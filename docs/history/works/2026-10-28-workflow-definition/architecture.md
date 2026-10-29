---
layer: history
module: workflow
status: frozen
updated: 2026-10-29
---

# 工作流定义 P1 架构规格（B3，第二轮评审材料）

> 状态：第二轮评审材料，尚未冻结。本文把第一轮确认的边界落成组件、数据所有权、契约、schema、验证与任务；冻结前不写数据库修改和实现。
>
> 关联：[brief.md](brief.md)、[domain-model.md](domain-model.md)、[component-spec.md](component-spec.md)、[contract.md](contract.md)、[schema.md](schema.md)、[review.md](review.md)。决策：[单定义](../../../history/decisions/2026-10-28-workflow-definition-single-definition.md)、[只存 graph](../../../history/decisions/2026-10-29-workflow-definition-graph-only.md)。

## 1 结论

1. 新增 `CMP-workflow`，只负责 B3 工作流定义的组合写、当前定义读、结构校验、DSL 导出/导入和专家引用投影。
2. 一个工作流只有一个聚合根 `Workflow`，只有一份当前定义 `WorkflowDefinition`，只存 `graph`，不存 `behavior`，不做版本/发布。
3. 工作流自己的表只有三张：`workflow`、`workflow_definition`、`workflow_expert_ref`；`CMP-workflow` 是唯一写入口。
4. `graph` 使用 JSONB；专家引用用规范化投影 `workflow_expert_ref`，供专家删除保护和 `refCount`。
5. 专家输出、fan-out 任务清单、评审回退的对外指令属 B4/workspace，不进入定义，也不进入本次建表。
6. `http-gateway` 只做协议翻译；`catalog` 组合工作流读与专家 `refCount`；`expert` 删除通过 `ReferenceGuard` 检查工作流引用。
7. P1 已冻结并按任务表实现；三张表、`CMP-workflow`、10 个端点与 OpenAPI 已落地。

## 2 范围与非目标

本轮做：

- `CMP-workflow` 组件规格、数据所有权、依赖方向；
- `WorkflowService` / `WorkflowRead` 契约；
- REST 端点、DTO、错误映射；
- 三张表的 schema、索引、约束与数据库修改顺序；
- 形状校验/语义警告的判据；
- 场景走查、验证计划、任务拆分。

本轮不做：

- 工作流版本、发布、版本列表、回滚；
- 节点行为配置、专家输出暂存；
- B4 实例、NodeRun、运行锁、任务清单、回退发布；
- UI；
- 任何实现代码或 OpenAPI 修改。

## 3 组件卡：`CMP-workflow`

| 项 | 内容 |
|---|---|
| 主目标 | 维护工作流聚合、唯一当前定义和图结构，提供结构校验、DSL 交换与专家引用投影 |
| 负责 | 工作流 CRUD、复制、当前定义保存/校验、DSL 导出/导入、专家引用重建 |
| 不负责 | 专家/工具/Skill 管理、运行、运行产物、任务清单、回退指令、发布/版本、HTTP 路由、跨资产列表拼装 |
| 拥有的数据 | `workflow`、`workflow_definition`、`workflow_expert_ref` |
| 公开契约 | `WorkflowService`、`WorkflowRead`、`WorkflowValidator`（内部可合并） |
| 依赖 | `platform` 的 `Db`；`kernel` 的 `Clock`、`IdGenerator`、错误类型 |
| 禁止依赖 | `http-gateway`、`catalog`、`expert` 的 service/store、Bun 文件 API、ACP |

### 3.1 组件边界理由

- 工作流有自己的聚合不变量和写入事务，不能塞进 `catalog`（只读）或 `expert`（专家聚合）。
- `graph` 是 JSONB，但专家引用要支持删除保护和计数，因此单独投影，而不是每次扫 JSONB。
- `type` 只是自由文本标签，不参与图校验；不引入类型枚举和工作流子类型。
- 运行产物不进定义，避免一次运行写定义，破坏单定义模型。

## 4 组件地图增量与依赖

在现有 B1 组件地图上新增：

| 组件 | 主目标 | 拥有的数据 | 依赖 |
|---|---|---|---|
| `CMP-workflow` | 工作流定义聚合与图 | `workflow`、`workflow_definition`、`workflow_expert_ref` | `platform`、`kernel`（含 `ExpertStatusReader` 端口） |
| `CMP-catalog`（增量） | 组合工作流读、专家 `refCount`、实现专家删除引用检查 | 无 | 现有四类资产读 + `workflow` 读 |
| `CMP-expert`（增量） | 删除前检查工作流引用 | 无新增 | `kernel` 的 `ReferenceGuard` |
| `CMP-http-gateway`（增量） | 工作流端点 | 无 | `workflow` 写服务、`catalog` 读 |

