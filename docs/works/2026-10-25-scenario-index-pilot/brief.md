---
layer: works
module: global
status: closed
updated: 2026-10-25
---

# 场景索引试点：智能体能力资产 / 专家定义与装配

## 背景

当前资料库有组件规格、工序结果和测试，但没有业务域 → 价值流 → 业务场景的索引，也没有从场景到文档锚点、代码入口、测试 ID 和外部不可变引用的可生成映射。

`req-scenario-spec` 已定义业务功能树、场景卡四要素、`SCN` 状态与生成索引；`doc-layout-spec` 已定义 `design/scenarios/` 路径与 `_index.md` 为生成物。项目此前因 M3 待排、B1 为无用户旅程的旁路，未建立第一个场景。

本工序只做单场景试点，验证索引格式与生成器；不铺全量场景树，不改后端功能。

## 目标

1. 建立首个业务场景：业务域「智能体能力资产」/ 价值流「专家能力定义与装配」/ 业务场景「专家定义与装配管理」。
2. 场景卡记录入口、运行序、外部不可变引用、3 正 1 反测试。
3. 为试点测试分配稳定 ID：`TC-EXP-001`～`TC-EXP-004`。
4. 实现最小索引生成器：扫描场景卡、文档 heading、代码导出符号、测试 ID 和 OpenAPI operation，生成 `design/scenarios/_index.md`。
5. 提供 `bun run docs:index` 与 `bun run docs:check`，后者在索引过期时失败。
6. 验证场景卡与生成索引的锚点全部可解析；不声称完整场景 `verified`。

## 范围

**做：**

- `docs/design/scenarios/agent-capability-assets/.../scenario.md`。
- 试点 4 个测试标题加 `TC-EXP-*` 前缀，不改变测试逻辑。
- `scripts/scenario-index.ts` 与 `package.json` 脚本。
- 生成 `docs/design/scenarios/_index.md`。
- `docs/README.md`、AGENTS 或相关规格中的场景/索引入口说明。
- 必要的工序结果与验证记录。

**不做：**

- 不新增业务功能、端点、表或迁移。
- 不把所有现有测试补 ID，不把 B1 的 30 个端点逐个场景化。
- 不建完整业务域/价值流树，不新增其他场景。
- 不改外部 `agent-flow-ui`。
- 不修改上游 `.agents/skills/`。

## 改动级别与确认门

**P2**：新增场景文档、测试 ID 与文档生成脚本，不改运行时代码或数据库契约。

用户已确认三维命名与试点范围；本工序按单场景试点执行。

## 任务表

| ID | 类型 | 组件 | 状态 | 产出 |
|---|---|---|---|---|
| `T-SCN-01` | design | `global` | done | 场景卡、入口/运行序/外部引用/3+1 映射 |
| `T-SCN-02` | change | `global` | done | 4 个测试 ID 前缀 |
| `T-SCN-03` | change | `global` | done | 索引生成器与 docs 脚本 |
| `T-SCN-04` | verify | `global` | done | 锚点校验、docs:check、测试与 typecheck |
| `T-SCN-05` | docs | `global` | done | 索引、导航、result 收口 |

## 验收标准

- 场景卡包含入口、运行序、外部引用、3 正 1 反测试；CRUD 子流程作为步骤，不拆成多个场景。
- 4 个测试 ID 在测试标题中唯一存在，生成器能解析。
- 文档锚点用 `path + heading`，不写行号；代码入口用 `path + symbol`；外部引用用 `path + operationId`。
- `bun run docs:check` 在索引与源数据一致时通过，改动场景后能检测过期。
- 同一输入重复生成索引无 diff。
- `bun test --max-concurrency=1`、`bun run typecheck` 通过。
- 场景状态为 `designed`，不标 `verified`。

## 待确认项

- 删除、引用保护等 CRUD 子流程本次未全部纳入 3+1，作为后续补测；不在本试点宣称完整验收。
