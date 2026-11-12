---
layer: works
module: global
status: frozen
updated: 2026-11-12
procedure: 2026-11-12-client-skill-package-304
---

# 提案：缓存未命中时不得发送 `If-None-Match`（交 `agent-flow-client` 实施）

> 结论先行：客户端在「本地没有该技能包」时仍然用任务自带的 ETag 发条件请求，服务端按 HTTP 语义回 `304`，客户端于是报「304 但本地无缓存」并让节点失败。修复点只有一处：缓存未命中时把 `etag` 置空再下载。
> 对应开放问题：`OQ-17`（2026-11-10 记为 `VR-01`，当时判定「不阻塞」，本次实测触发）。

## 1 现象与影响

- 带技能包的任务在启动节点失败，错误：`download_failed: 技能包 304 但本地无缓存：工作流初始化`；节点耗时 1s，属于下载阶段失败，未进入 DSH 执行。
- 不带技能包的任务正常（历史数据：2026-11-12 08:53、08:54 两次 `packages=0` 成功；10:11 之后每次 `packages=1` 全部失败）。
- 影响面：任何需要从执行面下载技能包的运行，**首次下载必失败**，与网络、凭据、环境无关。技能包来源为本地目录（`file://` 或绝对路径）时不受影响。

## 2 证据

服务端对同一个包（`packageId=01a1cefc-16bd-74ba-b11e-ebe68a451fd3.1`，367 B）的实测：

```bash
# 不带条件头
curl -H 'x-executor-protocol: 3' ... /api/v1/executor/skill-packages/01a1cefc-….1
→ HTTP 200，367 bytes

# 带该包自己的 ETag（客户端当前行为）
curl -H 'x-executor-protocol: 3' -H 'If-None-Match: "sha256-570f19…"' ... 同一个包
→ HTTP 304
```

任务下发的 `skillSet.packages[]` 里带着这个 ETag：

```json
{"etag":"\"sha256-570f19…\"","name":"工作流初始化","digest":"sha256:570f19…",
 "skillId":"01a1cefc-…","version":"v1.0","packageId":"01a1cefc-….1","sizeBytes":367}
```

客户端日志（`<stateRoot>/logs/client.jsonl`）：`task.received` 后 1.3s 内 `task.reported status=failed`，中间没有下载成功的记录。

## 3 根因

```ts
// src/components/gateway/gateway.ts:64-73
async downloadPackage(pkg: SkillPackage): Promise<PackageDownload> {
  const result = await withRetry(async () => await this.#transport.getBytes(path, PACKAGE_TIMEOUT_MS, {
    ...(pkg.etag === undefined ? {} : { "If-None-Match": pkg.etag }),   // ← 无条件带
  }), ...);
  if (result.status === 304) return { notModified: true };
```

```ts
// src/components/assets/package-cache.ts:26-36
if (cachePath !== null && (await tryCache(cachePath, staging, limits))) return;  // ← 缓存未命中才走到下面
const fetched = await options.download(pkg);                                     // ← pkg 仍带 etag
if (fetched.notModified) throw new AssetError("download_failed", `技能包 304 但本地无缓存：${pkg.name}`);
```

`installRemotePackage` 在调用下载器之前**已经知道缓存不存在**（`tryCache` 返回 false），却仍把它当作「本机已有副本」去发条件请求。语义上等于问服务端「这个版本比我手上的新吗」，而它手上根本没有这个版本——服务端回 `304`（「没变」）完全正确，客户端却据此判定无字节可用。

## 4 修复方案

### 推荐 A：缓存未命中时不带条件头（一处改动）

```diff
 // src/components/assets/package-cache.ts
   if (cachePath !== null && (await tryCache(cachePath, staging, limits))) return;
-  const fetched = await options.download(pkg);
+  // 走到这里说明本地没有该 digest 的副本：任务里的 etag 是"目标版本"的，
+  // 带上它必然 304，而本地又没有可用的包。缓存未命中时不做条件请求。
+  const fetched = await options.download({ ...pkg, etag: undefined });
   if (fetched.notModified) throw new AssetError("download_failed", `技能包 304 但本地无缓存：${pkg.name}`);
```