依赖方向：

```text
http-gateway
  ├── catalog ──┬── workflow read
  │             └── expert read（现有）
  ├── workflow service
  ├── expert service（现有）
  └── kernel

workflow
  ├── platform（Db）
  └── kernel（Clock、IdGenerator、错误、ExpertStatusReader 端口）

expert
  └── kernel（ReferenceGuard 端口）
```

- `catalog -> workflow` 只依赖 `WorkflowRead`，不导入 `workflow/store`；HTTP 的列表/详情读经 `catalog`，写经 `workflow service`。
- `workflow` 不导入 `expert`；专家存在性由 `workflow_expert_ref.expert_id` 外键和保存事务保证，启停状态通过 `ExpertStatusReader` 端口只读查询（组合根注入 `expert` 读实现）。
- `expert` 不导入 `workflow`；删除保护通过注入的 `ReferenceGuard`。
- 无环：`catalog -> workflow` 与 `catalog -> expert` 是两条读边；`workflow` 和 `expert` 不互调。

## 5 数据所有权

| 表 | 关键字段 | 写入口 | 说明 |
|---|---|---|---|
| `workflow` | `id`、`name`、`type`、`description`、`revision`、审计 | 工作流服务 | 聚合根 |
| `workflow_definition` | `workflow_id` PK、`graph`、`updated_at`、`updated_by` | 工作流服务 | 1:1 当前定义；只存图 |
| `workflow_expert_ref` | `workflow_id`、`node_id`、`expert_id` | 工作流服务 | 派生投影；可从 `graph` 重建 |

- `nodeCount`、`stageCount` 查询时从 `graph` 计算，不落列。
- `refCount` 由 `catalog` 组合时用 `workflow_expert_ref` 计数，不落 `expert` 列。
- 不建 `workflow_version`、`workflow_behavior`、`workflow_run`。
- 数据库修改脚本为 `db/migrations/0005_workflow.sql`。这里没有旧数据搬迁，只有 `create table`。

## 6 领域模型与不变量

### 6.1 图结构

```ts
type WorkflowGraph = {
  stages: Stage[];
  nodes: Node[];
  edges: Edge[];
};

type Stage = {
  id: string;
  name: string;
  description?: string;
  layout?: { x: number; y: number; width?: number; height?: number };
};

type Node = {
  id: string;
  type: "start" | "end" | "agent" | "review" | "confirm" | "fanout" | "fanin";
  name: string;
  stageId: string | null;
  expertId: string | null;
  layout?: { x: number; y: number };
};

type Edge = {
  id: string;
  from: string;
  to: string;
  kind: "seq" | "rollback";
};
```

- 节点/阶段/边的 ID 是工作流内稳定字符串，长度 1–64，允许 `[A-Za-z0-9][A-Za-z0-9_-]*`；不是 UUID。
- 节点/阶段/边 ID 分别唯一；边端点必须存在。
- `stageId` 可空；空表示不属于阶段。
- `expertId` 是 UUID 或 null；一个节点最多一个专家。
- 布局只用于展示；`x`/`y` 必须是有限数字，不参与执行。

### 6.2 节点专家矩阵（已确认）

| 节点类型 | `expertId` | 说明 |
|---|---|---|
| `start` | 必填 | 入口专家；B4 是否建 session 另定 |
| `end` | 必填 | 结束专家；B4 是否建 session 另定 |
| `agent` | 必填 | 执行节点 |
| `review` | 必填 | 评审节点 |
| `confirm` | 禁止 | 人工确认不绑专家 |
| `fanout` | 必填 | 子任务模板专家 |
| `fanin` | 必填 | 聚合专家 |

`start`/`end` 也绑定专家；`confirm` 禁止。若后续改变，校验规则、SCN-0102 和 B4 映射同步改。

### 6.3 形状校验（保存阻断）

- 顶层只有 `stages`、`nodes`、`edges`，未知字段拒绝。
- 数组元素字段集固定，未知字段拒绝。
- ID 重复、ID 格式非法、边端点不存在、自环、类型/kind 非法、`stageId` 不存在、`expertId` 非 UUID。
- 布局值不是有限数字。
- 规模上限：阶段 ≤100、节点 ≤500、边 ≤1000；超过返回 400。
- `expertId` 在当前库不存在：保存返回 400；导入时清空并警告。

