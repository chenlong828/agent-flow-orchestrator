---
layer: works
module: global
status: closed
updated: 2026-11-18
procedure: 2026-11-18-run-asset-detach
level: P2
---

# UI 对接提案：运行详情改用 run 快照

> 提交对象：`agent-flow-ui`（独立仓库）。本文件是给 UI 的需求交底，后端改动已完成；UI 代码不在本仓库修改。
> 目标：资产删除后，运行列表/详情仍显示历史名称与冻结图；删除只被未结束运行阻止。

## 0 结论

UI 不需要新增页面，只改 4 类交互：

1. 运行详情不再用 `GET /workflows/{id}` 取图，改用 `RunDetail.graph`；标题用 `RunSummary.workflowName`。
2. 节点弹层的「专家」优先用 `RunNodeView.expertName`，专家已删除时不再显示裸 UUID。
3. 运行列表的工作流名优先用 `RunSummary.workflowName`，已删除工作流的运行仍可读。
4. 工作流/专家/Harness 的删除对话框与 409 提示补一句「未结束的运行会阻止删除」；已结束运行不再阻止。

后端契约是加法变更，旧字段保留；UI 可在旧后端上继续运行（`run.graph` 缺失时回退旧路径）。

## 1 后端契约变化（已上线）

| 字段 | 类型 | UI 用途 |
|---|---|---|
| `RunSummary.workflowName` | `string` | 列表/详情的标题；工作流删除后仍可读 |
| `RunSummary.harnessName` | `string` | 运行详情副标题可展示；Harness 删除后仍可读 |
| `RunDetail.graph` | `WorkflowGraph` | 运行详情画布的数据源；与 `GET /workflows/{id}` 的 `graph` 同形 |
| `RunNodeView.expertName` | `string \| null` | 节点弹层「专家」名称；`confirm` 节点为 null |
| 删除 409 `details.references` | `Array<{type,id,name}>` | 可含 `type="run"` 的未结束运行；终态运行不再出现 |

语义变化：

- `workflowId` / `harnessId` 仍是启动时的历史 ID，**不代表资产当前存在**；不要因为 `GET /workflows/{id}` 返回 404 就判定运行无效。
- `GET /runs?workflowId=<历史 ID>` 仍能命中已删除工作流的历史运行（后端按 `workflow_ref_id` 过滤）。
- 删除工作流/Harness/专家时，只有 `created` / `running` / `waiting_confirm` / `waiting_resume` 的运行会阻止；`done` 不再阻止。

## 2 现状与落点

| 文件 | 现状 | 需要改 |
|---|---|---|
| `assets/js/pages/instance-detail.js` | `load()` 同时 `workflows.get(run.workflowId)` 与专家列表；`state.workflow` 存工作流；`shellOptions` 用 `state.workflow.name` | 用 `run.graph` 建图，标题用 `run.workflowName`；删除 `workflows.get` 依赖；保留专家列表只为颜色，专家名用 `runNode.expertName` |
| `assets/js/run/node-view.js` | `expertCell(node, experts)` 用图节点的 `expertId` 查专家列表 | `expertCell(node, runNode, experts)`：优先 `runNode.expertName`，其次专家列表，最后 ID |
| `assets/js/pages/instances.js` | `wfLabel(run)` 用 `state.workflows` 查名，删掉后回落 `shortId` | 优先 `run.workflowName`；筛选横幅同理 |
| `assets/js/pages/workflow-list.js` | 删除文案只说「删除后不可恢复；不会自动迁移旧图」 | 补「被未结束的运行引用时不能删除；已结束运行保留快照」 |
| `assets/js/pages/experts.js` | 删除文案「该操作不可恢复」；409 只显示通用错误 | 补「被工作流或未结束的运行引用时不能删除」；409 `references` 有 run 时提示「运行中的实例」 |
| `assets/js/pages/harnesses.js` | 删除文案「仍被工具引用时将删除失败」 | 补「或被未结束的运行引用」 |
| `assets/js/api.js`（可选） | `errorText` 对 409 只回 `error.message` | 对 `referenced` 且 `details.references` 含 `type="run"` 时，追加「运行中的实例」；不改其他错误映射 |

