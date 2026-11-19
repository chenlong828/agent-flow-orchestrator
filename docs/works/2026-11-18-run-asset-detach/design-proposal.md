---
layer: works
module: global
status: closed
updated: 2026-11-18
procedure: 2026-11-18-run-asset-detach
level: P1
---

# 设计提案：运行终态脱钩与历史快照

> 状态：**已冻结并实现（2026-11-18）**。用户裁决方案 A「快照 + 物理删除」；本文给出机制、schema、契约与验证，实现与验证见 [`result.md`](result.md)、[`review.md`](review.md)。
> 本文只写方案；不改代码、不改组件规格、不建迁移。

## 0 结论

| # | 决策 | 内容 |
|---|---|---|
| `D-01` | 删除语义 | 终态 run 不阻止删除资产；活跃 run 与当前定义引用仍阻止 |
| `D-02` | 历史可读 | run 在启动时冻结名称与图；终态时把活跃外键置空，历史展示只读 run 快照 |
| `D-03` | 引用分层 | `workflow_id` / `harness_id` / `run_node.expert_id` 是活跃引用（FK `RESTRICT`）；`workflow_ref_id` / `harness_ref_id` / `*_name` 是历史快照 |
| `D-04` | 删除检查 | 组合根把 `catalog` 的定义引用与 `CMP-run` 的活跃 run 引用合成一个 `ReferenceGuard`；工作流删除补 guard 与 409 |
| `D-05` | 契约 | `RunSummary` 增加 `workflowName` / `harnessName`；`RunDetail` 增加冻结 `graph`；`RunNodeView` 增加 `expertName`；`workflowId` / `harnessId` 仍非空，取历史快照 ID |
| `D-06` | 不做 | 不做软删除、回收站、run 保留期/清理（`OQ-27`）、`instance` 删除、技能包 GC |

一句话：**run 变成历史的那一刻就脱钩；删除时不再有历史外键，历史页改读 run 自己的快照。**

## 1 现状与约束

### 1.1 数据与生命周期

- `workflow_run` 保存 `workflow_id`、`harness_id`、`instance_id`、`graph_snapshot`、`intent_markdown`（[run/spec.md](../../design/components/run/spec.md) §2）。
- `run_node` 保存 `expert_id`、`state`、`task_id`、`session_id`、`verdict`（同节）。
- run 终态由 `CMP-run` 的 `finishRun` 唯一写入（[store-run-write.ts](../../../src/components/run/store-run-write.ts)），调用方统一是 `core.finish`（[core.ts](../../../src/components/run/core.ts)）。取消、节点失败、重启补结算、超时失败都走这里。
- `workflow_id`、`harness_id`、`instance_id`、`expert_id` 都是 `ON DELETE RESTRICT`；`workflow_run.instance_id` 没有删除入口，暂不处理。

### 1.2 删除链路

| 资产 | 当前阻止删除的来源 | 本次是否放开 |
|---|---|---|
| 工作流 | `workflow_run.workflow_id`（终态 run 也阻止）；无 guard；FK 错误未映射，界面 500 | 终态 run 放开；活跃 run 仍阻止并返回 409 |
| Harness | `workflow_run.harness_id`（终态 run 也阻止）；guard 只查工具 | 终态 run 放开；活跃 run 与工具仍阻止 |
| 专家 | `run_node.expert_id`（终态 run 也阻止）+ `workflow_expert_ref`（当前工作流） | 终态 run 放开；活跃 run 与当前工作流仍阻止 |
| 技能 / 工具 | `expert_skill` / `expert_tool`（专家装配） | 不变；专家删除后即可删 |
| 实例 | `workflow_run.instance_id` / `task.instance_id` | 不变；没有删除入口 |

### 1.3 为什么不能在删除时直接放开

run 记录不是导出文件：`workflow_run` / `run_node` 仍在产品库里被读，run 页还依赖工作流图和专家名。直接把 FK 去掉或 `SET NULL` 会让活跃 run 失去运行所需引用；只改错误码则用户仍然删不掉。需要把「历史可读」从资产表搬到 run 自己身上。

