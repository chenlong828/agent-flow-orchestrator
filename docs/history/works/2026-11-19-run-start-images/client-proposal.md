---
layer: works
module: run
status: frozen
updated: 2026-11-20
procedure: 2026-11-19-run-start-images
target: agent-flow-client
---

# Client 提案：初始资料拉取与图片模型能力

> 依据：[`proposal.md`](proposal.md) 与 2026-11-19 用户裁决（client 支持图片；粘贴即上传；只支持图片）。
> 本文给 `agent-flow-client` 项目使用，描述客户端需要实现的模型配置、执行面拉取、task-space 落盘与测试；后端契约以 [`proposal.md`](proposal.md) §5.1/§5.2 为准。本文不改 client 代码。
>
> **2026-11-19 client 已实现**：`T-CLI-IMG-01`–`07` 已落地，`bun run check` 285 pass，`promptCapabilities.image=true`，`read_image` 实测通过；真实 orchestrator 联调待编排侧 `EXE-06/07` 落地。见 [result.md](../../../../../agent-flow-client/docs/works/2026-11-19-run-start-inputs/result.md)。

## 1 目标

1. **打开图片能力**：把 S0 模型路由声明为支持图片输入，使 `read_image` 可用；用真实图片验证。
2. **声明能力**：poll 时带 `X-Executor-Capabilities: run-inputs`，让编排侧知道可以给本 client 派发带图片初始资料的 run。
3. **拉取初始资料**：拿到带 `runId` 的任务后，从执行面 `EXE-06/07` 列出并下载图片，校验 SHA-256，写入 `<task-space>/inputs/`，再建 session。
4. **失败显式**：下载/校验/路径失败让任务以 `asset` 类错误失败，不建 session、不让模型在缺少资料时继续。
5. **向后兼容**：旧服务端没有 `EXE-06/07` 时按「无初始资料」继续；不升 `X-Executor-Protocol` 版本。

## 2 非目标

- 不做通用文件（PDF、文本等）拉取；只处理图片。
- 不做上传：图片由 UI 上传到编排侧，client 只下载。
- 不做图片编辑、压缩、OCR、缩略图；原图落盘，模型按需 `read_image`。
- 不改 `TaskRequest` 结构（`runId` 已有）；不改 ACP prompt 内容（仍为文本）。
- 不做 IMDS/远端对象存储；走现有执行面 HTTP + 本地文件系统。
- 不做本地缓存跨 run 复用；task-space 按 run 隔离。

## 3 依赖的后端契约