### 6.4 语义校验（保存给警告）

- 恰好一个 `start`、一个 `end`。
- `start` 没有入边；`end` 没有出边。
- `seq` 子图是单主链：每个节点至多一条 `seq` 入边、一条 `seq` 出边，无 `seq` 环，所有节点从 `start` 可达。
- `rollback` 只从 `review`/`confirm` 出发，每个节点至多一条；目标必须是 `seq` 路径上的祖先，不能是 `end`。
- `fanout` 与 `fanin` 一对一：`fanout` 的唯一 `seq` 出边指向 `fanin`，`fanin` 的唯一 `seq` 入边来自 `fanout`；不支持嵌套。
- 节点专家绑定符合 6.2；`confirm` 不得绑专家。
- 阶段归属可选；不要求节点属于阶段。

语义问题不阻断保存，但 B4 运行前必须严格拦截。

导入 DSL 比保存更严：形状和语义错误都 400；缺失专家清空并给 warning。

## 7 操作与事务

| 操作 | 事务 | 并发 |
|---|---|---|
| 创建 | 插入 `workflow` + 空 `workflow_definition` | 名称唯一冲突 409 |
| 复制 | 读源 → 插入新根 + 复制 graph + 重建 refs | 源只读；名称冲突自动后缀 |
| 元数据更新 | 锁根 → 校验 revision → 更新 name/type/description → revision+1 | `If-Match`；404/409/428 |
| 保存定义 | 锁根 → 校验 revision → 形状校验 → 替换 graph → 重建 refs → revision+1 | `If-Match`；形状 400；语义 warnings |
| 校验 | 只做纯校验，不写 | 无 revision |
| 导出 DSL | 读根 + 定义；不写 | 无 |
| 导入 DSL | 校验 → 插入新根 + graph + refs（缺失专家清空） | 总是新建；名称冲突 409 |
| 删除 | 锁根 → 校验 revision → 删除根（级联） | `If-Match`；B4 引用保护后置 |

保存定义的顺序固定为：

1. `select workflow ... for update`，不存在 404；
2. 校验 `revision`，不匹配 409；
3. 形状校验，失败 400；
4. 用新 `graph` 更新 `workflow_definition`；
5. 删除该工作流的 `workflow_expert_ref`，按新图插入；
6. `workflow.revision + 1`、`updated_at/updated_by`；
7. 返回 `{workflow, warnings}`。

第 4–6 步同一事务；任一步失败回滚，不留下半套引用。

## 8 契约摘要

