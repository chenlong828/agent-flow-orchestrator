---
layer: design
module: workflow
status: current
component: CMP-workflow
updated: 2026-11-11
---

# `CMP-workflow` 组件规格

> 范围：B3 工作流定义。只维护工作流聚合、唯一当前定义、图校验、DSL 交换与专家引用投影；运行编排与实例归 [`CMP-run`](../run/spec.md)。

## 1 主目标

维护工作流定义聚合：工作流 CRUD、复制、图保存/校验、DSL 导出/导入、专家引用投影。是工作流三张表的唯一写入口。

**不负责**：专家/工具/Skill 管理、运行、运行产物、fan-out 任务清单、回退发布指令、发布/版本、HTTP 路由、跨资产列表拼装、UI。

## 2 拥有的数据

| 表 | 说明 |
|---|---|
| `workflow` | 聚合根：名称、类型标签、描述、`revision`、审计 |
| `workflow_definition` | 1:1 当前定义，`graph` JSONB 含结构、节点/阶段布局与可选画布视口 |
| `workflow_expert_ref` | 专家引用投影；可从 `graph` 重建 |

- 不建版本、发布、behavior、实例、运行表。
- 专家引用按工作流去重计数；不从 `expert` 反向写。
- 删除工作流级联定义与引用；被未终态 run 引用时返回 409 `referenced`，终态 run 不阻止删除（run 在终态已脱钩并保留快照）。

## 3 公共契约

```ts
type WorkflowService = {
  create(
    input: CreateWorkflow,
    actor?: string,
  ): Promise<{ id: string; revision: number; warnings: ValidationIssue[] }>;
  update(id: string, revision: number, input: UpdateWorkflow, actor?: string): Promise<{ id: string; revision: number }>;
  delete(id: string, revision: number): Promise<void>;
  copy(
    id: string,
    input: CopyWorkflow,
    actor?: string,
  ): Promise<{ id: string; revision: number; warnings: ValidationIssue[] }>;
  saveDefinition(
    id: string,
    revision: number,
    input: SaveDefinitionInput,
    actor?: string,
  ): Promise<{ id: string; revision: number; warnings: ValidationIssue[] }>;
  validate(graph: unknown): Promise<ValidationReport>;
  exportDsl(id: string): Promise<WorkflowDsl>;
  importDsl(
    dsl: WorkflowDsl,
    actor?: string,
  ): Promise<{
    id: string;
    revision: number;
    idMap: Record<string, string>;
    warnings: ValidationIssue[];
  }>;
};

type WorkflowRead = {
  list(query: WorkflowQuery): Promise<Page<WorkflowSummary>>;
  get(id: string): Promise<WorkflowDetail>;
  listByExpert(expertId: string): Promise<WorkflowReference[]>;
  /** 这些工作流节点绑定过的专家 ID，去重；多个工作流取并集。 */
  listExpertIdsByWorkflows(workflowIds: string[]): Promise<string[]>;
  countByExperts(expertIds: string[]): Promise<Record<string, number>>;
};
```

- `WorkflowRead` 供 `catalog` 组合列表/详情、专家删除引用检查、`refCount` 与专家列表按工作流过滤。
- `listExpertIdsByWorkflows` 只读 `workflow_expert_ref`，不解析 `graph`；`workflow_expert_ref` 是可重建投影，避免与图 JSON 的口径分叉。
- `WorkflowRead` 不暴露 store、SQL 行或 HTTP DTO。
- REST 端点与 DTO 见 [`CMP-http-gateway` 规格](../http-gateway/spec.md)。
- DSL v1 的机器可读结构资产：[`dsl.schema.json`](../../../../src/components/workflow/dsl.schema.json)；服务端运行时以 `graph.ts` 为校验源，schema 供外部编辑器/导入工具消费。

## 4 依赖与边界

允许依赖：

- `platform` 的 `Db`；
- `kernel` 的 `Clock`、`IdGenerator`、错误类型、分页、`ExpertStatusReader` 端口、`ReferenceGuard` 端口。

禁止依赖：

- `http-gateway`、`catalog`、`expert` 的 service/store；
- 在组件内拼 HTTP 响应或 DTO；
- 运行组件、Bun 文件 API、ACP。

专家删除保护与工作流自身删除保护通过组合根注入 `ReferenceGuard`；专家存在性与启停状态通过 `ExpertStatusReader` 端口只读查询，由组合根注入专家读实现；`CMP-workflow` 不导入专家或 run 组件，也不写 `expert`/`workflow_run` 表。`workflow_expert_ref.expert_id` 与 `workflow_run.workflow_id` 外键是并发兜底；工作流删除的 guard 只列**未终态** run。

## 5 领域不变量