### 2.1 运行详情：从「回查工作流」改为「读 run 快照」

```js
// 现在（会因工作流删除而 404）
const [wf, expertPage, pendingPage] = await Promise.all([
  workflows.get(run.workflowId),
  request({ method: 'GET', path: '/api/v1/experts?limit=200' }),
  runs.list({ state: 'waiting_confirm', limit: 1 })
]);
state.workflow = wf;
state.graph = toEditorGraph(wf.graph);

// 目标
const [expertPage, pendingPage] = await Promise.all([
  request({ method: 'GET', path: '/api/v1/experts?limit=200' }),
  runs.list({ state: 'waiting_confirm', limit: 1 })
]);
state.graph = toEditorGraph(run.graph);
```

- 标题：`run.workflowName || shortId(run.workflowId)`，不再依赖 `state.workflow`。
- `run.graph` 缺失（旧后端/灰度）时再回退 `workflows.get(run.workflowId)`；若回退也 404，显示「该运行没有可用的图快照」占位，不把整个详情页置为错误。
- 专家列表仍可拉取，用于节点圆点颜色；名称以 `runNode.expertName` 为准，专家已删除时用中性色圆点。
- `toEditorGraph` 继续使用；`RunDetail.graph` 与工作流 `graph` 同形，不需要新的转换器。

### 2.2 专家名：优先使用 run 节点快照

```js
// node-view.js
function expertCell(node, runNode, experts) {
  const name = (runNode && runNode.expertName) || '';
  if (name) return '<span class="expert-dot neutral"></span> ' + esc(name);
  const expert = node.expertId ? experts.get(node.expertId) : null;
  if (expert) { /* 现有颜色 + 名字 */ }
  return node.expertId ? '<span class="mono">' + esc(node.expertId) + '</span>' : '—';
}
```

- `summaryRows` 已经有 `runNode`，把 `expertCell(node, runNode, experts)` 传进去即可。
- `confirm` 节点 `expertName` 为 null，继续显示「—」。

### 2.3 运行列表：工作流名优先用快照

```js
function wfLabel(run) {
  return run.workflowName || (state.workflows.get(run.workflowId) || {}).name || shortId(run.workflowId);
}
```

- 筛选横幅 `?wfId=` 的工作流已被删除时，`state.workflows` 没有该行；可从 `state.runs` 中找同 `workflowId` 的 `workflowName`，找不到再显示 `shortId`。
- `run.harnessName` 可选：运行详情副标题目前显示 `clientId`，可改为 `harnessName（clientId）`；不强制。

### 2.4 删除提示与 409

三个删除对话框都补一句，不要只在错误 toast 里解释：

- 工作流：「被未结束的运行引用时不能删除；已结束的运行保留快照，不影响历史页。」
- 专家：「被当前工作流或未结束的运行引用时不能删除。」
- Harness：「被工具或未结束的运行引用时不能删除。」

409 `referenced` 的 `details.references` 现在可能含 `{type:"run", id, name}`：

- 若含 run：提示「有未结束的运行正在使用该资产」；可列出前 3 个 run ID，不自动取消运行。
- 若含 workflow/expert/tool：沿用现有「仍被引用」提示。
- 删除成功后，历史运行页应仍能打开；如果当前停留在该工作流编辑器，返回列表即可（运行详情不再依赖工作流页）。

## 3 边界

| 情形 | 处理 |
|---|---|
| 工作流已删除，`GET /runs/{id}` 仍返回 `workflowId` 与 `workflowName` | 正常展示；不要用 `workflowId` 再发 `GET /workflows/{id}` |
| 专家已删除，`run.nodes[].expertName` 仍返回值 | 正常展示；没有颜色时用中性圆点或只显示名字 |
| Harness 已删除，运行仍显示 `clientId` / `harnessName` | 正常展示；`harnessName` 是历史名，不表示节点仍在线 |
| 旧运行的 `graph` 或 `workflowName` 缺失 | 回退 `workflows.get`；仍失败则显示占位，不把详情页整体报错 |
| 删除只被终态 run 引用的资产 | API 返回 204；UI 显示成功；历史运行页仍可读 |
| 删除被活跃 run 引用的资产 | API 返回 409 `referenced`；UI 显示「有未结束的运行」并保留当前列表/对话框 |
| 同时有多个活跃 run | 不会出现（同一工作区单活跃 run），但 `references` 仍按数组处理 |
| 删除专家/技能/Harness 的链路 | 技能/工具仍被专家装配保护；UI 文案不要写成「只被运行引用」 |