完整 DTO 和端点见 [contract.md](contract.md)。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/workflows` | 列表；`q`、`type`、`page`、`sort` |
| `POST` | `/api/v1/workflows` | 创建空定义 |
| `GET` | `/api/v1/workflows/{id}` | 详情，含 graph |
| `PUT` | `/api/v1/workflows/{id}` | 更新名称/类型/描述，`If-Match` |
| `DELETE` | `/api/v1/workflows/{id}` | 删除，`If-Match` |
| `POST` | `/api/v1/workflows/{id}/copy` | 复制图，节点 ID 保留 |
| `PUT` | `/api/v1/workflows/{id}/definition` | 保存当前定义，`If-Match` |
| `POST` | `/api/v1/workflows/{id}/validate` | 校验未保存图，不写 |
| `GET` | `/api/v1/workflows/{id}/dsl` | 导出 DSL，`format=json|yaml` |
| `POST` | `/api/v1/workflows/import` | 导入 DSL，总是新建 |

## 9 数据与数据库修改

完整 DDL 设计见 [schema.md](schema.md)。

- 三张表；`workflow_definition.graph` 是 JSONB，仅 `jsonb_typeof(graph)='object'` 做数据库级兜底。
- `workflow_expert_ref.expert_id` 外键 `RESTRICT`；保存时专家不存在返回 400，专家删除前由 guard 阻止。
- `workflow.name` 大小写不敏感唯一（已确认）。
- 数据库修改只新增三张表，不改 B1 表，不搬迁任何旧数据；脚本为 `db/migrations/0005_workflow.sql`。
- 数据库修改测试断言三张表、索引、外键删除规则；不硬编码全库表数，避免与 Skill 包工序冲突。

## 10 冷热路径与性能

- 全部是控制面管理路径，没有运行期热路径。
- 列表只查根和 `jsonb_array_length` 计数，不返回 graph；详情才返回 graph。
- 保存是单事务、JSONB 整图替换；图最大 500 节点/1000 边，事务可控。
- 专家 `refCount` 用批量 `countByExperts`，避免列表 N+1；详情可按单个专家计数。
- 专家删除保护只查当前定义，不扫历史版本（没有历史版本）。
- 不引入缓存；读多写少， PostgreSQL 足够。

## 11 验证计划

### 11.1 架构与边界

- 无 `workflow -> expert` 代码导入；专家引用只通过 FK 和 guard。
- 无 `workflow -> catalog/http-gateway` 导入。
- `catalog` 只通过 `WorkflowRead` 读工作流，不导入 store。
- `http-gateway` 不导入 `workflow/store`，不执行 SQL；列表/详情走 `catalog`，写走 `workflow service`。

### 11.2 单元与存储

- 图形状校验：重复 ID、坏边、非法类型/kind、缺阶段、非法专家 ID、超限。
- 语义校验：缺开始/结束、多开始、断链、seq 环、非法回退、fanout/fanin 不配对、专家绑定矩阵。
- 保存事务：revision 冲突、形状失败回滚、专家 FK 失败回滚、refs 重建。
- 复制：图复制、节点 ID 保留、refs 正确、名称冲突自动后缀。
- 导入：合法 DSL、未知字段、坏边、缺失专家清空 + 警告、总是新建。

### 11.3 契约测试

按三场景各 3 正 1 反：

- SCN-0101：列表/详情、创建/复制、更新/删除、428/409。
- SCN-0102：保存图、读回、校验报告、形状阻断、并发冲突。
- SCN-0103：导出 JSON、YAML 等价、导入新工作流、未知字段/坏边拒绝。

### 11.4 跨组件

- 专家删除被工作流引用时 409，`details.references` 含工作流。
- `catalog` 列表 `refCount` 等于引用该专家的不同工作流数。
- 专家不存在时保存定义 400；导入时清空并警告。

### 11.5 验证命令

```bash
bun test tests/components/workflow
bun test tests/components/http-gateway/workflow.test.ts
bun test tests/components/catalog
bun test tests/architecture.test.ts
bunx tsc --noEmit
bun run docs:check
```

## 12 任务拆分（P1 冻结后执行）

| ID | 任务 | 依赖 | 验收 |
|---|---|---|---|
| `T-WF-101` | 数据库修改 + schema 测试 | P1 冻结 | 三表、索引、外键、级联；脚本可重放；无数据搬迁 |
| `T-WF-102` | 图类型、校验器、store | 101 | 形状/语义用例通过；无 HTTP 依赖 |
| `T-WF-103` | 工作流服务 CRUD/复制 | 102 | 创建/更新/删除/复制事务与并发 |
| `T-WF-104` | 保存定义 + 专家引用投影 | 103 | revision、refs 重建、专家 FK 失败回滚 |
| `T-WF-105` | DSL schema + 导出/导入 | 104 | JSON Schema 资产、JSON 导入/YAML 导出、映射、缺失专家清空 |
| `T-WF-106` | 读模型 + `catalog` 组合 | 103 | 列表/详情/refCount/专家引用查询 |
| `T-WF-107` | HTTP 端点 + OpenAPI | 104–106 | 10 个端点、错误映射、3+1 契约 |
| `T-WF-108` | 专家删除 guard + kernel 类型 | 106 | `ReferenceOwner`/`Reference` 扩展；专家删除 409 |
| `T-WF-109` | 场景旅程与 result 归档 | 107–108 | 三场景走查、命令输出、文档回写 |

每个任务装载 ≤250k；101–105 可串行，106–108 在 103/104 后并行。

## 13 风险与开放决策

见 [review.md](review.md)。已拍板：节点专家矩阵、名称唯一、`type` 可改、复制自动后缀、JSON 导入/YAML 导出。

仍需确认：

1. 数据库修改编号与 Skill 包工序的先后。

并发策略已定：QPS < 1 的 MVP 不增加专家删除相关锁/串行化/自动重试；保留 `revision` + `If-Match`；专家删除由 FK `RESTRICT` 兜底。

## 14 冻结门槛

第二轮通过必须满足：

- 组件边界、数据所有权、依赖方向无争议；
- 10 个端点的 DTO、状态码、错误码、并发语义完整；
- 三张表 DDL、索引、外键、数据库修改顺序可执行；
- 形状/语义规则可写成测试，无“看情况”；
- 三场景正常/失败路径均有契约测试映射；
- 任务可独立验收，无隐藏前置；
- 所有开放决策已决定或明确后置到 B4，不阻塞 101–109。