- `SourcePackage.etag` 是可选的，置空后 `downloadPackage` 不发 `If-None-Match`，服务端回 `200`。
- 原有的 `if (fetched.notModified) throw` 保留为防御（例如代理层擅自返回 304）。
- `tryCache` 命中时根本不会走下载器，所以「已缓存 → 条件请求」这条优化仍然成立（当前代码实际上从不带缓存发条件请求，等于这条优化本来就没生效）。

### 备选 B：收到 304 后去掉条件头重试一次

在 `installRemotePackage` 里判断 `notModified` 时，用 `{...pkg, etag: undefined}` 再调一次下载器。可行，但多一次往返、多一条重试分支；A 更直接。

### 不改服务端的原因

服务端 `304` 是 `executor-http-v3` `P-03` 的明文约定（`If-None-Match` 与 ETag 相等 → `304`），也是唯一能让「客户端已有副本」省流量的机制。服务端无法知道客户端有没有缓存，让服务端忽略条件头等于删掉这条契约，并让每次下发都全量传输。

## 5 测试

在 `tests/components/assets/package.test.ts` 补两条（现有 `skillSet()` 需要支持 `etag`）：

```ts
function skillSet(digest: string, etag?: string): SkillSet {
  return {
    digest,
    packages: [{
      packageId: "p-1", name: "alpha", version: "1", digest, sizeBytes: 0,
      downloadUrl: "/api/v1/executor/skill-packages/p-1",
      ...(etag === undefined ? {} : { etag }),
    }],
  };
}

test("缓存未命中时下载不带条件头：etag 被清空", async () => {
  const { bytes, sha256 } = await makeZip();
  let seen: string | undefined | "unset" = "unset";
  const assets = new LocalAssets({}, {
    download: async (pkg) => {
      seen = pkg.etag;
      return { bytes, notModified: false, sha256 };
    },
  });
  await assets.install(skillSet(`sha256:${sha256}`, '"sha256-abc"'), await container());
  expect(seen).toBeUndefined();
});

test("本地已有缓存时不调用下载器（条件请求优化仍有意义）", async () => {
  const { bytes, sha256, digest } = await makeZip();
  const calls = { count: 0 };
  const cacheRoot = await mkdtemp(join(tmpdir(), "afc-v2-cache-"));
  const assets = new LocalAssets({}, { cacheRoot, download: downloader(bytes, sha256, calls) });
  await assets.install(skillSet(digest, '"sha256-abc"'), await container());
  await assets.install(skillSet(digest, '"sha256-abc"'), await container());
  expect(calls.count).toBe(1);
});
```

> 第二条与现有「同 digest 二次安装只下载一次」重复时，保留现有那条即可，只补第一条。

## 6 验收

| ID | 断言 |
|---|---|
| `TC-PKC-1` | 缓存未命中 + 任务带 `etag`：下载器收到的 `etag` 为 `undefined`，请求不带 `If-None-Match`，安装成功 |
| `TC-PKC-2` | 缓存命中：不调用下载器（现有用例覆盖） |
| `TC-PKC-3` | 下载器返回 `notModified: true`（防御路径）：仍报 `download_failed`，不静默成功 |
| 手工 | 起一个带技能包的 run：节点进入 `running` 并真正执行，不再 1s 内 `failed(asset)` |

## 7 修复前的临时办法

- 跑不带技能包的工作流可以验证其他链路。
- 若要强行跑通：把该包的 zip 预置到 `<stateRoot>/cache/skills/<digest 中非字母数字替换为 ->.zip`（当前失败包的路径为 `…/cache/skills/sha256-570f1935….zip`），`tryCache` 命中后不再下载。缺点是每换一个技能版本都要重做一次，不建议长期使用。

## 8 回滚与风险

- 改动是「少发一个请求头」，无状态、无迁移；回滚即恢复原行。
- 唯一的行为差异：缓存未命中时不再收到 `304`，代理/中间层若擅自缓存 `304` 也不会影响（没有条件头就不会有 `304`）。
- 与 `VR-01` 的另一种处理方式（契约写明「304 只在客户端已有副本时可回」）不冲突：契约已经这么写了，缺的是客户端实现遵循。