## 2 方案

### 2.1 数据模型

`workflow_run` 新增：

| 列 | 类型 | 说明 |
|---|---|---|
| `workflow_ref_id` | `uuid not null` | 启动时的工作流 ID，历史展示/筛选用；不设外键 |
| `harness_ref_id` | `uuid not null` | 启动时的 Harness ID；不设外键 |
| `workflow_name` | `text not null` | 启动时冻结的工作流名 |
| `harness_name` | `text not null` | 启动时冻结的 Harness 名 |

`workflow_run` 调整：

- `workflow_id`、`harness_id` 去掉 `not null`，保留 `references ... on delete restrict`；只有活跃 run 非空。
- 新增 check：`state <> 'done' or (workflow_id is null and harness_id is null)`。

`run_node` 新增：

| 列 | 类型 | 说明 |
|---|---|---|
| `expert_name` | `text` | 启动时冻结的专家名；`confirm` 节点为 null |

- `expert_id` 保持可空 + `on delete restrict`；终态 run 的所有节点行置空。
- 历史专家 ID 不加冗余列：`graph_snapshot` 的节点仍保留启动时 `expertId`，展示用 `expert_name`。

### 2.2 生命周期

```
start ──▶ running（活跃外键非空 + 快照已写）
  │
  ├─ waiting_confirm / waiting_resume（活跃外键保持，删除资产被 FK 阻止）
  │
  └─ finishRun ──▶ done
        同一事务：
        1. workflow_run.state='done'，workflow_id=null，harness_id=null
        2. run_node.expert_id=null（该 run 全部节点）
        3. 保留 workflow_ref_id / harness_ref_id / workflow_name / harness_name / expert_name / graph_snapshot
```

- `start` 时读取工作流名与 Harness 名，写入快照；节点进入时写入 `expert_name`。
- `finishRun` 是唯一终态写入口；check 约束保证任何绕过它的终态写都会失败，而不是留下半脱钩。
- `waiting_resume` 不是终态：外键保持，删除资产仍被阻止；这保证续跑还能读专家与 Harness。

### 2.3 删除行为

| 操作 | 结果 |
|---|---|
| 删除只有终态 run 的工作流 | 204；历史 run 仍有 `workflowRefId`、`workflowName`、`graph` |
| 删除有活跃 run 的工作流 | 409 `referenced`；`references` 含 `type="run"` |
| 删除只有终态 run 的 Harness | 204；历史 run 仍有 `harnessRefId`、`harnessName` |
| 删除有工具或活跃 run 的 Harness | 409 `referenced`；工具或 run |
| 删除只有终态 run 的专家 | 204；历史页面显示 `expertName`，图里仍有启动时 `expertId` |
| 删除被当前工作流引用的专家 | 409 `referenced`；`type="workflow"`（现状不变） |
| 删除被专家装配引用的技能/工具 | 409 `referenced`；`type="expert"`（现状不变） |

删除服务仍先做 guard 预检；DELETE 时的外键错误作为并发兜底，映射为同一个 409。

### 2.4 引用检查

新增 `kernel.RunReferenceReader` 端口：

```ts
type RunReferenceOwner = "workflow" | "harness" | "expert";

type RunReferenceReader = {
  /** 仍处于 created/running/waiting_confirm/waiting_resume 的 run；终态不返回。 */
  active(owner: RunReferenceOwner, id: string): Promise<Reference[]>;
};
```

- 由 `CMP-run` 实现：工作流查 `workflow_run.workflow_id`；Harness 查 `harness_id`；专家查 `run_node.expert_id` 关联 `workflow_run.state <> 'done'`。
- `Reference.type` 增加 `"run"`，`ReferenceOwner` 增加 `"workflow"`；`catalog.check` 对 `workflow` 返回空数组（工作流没有定义侧引用页）。
- 组合根合成：

```ts
const runReferences = createRunReferenceReader({ db });
const guard: ReferenceGuard = {
  async check(owner, id) {
    const definitionRefs = await catalog.check(owner, id);
    const runRefs =
      owner === "workflow" || owner === "harness" || owner === "expert"
        ? await runReferences.active(owner, id)
        : [];
    return [...definitionRefs, ...runRefs];
  },
};
```

