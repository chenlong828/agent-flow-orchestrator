---
layer: design
module: catalog
status: current
component: CMP-catalog
updated: 2026-10-26
---

# `CMP-catalog` 组件规格

## 1 主目标

把四类资产的单聚合读契约组合成外部客户端可直接消费的列表、详情与引用只读投影；不拥有表，不执行写操作。

**不负责**：业务写规则、数据库访问、HTTP 路由、状态推进。

## 2 拥有的数据

- 无表；只读投影：资产列表项、资产详情、引用摘要、专家装配。
- 派生计数查询时计算；不落可写列。

## 3 公共契约

```ts
// Reference、ReferenceGuard 类型由 CMP-kernel 定义；本组件实现 ReferenceGuard。
type ReferenceAsset = {
  type: "harness" | "tool" | "skill";
  id: string;
  name: string;
};

type ReferencePage = {
  asset: ReferenceAsset;
  total: number;
  items: Reference[];
};

type CatalogRead = {
  listHarnesses(query: HarnessQuery): Promise<Page<HarnessListItem>>;
  getHarness(id: string): Promise<HarnessDetailView>;

  listTools(query: ToolQuery): Promise<Page<ToolListItem>>;
  getTool(id: string): Promise<ToolDetailView>;
  listToolsByHarness(harnessId: string): Promise<Reference[]>;

  listSkills(query: SkillQuery): Promise<Page<SkillListItem>>;
  getSkill(id: string): Promise<SkillDetailView>;
  getSkillDocument(id: string): Promise<SkillDocument>;
  listSkillCategories(): Promise<SkillCategoryView[]>;
  listExpertsUsingSkill(skillId: string): Promise<Reference[]>;

  listExperts(query: ExpertQuery): Promise<Page<ExpertListItem>>;
  getExpert(id: string): Promise<ExpertDetailView>;
  listExpertsUsingTool(toolId: string): Promise<Reference[]>;

  referencesForHarness(id: string): Promise<ReferencePage>;
  referencesForTool(id: string): Promise<ReferencePage>;
  referencesForSkill(id: string): Promise<ReferencePage>;
};

type HarnessListItem = {
  id: string;
  name: string;
  kind: "container" | "server" | "desktop" | "laptop";
  address: string;
  accessMode: "agent" | "ssh" | "container_registry";
  enabled: boolean;
  health: "unknown" | "online" | "offline" | "overloaded";
  lastHeartbeatAt: string | null;
  concurrencyMax: number;
  queuePolicy: "fifo" | "priority";
  tags: string[];
  toolCount: number;
  revision: number;
  updatedAt: string;
};

type HarnessDetailView = HarnessListItem & {
  description: string;
  createdAt: string;
};

type ToolParamView = {
  key: string;
  type: "string" | "int";
  description: string;
};

type ToolListItem = {
  id: string;
  name: string;
  kind: "mcp" | "cli" | "script";
  invocation: string;
  description: string;
  harnessId: string;
  harnessName: string;
  timeoutMs: number;
  status: "unverified" | "available" | "unavailable";
  lastDebugAt: string | null;
  paramCount: number;
  usedByCount: number;
  revision: number;
  updatedAt: string;
};

type ToolDetailView = ToolListItem & {
  params: ToolParamView[];
  createdAt: string;
};

type SkillListItem = {
  id: string;
  name: string;
  categoryCode: string;
  categoryLabel: string;
  description: string;
  version: string;
  enabled: boolean;
  tags: string[];
  usedByCount: number;
  revision: number;
  updatedAt: string;
};

type SkillDetailView = SkillListItem & {
  sections: {
    overview: string;
    steps: string;
    examples: string;
    scripts: string;
    verification: string;
  };
  pitfalls: string[];
  refs: { label: string; refType: string; path: string | null }[];
  createdAt: string;
};

type SkillCategoryView = {
  code: string;
  label: string;
  position: number;
};

type ExpertSkillPreviewView = {
  id: string;
  name: string;
};

type ExpertSkillSummaryView = {
  id: string;
  name: string;
  categoryCode: string;
  categoryLabel: string;
  description: string;
};

type ExpertToolSummaryView = {
  id: string;
  name: string;
  kind: "mcp" | "cli" | "script";
  status: "unverified" | "available" | "unavailable";
};

type ExpertListItem = {
  id: string;
  name: string;
  color: string;
  role: string;
  enabled: boolean;
  persona: string[];
  skillCount: number;
  toolCount: number;
  refCount: number;
  skills: ExpertSkillPreviewView[];
  revision: number;
  updatedAt: string;
};

type ExpertDetailView = Omit<ExpertListItem, "skills"> & {
  duty: string;
  skillOrder: string;
  verifyOrder: string;
  notes: string;
  skills: ExpertSkillSummaryView[];
  tools: ExpertToolSummaryView[];
  refs: { label: string; refType: string; path: string | null }[];
  createdAt: string;
};
```