- 一个工作流一份当前定义；`revision` 从 1 开始，写操作 +1。
- 节点/阶段/边 ID 为工作流内稳定字符串，分别唯一；边端点必须存在。
- `graph` 含 `stages`、`nodes`、`edges` 和可选 `viewport`；图顶层、阶段/节点/边顶层未知字段拒绝。`layout` / `viewport` 是前端画布对象，后端只要求 JSON 对象并原样存取，不解释 `x/y/width/height/zoom`。
- 结构、引用、拓扑与专家绑定错误阻断创建/保存/复制/导入；只有专家停用给 warning。B4 运行前仍需重新校验。
- 专家矩阵：`start`/`end`/`agent`/`split`/`review`/`fanout` 必须绑定专家，`confirm` 禁止绑定专家。
- 节点类型闭集：`start` / `agent` / `split` / `review` / `confirm` / `fanout` / `end`；`fanin` 已删除（2026-11-11，与 `CMP-run` 设计同步）。`split`/`fanout` 本期可保存、可校验，但运行启动时由 `CMP-run` 拒绝（`unsupported_node_type`）。
- `fanout` 必须恰好一个 `seq` 前驱且前驱类型为 `split`；不再要求 `fanout → fanin` 成对。
- `review` 与 `confirm` 可各发一条 `rollback` 边，目标必须是 `seq` 路径上的祖先；其他类型不得发回退边。
- 单链约束不变：每个节点 ≤1 条 `seq` 入边、≤1 条 `seq` 出边；`start` 无入边、`end` 无出边。
- 空图拒绝：创建必须提交合法图；保存/复制/导出/导入同样拒绝空图。旧空图/非法图可读，但写入和复制/导出会被拒绝。
- 导入是专家绑定例外：允许 `expertId` 为空；不存在的专家清空并 warning；禁止绑定仍 400。导入后再次保存时按严格绑定校验。
- 导出允许未绑定专家（保证导入结果可往返），拒绝不存在的专家 ID 和禁止绑定。
- 校验只读专家状态，不写工作流或专家表；`errors` 含拓扑/缺失专家/未绑定/禁止绑定，`warnings` 只含停用专家。
- 复制图，节点 ID 与 `viewport` 保留；源图不合法或为空时 400；名称冲突自动追加 ` (2)`…` (99)`。
- DSL 导入/导出在 `layout.viewport` 与 `graph.viewport` 之间双向映射；`layout` 字段不解释。
- 多字段图错误抛 `MultiFieldValidationError`，`details.issues` 为 `{code,path,message}`；`details.fieldErrors` 保留兼容。路径统一用数组下标，如 `graph.nodes[1].expertId`。

### 5.1 节点类型与执行语义

节点类型只描述「定义侧的形状与语义」；真正执行由 [`CMP-run`](../run/spec.md) 负责，`CMP-workflow` 不运行、不建 session。

| 类型 | 定义侧语义 | 执行侧（归 `CMP-run`） | 本期 |
|---|---|---|---|
| `start` | 唯一入口，无 seq 入边，必须绑专家 | 执行：以启动诉求为输入建 session | 是 |
| `agent` | 常规工作节点，必须绑专家 | 执行：读写 task-space 的常规任务 | 是 |
| `split` | 拆分节点，必须绑专家；产物是 task.db | 执行：跑 prompt，要求产出 SQLite task.db | 否（第二期） |
| `review` | 审核节点，必须绑专家，可发一条回退边 | 执行：产出 verdict；fail 沿回退边退回祖先 | 是 |
| `confirm` | 人工确认，禁止绑专家，可发一条回退边 | 不执行：run 停在 `waiting_confirm`，等外部决策 | 是 |
| `fanout` | 展开节点，必须绑专家，唯一前驱是 `split` | 不执行：读 task.db 为每行建 task，全部结算后继续 | 否（第二期） |
| `end` | 唯一出口，无 seq 出边，必须绑专家 | 执行：读取 task-space 产出最终结果 | 是 |

- `split`/`fanout` 的保存校验按上表执行；启动 run 时 `CMP-run` 以 `unsupported_node_type` 拒绝，避免出现「能画不能跑」却没有明确错误的现象。
- `confirm` 无专家、无 session；它的 `reject` 与 `review` 的 `fail` 共用同一条回退边语义。

## 6 验证

```bash
bun test tests/components/workflow
bunx tsc --noEmit
```

- 图形状/拓扑/绑定用例，`layout`/`viewport` 透明透传；
- 创建必须带图、空图拒绝、保存事务与 revision 冲突；
- 专家引用重建、复制、导入/导出；
- 专家引用投影：`listByExpert` 与 `listExpertIdsByWorkflows` 返回去重集合；空入参与未知工作流返回空数组；
- DSL 导出/导入与 schema 一致，缺失专家清空后保存 400。

## 7 预算

- 源码 + 规格 + 测试 ≤120k token；单任务装载 ≤250k。
