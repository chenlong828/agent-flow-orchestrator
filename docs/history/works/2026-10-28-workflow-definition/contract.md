---
layer: history
module: workflow
status: frozen
updated: 2026-10-29
---

# 工作流定义契约（P1 第二轮评审材料）

> 状态：提案，未冻结。通用 HTTP 约定沿用 [`CMP-http-gateway` 规格](../../../design/components/http-gateway/spec.md)；本文只写工作流新增的领域契约、端点、DTO、错误与 DSL。
>
> 关联：[architecture.md](architecture.md)、[schema.md](schema.md)、[review.md](review.md)。

## 1 约定

- 基础路径 `/api/v1`；工作流资源路径 `/api/v1/workflows`。
- ID 为 UUIDv7；工作流内节点/阶段/边 ID 是稳定字符串，不是 UUID。
- 更新、删除、保存定义必须带 `If-Match: "<revision>"`；缺 428，旧 revision 409。
- 未知请求体字段拒绝 400；未知查询参数忽略。
- 列表 `{items,total,limit,offset}`；默认 `limit=50`，上限 200。
- 写成功回读详情；删除 204；创建/复制/导入 201 + `Location`。
- 错误体沿用 `{error:{code,message,details?,requestId?}}`。
- `X-Actor` 只用于审计显示，不是身份。

## 2 内部契约

```ts
type WorkflowService = {
  create(input: CreateWorkflow, actor?: string): Promise<{ id: string; revision: number }>;
  update(
    id: string,
    revision: number,
    input: UpdateWorkflow,
    actor?: string,
  ): Promise<{ id: string; revision: number }>;
  delete(id: string, revision: number): Promise<void>;
  copy(
    id: string,
    input: CopyWorkflow,
    actor?: string,
  ): Promise<{ id: string; revision: number }>;
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

type WorkflowQuery = {
  q?: string;
  type?: string;
  page: PageQuery;
  sort?: "name" | "-name" | "updatedAt" | "-updatedAt";
};

type WorkflowReference = { id: string; name: string };
```

- `WorkflowService.validate` 只做图校验与专家状态的只读查询，不写数据库；`expert_missing`、`expert_disabled` 依赖当前专家表。HTTP 的校验端点先确认工作流存在，再调用它。
- `WorkflowRead.listByExpert` 供 `catalog` 实现专家删除 guard；`countByExperts` 供 `refCount` 组合。
- `WorkflowRead` 不暴露 store、SQL 行或 HTTP DTO。

## 3 领域类型

```ts
type CreateWorkflow = {
  name: string;
  type: string;
  description?: string;
};

type UpdateWorkflow = {
  name: string;
  type: string;
  description: string;
};

type CopyWorkflow = { name?: string };

type SaveDefinitionInput = { graph: WorkflowGraph };

type WorkflowSummary = {
  id: string;
  name: string;
  type: string;
  description: string;
  nodeCount: number;
  stageCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

type WorkflowDetail = WorkflowSummary & {
  graph: WorkflowGraph;
};

type WorkflowDsl = {
  dslVersion: 1;
  metadata: {
    name: string;
    type: string;
    description: string;
  };
  stages: Stage[];
  nodes: Node[];
  edges: Edge[];
  layout?: { viewport?: { x: number; y: number; zoom: number } };
};

type ValidationIssue = {
  code: string;
  path: string;
  message: string;
};

type ValidationReport = {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};
```

- `type` 是自由文本标签，1–40 字；不参与图校验，不定义枚举。
- `name` 1–80 字；是否大小写不敏感唯一待第二轮确认，推荐唯一。
- `description` ≤500 字。
- 图类型、节点枚举、ID 长度、规模上限见 [architecture.md](architecture.md) 第 6 节；本文不重复。

## 4 端点总表

| 方法 | 路径 | 请求 | 成功 | 失败 |
|---|---|---|---|---|
| `GET` | `/workflows` | `q`、`type`、`limit`、`offset`、`sort` | 200 列表 | 400 |
| `POST` | `/workflows` | `CreateWorkflow` | 201 详情 + `Location` | 400、409 |
| `GET` | `/workflows/{id}` | — | 200 详情 | 404 |
| `PUT` | `/workflows/{id}` | `UpdateWorkflow` + `If-Match` | 200 详情 | 400、404、409、428 |
| `DELETE` | `/workflows/{id}` | `If-Match` | 204 | 404、409、428 |
| `POST` | `/workflows/{id}/copy` | `CopyWorkflow` | 201 详情 + `Location` | 400、404、409（99 个后缀仍冲突） |
| `PUT` | `/workflows/{id}/definition` | `SaveDefinitionInput` + `If-Match` | 200 `{workflow,warnings}` | 400、404、409、428 |
| `POST` | `/workflows/{id}/validate` | `SaveDefinitionInput` | 200 `ValidationReport` | 400、404 |
| `GET` | `/workflows/{id}/dsl` | `format=json|yaml` | 200 DSL 文件 | 400、404 |
| `POST` | `/workflows/import` | `WorkflowDsl`（仅 JSON） | 201 `{workflow,idMap,warnings}` | 400、409 |

