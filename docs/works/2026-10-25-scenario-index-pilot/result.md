---
layer: works
module: global
status: closed
updated: 2026-10-25
---

# 场景索引试点：智能体能力资产 / 专家定义与装配

## 结论

首个业务场景已建立，索引可由场景源数据稳定生成：

- 业务域：智能体能力资产
- 价值流：专家能力定义与装配
- 业务场景：专家定义与装配管理（`SCN-0001`）

场景状态保持 `designed`。当前覆盖创建、列表、聚合更新和装配失败回滚；删除、引用保护、启停等 CRUD 子流程尚未全部进入 3 正 1 反，因此不标 `verified`。

## 交付物

| 文件 | 内容 |
|---|---|
| [`../../design/scenarios/agent-capability-assets/expert-capability-definition-and-assembly/expert-definition-and-assembly-management/scenario.md`](../../design/scenarios/agent-capability-assets/expert-capability-definition-and-assembly/expert-definition-and-assembly-management/scenario.md) | 场景卡：入口、运行序、外部引用、3+1 映射、覆盖边界 |
| [`../../design/scenarios/_index.md`](../../design/scenarios/_index.md) | 生成索引，`generated: true`，不手改 |
| [`../../../scripts/scenario-index.ts`](../../../scripts/scenario-index.ts) | 索引生成与校验脚本 |
| [`../../../package.json`](../../../package.json) | `docs:index`、`docs:check` |
| [`../../../tests/components/http-gateway/expert.test.ts`](../../../tests/components/http-gateway/expert.test.ts) | `TC-EXP-001`～`TC-EXP-004` 测试 ID 前缀，测试逻辑未改 |

## 实现口径

- 文档锚点：`path + heading`，源数据保存 heading 文本，不存行号；生成链接时再计算锚点。
- 代码入口：`path + 导出符号`；生成器用导出声明正则校验，当前覆盖 `export function/const/let/var/class/interface/type/enum`。
- 测试：测试标题以 `TC-<模块>-<三位序号>` 开头；场景 frontmatter 用 `R1/R2/R3/N1` 映射，测试 ID 不编码场景角色。
- 外部引用：`path + operationId`，本场景引用 `createExpert`、`listExperts`、`patchExpertAggregate`；不复制 OpenAPI 字段。
- 索引生成：扫描场景 frontmatter，校验路径层级、场景 ID、flow、状态、入口符号、文档 heading、测试 ID、OpenAPI operation，再分组生成。
- 更新方式：场景源文件是唯一事实来源；改完运行 `bun run docs:index`，提交前运行 `bun run docs:check`。
- 当前无 CI；`docs:check` 是本地门禁，CI 接入后可直接复用该命令。

## 验证

| 命令 | 结果 |
|---|---|
| `PATH="$PWD/.local/bun:$PATH" bun run docs:index` | 生成 `docs/design/scenarios/_index.md`，1 个场景 |
| `PATH="$PWD/.local/bun:$PATH" bun run docs:check` | 通过；索引与源数据一致 |
| `PATH="$PWD/.local/bun:$PATH" bun test --max-concurrency=1` | 199 pass，0 fail，1953 expect |
| `PATH="$PWD/.local/bun:$PATH" bun run typecheck` | 通过 |
| `git diff --check` | 通过 |

锚点校验由生成器覆盖：3 个代码导出符号、3 个文档 heading、4 个测试 ID、3 个 OpenAPI operation 全部可解析。

## 偏差与欠账

- 未建 `requirements/`：这是文档/工具链旁路，没有用户旅程，`brief.md` 为锚点。
- 未建完整业务域/价值流树；本次只建一个场景。
- 未给全部测试补 ID；只在试点 4 个测试标题加前缀，后续触及时补齐。
- 未覆盖完整 CRUD、删除与引用保护的场景验收；场景保持 `designed`。
- `docs:check` 只校验场景索引相关锚点；完整文档树的 `layer` / `status` / 路径一致性仍无自动校验。
- 生成器的代码符号校验是导出声明正则，不是完整 TypeScript AST；接口方法、重导出等复杂符号后续需要增强。

## 后续

1. 在 M3 真正出现需求时，再补 `REQ` 与完整场景验收；当前不把 `SCN-0001` 冒充完整业务验收。
2. 把删除、引用保护、启停等子流程补入 3+1，或明确排除出本场景后再评估 `verified`。
3. 需要时把 `docs:check` 接入 CI；当前只做本地门禁。
4. 观察若干场景后再决定是否把 `playbook/` 与场景索引规则合并回上游技能。
