---
layer: works
module: global
status: closed
updated: 2026-10-25
---

# B1 每端点正反例契约补测

## 背景

- B1 的 29 个业务端点与四类资产已经交付，`T-B1-I09` 覆盖了种子、旅程、架构与健康检查。
- [`2026-10-25-core-config/result.md`](../2026-10-25-core-config/result.md) 明确记录：当时未补 API「每端点 3 正 1 反」的剩余缺口，属于独立任务。
- 工作区已有一批未提交的 API 契约补测改动，覆盖 HTTP 端点、服务层边界与测试基座；本次把这个独立工序收口，不改业务实现与契约。

## 目标

1. 按 `API-01`～`API-29` 补齐 HTTP 契约的正例、反例与边界断言，断言具体状态码、字段值、列表顺序和错误 `code`。
2. 补齐四类资产服务层的写入规则、失败路径与事务回滚断言。
3. 补齐 `catalog`、`kernel`、`platform` 的只读组合、错误分类、事务与迁移测试。
4. 同步 README 的测试计数，使文档与实际全量结果一致。

## 范围

**做：**

- `tests/components/http-gateway/` 下的 Harness、工具、Skill、专家、健康检查与公共契约测试。
- `tests/components/{harness,tool,skill,expert}/service.test.ts` 的边界与失败路径。
- `tests/components/catalog/`、`tests/components/kernel/`、`tests/components/platform/`。
- `README.md` 的测试计数。

**不做：**

- 不改业务实现、数据库 schema、REST 契约或 OpenAPI。
- 不做 UI 适配，不在本仓库启动或修改外部 UI 项目。
- 不以覆盖率百分比为目标；只补规格要求的业务断言。
- 不把已关闭的 `2026-10-25-core-config` 历史结论改写为“当时已完成”。

## 改动级别与确认门

**P3**：仅测试与文档，不改业务契约、数据结构、组件边界或运行行为。按默认执行，无额外人工确认门。

## 验收标准

- `API-01`～`API-29` 均有对应用例，覆盖成功路径、关键失败路径与边界。
- 断言具体状态码、字段值、顺序、错误 `code` 或 `details`，不以存在性断言替代业务结果。
- 全量测试通过；`typecheck` 通过；`git diff --check` 无空白错误。
- README 测试计数与实际全量结果一致。

## 任务表

| ID | 类型 | 组件 | 状态 | 产出 |
|---|---|---|---|---|
| `T-B1-I10` | verify | `global` | completed | API-01～29 正反例、服务层与测试基座补测、README 计数同步 |

## 装载清单

- [`http-gateway/spec.md`](../../design/components/http-gateway/spec.md)：端点表与「每个端点 3 正 1 反」要求。
- [`architecture.md`](../../design/architecture.md)：契约测试分层与测试边界。
- [`2026-10-24-db-backend-infra/result.md`](../2026-10-24-db-backend-infra/result.md)：B1 既有验证结果。
- [`2026-10-25-core-config/result.md`](../2026-10-25-core-config/result.md)：未补测缺口的来源说明。
