---
layer: design
module: workflow-orchestration
status: verified
updated: 2026-11-11
flow: FLOW-EXE-PACKAGE-001
scenario: SCN-0203
domain: 工作流编排
valueStream: 执行面调度
title: 执行面技能包供给
entries:
  - component: CMP-http-gateway
    path: src/components/http-gateway/app.ts
    symbol: createHttpApp
  - component: CMP-skill
    path: src/components/skill/package-source.ts
    symbol: createSkillPackageSource
  - component: CMP-scheduler
    path: src/components/scheduler/service.ts
    symbol: createScheduler
docs:
  - path: docs/design/components/http-gateway/spec.md
    heading: 4.3 执行面端点
  - path: docs/design/components/skill/spec.md
    heading: 3.3 编排面制品供给
  - path: docs/design/components/kernel/spec.md
    heading: 3.6 执行面制品端口
tests:
  - role: R1
    id: TC-EXK-001
  - role: R2
    id: TC-EXK-002
  - role: R3
    id: TC-EXK-003
  - role: N1
    id: TC-EXK-004
externalRefs: []
---

# 执行面技能包供给

## 1 场景与价值

任务下发时携带 `skillSet`，client 按 `packageId` 取不可变技能包，按 `digest` 短路已安装的副本。

结果：client 拿到与任务快照一致的包字节并校验摘要；同一 digest 在 1000 个任务里只下载一次；不可变内容不会被同名/新版本悄悄替换。

## 2 入口

实现后入口（当前 `planned`）：

- HTTP：`CMP-http-gateway` 的执行面路由（`P-03` → `GET /api/v1/executor/skill-packages/{packageId}`）。
- 领域：`CMP-skill` 实现的 `SkillPackageSource` 端口（`describe` / `open`）。
- 生成 `skillSet` 的位置：`CMP-scheduler` 入队冻结（见 `SCN-0201`）。

## 3 运行序

流程定义：`FLOW-EXE-PACKAGE-001`。

1. 任务下发：`skillSet.packages[]` 每项含 `packageId`、`name`、`version`、`digest`、`sizeBytes`、`downloadUrl`、`etag`。
2. client 已在容器根 `.dsh/skills` 安装同 `digest` 的包 → 跳过下载与替换（`P-03` #5 热路径）。
3. 否则按 `downloadUrl` 请求 `P-03`，可带 `If-None-Match`（本机已有副本时）：`200` 返回 zip + `Content-Length` + `ETag` + `X-Checksum-Sha256` + `Cache-Control: private, max-age=3600`；命中 `304` 用本地缓存（`VR-01` 的前提是本地已有副本，client 侧修复）。
4. client 校验 `X-Checksum-Sha256` 与 `sizeBytes`；不匹配按 `P-03` #2 重试一次，仍失败报 `failed(asset)`。
5. 下载前按 `sizeBytes` 与 `maxSkillPackageBytes=64 MiB` 预检；超限中止。
6. 解压只到容器内 staging 目录，防路径穿越后原子替换 `.dsh/skills`；同一容器同一时刻只有一个安装临界区（`C-03`）。
7. 结束：任务进入执行；包内容在任务期间不变。

失败路径：

- `packageId` 未知或已下架：`404 package_not_found`，client 报 `failed(asset)` 不重试（`executor-http-v3` §4.3）。
- 服务端/依赖不可用（`5xx`）：client 退避重试，超过阈值报 `failed(asset)`；调度器按重试策略结算。
- 任务进行中 Skill 被保存为新版本：旧 `packageId` 不再可下载（当前不保留历史包），返回 404；新任务用新 `packageId` 与 digest。

## 4 不可变引用

- 契约：§4.3 `P-03` 语义与不变量、§5 `SkillPackage`/`SkillSet` 类型、`C-03`、`maxSkillPackageBytes` 常量。
- 制品身份：`packageId` 与内容一一对应，由 `CMP-skill` 发放；`digest`/`etag` 由包字节派生（[`CMP-kernel` §3.6](../../../../components/kernel/spec.md)）。
- Skill 包结构与摘要：`CMP-skill` 规格 §8；`packageId` 不变式见本场景 §3 与 `CMP-skill` §3.3。

## 5 测试方案

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-EXK-001` | `200 application/zip` 带 `Content-Length`、`ETag`、`X-Checksum-Sha256`、`Cache-Control`；响应字节 sha256 与任务快照 `digest` 一致，长度与 `sizeBytes` 一致 |
| R2 | `TC-EXK-002` | `If-None-Match` 命中 → `304` 无 body；不命中 → `200` 全量；不同 `packageId` 的 ETag 不同 |
| R3 | `TC-EXK-003` | 未知 `packageId` → `404 package_not_found`；包文件缺失/损坏 → `500 package_unavailable`；两种都不返回部分内容 |
| N1 | `TC-EXK-004` | Skill 保存新版本后旧 `packageId` 返回 404，新 `packageId` 的 `digest`/`etag` 不同；同一 Skill 同版本重复请求内容与 ETag 稳定 |

## 6 覆盖边界

- 不覆盖 client 侧解压、路径安全、安装临界区与 digest 短路实现（client 工序）。
- 不覆盖 `downloadUrl` 指向第三方签名 URL 的直取（`OQ-14` 未决，当前只走 `P-03`）。
- 不覆盖 Skill 包的建设与发布（`SCN-0002`）。
