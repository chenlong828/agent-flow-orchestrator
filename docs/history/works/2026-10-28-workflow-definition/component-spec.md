---
layer: history
module: workflow
status: frozen
updated: 2026-10-29
---

# `CMP-workflow` 组件规格（P1 草案）

> 状态：第二轮评审材料，未实现、未冻结。契约细节见 [contract.md](contract.md)，schema 见 [schema.md](schema.md)，边界与校验见 [architecture.md](architecture.md)。

## 1 主目标

维护工作流聚合和唯一当前定义：工作流 CRUD、复制、图保存/校验、DSL 导出/导入、专家引用投影。

**不负责**：专家/工具/Skill 管理、运行、运行产物、fan-out 任务清单、回退发布指令、发布/版本、HTTP 路由、跨资产列表拼装、UI。

## 2 拥有的数据

| 表 | 说明 |
|---|---|
| `workflow` | 聚合根：名称、类型标签、描述、`revision`、审计 |
| `workflow_definition` | 1:1 当前定义，只含 `graph` JSONB |
| `workflow_expert_ref` | 专家引用投影，可从 `graph` 重建 |

- 唯一写入口是本组件服务；`catalog` 只读，`http-gateway` 不执行 SQL。
- 不建版本、发布、behavior、实例、运行表。

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
  validate(graph: WorkflowGraph): Promise<ValidationReport>;
  exportDsl(id: string): Promise<WorkflowDsl>;
  importDsl(
    dsl: WorkflowDsl,
    actor?: string,
  ): Promise<{ id: string; revision: number; idMap: Record<string, string>; warnings: ValidationIssue[] }>;
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
- 输入/输出类型、错误、事务、端点见 [contract.md](contract.md)；本文不复制。

## 4 依赖与边界

允许：

- `platform` 的 `Db`；
- `kernel` 的 `Clock`、`IdGenerator`、错误类型、`ExpertStatusReader` 端口。

禁止：

- `http-gateway`、`catalog`、`expert` 的 service/store；
- 直接读或写 `expert` 表；专家存在性/启停状态通过 `ExpertStatusReader` 端口只读查询；
- Bun 文件 API、ACP、运行组件；
- 在组件内拼 HTTP 响应或 DTO。

`expert` 删除保护通过组合根注入的 `ReferenceGuard` 调用 `catalog`，专家状态通过 `ExpertStatusReader` 端口查询；不由本组件反向依赖 `expert`。

## 5 不变量与校验

- 一个工作流一份当前定义；`revision` 乐观锁。
- 节点/阶段/边 ID 唯一；边端点存在；`seq`/`rollback` 枚举。
- 形状错误阻断保存；语义问题保存成功并给 warning；B4 运行前严格拦截。
- 专家矩阵：`start`/`end`/`agent`/`review`/`fanout`/`fanin` 必填，`confirm` 禁止。
- 导入比保存更严：形状/语义错误 400；缺失专家清空并 warning。
- 复制图，节点 ID 保留；名称冲突自动后缀。

详细规则见 [architecture.md](architecture.md) 第 6 节。

## 6 验证

```bash
bun test tests/components/workflow
bunx tsc --noEmit
```

- 形状/语义校验用例；
- 保存事务与 revision 冲突；
- 专家引用重建、复制、导入；
- DSL 导出/导入与 JSON Schema 一致性。

## 7 预算与状态

- 预算：源码 + 规格 + 测试 ≤120k token；单任务装载 ≤250k。
- 当前状态：`planned`；P1 冻结后按 [architecture.md](architecture.md) 第 12 节任务实现，再把本文提升为 `docs/design/components/workflow/spec.md`。