- `ReferenceGuard` 由本组件实现；领域删除服务通过端口调用，不直接依赖本组件类型。
- 视图类型（`HarnessListItem`、`ToolListItem`、`ExpertDetailView` 等）由本组件定义；`http-gateway` 只做字段映射。
- `ReferenceGuard.check` 对 Harness 返回引用工具，对工具/Skill 返回引用专家；无引用返回 `[]`。
- 读投影是组件层视图；`http-gateway` 负责映射 REST DTO，不重新定义读模型语义。
- 不存在抛 `NotFoundError`；不返回半成品对象。
- `listToolsByHarness` / `listExpertsUsing*` 只返回引用摘要，不返回内部行。

### 3.1 方法契约

| 方法 | 目的 | 输入 | 输出 | 错误 | 读源 |
|---|---|---|---|---|---|
| `listHarnesses` | Harness 列表 | `HarnessQuery` | `Page<HarnessListItem>` | `ValidationError` | `HarnessRead.list` + `ToolRead.listByHarness` |
| `getHarness` | Harness 详情 | `id` | `HarnessDetailView` | `NotFoundError` | `HarnessRead.get` + `ToolRead.listByHarness` |
| `listTools` | 工具列表 | `ToolQuery` | `Page<ToolListItem>` | `ValidationError` | `ToolRead.list` + `HarnessRead.get` + `ExpertRead.listExpertsUsingTool` |
| `getTool` | 工具详情 | `id` | `ToolDetailView` | `NotFoundError` | `ToolRead.get` + `HarnessRead.get` + `ExpertRead.listExpertsUsingTool` |
| `listToolsByHarness` | Harness 下工具引用 | `harnessId` | `Reference[]` | 无 | `ToolRead.listByHarness` |
| `listSkills` | Skill 列表 | `SkillQuery` | `Page<SkillListItem>` | `ValidationError` | `SkillRead.list` + `ExpertRead.listExpertsUsingSkill` |
| `getSkill` | Skill 详情 | `id` | `SkillDetailView` | `NotFoundError` | `SkillRead.get` + `ExpertRead.listExpertsUsingSkill` |
| `getSkillDocument` | Skill 编排文档 | `id` | `SkillDocument` | `NotFoundError` | `SkillRead.getDocument`（原样透传，不二次加工） |
| `listSkillCategories` | 分类参考数据 | 无 | `SkillCategoryView[]` | 无 | `SkillRead.listCategories` |
| `listExpertsUsingSkill` | Skill 的引用专家 | `skillId` | `Reference[]` | 无 | `ExpertRead.listExpertsUsingSkill` |
| `listExperts` | 专家列表 | `ExpertQuery` | `Page<ExpertListItem>` | `ValidationError` | `ExpertRead.list` + `SkillRead.getSummary`（前 3 个预览） |
| `getExpert` | 专家详情 | `id` | `ExpertDetailView` | `NotFoundError` | `ExpertRead.get` + `SkillRead.getSummary` + `ToolRead.getSummary` |
| `listExpertsUsingTool` | 工具的引用专家 | `toolId` | `Reference[]` | 无 | `ExpertRead.listExpertsUsingTool` |
| `referencesForHarness` | 删除前引用页 | `id` | `ReferencePage` | `NotFoundError` | `ReferenceGuard.check` |
| `referencesForTool` | 删除前引用页 | `id` | `ReferencePage` | `NotFoundError` | `ReferenceGuard.check` |
| `referencesForSkill` | 删除前引用页 | `id` | `ReferencePage` | `NotFoundError` | `ReferenceGuard.check` |