| 用途 | 请求 | 成功 |
|---|---|---|
| 能力声明 | `POST /api/v1/executor/poll` 增加可选头 `X-Executor-Capabilities: run-inputs` | 服务端记录到 presence |
| 列出初始资料 | `GET /api/v1/executor/runs/{runId}/inputs` | 200 `{ items: ExecutorRunInputRef[] }`；无图片 `[]` |
| 下载单张 | `GET /api/v1/executor/runs/{runId}/inputs/{inputId}` | 200 二进制；`Content-Type` 为 image/*；`X-Checksum-Sha256` |
| 失败 | 见下 | `401 unauthorized`、`404 run_not_found`/`input_not_found`、`503 service_unavailable` |

```ts
type ExecutorRunInputRef = {
  inputId: string;
  name: string;           // 服务端已清洗/去重；仍要二次校验
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  sizeBytes: number;
  sha256: string;         // 64 位小写十六进制
  downloadPath: string;   // 相对 executor base（/api/v1/executor）：/runs/{runId}/inputs/{inputId}
};
```

关键约定：

- `TaskRequest` 不改；`runId?` 已由文件浏览工序落地，client 用它拉取。
- `downloadPath` 已经是相对 `/api/v1/executor` 的路径，`HttpTransport.getBytes(downloadPath)` 可直接使用；client 不要自己拼 `/api/v1/executor` 前缀。
- `X-Executor-Protocol` 仍为 `3`；`EXE-06/07` 是加法端点。
- 服务端只对「属于该 `clientId` 的 run」返回数据；401/404 按失败处理。
- 服务端保证 `name` 已清洗；client 仍做路径安全校验（防御 task-space 内已有符号链接/异常名）。

## 4 现状与缺口

| 事实 | 位置 | 影响 |
|---|---|---|
| client 的 pi-ai 模型条目只有 `{ id, name }` | [`profile.ts`](../../../../../agent-flow-client/src/components/runtime/profile.ts) 第 47 行 | 路由未声明图片输入，`read_image` 被拒 |
| ACP `initialize` 当前 `promptCapabilities.image=false` | [`summary.protocol.jsonl`](../../../../../agent-flow-client/docs/history/works/2026-11-14-acp-progress-feedback/probe/summary.protocol.jsonl) 第 2 行 | 佐证路由未声明；补 `input` 后应变为 true |
| prompt 只发 `{type:"text"}` | [`runtime.ts`](../../../../../agent-flow-client/src/components/runtime/runtime.ts) 第 138 行 | 不靠 ACP 图片块；走文件 + `read_image` |
| task-space 只 `mkdir -p`，不写内容 | [`workspace.ts`](../../../../../agent-flow-client/src/components/workspace/workspace.ts) 第 94–106 行 | 需要新增受控写入 `inputs/` |
| 执行面客户端只有 poll/result/package/log/archive | [`gateway.ts`](../../../../../agent-flow-client/src/components/gateway/gateway.ts) | 需要新增 list/download 方法与 wire 解析 |
| 任务执行前没有「准备资料」步骤 | [`executor.ts`](../../../../../agent-flow-client/src/components/executor/executor.ts) `#prepareTask` | 在 `ensureTaskSpace` 后、建 session 前插入 seed |
| `result.ts` 的错误分类没有初始资料码 | [`result.ts`](../../../../../agent-flow-client/src/components/result/result.ts) `MAPPING` | 新码归 `asset` |

## 5 设计总览

```text
poll（X-Executor-Capabilities: run-inputs）
  │
  ▼
task（runId / taskSpacePath / prompt）
  │
  ├─ ensureContainer / ensureTaskSpace          # 现有
  ├─ seedRunInputs(task)                         # 新增
  │    ├─ GET /executor/runs/{runId}/inputs
  │    ├─ 逐张：已存在且 size 相同 → 跳过
  │    ├─ GET downloadPath（重试 3 次）
  │    ├─ 校验 size + sha256
  │    └─ 原子写入 <task-space>/inputs/<name>（只读）
  ├─ ensureInstance / session/new               # 现有
  ├─ assets.install                             # 现有
  └─ prompt（文本里已有 [初始资料] 清单）        # 现有
```

`seedRunInputs` 失败在 `ensureInstance` 之前抛出，不会拉起 DSH 进程；`#runTask` 的 catch 会组装 `failed` 结果，`error.class = "asset"`。

## 6 具体改动

### 6.1 图片模型能力（前置，单独先做）

[`runtime/profile.ts`](../../../../../agent-flow-client/src/components/runtime/profile.ts)：

```ts
export type ModelInput = "text" | "image";

export type ProfileModel = {
  provider: string;
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  /** 该路由声明的输入模态；缺省按 text。 */
  input?: ModelInput[];
};

export const S0_MODEL: ProfileModel = {
  provider: "hundsun-public",
  model: "hs-deepseek-flash-latest",
  baseUrl: "http://47.93.127.129:10088/v1",
  apiKeyEnv: "HUNDSUN_PUBLIC_API_KEY",
  input: ["text", "image"],
};

// writeProfilePatch 内：
models: [{
  id: model.model,
  name: model.model,
  input: model.input ?? ["text", "image"],
}]
```

- `AF_MODEL` 只覆盖模型 id，不覆盖 `input`；若部署把 `AF_MODEL` 指到纯文本模型，需同步改 `input`，否则 `read_image` 会在 provider 处失败。
- 改完跑真实验证：起一次 `--profile acp` 会话，调用 `read_image` 读一张 PNG，确认模型能描述内容；同时可看 ACP `initialize` 是否变为 `promptCapabilities.image=true`。
- 该改动与初始资料拉取解耦，可以先合入、先验证。

### 6.2 能力声明（poll 头）

[`gateway/transport.ts`](../../../../../agent-flow-client/src/components/gateway/transport.ts)：

- 给 `#request` 的调用增加可选 `headers`（`get/getBytes` 已有；`post` 增加第 4 个参数）。
- 在 [`gateway.ts`](../../../../../agent-flow-client/src/components/gateway/gateway.ts) 的 `poll` 传入：