## 4 验收与测试

建议在 `SCN-0004` 增加/调整断言（编号接现有 T11）：

| 编号 | 断言 |
|---|---|
| `SCN-0004-T12` | 工作流接口返回 404 时，运行详情仍用 `RunDetail.graph` 渲染画布，标题显示 `workflowName`，页面不进入错误态 |
| `SCN-0004-T13` | 专家列表不含该专家时，节点弹层「专家」显示 `RunNodeView.expertName`，不显示裸 UUID |
| `SCN-0004-T14` | 运行列表对已删除工作流的运行显示 `workflowName`；按 `workflowId` 过滤仍命中 |
| `SCN-0004-T15` | 删除只被终态 run 引用的工作流/专家/Harness：确认框文案包含「未结束的运行」，删除成功，历史运行页仍可读 |
| `SCN-0004-T16` | 删除被活跃 run 引用的资产：409 `referenced` 提示「有未结束的运行」，不自动取消运行；列表保留 |

实现后运行：

```bash
npm run check:syntax
npm run check:docs
npm run docs:index:check
npm run test:gate
npm test
```

`tools/fake-b1.js` 的 run 夹具需要补 `workflowName` / `harnessName` / `graph` / `nodes[].expertName`，并增加「工作流 404」与「专家列表缺失」两个夹具分支；`tools/verify-m1-scenarios.js` 增加上述断言。

## 5 建议的 UI 文档落点

直接写入 `agent-flow-ui` 时（本次因文件沙箱限制未写入，需用户批准或手工复制）：

| 文档 | 目标路径 |
|---|---|
| 需求卡 | `docs/requirements/REQ-0027-run-asset-snapshot.md`（`status: accepted`，`module: instances`，影响 `SCN-0004`） |
| 工序 brief | `docs/works/2026-11-18-run-asset-snapshot/brief.md`（`status: active`，引 `REQ-0027`，任务见下） |
| 路线图 | `docs/plan/roadmap.md`「当前在飞」加 `works/2026-11-18-run-asset-snapshot` |
| 组件规格 | `docs/design/components/instances/spec.md` 的取数与字段说明 |
| 场景 | `docs/design/scenarios/operations/instances/control-instance/scenario.md` 增加 T12–T16，执行后更新「最近一次执行」 |

建议 UI 工序任务：

| ID | 类型 | 内容 |
|---|---|---|
| `T-UI-SNAP-01` | change | `instance-detail.js` 改用 `run.graph` / `run.workflowName`，移除 `workflows.get` |
| `T-UI-SNAP-02` | change | `node-view.js` 专家名优先 `runNode.expertName` |
| `T-UI-SNAP-03` | change | `instances.js` 工作流名优先 `run.workflowName` |
| `T-UI-SNAP-04` | change | 三个删除对话框文案 + 409 `references` 的 run 提示 |
| `T-UI-SNAP-05` | test | `fake-b1` 夹具与 `SCN-0004` T12–T16 |
| `T-UI-SNAP-06` | docs | `instances/spec.md`、`SCN-0004`、`result.md` 收口 |

## 6 不需要 UI 做的事

- 不需要新增运行详情/列表页面，不需要改 BFF 转发。
- 不需要改 `GET /workflows/{id}`、`GET /experts`、`GET /harnesses` 的请求路径；只是运行详情不再依赖工作流/专家的实时存在。
- 不需要处理「删除时自动取消运行」；删除被活跃 run 引用时直接 409，由用户先取消/结束运行。
