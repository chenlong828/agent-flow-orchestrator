---
layer: works
module: global
status: closed
updated: 2026-10-29
---

# 结果：技术债清理（护栏、死代码、网关）

## 结论

本轮 M1+M2+M3 全部完成：架构护栏从“对相对导入空转”改为可拦截跨组件导入、循环依赖、Bun 文件 API 越界、`FileStore` 越界与 kernel 反向依赖；死代码与迁移期占位壳删除；`ReferenceGuard` 改为必填；草稿保存的 `If-Match` 与 201/200 规则下沉到 `SkillDraftService`；`http-gateway` 拆为协议件 + 按资源路由，`app.ts` 从 845 行降到 122 行。REST 的 47 个业务端点与字段/状态码保持不变。

## 交付

| 任务 | 结果 |
|---|---|
| T-DEBT-00 | 建立工序 `brief.md`（`9fddac3`） |
| T-DEBT-01 | 重写 `tests/architecture.test.ts`：相对导入解析、`workflow` 纳入领域组件、循环依赖、Bun 文件 API、`FileStore`、kernel 反向依赖；含合成违规自测（`c91657f`） |
| T-DEBT-02 | 删除 `skill/{store,service,types}.ts` 占位壳与 `read.ts` 不可达分支（`cb09eb4`） |
| T-DEBT-03 | 删除 `expert/store.ts` 未引用的 `replaceSkillLinks`/`replaceToolLinks`（`b3aea26`） |
| T-DEBT-04 | 删除 `workflow/graph.ts` 未使用的 `EMPTY_GRAPH`（`8db6ab1`） |
| T-DEBT-05 | 删除 `parseSortQuery` 未使用的 `defaultSort` 参数（`f2b161c`） |
| T-DEBT-06 | README 与架构文档对齐：10 个组件、16 张表、5 个迁移、47 个业务端点、B3 已实现（`1d317a0`） |
| T-DEBT-07 | 增加 `bun run check`（typecheck + test + docs:check），README 开发段写明（`57484fa`） |
| T-DEBT-08 | `SkillDraftDeps.guard` 必填，删除裸抛分支；测试默认注入替身（`1c3c77d`） |
| T-DEBT-09 | `ExpertDeps.guard` 必填，删除静默跳过分支（`00d486a`） |
| T-DEBT-10 | `saveDraft` 校验 If-Match 规则、返回 `created`/`updatedAt`；更新 skill 规格与服务测试（`7144236`） |
| T-DEBT-11 | 保存端点解析 `baseRevision`、委托 `saveDraft`、按 `created` 映射 201/200；`created` 不进入 REST body（`19aedc6`） |
| T-DEBT-12 | 草稿创建复用 `readOptionalJsonObject`，保留 UUID 校验（`47befb4`） |
| T-DEBT-14 | 抽 `respond.ts`：`json`/`noContent`/`markdown`/`notModified`/`errorResponse`/`statusFor`/`restCode`（`057664a`） |
| T-DEBT-15 | 抽 `fields.ts`；新增 13 个 schema 的字段白名单 ↔ OpenAPI 一致性测试（`6c0981b`、`ceff0d9`） |
| T-DEBT-16 | 抽 `queries.ts`：5 个列表查询 + `pagePayload`（`95174eb`） |
| T-DEBT-17 | 抽 `dto.ts`/`yaml.ts`；按资源拆 `routes/{harness,tool,skill,expert,workflow}.ts`；`app.ts` 只留入口、健康检查、分类与分派（`2264099`、`4570f23`）；补 UUID 校验顺序（`4d2efc9`） |

## 验证

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `node_modules/.bin/tsc --noEmit` | 0 |
| 全量测试 | `bun run check` | 269 pass / 0 fail，31 个文件，2440 个断言 |
| 场景索引 | `bun run scripts/scenario-index.ts --check` | 4 个场景，索引最新 |
| 架构护栏 | `bun test tests/architecture.test.ts` | 11 pass，含合成违规自测 |
| 字段白名单 | `bun test tests/components/http-gateway/openapi-fields.test.ts` | 13 pass，13 个 schema 精确对齐 |
| 网关尺寸 | `wc -l src/components/http-gateway/app.ts` | 122 行（验收 ≤250） |

基线为 249 pass / 0 fail / 2403 expect / 30 files；最终增加 20 个测试、1 个测试文件，无既有测试删除。

## 行为与边界

- 保存 Skill 草稿：新建草稿带 `If-Match` 返回 400；已有草稿缺 `If-Match` 返回 428；旧 revision 返回 409；新建保存 201，更新保存 200。`created` 只用于传输层选状态码，不进入响应 body；`updatedAt` 按 `SkillSaveResult` 契约返回。
- `ReferenceGuard` 在两个领域服务中均为必填依赖，组合根负责注入；测试用显式替身，不再依赖“未注入就跳过”。
- 架构测试的合成违规自测确保护栏本身不会再次空转；`http-gateway` 仍不碰 store、不碰 `FileStore`。
- `app.ts` 不再包含字段数组、查询解析、响应助手、DTO 校验或 YAML 序列化；路由模块按资源聚合，`misc` 保留在入口（健康检查、`skill-categories`、分派）。
- 未新增依赖、Web 框架或通用路由表；`openapi.yaml` 的 31 个 path / 47 个业务端点未变。

## 偏差与说明

- `T-DEBT-17` 原计划 6 个 commit（含 `misc`），实际按依赖顺序拆为 3 个：`17a` 抽 DTO/YAML、`17` 拆 5 个资源路由、`fix` 保持未知路径的 UUID 校验顺序；`misc` 仅 10 余行，保留在 `app.ts`，未单列文件。功能与验收目标不变。
- `T-DEBT-15` 的字段一致性测试使用 `Bun.YAML.parse` 读取 `openapi.yaml`，解析 `allOf`/`$ref` 后按 schema 逐项比对；这是对“网关 DTO 与契约漂移”的回归护栏，不改变运行时行为。
- `SkillSaveResult` 增加 `updatedAt` 是修正既有规格/OpenAPI 与代码的漂移；OpenAPI 早已要求该字段。

## 未做与遗留

- `T-DEBT-13`（JSON 请求体上限）本轮未选，未做。
- Hold 项：skill store（T-DEBT-18）、catalog N+1（T-DEBT-19）、跨组件公共件（T-DEBT-20）、`SkillService` 拆分（T-DEBT-21）、请求上下文/结构化日志（T-DEBT-22）、`RevisionConflictError` 竞态兜底（T-DEBT-23）。
- 网关当前有 7 个外部依赖；若 B4 增加到 8 个，需先决定“记录为硬上限例外”还是引入 facade，本轮不预置。
- 未做 CI 接入；`bun run check` 是本地统一入口，接入流水线属于后续工序。