```ts
const CAPABILITIES: Record<string, string> = { "X-Executor-Capabilities": "run-inputs" };

async poll(request: PollRequest): Promise<PollResponse> {
  const result = await this.#transport.post(
    "/poll",
    serializePollRequest(request),
    this.#pollTimeoutMs,
    CAPABILITIES,
  );
  return parsePollResponse(result.body);
}
```

- 只给 poll 带这个头，不污染 result/log/archive 请求；服务端只读 poll。
- 旧服务端忽略未知头；不升协议版本。

### 6.3 拉取端口与 wire 解析

**类型**（[`executor/types.ts`](../../../../../agent-flow-client/src/components/executor/types.ts)）：

```ts
export type ExecutorRunInput = {
  inputId: string;
  name: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  sizeBytes: number;
  sha256: string;
  downloadPath: string;
};
```

**端口**（[`executor/ports.ts`](../../../../../agent-flow-client/src/components/executor/ports.ts)）：

```ts
export interface RunInputPort {
  listRunInputs(runId: string): Promise<ExecutorRunInput[]>;
  downloadRunInput(ref: ExecutorRunInput): Promise<Uint8Array>;
}
```

**wire 解析**（[`gateway/wire.ts`](../../../../../agent-flow-client/src/components/gateway/wire.ts)）：新增 `parseRunInputs`，逐字段校验，非法即 `protocol_error`：

```ts
export function parseRunInputs(body: unknown): ExecutorRunInput[] {
  const root = asRecord(body, "runInputs");
  return asArray(root.items, "runInputs.items").map((raw, index) => {
    const item = asRecord(raw, `runInputs.items[${index}]`);
    return {
      inputId: asString(item.inputId, "runInputs.items[].inputId"),
      name: asString(item.name, "runInputs.items[].name"),
      mediaType: asString(item.mediaType, "runInputs.items[].mediaType") as ExecutorRunInput["mediaType"],
      sizeBytes: asNumber(item.sizeBytes, "runInputs.items[].sizeBytes"),
      sha256: asString(item.sha256, "runInputs.items[].sha256"),
      downloadPath: asString(item.downloadPath, "runInputs.items[].downloadPath"),
    };
  });
}

// downloadPath 必须相对 executor base 且只指向 run inputs 资源：
//   /runs/{runId}/inputs/{inputId}
export function assertInputDownloadPath(path: string): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new GatewayError("protocol_error", `初始资料下载路径非法：${path}`);
  }
  if (!path.startsWith("/runs/") || decoded.includes("..") || path.includes("://")) {
    throw new GatewayError("protocol_error", `初始资料下载路径非法：${path}`);
  }
}
```

**网关实现**（[`gateway/gateway.ts`](../../../../../agent-flow-client/src/components/gateway/gateway.ts)）：

```ts
const RUN_INPUT_TIMEOUT_MS = 120_000;

export class HttpScheduler implements SchedulerPort, RunInputPort {
  async listRunInputs(runId: string): Promise<ExecutorRunInput[]> {
    try {
      const response = await withRetry(
        async () => await this.#transport.get(`/runs/${encodeURIComponent(runId)}/inputs`, RUN_INPUT_TIMEOUT_MS),
        this.#options.retry,
      );
      return parseRunInputs(response.body);
    } catch (error) {
      // 旧服务端没有该端点：按「无初始资料」继续。
      if (error instanceof GatewayError && error.status === 404) return [];
      throw error;
    }
  }

  async downloadRunInput(ref: ExecutorRunInput): Promise<Uint8Array> {
    assertInputDownloadPath(ref.downloadPath);
    const response = await withRetry(
      async () => await this.#transport.getBytes(ref.downloadPath, RUN_INPUT_TIMEOUT_MS),
      this.#options.retry,
    );
    if (response.bytes === null) {
      throw new GatewayError("protocol_error", "初始资料响应为空");
    }
    return response.bytes;
  }
}
```

`HttpTransport` 需要新增 `get(path, timeoutMs)`（JSON）——`getBytes` 已有但会返回二进制；list 用 JSON。

### 6.4 task-space 受控写入

[`workspace/workspace.ts`](../../../../../agent-flow-client/src/components/workspace/workspace.ts) 实现三个新方法：