`ReferenceGuard` 是一个契约，方法表不重复列其实现细节；检查语义见上方。

## 4 数据来源

| 投影 | 来源 |
|---|---|
| Harness 列表/详情 | `HarnessRead` + `ToolRead.listByHarness` |
| 工具列表/详情 | `ToolRead` + `HarnessRead.get`（名称）+ `ExpertRead.listExpertsUsingTool` |
| Skill 列表/详情 | `SkillRead`（列表摘要含 `description`）+ `ExpertRead.listExpertsUsingSkill` |
| Skill 编排文档 | `SkillRead.getDocument`（原样透传；不做跨资产组合） |
| 专家列表/详情 | `ExpertRead`（列表含 `skillIds`）+ `SkillRead.getSummary` + `ToolRead.getSummary` |
| 分类列表 | `SkillRead.listCategories` |
| 引用查询 | `ToolRead.listByHarness` / `ExpertRead.listExpertsUsing*` |

- 不直接 SQL；不导入任何 store。
- 单次请求内的多次读尽量在同一数据库快照/事务中完成；是否使用只读事务在实现时定，契约不承诺强一致。
- 计数口径：Harness `toolCount` = 引用工具数；工具/Skill `usedByCount` = 引用专家数；专家 `refCount=0`（B1）。
- 专家列表只为前 3 个 `skillIds` 解析名称，不把完整摘要塞进列表；Skill 列表的 `description` 由 `SkillRead` 摘要直接提供，不需要逐条详情。

## 5 依赖与边界

- 允许：`harness`、`tool`、`skill`、`expert` 的公开读契约；`kernel` 的错误、分页、`ReferenceGuard` 契约。
- 禁止：写服务、store、`Bun.sql`、HTTP 类型、其他组件的内部类型。
- `http-gateway` 只调用本组件的读契约与领域写服务，不直接导入领域 store。

## 6 验证

- 组合：每个列表/详情字段完整；跨组件名称/计数正确；空集合返回空数组而非 `null`。
- 引用：Harness 被工具引用、工具/Skill 被专家引用；删除前引用列表与详情一致。
- 端口：`ReferenceGuard` 对三类资产分别返回正确引用；无引用返回 `[]`。
- 架构：无写操作、无 SQL、无 store 导入。
- 契约：对应 REST 读端点的 3 正 1 反在 `http-gateway` 规格中列明。

## 7 预算与运行

- 预算上限：源码 + 规格 + 测试 ≤120k token；当前规格约 10 KB。
- 单独验证命令：`bun test tests/components/catalog`。
- 当前状态：`current`；已实现并通过契约测试，实施与验证的历史记录见 [`result.md`](../../../history/works/2026-10-24-db-backend-infra/result.md)（归档件，仅作追溯）。

## 8 B1 实现口径与剩余风险

- 列表/详情按多次只读查询组合，未引入统一只读事务；单次请求内各查询之间不保证同一快照。
- 专家详情与列表的 Skill 摘要在 catalog 内逐项解析；列表最多 3 个预览，详情为完整装配；B1 接受当前读放大，不提前加缓存。若后续列表规模明显增长，再评估领域读契约合并或批量摘要读。
- 剩余风险：跨表读一致性由调用方按业务容忍度处理；B1 未出现需要强一致的读路径。
