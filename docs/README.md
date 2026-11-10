# 文档导航

本目录按「五态分离」组织：**位置即状态**——文档在哪一层，就处于什么生命周期；frontmatter（`layer` / `module` / `status` / `updated`）与路径互相校验。分层规则见技能 `doc-layout-spec`（技能不在文档树内）。

另设方法层 `playbook/`，只放可复用的设计判断，不属于生命周期状态。`doc-layout-spec` 上游尚未合并 `playbook/` 规则，当前是项目本地扩展；合并后以技能为准，并删除本注。

## 当前实际存在的结构

```
docs/
├── README.md
├── plan/                                   ← 调度：接下来做什么
│   ├── roadmap.md
│   └── open-questions.md
├── design/                                 ← 真相：系统现在是什么
│   ├── architecture.md
│   ├── contracts/
│   │   └── executor-http-v2.md             ← 执行面契约（跨项目 REST 契约，调度器侧权威）
│   ├── components/
│   │   ├── kernel/spec.md
│   │   ├── config/spec.md
│   │   ├── platform/spec.md
│   │   ├── harness/spec.md
│   │   ├── tool/spec.md
│   │   ├── skill/spec.md
│   │   ├── expert/spec.md
│   │   ├── catalog/spec.md
│   │   ├── http-gateway/spec.md
│   │   ├── scheduler/spec.md               ← 执行面任务列表与派发（planned）
│   │   └── instance/spec.md                ← 执行面实例与工作区登记（planned）
│   └── scenarios/
│       ├── _index.md
│       ├── agent-capability-assets/
│       │   ├── expert-capability-definition-and-assembly/
│       │   │   └── expert-definition-and-assembly-management/
│       │   │       └── scenario.md
│       │   └── skill-capability-definition-and-supply/
│       │       ├── skill-draft-and-publishing/
│       │       │   └── scenario.md
│       │       └── skill-retrieval-and-supply/
│       │           └── scenario.md
│       └── workflow-orchestration/
│           ├── workflow-definition/
│           │   ├── workflow-portfolio-management/
│           │   │   └── scenario.md
│           │   ├── workflow-editing-and-publishing/
│           │   │   └── scenario.md
│           │   └── workflow-definition-exchange/
│           │       └── scenario.md
│           └── execution-scheduling/       ← 执行面调度
│               ├── executor-task-dispatch/scenario.md
│               ├── executor-result-settlement/scenario.md
│               ├── executor-skill-package-supply/scenario.md
│               ├── executor-control-signals/scenario.md
│               └── executor-protocol-gate/scenario.md
├── playbook/                               ← 方法：同类问题怎么判断（项目本地，待技能合并）
│   ├── backend-contract-boundaries.md
│   └── code-health-rules.md
├── works/                                  ← 执行：正在做什么（当前在办：2026-11-10-scheduler-layer-design、2026-11-10-node-registry-implementation、2026-11-11-executor-joint-debug）
└── history/                                ← 记忆：怎么走到这里（冻结只读）
    ├── decisions/                          ← 整篇决策记录，按日期命名
    └── works/                              ← 已归档工序，按日期命名
```

其余内容在诞生时创建，**不预建空目录、不预建索引行**：

- `requirements/`：一卡一文件 `REQ-0001-<slug>.md`，只回答「为什么做」；
- `design/scenarios/`：`<领域>/<价值流>/<场景>/scenario.md`，业务功能树按需建立；专家、Skill、工作流定义与执行面调度的场景与生成索引已存在（执行面 6 张为 `draft`，待实现工序补测试与入口后转 `designed`）；
- `design/components/` 与 `design/scenarios/` 是**按文档类型分的兄弟目录**：前者是单组件规格，后者是跨组件运行序；`architecture.md` 是系统视图。三者不混放，也不因为“一切皆组件”而扁平化。
- `design/contracts/`：跨项目 REST 契约（`executor-http-v2`）。放在 design 而不是 works，是因为契约是现行真相、会被另一个项目引用；client 仓库保留同构副本，冲突时以本仓库为准。这是 `doc-layout-spec` 的项目本地扩展，上游合并前以本段为准。
- `works/`：一级只有工序目录 `YYYY-MM-DD-<短名>/`，含 `brief.md`，收口后补 `result.md` 再整目录归档。
- `playbook/`：方法层，一份 playbook 对应一类可复用的设计判断；`status` 为 `draft / current / deprecated`，废弃后移入 `history/playbooks/`。不复制组件契约，强制规则应升级到技能。

`plan/risks.md` 在首条真实风险出现时创建；`plan/` 一级只放这三个固定主题，不建子目录。

## 阅读顺序（新接手者）