```ts
export interface WorkspacePort {
  // ...现有
  /** 创建 <task-space>/inputs（0700），返回真实路径。 */
  ensureInputsDir(taskSpacePath: string): Promise<string>;
  /** 已存在且是普通文件时返回 size；不存在返回 null；符号链接/目录报错。 */
  inputStat(taskSpacePath: string, name: string): Promise<{ size: number } | null>;
  /** 原子写入：同目录 .part → rename；只读 0400；拒绝路径穿越/符号链接。 */
  writeInput(taskSpacePath: string, name: string, bytes: Uint8Array): Promise<void>;
}
```

实现要点：

- `name` 二次校验：非空、非 `.`/`..`、`basename(name) === name`、不含 `/`、`\`、NUL、控制字符、不是绝对路径；`resolve(inputsDir, name)` 必须在 `inputsDir` 内。
- `inputsDir` 与目标的 `realpath` 都必须在 `<task-space>` 内；目标本身是符号链接时拒绝（模型可在 task-space 写文件，必须防「先建符号链接再把图片引到工作区外」）。
- `writeInput`：`mkdir(inputsDir, {recursive:true, mode:0o700})` → 写 `<name>.<random>.part`（`0o600`）→ `rename` 到 `<name>` → `chmod 0o400`；失败清理临时文件。Windows 上 `rename` 覆盖失败时先 `rm` 再 rename。
- 文件只读是「初始资料不可变」的约定；后续任务按 size 跳过下载即建立在此之上。模型若确实需要副本，应复制到别处，不要改原文件。

### 6.5 执行前 seed

[`executor/executor.ts`](../../../../../agent-flow-client/src/components/executor/executor.ts)：

- `NodeExecutorOptions` 增加：

```ts
runInputs?: RunInputPort;
```

- `#prepareTask` 在 `ensureTaskSpace(...)` 之后、`ensureInstance(...)` 之前调用：

```ts
await this.#seedRunInputs(task);
```

- 新增私有方法：

```ts
async #seedRunInputs(task: TaskRequest): Promise<void> {
  if (task.runId === undefined || this.#options.runInputs === undefined) return;
  let refs: ExecutorRunInput[];
  try {
    refs = await this.#options.runInputs.listRunInputs(task.runId);
  } catch (error) {
    throw new ExecutorError("input_fetch_failed", `拉取初始资料列表失败：${(error as Error).message}`);
  }
  if (refs.length === 0) return;
  await this.#options.workspace.ensureInputsDir(task.taskSpacePath);

  for (const ref of refs) {
    try {
      const existing = await this.#options.workspace.inputStat(task.taskSpacePath, ref.name);
      if (existing !== null && existing.size === ref.sizeBytes) {
        this.#options.log?.("run_inputs.skip", { inputId: ref.inputId, name: ref.name });
        continue;
      }
      const bytes = await this.#options.runInputs.downloadRunInput(ref);
      if (bytes.byteLength !== ref.sizeBytes || sha256Hex(bytes) !== ref.sha256) {
        throw new ExecutorError("input_checksum_mismatch", `初始资料校验失败：${ref.name}`);
      }
      await this.#options.workspace.writeInput(task.taskSpacePath, ref.name, bytes);
      this.#options.log?.("run_inputs.stored", { inputId: ref.inputId, name: ref.name, bytes: bytes.byteLength });
    } catch (error) {
      if (error instanceof ExecutorError) throw error;
      if (error instanceof WorkspaceError) {
        if (error.code === "path_escape") {
          throw new ExecutorError("input_path_invalid", `初始资料路径非法：${ref.name}`);
        }
        throw error; // 磁盘满/权限保持 workspace 分类
      }
      throw new ExecutorError("input_fetch_failed", `拉取初始资料失败：${ref.name}`);
    }
  }
}
```

- `sha256Hex` 用 `node:crypto`：

```ts
function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
```

逐张下载，不一次性把所有字节放内存。
- **重试**：网络/5xx/超时由 `withRetry` 在 `HttpScheduler` 内做（3 次，退避）；`input_fetch_failed` 是最终结果。401/404 不重试（`GatewayError.retryable` 只含 `unreachable/timeout`）。
- **幂等**：已存在且 size 相同即跳过；重派、`resumeNode`、崩溃重启都不会重复下载。
- **失败语义**：抛 `ExecutorError`；`#runTask` 的 catch 会得到 `code`，`classify` 映射到 `asset`，结果 `failed`；session 未创建。
- **日志**：`run_inputs.list/skip/stored/failed` 走现有 `log` 回调；不记录字节。

