# 文档导航

本目录按「五态分离」组织：**位置即状态**——文档在哪一层，就处于什么生命周期；frontmatter（`layer` / `module` / `status` / `updated`）与路径互相校验。分层规则见技能 `doc-layout-spec`（技能不在文档树内）。

## 当前实际存在的结构

```
docs/
├── README.md
├── plan/                                   ← 调度：接下来做什么
│   ├── roadmap.md
│   └── open-questions.md
├── design/                                 ← 真相：系统现在是什么
│   ├── architecture.md
│   └── components/
│       ├── kernel/spec.md
│       ├── platform/spec.md
│       ├── harness/spec.md
│       ├── tool/spec.md
│       ├── skill/spec.md
│       ├── expert/spec.md
│       ├── catalog/spec.md
│       └── http-gateway/
│           ├── spec.md
│           └── openapi.yaml
├── works/                                  ← 执行：正在做什么
│   ├── 2026-10-24-agentflow-execution-concept/
│   │   ├── brief.md
│   │   ├── concept-design.md
│   │   └── result.md
│   └── 2026-10-24-db-backend-infra/
│       ├── brief.md
│       ├── analysis.md
│       ├── use-cases.md
│       ├── domain-objects.md
│       ├── proposal.md
│       ├── implementation-plan.md
│       └── result.md
└── history/                                ← 记忆：怎么走到这里（冻结只读）
    └── decisions/
        ├── 2026-10-23-project-init.md
        └── 2026-10-24-component-boundary-and-naming.md
```

其余内容在诞生时创建，**不预建空目录、不预建索引行**：

- `requirements/`：一卡一文件 `REQ-0001-<slug>.md`，只回答「为什么做」；
- `design/scenarios/`：`<领域>/<价值流>/<场景>/scenario.md`，业务功能树按需建立；
- `design/components/` 与未来的 `design/scenarios/` 是**按文档类型分的兄弟目录**：前者是单组件规格（可附派生的机器可读契约），后者是跨组件运行序；`architecture.md` 是系统视图。三者不混放，也不因为“一切皆组件”而扁平化。
- `works/`：一级只有工序目录 `YYYY-MM-DD-<短名>/`，含 `brief.md`，收口后补 `result.md` 再整目录归档。

`plan/risks.md` 在首条真实风险出现时创建；`plan/` 一级只放这三个固定主题，不建子目录。

## 阅读顺序（新接手者）

1. [`../README.md`](../README.md) —— 项目定位与当前阶段
2. [`../AGENTS.md`](../AGENTS.md) —— 技能加载、门禁与文档纪律
3. [`plan/roadmap.md`](plan/roadmap.md) —— 里程碑、工序与依赖
4. [`plan/open-questions.md`](plan/open-questions.md) —— 未决的跨工序问题
5. [`design/architecture.md`](design/architecture.md) —— 现行组件边界、依赖与数据所有权
6. [`design/components/kernel/spec.md`](design/components/kernel/spec.md) —— 共享错误、分页与端口契约
7. [`design/components/http-gateway/spec.md`](design/components/http-gateway/spec.md) 与 [`openapi.yaml`](design/components/http-gateway/openapi.yaml) —— 对外 REST 契约，UI 侧按此印证
8. [`works/2026-10-24-db-backend-infra/result.md`](works/2026-10-24-db-backend-infra/result.md) —— B1 实现结果、验证命令与偏差
9. [`history/decisions/2026-10-23-project-init.md`](history/decisions/2026-10-23-project-init.md) —— 初始化时的取舍与被否决方案

## 维护纪律（速记）

- 新建文档先问「属于哪一态」，按路径放置并写 frontmatter；`layer` 与目录矛盾、`status` 越出本层值域、`module` 与组件不符，发现即修。
- 一处一事：同一事实只有一份权威文档，其他地方引用不复制。
- 需求进 `requirements/`；工序 `brief.md` 必须引 `REQ-xxxx`，一个 REQ 同时只挂一个在飞工序；无 REQ 的调研/概念工序引对应 `OQ` 并在 brief 说明边界。
- 收口写 `result.md` 后才可归档到 `history/works/`；归档件不得作为设计依据。
- 生成物标 `generated: true`，不手改。
- 目前无自动校验脚本（见 roadmap 欠账），改完人工核对路径与 frontmatter 一致。
