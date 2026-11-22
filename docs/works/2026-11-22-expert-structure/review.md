---
layer: works
module: expert
status: active
updated: 2026-11-22
procedure: 2026-11-22-expert-structure
level: P2
---

# 评审：专家结构精简

## 1 改动级别

P2：兼容性契约变更（弃用字段保留并返回空）、非核心表字段语义变更（`duty` 改 Markdown、三列清空）、跨组件改动（expert / run / catalog / http-gateway / seed）。不触碰模块切分、依赖方向与热路径失败语义，按 P2 走影响规格与人最终确认。

## 2 四档裁决

### Blocker（0）

无。迁移与 seed 均保留全部文案（合并进 `duty`），没有数据丢失路径；回归测试覆盖读写、迁移、提示词与 HTTP 契约。

### Decision now（3，已随本轮落地）

| 决定 | 选项与代价 | 落点 |
|---|---|---|
| 职责范围的 Markdown 结构 | 四节标题（保留原四块语义） vs 纯文本段落（丢结构） | 迁移 0015、seed、[`expert/spec.md`](../../design/components/expert/spec.md) |
| 存量数据处理 | SQL 迁移合并并清空旧列 + seed 同步 vs 只改 seed（其他环境数据不动） | [`0015_expert_duty_markdown.sql`](../../../db/migrations/0015_expert_duty_markdown.sql) |
| 过渡期写入 | 接受但忽略 vs 照常落库 vs 400 拒绝 | [`normalize.ts`](../../../src/components/expert/normalize.ts)、[`write.ts`](../../../src/components/expert/write.ts) |

三条均经用户选择推荐方案后落地；pinning test 见 `tests/components/expert/service.test.ts`、`tests/components/http-gateway/expert.test.ts`。

### Verified sound（已查、无需改动）

- 提示词：`composeNodePrompt` 只拼 名称/角色/性格/职责范围，`职责范围` 单独起行后输出 Markdown；`tests/components/run/prompt.test.ts` 断言旧标签不再出现。
- 运行期消费者核对：全仓库检索 `skillOrder` / `verifyOrder` / `notes` / `refsFor` / `toolIds`，除专家读写、catalog 投影与 OpenAPI 外无运行链路引用；工具/参考知识本就不参与派发。
- 迁移：本地库 `applied=1 skipped=14`，迁移后旧三列为空、`duty` 四节完整；seed 重跑结果一致。
- 读模型：`ExpertSummary` / `ExpertDetail` 的空值来自固定填充而非数据库回读；`toolCount` 固定 0，`refCount` 仍按工作流引用计数。
- HTTP 契约：`tests/components/http-gateway/expert.test.ts` 22 条通过，包含工具装配过渡行为；`bun test --max-concurrency=1` 456 pass / 1 skip / 0 fail。
- 服务：重启 3100 后 `/healthz` 正常，`/openapi.yaml` 已含 4 处新字段说明。

### Hold（1，转后续工序）

- UI 侧删除 ③④⑤ 后，删除 `expert_tool` / `expert_ref` 表、`expert` 的三列、`toolIds` / `refs` / `skillOrder` / `verifyOrder` / `notes` 字段与 `PUT /experts/{id}/tools` 端点。不阻塞本轮：当前写入已被忽略、读取恒为空，不会污染新数据。

## 3 结论

**通过（P2）**。Blocker 0；Decision now 3 已落文档与测试；Hold 1 已记录，等 UI 改造完成后另立工序清理。用户已确认三项设计决策，最终合并前仍按 P2 规则做一次人最终确认。
