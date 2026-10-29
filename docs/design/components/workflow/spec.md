---
layer: design
module: workflow
status: current
component: CMP-workflow
updated: 2026-10-29
---

# `CMP-workflow` 组件规格

> 范围：B3 工作流定义。只维护工作流聚合、唯一当前定义、图校验、DSL 交换与专家引用投影；不包含 B4 实例/运行。

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
- 删除工作流级联定义与引用；专家被引用时由外键 `RESTRICT` 阻止删除。

## 3 公共契约

```ts
type WorkflowService = {
  create(input: CreateWorkflow, actor?: string): Promise<{ id: string; revision: number }>;
  update(id: string, revision: number, input: UpdateWorkflow, actor?: string): Promise<{ id: string; revision: number }>;
  delete(id: string, revision: number): Promise<void>;
  copy(id: string, input: CopyWorkflow, actor?: string): Promise<{ id: string; revision: number }>;
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
  countByExperts(expertIds: string[]): Promise<Record<string, number>>;
};
```

- `WorkflowRead` 供 `catalog` 组合列表/详情、专家删除引用检查与 `refCount`。
- `WorkflowRead` 不暴露 store、SQL 行或 HTTP DTO。
- REST 端点与 DTO 见 [`CMP-http-gateway` 规格](../http-gateway/spec.md)。
- DSL v1 的机器可读结构资产：[`dsl.schema.json`](../../../../src/components/workflow/dsl.schema.json)；服务端运行时以 `graph.ts` 为校验源，schema 供外部编辑器/导入工具消费。

## 4 依赖与边界

允许依赖：

- `platform` 的 `Db`；
- `kernel` 的 `Clock`、`IdGenerator`、错误类型、分页、`ExpertStatusReader` 端口。

禁止依赖：

- `http-gateway`、`catalog`、`expert` 的 service/store；
- 在组件内拼 HTTP 响应或 DTO；
- 运行组件、Bun 文件 API、ACP。

专家删除保护通过组合根注入 `ReferenceGuard`；专家存在性与启停状态通过 `ExpertStatusReader` 端口只读查询，由组合根注入专家读实现；`CMP-workflow` 不导入专家组件，也不写 `expert` 表。`workflow_expert_ref.expert_id` 外键是并发兜底。

## 5 领域不变量

- 一个工作流一份当前定义；`revision` 从 1 开始，写操作 +1。
- 节点/阶段/边 ID 为工作流内稳定字符串，分别唯一；边端点必须存在。
- `graph` 含 `stages`、`nodes`、`edges` 和可选 `viewport`；未知字段拒绝。`viewport={x,y,zoom}` 仅用于展示，`x/y` 是画布滚动偏移、`zoom` 是缩放倍数；不参与执行语义。
- 形状错误阻断保存；语义问题保存成功并给 warning；B4 运行前严格拦截。
- 专家矩阵：`start`/`end`/`agent`/`review`/`fanout`/`fanin` 必填，`confirm` 禁止。
- 导入比保存更严：形状/语义错误 400；缺失专家清空并 warning；停用专家保留绑定。
- 校验只读专家状态，不写工作流或专家表。
- 复制图，节点 ID 与 `viewport` 保留；名称冲突自动追加 ` (2)`…` (99)`。
- DSL 导入/导出在 `layout.viewport` 与 `graph.viewport` 之间双向映射。

## 6 验证

```bash
bun test tests/components/workflow
bunx tsc --noEmit
```

- 图形状/语义用例；
- 保存事务与 revision 冲突；
- 专家引用重建、复制、导入；
- DSL 导出/导入与 schema 一致。

## 7 预算

- 源码 + 规格 + 测试 ≤120k token；单任务装载 ≤250k。
