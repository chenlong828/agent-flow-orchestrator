---
layer: works
module: global
status: closed
updated: 2026-10-29
---

# 评审：技术债清理（护栏、死代码、网关）

评审对象：`brief.md`、`result.md` 与 `bc26e2c..ceff0d9` 的代码/文档变更。结论按四档裁决：blocker / decision now / verified sound / hold。

## 结论

通过（P2 收口）。blocker 0，decision now 0，verified sound 7，hold 6。护栏、死代码、领域规则下沉与网关拆分均有可复现的测试或尺寸证据；未引入新依赖、未改 `openapi.yaml` 的 31 个 path / 47 个业务端点。Hold 项已转入 `docs/plan/open-questions.md`，不阻塞本轮关闭。

## Blocker

无。

## Decision now

无。本轮唯一需要在执行前拍板的是“草稿保存的 If-Match 与 201/200 规则归谁”，已按确认落到 `SkillDraftService`，并由服务测试与网关测试锁定；收口时无新增待决项。

## Verified sound

1. **架构护栏真的会拦截**：`tests/architecture.test.ts` 先把相对导入解析为绝对路径，再判组件归属；新增循环依赖、Bun 文件 API、`FileStore`、kernel 反向依赖检查，并用合成违规导入自测。11 个测试通过。
2. **死代码删除有依据**：`skill` 占位壳、`SKILL_MD` 不可达分支、`replaceSkillLinks`/`replaceToolLinks`、`EMPTY_GRAPH`、`parseSortQuery` 的 `defaultSort` 均无引用；删除后 269 个测试全绿。
3. **Guard 必填**：`SkillDraftDeps.guard` 与 `ExpertDeps.guard` 不再有 `undefined` 跳过分支；测试显式注入替身，组合根是唯一注入点。
4. **草稿规则已下沉**：保存端点只解析 `baseRevision`、调用 `saveDraft`、按 `created` 选 201/200；不再 `getDraft` 判状态，不把 `created` 写入响应 body；新建带 `If-Match` 为 400，已有草稿缺 `If-Match` 为 428，旧 revision 为 409。
5. **网关协议件分离**：`respond.ts`、`fields.ts`、`queries.ts`、`dto.ts`、`yaml.ts` 各司其职；`app.ts` 122 行，只留入口、`/healthz`、`skill-categories` 与按资源分派。
6. **路由按变化原因拆分**：`routes/{harness,tool,skill,expert,workflow}.ts` 聚合各自资源的集合/单项/子资源；已知端点的路径、字段、状态码由既有 269 个测试覆盖，`openapi.yaml` 未改。
7. **字段白名单与契约对齐**：`openapi-fields.test.ts` 解析 `openapi.yaml` 的 13 个请求 schema（含 `ToolUpdate` 的 `allOf`），与 `fields.ts` 精确比对，能捕获 DTO 与 OpenAPI 漂移。

## Hold

| 项 | 理由与去向 |
|---|---|
| T-DEBT-13 JSON 请求体上限 | 本轮未选；需先定数值、413 语义与客户端约束，后续工序再做。 |
| T-DEBT-18 skill store | 等下次改 skill 写路径时一并处理，避免为抽象而抽象。 |
| T-DEBT-19 catalog N+1 | 列表数据量未到痛点；等测量或 B4 端点增长后再优化。 |
| T-DEBT-20 跨组件公共件（`toIso`/`escapeLike`/分页） | 当前重复量小，抽取会跨组件扩权；留到有第三个使用点。 |
| T-DEBT-21 `SkillService`/`SkillDraftService` 拆分 | 现有职责虽多但边界稳定；拆分需重新设计事务与文件写入顺序，收益不足。 |
| T-DEBT-22 请求上下文/结构化日志 | 属于可观测性工序，需先定日志字段与采样；本轮不顺手加。 |
| T-DEBT-23 `RevisionConflictError` 竞态兜底 | 无法稳定复现；等有失败样本再加测试与兜底。 |

另：网关当前 7 个外部依赖；B4 若增至 8 个，需在“记录为硬上限例外”与“引入 facade”之间做架构决定，本轮不预置。

## 证据

| 检查 | 结果 |
|---|---|
| `node_modules/.bin/tsc --noEmit` | 0 |
| `bun run check` | 269 pass / 0 fail，31 个文件，2440 个断言；`docs:check` 最新 |
| `bun test tests/architecture.test.ts` | 11 pass，含合成违规自测 |
| `bun test tests/components/http-gateway/openapi-fields.test.ts` | 13 pass |
| `wc -l src/components/http-gateway/app.ts` | 122 行 |
| `git diff --name-only bc26e2c..HEAD -- src/components/http-gateway/openapi.yaml` | 空（契约文件未改） |

## 残余风险

- 路由拆分以 3 个 commit 落地（`17a` 支撑件、`17` 资源模块、`fix` UUID 顺序），而非 brief 原写的 6 个；单次 diff 较大，二分定位不如逐资源提交细。测试覆盖与 `openapi.yaml` 未改降低了风险，但后续再拆应优先小步提交。
- 字段白名单测试是静态 schema 对齐，不替代端点级序列化测试；后者仍由 `tests/components/http-gateway/*` 覆盖。
- `bun run check` 是本地统一入口，尚未接入 CI；跳过检查仍可能合入，属于流程风险而非代码缺陷。
- `app.ts` 仍保留 `/healthz`、`skill-categories` 与分派；若 B4 继续增长，再评估是否把 `misc` 独立成模块。

## 裁决

- **可以关闭本工序**：blocker 与 decision now 均为 0；hold 已记录，不阻塞。
- **后续动作**：归档时把本目录移入 `docs/history/works/`，frontmatter 改 `frozen`；`docs/plan/open-questions.md` 增补 hold 项。
