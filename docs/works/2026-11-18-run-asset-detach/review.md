---
layer: works
module: global
status: closed
updated: 2026-11-18
procedure: 2026-11-18-run-asset-detach
level: P1
---

# 评审与裁决：运行终态脱钩

## 1 评审结论

**通过（有条件）**。条件：UI 运行页改用 `RunDetail.graph` 与快照名字（跨项目，不阻塞本仓库交付）；`OQ-27` 归档保留期仍为待定。

- blocker 0
- decision 2（终态脱钩机制、契约与历史展示；均已落规格与 pinning test）
- verified sound 4 组
- hold 2（UI 配套、`OQ-27`）

## 2 四档裁决

### Blocker（0）

无。

### Decision now（2）

| # | 决策 | 理由 | 落点 |
|---|---|---|---|
| `D-01` | 终态脱钩放在 `finishRun` 同一事务，不用 `SET NULL`/trigger/删除时脱钩 | `finishRun` 是唯一终态入口；同事务保证 run 与节点一起脱钩，外键继续保护活跃 run；避免新 trigger 或跨组件事务 | [`run/spec.md`](../../design/components/run/spec.md)、[`0013`](../../../db/migrations/0013_run_asset_snapshot.sql)、service test |
| `D-02` | 历史展示改读 run 快照（`workflowName`/`harnessName`/`graph`/`expertName`），`workflowId`/`harnessId` 保留为历史 ID | 删除资产后运行页仍完整；`RunDetail.graph` 直接复用已有 `graph_snapshot`；`workflowId` 非空避免列表过滤与链接语义变成 null | [`run/spec.md`](../../design/components/run/spec.md)、OpenAPI、`run-asset-detach` HTTP test |

### Verified sound（4）

| # | 检查 | 证据 |
|---|---|---|
| `V-01` | 迁移回填与终态脱钩 | `0013` 在开发库 applied；34 条 run 的 `workflow_id`/`harness_id` 全空、ref 非空；192 条 `run_node.expert_id` 全空；11 条 `confirm` 节点 `expert_name` 为 null；`schema.test.ts` 校验列/check/FK |
| `V-02` | 终态删除与历史可读 | `run-asset-detach.test.ts`：删除工作流/专家/Harness 均 204；`GET /runs/{id}` 仍返回名字、`graph`、`expertName`；列表按 `workflowId` 命中已删除工作流的历史 run |
| `V-03` | 活跃 run 保护与错误映射 | 同一测试：活跃 run 下删除工作流/Harness 返回 409 `referenced`，`references` 含 `type="run"`；工作流删除不再 500；`workflow_run_history_detached` 拒绝终态非空 |
| `V-04` | 规格/契约/质量 | `bun run typecheck` 通过；`bun test` 431 pass / 1 skip / 0 fail；`docs:check` 通过；`quality:report` 违规 0；OpenAPI 测试通过（refs 600） |

### Hold（2）

| # | 项 | 为什么不阻塞 | 去向 |
|---|---|---|---|
| `H-01` | UI 运行页改用 `RunDetail.graph` 与快照名 | 本仓库的 API 契约已交付；UI 是独立项目，不按 UI 作为验收前置 | `T-DET-08`，UI 仓库配套 |
| `H-02` | `OQ-27` 归档/运行记录保留期与清理 | 与删除语义正交；当前归档与历史 run 只增不减，不影响本次删除保护 | 保持 `plan/open-questions.md` 待定 |

## 3 走查记录

| 走查 | 结果 |
|---|---|
| 正常流程 | start 写快照 → 节点写 `expert_name` → 终态脱钩 → 删除资产 → 详情读快照；通过 |
| 失败流程 | 活跃 run 删除被 guard/FK 阻止；删除工作流的外键错误映射 409；`start` 插入窗口遇到工作流/Harness 被并发删除时按约束名映射 404（已实现，无稳定的并发复现测试） |
| 扩展场景 | 新增一个资产类型不需要改 run 删除逻辑；只有直接引用 run 的资产需要在 `finishRun` 加脱钩列 |
| 重启/并发 | `finishRun` 单事务；check 约束兜底终态根；并发启动/删除由 FK 兜底 |
| 删除测试 | 删除 `RunReferenceReader` 会让活跃 run 的引用从 409 消失，但 FK 仍会兜底；删除 `graph` 字段会让 UI 回到按 `workflowId` 回查，属于 UI 契约退化 |

## 4 遗留与条件

1. **UI 配套**：运行页必须用 `RunDetail.graph` 和 `workflowName`/`harnessName`/`expertName`；否则工作流删除后运行页仍会回查 404。条件不阻塞本仓库合并，但阻塞用户端到端体验。
2. **`OQ-27`**：归档保留期与清理保持待定。
3. **删除不可逆**：只被终态 run 引用的资产删除后，历史 run 只保留快照；UI 是否在删除前提示影响条数由 UI 决定。
4. **质量 WARN**：`workflow_run` 24 列、`run_node` 可空比例 58.8% 为仅报告项，未触发违规；后续若做表宽治理再收敛。
