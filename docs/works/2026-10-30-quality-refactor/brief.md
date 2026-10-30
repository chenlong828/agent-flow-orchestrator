---
layer: works
module: global
status: active
updated: 2026-10-30
---

# 工序：代码质量基线收敛与结构重构

## 目标

按 `bun run quality:report` 的存量基线，分批收敛尺寸、复杂度、死代码与入口债务；保持 `/api/v1` 契约、数据库 schema、错误码和运行行为不变。

## 触发与基线

- 触发：新增代码质量检查器（工作区未提交：`scripts/quality-report.ts`、`.oxlintrc.json`、`knip.json`、`package.json`、`docs/playbook/code-health-rules.md`）。
- 基线 HEAD：`dac9316`；工作区另有评审试点改动，不属本工序，不修改、不提交。
- 报告必须用 Bun 跑：`node scripts/quality-report.ts` 会因 `bunPath=null` 把 OpenAPI 测试误报为 ERROR；项目内 Bun 为 `.local/bun/bun`。
- 2026-10-30 基线（项目内 Bun：`.local/bun/bun`）：
  - `bun run quality:report`：工具健康 8/8；违规 80 条、仅报告 158 条；OpenAPI/DTO 13 pass / 0 fail。
  - `bun test --max-concurrency=1`：273 pass / 0 fail / 2493 expect / 31 files。
  - `bun run typecheck`：0 错误。
  - `bun run docs:check`：场景索引最新。
- 报告全文：`report-before.txt`。

## 主要债务

| 区域 | 现状 | 规则 |
|---|---|---|
| `skill/draft.ts` | 623 行；`createSkillDraftService` 424 行；`saveDraft` 173 行 | Q-01 / Q-02 |
| `workflow/graph.ts` | `analyzeTopology` 复杂度 78；`collectGraph` 166 行 | Q-02 / Q-04 |
| `http-gateway/routes` | `handleSkill` 148 行 / 复杂度 57 / 14 分支；`handleWorkflow` 112 / 24；`handleExpert` 93 / 17；`createHttpApp` 92 / 20 | Q-02 / Q-04 / Q-20 |
| 服务与读模型工厂 | `createCatalog` 315 行；`createWorkflowService` 262 行；`createExpertService` 245 行 | Q-02 |
| 入口与死代码 | `main.ts` 深导入 skill 2 处；`skill/index.ts` 孤儿；8 个孤儿运行时导出 | Q-07 / Q-08 / Q-09 |
| 其他 | 17 处非空断言；12 个克隆块；2 个 6 参数函数 | Q-13 / Q-12 / Q-03 |

## 范围（待确认）

### 批次 A：入口与死代码收敛（P3）

- `main.ts` 改为经 `components/skill/index.ts` 装配，消除 2 处跨组件深导入与 1 个孤儿文件。
- 清理 8 个孤儿运行时导出：4 个 store 工厂从 barrel 移除（仍由组件内 service 使用）、`removeDraftTree` / `requireObject` / 2 个路径上限常量改为模块内私有。
- 预期：Q-07 2 → 0、Q-08 1 → 0、Q-09 8 → 0；不改任何行为。

### 批次 B：HTTP 路由拆分（P2）

- `routes/skill.ts` 按资源与方法拆成 `skills` 与 `skill-drafts` 两组处理函数，再按子资源分派；保留现有 404 顺序与 UUID 校验位置。
- `app.ts` 抽出文档、健康检查、skill-categories 与服务分派，压低 `route` 的分支与行数。
- 同批处理 `routes/expert.ts`、`routes/workflow.ts` 的同类超限；路由段访问改显式取值，消除其中的非空断言。
- 预期：Q-02 4 个函数回落、Q-04 3 个函数回落、Q-20 14 → ≤12、Q-13 路由部分清零。

### 批次 C：Workflow 分析拆分（P2）