共 10 个业务端点；不含 `/healthz` 和 `/openapi.yaml`。

## 5 端点细节

### 5.1 列表与详情

`GET /workflows?q=需求&type=主流程&limit=20&offset=0&sort=updatedAt:desc`

- `q` 按名称大小写不敏感包含匹配。
- `type` 精确匹配标签；空字符串不筛选。
- `sort` 只接受 `name:asc|desc`、`updatedAt:asc|desc`；默认 `updatedAt:desc`。
- 列表项不返回 `graph`，返回 `nodeCount`、`stageCount`。
- 详情返回 `graph`，不返回 `behavior`、版本、发布状态、`lastRun`。

### 5.2 创建

```json
{ "name": "需求到实现", "type": "研发主流程", "description": "从需求到实现的主流程" }
```

- 创建根 + 空图 `{stages:[],nodes:[],edges:[]}`，返回详情。
- 名称冲突 409 `name_conflict`；字段错误 400 `validation_error`。
- 创建不要求 `If-Match`。

### 5.3 更新元数据

`PUT /workflows/{id}`，`If-Match: "3"`：

```json
{ "name": "需求到实现 v2", "type": "研发主流程", "description": "更新说明" }
```

- 全量更新 name/type/description；不接收 graph。
- 成功 `revision` 递增，返回详情。
- 缺 `If-Match` 428；旧 revision 409，`details.currentRevision` 返回当前值。

### 5.4 删除

- `DELETE /workflows/{id}` + `If-Match`；成功 204。
- B3 没有实例引用，不做实例 guard；B4 引入实例后另加 409。
- 重复删除 404。

### 5.5 复制

`POST /workflows/{id}/copy`：

```json
{ "name": "需求到实现（副本）" }
```

- `name` 可省略；省略时默认 `"{源名称} 副本"`。
- 复制源 `graph`，节点/阶段/边 ID 原样保留；重建 `workflow_expert_ref`。
- 名称冲突时自动追加 ` (2)`、` (3)`，最多到 ` (99)`；超过 80 字先截断基名再加后缀；99 个仍冲突返回 409 `name_conflict`。
- 不复制版本、运行状态、专家输出、任务清单；源工作流不变。
- 源不存在 404；不要求 `If-Match`。
- 成功 201，返回新详情 + `Location`。

### 5.6 保存定义

`PUT /workflows/{id}/definition`，`If-Match: "3"`：

```json
{
  "graph": {
    "stages": [{ "id": "s1", "name": "方案设计" }],
    "nodes": [
      { "id": "n1", "type": "start", "name": "开始", "stageId": "s1", "expertId": "019..." },
      { "id": "n2", "type": "end", "name": "结束", "stageId": "s1", "expertId": "019..." }
    ],
    "edges": [{ "id": "e1", "from": "n1", "to": "n2", "kind": "seq" }]
  }
}
```

- 形状错误：400 `validation_error`，`details.fieldErrors` 列出字段/原因；不保存。
- 语义问题：200，返回 `{workflow,warnings}`；定义已保存，B4 运行前再严格拦截。
- 保存时 `expertId` 不存在：400 `validation_error`，整个事务回滚。
- 成功 `revision` 递增；缺 `If-Match` 428；旧 revision 409。
- 响应中的 `workflow` 是保存后的详情（含 graph）。

### 5.7 校验

`POST /workflows/{id}/validate`：

```json
{ "graph": { "stages": [], "nodes": [], "edges": [] } }
```

- 只校验，不写；不要求 `If-Match`。
- 形状和语义都放在 `ValidationReport` 返回，统一 200；只有工作流不存在 404、请求形状非法 400。
- 编辑器的实时校验用这个端点；保存仍按 5.6 的规则阻断形状错误。

### 5.8 导出 DSL

`GET /workflows/{id}/dsl?format=json` 或 `?format=yaml`。

- JSON 为权威格式；YAML 是同一结构的无损渲染。
- 返回 DSL 文档本身，`Content-Type: application/json` 或 `application/yaml; charset=utf-8`；带 `Content-Disposition: attachment`。
- 不包含 `id`、`revision`、`createdAt`、`updatedAt`、`behavior`、运行数据。
- `format` 非法 400；工作流不存在 404。

### 5.9 导入 DSL

`POST /workflows/import`，`Content-Type: application/json`，请求体是 DSL 文档本身：

```json
{
  "dslVersion": 1,
  "metadata": { "name": "外部流程", "type": "外部导入", "description": "" },
  "stages": [],
  "nodes": [
    { "id": "n1", "type": "start", "name": "开始", "stageId": null, "expertId": "019..." }
  ],
  "edges": []
}
```