1. [`../README.md`](../README.md) —— 项目定位与当前阶段
2. [`../AGENTS.md`](../AGENTS.md) —— 技能加载、门禁与文档纪律
3. [`plan/roadmap.md`](plan/roadmap.md) —— 里程碑、工序与依赖
4. [`plan/open-questions.md`](plan/open-questions.md) —— 开放问题登记；当前有 6 项 hold（OQ-5～OQ-7、OQ-9～OQ-11）与 8 项待定（OQ-12～OQ-19，2026-11-10 执行面契约 v2 接口验证转出），无阻塞项；历史条目已关闭归档
5. [`design/architecture.md`](design/architecture.md) —— 现行组件边界、依赖与数据所有权
6. [`design/scenarios/_index.md`](design/scenarios/_index.md) —— 业务域/价值流/场景的生成索引；先看场景再看组件
7. [`design/scenarios/agent-capability-assets/expert-capability-definition-and-assembly/expert-definition-and-assembly-management/scenario.md`](design/scenarios/agent-capability-assets/expert-capability-definition-and-assembly/expert-definition-and-assembly-management/scenario.md) —— 首个试点场景：入口、运行序、外部引用与 3+1
    `design/scenarios/agent-capability-assets/skill-capability-definition-and-supply/` 下有 Skill 草稿与发布、检索与供给两个 `verified` 场景；`design/scenarios/workflow-orchestration/` 下另有工作流定义三个 `verified` 场景：组合管理、编辑与校验、定义交换；覆盖 B3 定义侧，B4 运行与 UI 未做，以场景索引为准。
    执行面调度在 `design/scenarios/workflow-orchestration/execution-scheduling/` 下：任务派发、结果回收与重派、技能包供给、停止与取消、协议版本与凭据、节点登记与派发门禁，共 6 张 `draft` 场景，运行序/引用/测试方案已按 `designed` 判据写齐，待实现工序补测试 ID 与入口后转档。
8. [`design/components/kernel/spec.md`](design/components/kernel/spec.md) 与 [`config/spec.md`](design/components/config/spec.md) —— 共享错误/分页/端口，以及 TOML 启动配置
9. [`design/components/http-gateway/spec.md`](design/components/http-gateway/spec.md) —— 对外 REST 契约；运行时 `/openapi.yaml` 与 Swagger UI `/docs` 由 `CMP-http-gateway` 直接提供；外部项目若接入按此消费
10. [`design/components/workflow/spec.md`](design/components/workflow/spec.md) —— `CMP-workflow` 的聚合、图保存/校验、DSL 与专家引用投影
    - 执行面：[`design/components/scheduler/spec.md`](design/components/scheduler/spec.md) 与 [`instance/spec.md`](design/components/instance/spec.md) —— 任务列表、派发/重派/结果接受，以及实例与工作区登记（`planned`）
11. [`design/contracts/executor-http-v2.md`](design/contracts/executor-http-v2.md) —— 执行面契约 v2：三端点、at-least-once、客户端承诺与调度器职责；调度器侧落点见 [`components/scheduler/spec.md`](design/components/scheduler/spec.md) 与 [`components/instance/spec.md`](design/components/instance/spec.md)；接口一致性验证与偏离清单见 [`history/works/2026-11-10-executor-contract-verification/verification.md`](history/works/2026-11-10-executor-contract-verification/verification.md)
12. [`history/works/2026-10-28-workflow-definition/result.md`](history/works/2026-10-28-workflow-definition/result.md) —— B3 工作流定义实现结果与验证记录
13. [`playbook/backend-contract-boundaries.md`](playbook/backend-contract-boundaries.md) —— 后端聚合写、列表读模型与 BFF 边界的可复用判定；与现行规格冲突时以规格为准
14. [`history/works/2026-10-24-db-backend-infra/result.md`](history/works/2026-10-24-db-backend-infra/result.md) —— B1 实现结果、验证命令与偏差（已归档，历史证据，不作设计依据）
15. [`history/works/2026-10-25-api-swagger/result.md`](history/works/2026-10-25-api-swagger/result.md) —— Swagger UI、OpenAPI 端点与验证结果（已归档）
16. [`history/works/2026-10-25-runtime-openapi-export/result.md`](history/works/2026-10-25-runtime-openapi-export/result.md) —— OpenAPI 资产移入 HTTP 组件，以及方法/字段说明补齐结果（已归档）
17. [`history/works/2026-10-25-scenario-index-pilot/result.md`](history/works/2026-10-25-scenario-index-pilot/result.md) —— 首个场景索引试点、生成器与校验结果（已归档）
18. [`history/decisions/2026-10-23-project-init.md`](history/decisions/2026-10-23-project-init.md) —— 初始化时的取舍与被否决方案
19. [`history/decisions/2026-10-25-project-boundary-and-open-questions.md`](history/decisions/2026-10-25-project-boundary-and-open-questions.md) —— 仅 HTTP API、无 CLI/库/产品 UI，以及早期开放问题归档
20. [`history/decisions/2026-10-25-playbook-method-layer.md`](history/decisions/2026-10-25-playbook-method-layer.md) —— `playbook/` 方法层、首份 playbook 的范围与上游技能延迟合并
21. [`playbook/code-health-rules.md`](playbook/code-health-rules.md) —— 代码健康规则的阈值、级别、基线策略与 agent 反馈闭环

## 维护纪律（速记）

- 新建文档先问「属于哪一态」，按路径放置并写 frontmatter；`layer` 与目录矛盾、`status` 越出本层值域、`module` 与组件不符，发现即修。
- `playbook/` 是方法层，不是现行系统契约；每条规则要有真实工序证据，废弃后归档，不保留半失效副本。`layer: playbook` 目前是项目本地值，待上游 `doc-layout-spec` 合并后以技能为准。
- 一处一事：同一事实只有一份权威文档，其他地方引用不复制。
- 需求进 `requirements/`；工序 `brief.md` 必须引 `REQ-xxxx`，一个 REQ 同时只挂一个在飞工序；无 REQ 的调研/概念工序引对应 `OQ` 并在 brief 说明边界。
- 收口写 `result.md` 后才可归档到 `history/works/`；归档件不得作为设计依据。
- 生成物标 `generated: true`，不手改。
- `design/scenarios/_index.md` 是生成物；改场景后跑 `bun run docs:index`，提交前跑 `bun run docs:check`。CI 尚未接入，当前以该命令作为本地门禁。