- `workflow.delete` 新增 `guard` 依赖与预检；`harness.delete` / `expert.delete` 已有 guard，换成合成 guard 即可。
- `workflow.delete` 捕获 `isReferenceViolation`（`23503` / `23001`）并抛出 `ReferencedError`，修掉现在的 500。

### 2.5 契约增量

| 类型 | 变化 |
|---|---|
| `RunSummary` | `workflowId` / `harnessId` 改从 `*_ref_id` 读，仍为非空；新增 `workflowName`、`harnessName` |
| `RunDetail` | 增加 `graph`：启动时冻结的 `WorkflowGraph` |
| `RunNodeView` | 增加 `expertName`（`confirm` 为 null） |
| 409 `details.references` | 条目 `type` 可含 `run`；`name` 为 run ID |
| OpenAPI | 上述字段、`ReferenceItem.type` 枚举、删除端点描述 |

`RunDetail.graph` 是运行页的新数据源：UI 不再按 `workflowId` 回查工作流，避免工作流删除后运行页缺图。`workflowId` 仍保留，用于筛选和跳转；工作流删除后该跳转返回 404，属于预期。

## 3 被否决方案

| 方案 | 否决理由 |
|---|---|
| `ON DELETE SET NULL` + trigger 拦截活跃 run | 需要新增 trigger 机制；`SET NULL` 本身分不清活跃/终态，必须再加 trigger 与自定义错误码；应用层仍需解释 409 |
| 去掉 run 侧外键 | 活跃 run 失去数据库兜底；删除与启动并发时可能删掉正在用的资产；与现有「外键兜底并发窗口」口径冲突 |
| 删除时由 run 组件脱钩 | 删除与脱钩分成两次写，失败会留下半脱钩；放进同一事务需要跨组件传事务，边界更重 |
| 软删除 | 用户选 A「物理删除」；软删除只隐藏，不释放行与技能包，仍需 purge 工序 |
| 保留 RESTRICT，只把 409 的 references 补全 | 不满足「测试数据能删」的诉求 |

## 4 迁移与回填

迁移 `0013_run_asset_snapshot.sql`（只向前）：

```sql
alter table workflow_run add column workflow_ref_id uuid;
alter table workflow_run add column harness_ref_id uuid;
alter table workflow_run add column workflow_name text;
alter table workflow_run add column harness_name text;
alter table run_node add column expert_name text;

update workflow_run r set workflow_ref_id = r.workflow_id, workflow_name = w.name
  from workflow w where w.id = r.workflow_id;
update workflow_run r set harness_ref_id = r.harness_id, harness_name = h.name
  from harness h where h.id = r.harness_id;
update run_node rn set expert_name = e.name
  from expert e where e.id = rn.expert_id;

-- 终态 run 脱钩；先回填名字，再清活跃外键。
update workflow_run set workflow_id = null, harness_id = null where state = 'done';
update run_node rn set expert_id = null
  from workflow_run r
 where rn.run_id = r.id and r.state = 'done' and rn.expert_id is not null;

alter table workflow_run alter column workflow_ref_id set not null;
alter table workflow_run alter column harness_ref_id set not null;
alter table workflow_run alter column workflow_name set not null;
alter table workflow_run alter column harness_name set not null;
alter table workflow_run alter column workflow_id drop not null;
alter table workflow_run alter column harness_id drop not null;

alter table workflow_run add constraint workflow_run_history_detached
  check (state <> 'done' or (workflow_id is null and harness_id is null));

create index workflow_run_workflow_ref_idx on workflow_run (workflow_ref_id, created_at desc);
create index workflow_run_harness_idx on workflow_run (harness_id) where harness_id is not null;
create index run_node_expert_id_idx on run_node (expert_id) where expert_id is not null;
```

回填顺序是关键：先写 `*_name` 与 `expert_name`，再清活跃外键；否则历史名字丢失。现有 34 条 run 的资产都存在，若任一外键缺失，迁移在 `set not null` 处失败，按数据问题处理，不做静默兜底。