- 总是新建工作流；不覆盖、不合并已有工作流。
- 校验 `dslVersion=1`、未知字段、图形状、节点矩阵、单主链、fanout/fanin、回退规则；**导入从严**：语义错误也 400。
- `expertId` 在当前库不存在：清空为 `null`，返回 warning；节点其他字段保留。
- 专家停用：保留绑定，返回 warning；B4 运行前拦截。
- 节点 ID 原样保留；因为总是新建，`idMap` 当前为恒等映射；保留字段是为了未来合并/导入。
- 名称冲突 409；成功 201，返回 `{workflow,idMap,warnings}` + `Location`。
- v1 不支持 YAML 导入；YAML 只用于导出评审。

## 6 DSL 与校验错误码

### 6.1 DSL 顶层

- `dslVersion`: 必须为 `1`。
- `metadata`: `name`、`type` 必填，`description` 可选；未知字段拒绝。
- `stages`、`nodes`、`edges`: 与 `WorkflowGraph` 同构；未知字段拒绝。
- `layout`: 可选，仅展示；`viewport` 可选。
- 不包含 `behavior`、`id`、`revision`、时间戳、运行数据。

### 6.2 形状错误码（400，保存/导入）

| `code` | 触发 |
|---|---|
| `graph_shape` | 顶层/元素不是对象，或未知字段 |
| `duplicate_id` | 节点/阶段/边 ID 重复 |
| `invalid_id` | ID 格式或长度非法 |
| `missing_endpoint` | 边端点不存在 |
| `self_edge` | 边 from=to |
| `invalid_node_type` | 节点类型不在枚举 |
| `invalid_edge_kind` | 边 kind 不在 `seq`/`rollback` |
| `missing_stage` | `stageId` 指向不存在的阶段 |
| `invalid_expert_id` | `expertId` 不是 UUID |
| `invalid_layout` | 布局值不是有限数字 |
| `graph_too_large` | 超过阶段/节点/边上限 |

### 6.3 语义警告码（保存 200；导入 400）

| `code` | 触发 |
|---|---|
| `missing_start` / `multiple_start` | 开始节点数量不是 1 |
| `missing_end` / `multiple_end` | 结束节点数量不是 1 |
| `start_has_incoming` / `end_has_outgoing` | 开始/结束边不合规 |
| `broken_chain` | seq 单主链断裂、入/出度超 1、不可达 |
| `seq_cycle` | seq 子图有环 |
| `invalid_rollback` | rollback 来源/数量/目标不合法 |
| `rollback_target_not_ancestor` | 回退目标不是祖先 |
| `fanout_fanin_unpaired` | fanout/fanin 不一对一 |
| `expert_required` | 节点类型要求专家但为空 |
| `expert_forbidden` | confirm 绑了专家 |
| `expert_missing` | 专家不存在（导入时清空并警告） |
| `expert_disabled` | 专家停用（保留绑定并警告） |

## 7 错误映射

| HTTP | `code` | 场景 |
|---:|---|---|
| 400 | `validation_error` | 字段/图形状/专家不存在/请求体未知字段 |
| 404 | `not_found` | 工作流不存在 |
| 409 | `name_conflict` | 名称重复 |
| 409 | `revision_conflict` | `If-Match` 旧 revision |
| 409 | `referenced` | 专家删除时仍被工作流引用（专家端点） |
| 428 | `precondition_required` | 缺 `If-Match` |

工作流删除暂不返回 `referenced`；B4 实例引用后另加。

## 8 跨组件契约

### 8.1 `catalog`

- 新增 `listWorkflows(query)`、`getWorkflow(id)`，内部调用 `WorkflowRead`；HTTP 列表/详情读经这里。
- 实现 `ReferenceGuard.check("expert", id)`：调用 `WorkflowRead.listByExpert`，返回 `{type:"workflow",id,name}`。
- `listExperts` 用 `countByExperts` 覆盖 `refCount`。
- `catalog` 不写工作流表，不导入 `workflow/store`。

### 8.2 `expert`

- `ExpertService.delete` 增加可选 `guard`；删除前 `guard.check("expert", id)`，非空返回 `ReferencedError`。
- 现有 B1 无 guard 的调用由组合根注入；专家删除仍先校验 revision。
- 数据库 `workflow_expert_ref.expert_id` 外键 `RESTRICT` 是并发兜底；FK 冲突映射为 409 `referenced`（details 可为空，客户端重读）。

### 8.3 `kernel`

- `ReferenceOwner` 增加 `"expert"`。
- `Reference.type` 增加 `"workflow"`。
- 不改 `ReferenceGuard` 方法签名。
- 新增 `ExpertStatusReader` 端口：`statuses(expertIds): Promise<Record<string, boolean>>`；由 `expert` 读实现，组合根注入工作流服务，工作流不导入专家组件。

## 9 未决

1. `dslVersion: 1` 的独立 JSON Schema 已落在 `src/components/workflow/dsl.schema.json`；服务端运行时校验仍以 `graph.ts` 为准。

并发策略：QPS < 1 的 MVP 不为专家删除做额外并发控制；保留 `revision` + `If-Match`；专家删除由 FK `RESTRICT` 兜底，冲突 409，不自动重试。
