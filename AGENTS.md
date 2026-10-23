# 项目协作约定（agent 必读）

本文件只写「怎么做」的稳定规则。项目是什么见 `README.md`，文档放哪见 `docs/README.md`。

## 项目定位

AgentFlow 研发智能体工作流编排服务的编排侧（职责按目录名推断，待架构选型时确认）。相关项目 [`../agent-flow-ui`](../agent-flow-ui) 是同一编排服务的 UE 高保真原型；两个项目的关系、需求是否以原型为来源，均未确认，记于 `docs/plan/open-questions.md` OQ-2，确认前不作为事实引用。

## 语言

- 文档、注释、commit message 用中文；代码标识符、API 名、目录名用英文。
- 结论必须能落到文件、命令输出或测试结果，不写「应该可以」。

## 技能（已安装于 `.agents/skills/`）

来源：`~/skills/af-dev-skill` v0.1（2026-10-23 整目录复制）。技能正文不手改；升级 = 覆盖同名目录，并在 `docs/history/decisions/` 记一条。

| 技能 | 何时加载 |
|---|---|
| `req-scenario-spec` | 录需求、定场景、拆任务、多对话交接 |
| `design-before-coding` | 任何写 / 改代码前的组件级设计 |
| `arch-design-spec` | 动组件切分、公共契约、schema、数据所有权、分层依赖、热路径；定 P0–P3 与人工确认门 |
| `dev-execution-spec` | 动手到交付：模糊先问、验收、提交、工作区卫生 |
| `doc-layout-spec` | 新建 / 移动 / 归档文档，核对文档树 |

阅读顺序：req → design → arch → dev → doc。纯设计任务加载前三个；落代码加 dev；只写 / 改文档才加载 doc。

## 门禁与纪律

- 改动级别按 `arch-design-spec` 判定：P1 未确认不写实现代码，P2 未确认不合并，P0 只出阻塞简报。
- 技术栈与运行形态未定（`docs/plan/open-questions.md` OQ-1），确定前不建代码骨架。
- 密钥只进 `.env`（已 ignore），不进 README、日志、注释、commit；提交前过 `git status` 与 `git diff --cached`。
- 一个 commit 一件事，绑定任务与场景 ID；不夹带无关重构、依赖升级或格式化。
- 删除、覆盖工作区、`git reset --hard`、`git clean`、对外发布，执行前必须确认。
- 临时文件只放 `docs/works/<工序>/`，不散落仓库根。

## 文档纪律

- 五态分离：`docs/requirements|plan|design|works|history`，位置即状态；每份文档带 frontmatter（`layer` / `module` / `status` / `updated`）。
- 反占位：目录与文件在内容诞生时创建，不预建空目录、不预建索引行。
- 一处一事：同一事实只有一份权威文档，其余引用不复制；排期只在 `plan/roadmap.md`。
- 场景只引用 `REQ-` / `SCN-` / `CMP-` ID，不写文件行号。
- 生成物（如 `design/scenarios/_index.md`）标 `generated: true`，不手改。
- 当前没有自动校验脚本，属已知欠账；改完文档人工核对「路径 ↔ layer / status」一致。
