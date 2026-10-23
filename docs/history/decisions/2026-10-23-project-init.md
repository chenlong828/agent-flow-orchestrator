---
layer: history
module: global
status: frozen
updated: 2026-10-23
---

# 2026-10-23 项目初始化与技能安装

## 背景

仓库为空目录起步。`~/skills/af-dev-skill`（v0.1 评审稿）含五个开发流程技能；姊妹目录 `agent-flow-ui` 已用同一套技能与五态文档树，可作为形态参照。

## 决策

1. **技能安装位置**：`.agents/skills/<name>/SKILL.md`，与 `agent-flow-ui` 一致。安装后由 DSH 项目级提供方（`project-agents`，rank 200）发现；本次已用 `skill` 工具实载 `doc-layout-spec` 验证可读。
2. **技能正文不改**：整目录复制自 `~/skills/af-dev-skill`，升级时覆盖同名目录并在本目录记新记录，不逐条维护副本。
3. **文档根**：`docs/`，五态分离；反占位，不预建空目录与索引行。
4. **本次只做流程层**：技能、文档树、git。技术栈与代码骨架不在本次，转 OQ-1，按 `arch-design-spec` 的 P1 流程决定。
5. **git**：`git init -b main`；仓库级 `user.name` / `user.email` 沿用 `agent-flow-ui` 的值，不写全局 `.gitconfig`（该文件不存在）。
6. **暂不建 CI 与文档校验脚本**：技术栈未定，过早选工具链会绑定实现；作为已知欠账记入 `plan/roadmap.md`。

## 被否决的方案

- **装到 `~/.dsh/skills`**：只对本机所有项目生效，项目内不可追溯版本，且会与 `agent-flow-ui` 的副本分叉。
- **同时装 `.dsh/skills` 与 `.agents/skills`**：同名双源，违背单一事实来源。
- **预建 `requirements/`、`design/`、`works/` 空目录**：违反反占位，会让路径与真实状态脱节。
- **顺手建 Node/TS 骨架**：技术栈未定，属 P1 结构决策；先选型再落地。

## 未验证的边界

`agent-flow-ui` 与本项目的关系来自目录结构与产品命名的推断，无任何一方的引用证据。已改记为 OQ-2，确认前不作为需求来源引用。

## 后果

- 新会话入口：`README.md` → `AGENTS.md` → `docs/README.md` → `plan/roadmap.md`。
- 技术栈冻结前不写实现代码；M1 / M2 之前不开工序。
- 文档只有人工校验；首个 P3 工序补门禁脚本。