- `collectGraph` 按 stages / nodes / edges / viewport 拆解析函数。
- `analyzeTopology` 按端点、seq 链、可达性、环、回退、fanout/fanin 拆成独立阶段，共享一次邻接表构建；保持 issue 产生顺序。
- `normalizeDsl` 与 `createWorkflowService` 按字段归一化与保存/导入/导出流程拆分。
- 预期：复杂度 78 / 24 / 19 / 20 全部 ≤15，`collectGraph` / `analyzeTopology` ≤80 行；依赖既有 graph / service / scenario 测试。

### 批次 D：Skill Draft 拆分（P2，需先定 OQ-9）

- D1（推荐）：保持单一 `SkillDraftService` 契约，按生命周期、文件操作、保存流程拆内部模块与阶段函数；事务与文件写入顺序不变。
- D2：拆成三个服务模块，由同一工厂组装 facade；改动面更大，需重新走查事务与配额。
- 预期：`draft.ts` ≤500 行，`createSkillDraftService` 与 `saveDraft` 回到 80 行内。

### 批次 E（阶段二候选）：Catalog 与 Service/Store 工厂（P2）

- `catalog/index.ts`：保留 `CatalogRead` facade，把按资源的读模型组装拆到独立文件；不改变方法语义与 `CatalogRead` 契约。
- `expert` / `harness` / `tool` / `workflow` 的 service 与 store：抽行映射、读模型拼装与 patch 归一化；`updateRoot` 的 6 参数改为输入对象。
- 预期：Q-02 剩余 9 个函数回落、Q-03 2 → 0、Q-12 12 → ≤6。
- 本轮按用户「全部编码层面问题改完」的要求，把 `ensureText` / `toIso` / `escapeLike` / `buildWhere` 抽到 `core/kernel`；OQ-8 中仅保留 catalog N+1 等未做项。

### 暂不做

- catalog N+1（OQ-7）、skill store（OQ-6）、请求上下文（OQ-10）、`RevisionConflictError` 兜底（OQ-11）。
- `skill_draft` 可空列：已按单基线处理，`created_by` / `updated_by` 直接写为 NOT NULL，可空列降到 37.5%；迁移历史合并为 `0001_baseline.sql`，本地开发/测试库已重置。
- 调阈值、改 `openapi.yaml` / schema、加依赖、全仓格式化、顺手优化未测性能。

## 验证

每批次完成后：

1. `bun test --max-concurrency=1`：不低于 273 pass，0 fail；
2. `bun run typecheck`：0 错误；
3. `bun run docs:check`；
4. `bun run quality:report`：不新增违规，批次目标指标下降；
5. `openapi-fields` 保持 13 pass / 0 fail，`openapi.yaml` 无 diff；
6. 最终在 `3100` 端口启动服务，验证 `/healthz` 与 `/openapi.yaml` 为本次版本。

## 任务表

| ID | 类型 | 内容 | 组件 | 状态 |
|---|---|---|---|---|
| T-QUALITY-01 | refactor | 入口与死代码收敛 | skill / 各组件 barrel | 完成 |
| T-QUALITY-02 | refactor | HTTP 路由拆分 | http-gateway | 完成 |
| T-QUALITY-03 | refactor | Workflow 分析拆分 | workflow | 完成 |
| T-QUALITY-04 | refactor | Skill Draft 拆分 | skill | 完成 |
| T-QUALITY-05 | refactor | Catalog / Service / Store 工厂拆分 | catalog / expert / harness / tool / workflow | 完成 |
| T-QUALITY-06 | refactor | 全量指标收敛（函数数、克隆、非空、可选字段、config） | core / 各组件 | 完成 |
| T-QUALITY-07 | docs | 本工序结果与剩余裁决记录 | docs/works | 完成 |
| T-QUALITY-08 | db | 迁移拍扁为单基线并重置本地库 | db/migrations | 完成 |

## 开放问题

- OQ-9：已按 D1 落地（保留单一 `SkillDraftService` facade，内部拆分）。
- 批次 B 已同批处理 expert / workflow 路由。
- 孤儿导出已逐项确认并删除；保留的公共类型仍由 barrel 再导出。
- 阶段二（批次 E）已在本工序内完成。
- 已全部收口：`skill_draft` 的 `created_by` / `updated_by` 已改为 NOT NULL，迁移历史已拍扁为单基线。
