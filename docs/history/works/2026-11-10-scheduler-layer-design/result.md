---
layer: history
module: global
status: frozen
updated: 2026-11-11
procedure: 2026-11-10-scheduler-layer-design
---

# 结果：执行面调度层设计

## 1 验收对照

| 判据（[`brief.md`](brief.md) §6） | 结果 | 证据 |
|---|---|---|
| `S-01`–`S-08` 每条有唯一落点且不与契约冲突 | 满足 | [`scheduler/spec.md`](../../../design/components/scheduler/spec.md) §4.2 逐条映射；`review.md` §4「契约职责落点」 |
| 三端点有路径、成功码、错误码与 DTO 映射 | 满足 | [`http-gateway/spec.md`](../../../design/components/http-gateway/spec.md) §4.3（`EXE-01`–`EXE-03`）、§5.8、§3.3 错误表 |
| 新组件有职责/数据/契约/状态机/依赖/验证/预算/待定 | 满足 | [`scheduler/spec.md`](../../../design/components/scheduler/spec.md)、[`instance/spec.md`](../../../design/components/instance/spec.md) 各 8 节 |
| 5 张场景四要素齐，不复制组件契约 | 满足（入口与 TC 标 `planned`） | [`execution-scheduling/`](../../../design/scenarios/workflow-orchestration/execution-scheduling/)；场景正文只引用契约条款 ID，不抄字段 |
| 决策有记录、OQ 有落点 | 满足 | [`history/decisions/2026-11-10-scheduler-layer-design.md`](../../decisions/2026-11-10-scheduler-layer-design.md)；`OQ-18`/`OQ-20` 关闭，`OQ-21`/`OQ-22` 有去向 |
| `docs:check` 通过；`bun test`/`typecheck` 不回归 | 满足 | 见 §2 |

## 2 验证记录

```bash
export PATH="$PWD/.local/bun:$PATH"
bun run docs:index     # 已生成 docs/design/scenarios/_index.md：11 个场景
bun run docs:check     # 场景索引已是最新：11 个场景
bun run check          # tsc --noEmit + bun test + docs:check
                       # 281 pass / 0 fail，2617 expect()，32 files；索引校验通过
```

- 本轮无代码改动：`src/`、`db/`、`tests/`、`src/components/http-gateway/openapi.yaml` 均未修改，故不运行 `quality:report`（基线不变）。
- 链接检查：对本轮新增与修改的 18 份文档做相对链接解析，0 处失效。

## 3 结论落点

| 结论 | 落点 |
|---|---|
| 组件切分（`CMP-scheduler` + `CMP-instance`，端点并入网关） | [`architecture.md`](../../../design/architecture.md) §3–§5、决策记录 §1 |
| 任务状态机、重派/未确认重发、结果接受、重试策略 | [`scheduler/spec.md`](../../../design/components/scheduler/spec.md) §4 |
| 实例登记、工作区路径、粘性、`blocked` 状态 | [`instance/spec.md`](../../../design/components/instance/spec.md) §4 |
| 执行面端点、错误映射、DTO | [`http-gateway/spec.md`](../../../design/components/http-gateway/spec.md) §4.3、§5.8 |
| `task_not_found` / `unsupported_protocol` 与 `SkillPackageSource` | [`kernel/spec.md`](../../../design/components/kernel/spec.md) §3.1、§3.6 |
| 重试参数、`[executor]` | [`config/spec.md`](../../../design/components/config/spec.md) §3.1–§3.2；执行面凭据 2026-11-10 改为落 Harness 表，`EXECUTOR_CLIENTS` 已删除（[`2026-11-10-executor-client-token.md`](../../decisions/2026-11-10-executor-client-token.md)） |
| `packageId` / `digest` / `etag` 与旧版本 404 | [`skill/spec.md`](../../../design/components/skill/spec.md) §3.3 |
| 5 张执行面场景 | [`execution-scheduling/`](../../../design/scenarios/workflow-orchestration/execution-scheduling/) 与生成的 [`_index.md`](../../../design/scenarios/_index.md) |
| 开放问题处置 | [`plan/open-questions.md`](../../../plan/open-questions.md) `OQ-18`、`OQ-20` 关闭；`OQ-21` 补调度器侧兜底；新增 `OQ-22` |
| 在办工序登记 | [`plan/roadmap.md`](../../../plan/roadmap.md)「在办工序」 |

## 4 未完成与待确认

1. **P1 人工门已签字（2026-11-11）**：7 项决策已确认，其中 `D-03` 改为「失败结果不自动重派」，已同步 `scheduler/spec.md` §4.5、`config/spec.md`、`SCN-0202`；设计冻结，实现工序另立。
2. **执行面无实现**：`EXE-01`–`EXE-03`、`task`/`task_attempt`/`instance` 表、执行面配置、`SkillPackageSource` 均标「未实现」；实现工序另立（`H-06`）。
3. **场景状态停在 `draft`**：5 张场景的运行序、不可变引用、3 正 1 反测试方案已齐，但仓库 `docs:check` 要求 frontmatter 的 TC ID 已存在于 `tests/**/*.test.ts`，纯设计工序无法满足 → 按 `review.md` `D-06` 保持 `draft`，实现工序补测试后转 `designed`/`verified`。
4. **client 侧偏离未修**：`OQ-15`（`timeout` 错误码）、`OQ-16`（摘要不匹配不重试）、`OQ-17`（无缓存带条件头）仍按契约与设计并存；由于失败结果已不自动重派，`OQ-15` 的影响降为「失败原因展示口径」。
5. **未做的范围**：任务启动入口（实例登记与任务入队 HTTP 面，`OQ-22`）、任务来源与 prompt 组成、B4 运行实例、历史包保留、只读状态端点。

## 5 下一步

- 已确认，本工序收口归档；另立实现工序（P1），按 `scheduler/spec.md` §6 与 `instance/spec.md` §6 的验证矩阵落代码、测试、OpenAPI 与迁移。
- 若确认前要调整（如重试默认值、`packageId` 构成），先改对应规格与决策记录，再重跑 `bun run docs:check`。
