---
layer: works
module: expert
status: active
updated: 2026-11-22
procedure: 2026-11-22-expert-structure
level: P2
---

# 结果：专家结构精简，职责范围合并为 Markdown

## 1 结论

- 专家根只保留 `role`、`duty`、`persona` 与有序 Skill 装配；`duty` 是 Markdown 职责范围，固定四节：主要职责 / 技能配合顺序 / 重点验证顺序 / 对承担任务的解读。
- 迁移 0015 已把存量 `skill_order` / `verify_order` / `notes` 合并进 `duty` 并清空旧列；seed 改为同一格式，可重复执行。
- 提示词专家块只输出 名称 / 角色 / 性格 / 职责范围；工具清单、参考知识、主要工作内容不再进入 prompt。
- 接口过渡口径：`skillOrder` / `verifyOrder` / `notes` 恒为 `""`，`tools` / `refs` 恒为 `[]`，`toolCount` 恒为 `0`；这些字段与 `toolIds` 的写请求接受但忽略，`setTools` 只接受请求、不落库。UI 改造完成后删除字段、表与端点。
- Skill 装配（`skillIds` 有序、slug 唯一）与既有派发链路不受影响。

## 2 落点

| 内容 | 文件 |
|---|---|
| 迁移 | [`0015_expert_duty_markdown.sql`](../../../db/migrations/0015_expert_duty_markdown.sql) |
| 专家读写与类型 | [`write.ts`](../../../src/components/expert/write.ts)、[`read.ts`](../../../src/components/expert/read.ts)、[`normalize.ts`](../../../src/components/expert/normalize.ts)、[`store.ts`](../../../src/components/expert/store.ts)、[`types.ts`](../../../src/components/expert/types.ts) |
| 提示词与派发 | [`prompt.ts`](../../../src/components/run/prompt.ts)、[`dispatch-ops.ts`](../../../src/components/run/dispatch-ops.ts) |
| 读模型投影 | [`catalog/expert.ts`](../../../src/components/catalog/expert.ts) |
| 契约 | [`openapi.yaml`](../../../src/components/http-gateway/openapi.yaml) |
| 种子 | [`seed.ts`](../../../scripts/seed.ts) |
| 规格 | [`expert/spec.md`](../../design/components/expert/spec.md)、[`run/spec.md`](../../design/components/run/spec.md)、[`catalog/spec.md`](../../design/components/catalog/spec.md)、[`http-gateway/spec.md`](../../design/components/http-gateway/spec.md)、[`architecture.md`](../../design/architecture.md) |

## 3 验证

迁移与种子（本地库）：

```text
$ bun run db:migrate
迁移完成：applied=1 skipped=14
  + 0015_expert_duty_markdown.sql

$ bun run db:seed
种子完成：Skill 15、专家 15、流程 4；专家技能装配 60 条（不预置 Harness/工具）
```

迁移后「评审专家」的 `duty` 已包含四节，旧三列为空；`GET /api/v1/experts/{id}`：

```json
{"role":"以独立、否决视角对实现产物做准出评审","duty":"## 主要职责\n先运行 precheck……","skillOrder":"","verifyOrder":"","notes":"","tools":[],"refs":[],"toolCount":0,"skillCount":5}
```

自动化门禁：

```text
$ bun run typecheck
$ tsc --noEmit                      # 通过

$ bun test --max-concurrency=1
456 pass / 1 skip / 0 fail（457 tests）
```

服务重启（`bun run scripts/start-bg.ts reload`）后：

```text
$ curl -s http://127.0.0.1:3100/healthz
{"status":"ok","database":"up"}
$ curl -s http://127.0.0.1:3100/openapi.yaml | grep -c "职责范围，Markdown"
4
```

## 4 未做 / 待办

- 未删除 `expert_tool`、`expert_ref` 表与 `expert` 的 `skill_order` / `verify_order` / `notes` 列；等 UI 侧完成 ③④⑤ 删除后另立工序整体清理（同时移除 `toolIds` / `refs` / `setTools` 端点与 `toolCount`）。
- 未改 UI 仓库；专家编辑界面仍会显示与提交这些过渡字段，后端按忽略处理。
- 未改历史归档件中的「五区」表述，历史保持原样。