### 6.6 错误码与分类

[`result/result.ts`](../../../../../agent-flow-client/src/components/result/result.ts) 的 `MAPPING` 的 `asset` 行增加：

```ts
input_fetch_failed
input_checksum_mismatch
input_path_invalid
```

三者都归 `asset`；不改 `scheduler`/`workspace` 的现有码。若更希望 `input_path_invalid` 归 `workspace`，可以换，但 UI/编排只看 `status=failed`，不影响语义；建议统一 `asset`，便于「输入资料问题」聚合。

### 6.7 组合根

[`cli/serve-compose.ts`](../../../../../agent-flow-client/src/components/cli/serve-compose.ts)：

- `HttpScheduler` 已实现 `RunInputPort`；`createExecutor` 的入参增加 `runInputs`，并在 `new NodeExecutor({ ... runInputs })` 传入。
- `composeForServe` 调用 `createExecutor({ ..., runInputs: gateway })`。
- `HttpTransport` 不需要新配置；能力头在 `poll` 里固定发送。

[`cli/compose.ts`](../../../../../agent-flow-client/src/components/cli/compose.ts) 的本地 `run` 不传 `runInputs`：手工任务没有执行面，跳过 seed；这与「无 runId 的任务」行为一致。

### 6.8 文档与版本

- `README.md` 的 v3 能力清单增加「run 初始资料拉取（`EXE-06/07`，`run-inputs` 能力）」。
- `docs/design/contracts/executor-http-v3.md`（client 仓库副本）同步新增 `EXE-06/07` 与能力头；如 client 只保留一份引用，更新引用即可。
- 不升客户端版本号（除非项目惯例要求）；`X-Executor-Protocol` 保持 `3`。

## 7 行为细节

| 场景 | 行为 |
|---|---|
| `task.runId` 缺失 | 跳过 seed；正常执行（手工任务/旧服务端） |
| `EXE-06` 404（旧服务端） | 视为无初始资料，继续执行；不报错 |
| 初始资料列表为空 | 不建 `inputs/`，继续执行 |
| 同一 run 的后续任务 | 列出后按 size 跳过；不重复下载 |
| 任务被重派（S-02） | 同上；已存在文件不重复写 |
| `resumeNode` 重开同一 task | 同上；task-space 保留 |
| 文件被删除/大小不符 | 重新下载并原子覆盖 |
| 下载 5xx/超时 | `withRetry` 3 次；仍失败 → `input_fetch_failed` |
| 下载 401/404 | 不重试 → `input_fetch_failed` |
| SHA/长度不符 | `input_checksum_mismatch`；下载后先校验，失败不写，已有文件保持原状 |
| 名称非法/符号链接 | `input_path_invalid`；不写 |
| 磁盘满/权限 | `writeInput` 抛 `WorkspaceError`（`permission_denied`/`disk_full`）→ `#seedRunInputs` 原样抛出，`classify` 归 `workspace` |

> 上面的 catch 已按此实现：`WorkspaceError` 中只有 `path_escape` 转成 `input_path_invalid`，其余（`permission_denied`/`disk_full`）原样抛出，由 `classify` 归 `workspace`，避免把磁盘问题误报成下载失败。

## 8 测试

### 8.1 单元/组件

| 文件 | 用例 |
|---|---|
| `tests/components/gateway/transport.test.ts` | poll 带 `X-Executor-Capabilities: run-inputs`；其他请求不带；未知头兼容 |
| `tests/components/gateway/wire.test.ts` | `parseRunInputs` 正常/缺字段/非法类型；空列表 |
| `tests/components/gateway/gateway.test.ts` | list 200/404→[]；download 200/字节；5xx 重试；超时 |
| `tests/components/workspace/task-space.test.ts` | `ensureInputsDir`；`inputStat`；`writeInput` 原子写/只读/覆盖；`..`/绝对路径/符号链接拒绝 |
| `tests/components/executor/execute.test.ts` | 无 runId 跳过；空列表跳过；下载并写 `inputs/`；已存在 size 相同跳过；checksum 失败 → `failed(asset)`；路径非法 → `input_path_invalid`；下载失败 → `input_fetch_failed` |
| `tests/components/result/result.test.ts` | 三个新码归 `asset` |
| `tests/scenarios/v3-serve.test.ts` | 桩调度器带 `inputs` 列表与字节，真实 `serve` 跑完一个任务，task-space 出现 `inputs/` |

