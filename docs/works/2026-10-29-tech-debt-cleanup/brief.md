---
layer: works
module: global
status: closed
updated: 2026-10-29
---

# 工序：技术债清理（护栏、死代码、网关）

## 目标

清理 2026-10-29 规范性审视中已确认的技术债，分三批交付：

1. 让架构护栏真正会拦截违规（当前 `tests/architecture.test.ts` 的组件互调检查对相对导入空转）；
2. 清除已确认的死代码，统一 `ReferenceGuard` 的必填约束，把草稿保存规则从 HTTP 网关移回 skill 领域；
3. 把 `http-gateway/app.ts` 按变化原因拆成协议件与按资源的路由模块，为 B4 端点增长留出空间。

**不改变对外 REST 契约**：`/api/v1` 的路径、字段、状态码、错误码保持现状；`openapi.yaml` 的 47 个业务端点与 31 个 path 不变。

## 非目标

- 不补 skill store（T-DEBT-18，等下次改 skill 写路径）；
- 不优化 catalog N+1（T-DEBT-19，等测量或 B4）；
- 不抽跨组件 `toIso`/`escapeLike`/分页公共件（T-DEBT-20）；
- 不拆 `SkillService` / `SkillDraftService`（T-DEBT-21）；
- 不做请求上下文、结构化日志（T-DEBT-22）；
- 不改 `RevisionConflictError` 竞态兜底（T-DEBT-23，无法稳定复现）；
- 不做 JSON 请求体上限（T-DEBT-13，本轮未选）；
- 不引入 Web 框架、通用路由表或新依赖；
- 不重命名 `SkillNotFoundError` 等错误类。

## 基线

- HEAD：`bc26e2c feat(T-WF-110, SCN-0102): 工作流定义持久化画布视口`
- 工作区：`.agents/skills/*`、`AGENTS.md`、`docs/history/decisions/2026-10-29-review-verdict-pilot.md` 是评审试点改动，不属于本工序，不修改、不提交。
- 基线验证：`bun test --max-concurrency=1` → 249 pass / 0 fail / 2403 expect / 30 files；`tsc --noEmit` → 0；`bun run docs:check` → 最新。

## 范围与定级

- 工序整体 P2（跨组件结构清理）；子任务按 `arch-design-spec` 单独定级：测试/文档/死代码 P3，`guard` 必填、草稿规则下沉、路由拆分 P2。
- 人工确认：用户于 2026-10-29 确认执行 M1+M2+M3、同意删除死代码、计划批准后直接提交（P2 不再逐项签字）、建立本 brief。
- 执行纪律：一项任务只动一个组件（源码 + 规格 + 测试）；每项一个 commit，绑定 `T-DEBT-xx`；每项后跑全量测试、`tsc`、`docs:check`；失败即停。

## 任务表