## 5 组件与依赖

| 组件 | 变化 | 依赖 |
|---|---|---|
| `CMP-platform` | 迁移 `0013` | 无 |
| `CMP-run` | `start` 写快照；`finishRun` 脱钩；类型/读模型；实现 `RunReferenceReader` | 仍依赖 workflow/harness/expert 读契约；不新增组件依赖 |
| `CMP-workflow` | `delete` 新增 `ReferenceGuard` 预检与 409；允许依赖增加 guard 端口 | `kernel.ReferenceGuard`；不依赖 run 组件 |
| `CMP-harness` / `CMP-expert` | 删除使用合成 guard；无新代码路径 | 现有 guard |
| `CMP-catalog` | `checkReferences` 增加 `workflow` 分支返回 `[]`；说明 guard 只实现定义侧 | 无 |
| `CMP-kernel` | `ReferenceOwner` / `Reference.type` / `RunReferenceReader` 端口 | 无 |
| `CMP-http-gateway` | DTO/OpenAPI/409 文档；工作流删除 500 修复在 domain | 无新增依赖 |
| 组合根 | 创建 `runReferenceReader`，合成 guard；注入 run/workflow/harness/expert | 无环：reader 只依赖 `Db`，早于 run service 创建 |

数据所有权不变：`workflow_run` / `run_node` 仍只有 `CMP-run` 写；`CMP-workflow` / `CMP-harness` / `CMP-expert` 不写 run 表。

## 6 验证计划

| 层 | 用例 |
|---|---|
| 迁移 | 回填 `*_ref_id` / `*_name` / `expert_name`；终态行外键为空；活跃行保留；`workflow_run_history_detached` 拒绝终态非空；索引存在 |
| run | `start` 写快照；`finishRun` 后 run 与所有节点脱钩；取消/失败/重启补结算/超时失败四条终态路径都脱钩；`waiting_resume` 保持外键 |
| run 读 | `RunSummary` 名字与 ref ID；`RunDetail.graph`；`RunNodeView.expertName`；按 `workflowId` 过滤命中已删除工作流的历史 run |
| 删除 | 工作流/Harness/专家仅终态引用 → 204；活跃引用 → 409 且 references 含 `type="run"`；专家被当前工作流引用 → 409 `type="workflow"`；技能/工具仍被专家装配阻止 |
| HTTP | 新增字段契约；工作流删除 500 → 409；400/404/409 映射不回退 |
| 架构 | 无跨组件直接写 run 表；guard 组合在组合根；无循环依赖 |
| 质量 | `bun test`、`bun run typecheck`、`bun run quality:report` |

## 7 风险与待定

| 项 | 说明 |
|---|---|
| UI 配套 | 运行页必须改用 `RunDetail.graph` 与名字字段；否则工作流删除后运行页仍会回查 404。UI 在另一个仓库，本工序只出契约 |
| 终态删除不可逆 | 删除资产后快照仍可读，但资产本身不再存在；UI 是否提示影响条数由 UI 定 |
| `graph` 体积 | `RunDetail` 每次返回图快照；当前图规模小，冷读可接受；若图变大再评估按需返回 |
| 并发启动/删除 | 删除先 guard 预检，FK 兜底；`start` 在插入窗口遇到工作流/Harness 被删时，按约束名映射 404/400，不返回 500 |
| `run_node.expert_id` 脱钩 | 由 `finishRun` 统一做；run 级 check 保证终态外键为空，节点级由测试守住；若未来出现新的终态入口，必须复用 `finishRun` |
| `OQ-27` | run/归档保留期与清理不在本工序 |

## 8 确认记录

| 日期 | 决策 | 确认人 |
|---|---|---|
| 2026-11-18 | 方案 A：快照 + 物理删除 | 用户 |
| 2026-11-18 | 机制：终态脱钩 + 保留活跃 FK；先出设计文档再开工 | 用户 |
| 2026-11-18 | 冻结本文并开工 | 用户 |