### 8.2 真实联调

1. 起编排 + client + 一段带初始资料的工作流；UI 上传 2 张 PNG。
2. 首节点任务日志出现 `run_inputs.stored` 两条；`<task-space>/inputs/` 有 2 个只读文件。
3. 首节点模型 `read_image` 能描述图片（ACP 路由已声明图片输入）。
4. 重派/续跑不重复下载；改动其中一张文件大小后下一任务会重新拉取。
5. 归档 tar 包含 `inputs/`。

## 9 风险与验证

| # | 风险 | 处置 |
|---|---|---|
| `RC-01` | `hundsun-public` 路由实际不接受图片 | 6.1 的真实 `read_image` 验证；不通过则停或换路由 |
| `RC-02` | `read_image` 不在 `--profile acp` 工具目录 | 会话实测；必要时调整 `tool-fs`/`attachment-local` 挂载 |
| `RC-03` | `AF_MODEL` 覆盖为纯文本模型但 `input` 仍声明图片 | 配置文档写明；或在 `modelFromEnv` 允许 `AF_MODEL_INPUT` 覆盖 |
| `RC-04` | task-space 内符号链接把图片写到工作区外 | `writeInput` 逐级 `realpath` + `lstat` 拒绝；测试覆盖 |
| `RC-05` | 服务端副本缺失/损坏 | 下载失败让任务失败并报 `input_fetch_failed`，不静默继续 |
| `RC-06` | 旧服务端 404 被误判为「无资料」 | 404 只在 `runId` 存在时被视为兼容路径；日志 `run_inputs.unavailable` 便于排查 |
| `RC-07` | 8 MB × N 的下载/内存 | 逐张下载、校验、落盘；不聚合全部字节 |
| `RC-08` | 图片只读后模型想编辑 | 文档说明「初始资料不可变」；模型应复制到别处再改 |

## 10 任务清单

| ID | 类型 | 内容 | 依赖 |
|---|---|---|---|
| `T-CLI-IMG-01` | change | `profile.ts` 模型 `input` + 真实 `read_image` 验证 | 无 |
| `T-CLI-IMG-02` | change | transport `post` 可选头 + poll 能力头 + `get` JSON | — |
| `T-CLI-IMG-03` | change | `ExecutorRunInput` 类型、`RunInputPort`、`parseRunInputs`、`HttpScheduler` list/download | T-CLI-IMG-02 |
| `T-CLI-IMG-04` | change | workspace `ensureInputsDir`/`inputStat`/`writeInput` + 路径安全 | — |
| `T-CLI-IMG-05` | change | executor `runInputs` 选项与 `#seedRunInputs` + 错误码/分类 | 03/04 |
| `T-CLI-IMG-06` | test | 上述单元/组件/场景测试 | 01–05 |
| `T-CLI-IMG-07` | docs | README 与 executor 契约副本 | 05 |

> 状态（2026-11-19）：`T-CLI-IMG-01`–`07` 已全部完成，`bun run check` 285 pass，读图探针通过；见 [result.md](../../../../../agent-flow-client/docs/works/2026-11-19-run-start-inputs/result.md)。

## 11 参考

- 后端方案：[`proposal.md`](proposal.md)
- UI 方案：[`ui-proposal.md`](ui-proposal.md)
- 现有执行面客户端：[`gateway.ts`](../../../../../agent-flow-client/src/components/gateway/gateway.ts)、[`transport.ts`](../../../../../agent-flow-client/src/components/gateway/transport.ts)、[`wire.ts`](../../../../../agent-flow-client/src/components/gateway/wire.ts)
- 现有执行内核：[`executor.ts`](../../../../../agent-flow-client/src/components/executor/executor.ts)、[`ports.ts`](../../../../../agent-flow-client/src/components/executor/ports.ts)
- 工作区：[`workspace.ts`](../../../../../agent-flow-client/src/components/workspace/workspace.ts)
- 模型配置：[`profile.ts`](../../../../../agent-flow-client/src/components/runtime/profile.ts)
- 能力探针：[`summary.protocol.jsonl`](../../../../../agent-flow-client/docs/history/works/2026-11-14-acp-progress-feedback/probe/summary.protocol.jsonl)
- 本机读图实测：[`vision-probe.md`](probe/vision-probe.md)
