# AgentFlow · 编排服务（agent-flow-orchaster）

AgentFlow 研发智能体工作流编排服务的编排侧工程：目标是把「工作流定义 → 专家 / Skill / 工具装配 → 运行实例 → 效能数据」这条链路落成可运行、可验证的服务。

- 同族项目（关系待确认，见 [`docs/plan/open-questions.md`](docs/plan/open-questions.md) OQ-2）：[`../agent-flow-ui`](../agent-flow-ui) —— 同一「研发智能体工作流编排服务」的 UE 高保真原型
- 文档树：[`docs/`](docs/README.md)（五态分离，导航与阅读顺序见该页）
- 协作与门禁：[`AGENTS.md`](AGENTS.md)
- 技能：`.agents/skills/`（af-dev-skill v0.1，随仓库安装）

## 当前状态

M0 项目初始化已完成：技能安装、五态文档树、git 仓库。技术栈与运行形态尚未选定，首个里程碑待排——见 [`docs/plan/roadmap.md`](docs/plan/roadmap.md) 与 [`docs/plan/open-questions.md`](docs/plan/open-questions.md)。

技术栈确定前不写实现代码；选型与技术栈相关的结构决策按 `arch-design-spec` 的 P1 流程走。

## 目录

```
.
├── AGENTS.md                 ← agent 协作规则、技能加载与门禁
├── .agents/skills/           ← 五个开发流程技能（项目级安装）
├── README.md
└── docs/                     ← 五态文档树
```