| ID | 类型 | 组件 | 内容 | 状态 | 装载清单 |
|---|---|---|---|---|---|
| T-DEBT-00 | docs | global | 建立工序 brief | done | 本文件 |
| T-DEBT-01 | test | tests/global | 修正架构测试相对导入盲区；加 workflow；补循环依赖、Bun 文件 API、FileStore、kernel 检查；加自测 | done | `tests/architecture.test.ts` |
| T-DEBT-02 | chore | skill | 删 `store.ts`/`service.ts`/`types.ts` 占位壳；删 `read.ts` 不可达分支 | done | `src/components/skill/{store,service,types,read}.ts` |
| T-DEBT-03 | chore | expert | 删未引用的 `replaceSkillLinks`/`replaceToolLinks` | done | `src/components/expert/store.ts` |
| T-DEBT-04 | chore | workflow | 删未使用的 `EMPTY_GRAPH` | done | `src/components/workflow/graph.ts` |
| T-DEBT-05 | chore | gateway | 删 `parseSortQuery` 未使用的 `defaultSort` 参数 | done | `src/components/http-gateway/validation.ts` |
| T-DEBT-06 | docs | docs | README 组件/端点/B3 状态与表数口径；架构 §9 验证映射、§10 当前数、vendor 预算口径 | done | `README.md`、`docs/design/architecture.md` |
| T-DEBT-07 | chore | global | 加 `bun run check`（typecheck + test + docs:check），README 开发段写明 | done | `package.json`、`README.md` |
| T-DEBT-08 | refactor | skill | `SkillDraftDeps.guard` 必填，删裸抛分支；测试默认注入替身 | done | `src/components/skill/draft.ts`、`tests/components/skill/*` |
| T-DEBT-09 | refactor | expert | `ExpertDeps.guard` 必填，删静默跳过分支 | done | `src/components/expert/service.ts`、`tests/components/expert/*` |
| T-DEBT-10 | refactor | skill | `saveDraft` 校验 If-Match 规则并返回 `created`；更新 skill 规格；补服务测试 | done | `src/components/skill/{draft,contract}.ts`、`docs/design/components/skill/spec.md`、`tests/components/skill/*` |
| T-DEBT-11 | refactor | gateway | 保存端点改为解析 `baseRevision` + 委托 `saveDraft` + 按 `created` 映射 201/200 | done | `src/components/http-gateway/app.ts`、`tests/components/http-gateway/skill.test.ts` |
| T-DEBT-12 | refactor | gateway | 草稿创建复用 `readOptionalJsonObject`，保留 UUID 校验 | done | `src/components/http-gateway/app.ts` |
| T-DEBT-14 | refactor | gateway | 抽 `respond.ts`（json/noContent/markdown/notModified/errorResponse/statusFor/restCode） | done | `src/components/http-gateway/{app,respond}.ts` |
| T-DEBT-15 | refactor | gateway | 抽 `fields.ts`；加字段白名单 ↔ OpenAPI 一致性测试 | done | `src/components/http-gateway/{app,fields}.ts`、`tests/components/http-gateway/*` |
| T-DEBT-16 | refactor | gateway | 抽 `queries.ts`（5 个列表查询 + pagePayload） | done | `src/components/http-gateway/{app,queries}.ts` |
| T-DEBT-17 | refactor | gateway | 按资源拆 `routes/`（harness/tool/skill/expert/workflow；misc 保留 app）；`app.ts` 122 行、分派 ≤100 行 | done | `src/components/http-gateway/app.ts`、`src/components/http-gateway/routes/*` |

**未纳入本轮**：T-DEBT-13（JSON 请求体上限）、T-DEBT-18～23（见非目标）。

## 验收标准

1. **架构护栏**：`tests/architecture.test.ts` 对相对路径跨组件导入、循环依赖、Bun 文件 API 越界、`FileStore` 越界、kernel 反向依赖都能报红；用一条合成违规导入自测。
2. **死代码**：上述符号/文件删除后 `grep` 无引用，全量测试通过。
3. **完整性**：`guard` 无 `undefined` 分支；草稿保存的 400/428/201/200 由 skill 服务决定，网关不再读草稿判状态。
4. **网关拆分**：`app.ts` ≤250 行，路由分派 ≤100 行，字段数组与响应助手不在 `app.ts`；每个资源拆分后全量测试通过。
5. **文档**：README 与架构文档的组件数、端点数、表数、B3 状态与代码一致；`docs:check` 通过。
6. **回归**：每个任务后 `bun test --max-concurrency=1` 全绿、`tsc --noEmit` 为 0；最终测试数不少于 249。

## 评审与收口

- P2 工序：收口时写 `result.md` 与 `review.md`，按四档裁决（blocker / decision now / verified sound / hold）。
- Hold 项转入 `docs/plan/open-questions.md`，不在本工序 diff 内。
- 归档：整目录移入 `docs/history/works/`，frontmatter 改 `frozen`。

## 开放问题

- 无阻塞项。
- T-DEBT-13（JSON 上限）本轮未做；若后续有明确客户端约束，再定数值与 413 语义。
