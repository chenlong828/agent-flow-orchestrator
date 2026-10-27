---
layer: history
module: global
status: frozen
updated: 2026-10-27
---

# B1 每端点正反例契约补测：结果

## 结论

B1 的 HTTP 契约补测已收口。`API-01`～`API-29` 均有对应用例，覆盖成功、失败、边界、分页、`If-Match`、引用保护与错误映射；服务层与测试基座的缺口也一并补齐。业务实现、数据库 schema、REST 契约与 OpenAPI 均未改动。

全量测试当前为 **188 pass / 0 fail / 1839 expect / 21 files**；README 的测试计数同步为 188。

## 交付物

| 内容 | 落点 |
|---|---|
| Harness / 工具 / Skill / 专家 HTTP 契约正反例 | [`tests/components/http-gateway/`](../../../../tests/components/http-gateway) |
| 四类资产服务层边界与失败路径 | [`harness`](../../../../tests/components/harness/service.test.ts)、[`tool`](../../../../tests/components/tool/service.test.ts)、[`skill`](../../../../tests/components/skill/service.test.ts)、[`expert`](../../../../tests/components/expert/service.test.ts) |
| 只读组合、错误分类、事务与迁移 | [`catalog`](../../../../tests/components/catalog/read-model.test.ts)、[`kernel`](../../../../tests/components/kernel/errors.test.ts)、[`platform`](../../../../tests/components/platform/db.test.ts) |
| 公共契约测试 | [`common-contract.test.ts`](../../../../tests/components/http-gateway/common-contract.test.ts) |
| 测试计数 | [`README.md`](../../../../README.md) 更新为 188 |

## 覆盖结果

- `API-01`～`API-07`：Harness 列表、详情、创建、更新、启停、删除、引用页。
- `API-08`～`API-13`：工具列表、详情、创建、更新、删除、引用页。
- `API-14`～`API-21`：Skill 分类、列表、详情、创建、更新、启停、删除、引用页。
- `API-22`～`API-29`：专家列表、详情、创建、更新、启停、删除、Skill 装配、工具装配。
- 公共契约：名称冲突、404、428、409、未知字段、非法分页与 UUID、响应 Content-Type。
- 服务层：枚举与边界、改名冲突、旧 revision、引用保护、事务回滚、装配顺序与重复目标。
- 测试基座：catalog 只读投影、kernel 错误分类、platform 事务/迁移/数据库错误分类。

## 验证

| 验证 | 命令 | 结果 |
|---|---|---|
| 全量测试 | `./.local/bun/bun test --max-concurrency=1` | 188 pass / 0 fail / 1839 expect / 21 files |
| 类型检查 | `./.local/bun/bun run typecheck` | 通过，无输出 |
| 空白检查 | `git diff --check` | 无输出 |

## 偏差与说明

- 没有按“覆盖率百分比”设目标，也没有为凑数量新增空洞用例；用例按端点表与业务规则补。
- 没有改 `2026-10-25-core-config/result.md` 的历史结论；该工序记录的是当时状态，本次补测由本工序收口。
- `tests/components/http-gateway/common-contract.test.ts` 中工具参数使用契约字段 `key`，与 `T-B1-I04` 的修复一致；该文件作为补测工序整体提交。

## 结论落点

| 内容 | 位置 |
|---|---|
| 补测范围与任务 | [`brief.md`](brief.md) |
| HTTP 契约权威 | [`http-gateway/spec.md`](../../../design/components/http-gateway/spec.md) |
| 全量验证 | 本文件「验证」表 |
| 后续 UI 适配 | 不在本工序；属于 `agent-flow-ui` 独立项目任务 |
