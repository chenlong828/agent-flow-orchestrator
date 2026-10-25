---
layer: works
module: global
status: closed
updated: 2026-10-25
---

# 结果：列表读模型补齐

## 结论

三个列表读模型缺口已在后端补齐，列表接口一次请求即可渲染，不需要 BFF 逐条拉详情：

- `GET /api/v1/skills`：`SkillListItem` 新增有序 `triggers`；`SkillSummary` 读取即带触发词，列表与 `getSummary` 共用。
- `GET /api/v1/experts`：`ExpertListItem` 新增 `skills`，按装配顺序最多返回前 3 个 `{id,name}`；`ExpertRead.list` 返回有序 `skillIds` 供 `catalog` 组合。
- `GET /api/v1/tools`：`ToolListItem` 新增 `description`；详情仍返回完整参数与创建时间。
- 详情语义未变：Skill 详情仍有五章/踩坑/引用，专家详情仍是完整装配摘要，工具详情仍有参数。
- 未新增 `?include=` 参数、未加 BFF 富化、未让前端逐条查询，也未改数据库 schema。

## 交付物

| 落点 | 内容 |
|---|---|
| [`src/components/skill/types.ts`](../../../src/components/skill/types.ts) / [`service.ts`](../../../src/components/skill/service.ts) | `SkillSummary.triggers`，列表与摘要读取 |
| [`src/components/expert/types.ts`](../../../src/components/expert/types.ts) / [`service.ts`](../../../src/components/expert/service.ts) | `ExpertSummary.skillIds`，列表返回有序装配 ID |
| [`src/components/catalog/index.ts`](../../../src/components/catalog/index.ts) | `SkillListItem.triggers`、`ToolListItem.description`、`ExpertListItem.skills` 前 3 预览 |
| [`src/components/http-gateway/openapi.yaml`](../../../src/components/http-gateway/openapi.yaml) | 列表字段、`ExpertSkillPreview`、`ExpertBase`、详情复用与说明 |
| [`docs/design/components/skill/spec.md`](../../design/components/skill/spec.md) | 摘要含 `triggers` |
| [`docs/design/components/expert/spec.md`](../../design/components/expert/spec.md) | 列表含有序 `skillIds`，供预览组合 |
| [`docs/design/components/catalog/spec.md`](../../design/components/catalog/spec.md) | 三类列表视图与数据来源 |
| [`docs/design/components/http-gateway/spec.md`](../../design/components/http-gateway/spec.md) | 列表 DTO 字段与外部 UI 映射 |
| [`tests/components/http-gateway/skill.test.ts`](../../../tests/components/http-gateway/skill.test.ts) | 列表 `triggers` |
| [`tests/components/http-gateway/tool.test.ts`](../../../tests/components/http-gateway/tool.test.ts) | 列表 `description` |
| [`tests/components/http-gateway/expert.test.ts`](../../../tests/components/http-gateway/expert.test.ts) | 列表前 3 个 Skill 预览与顺序 |
| [`tests/components/catalog/read-model.test.ts`](../../../tests/components/catalog/read-model.test.ts) | 三个投影的新字段 |
| [`tests/components/http-gateway/common-contract.test.ts`](../../../tests/components/http-gateway/common-contract.test.ts) | 列表/详情字段集合快照 |

## 验证

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `./.local/bun/bun run typecheck` | 通过 |
| 全量测试 | `./.local/bun/bun test --max-concurrency=1` | 199 pass / 0 fail / 1953 expect |
| 真实 API 冒烟 | 创建带触发词的 Skill、带描述的 Tool、带装配的 Expert → 逐个查列表 → 清理 | 新字段均按预期返回 |

冒烟返回示例（字段已裁剪）：

```json
{
  "skill": { "triggers": ["触发甲", "触发乙"] },
  "tool": { "description": "smoke tool desc" },
  "expert": { "skills": [{ "id": "...", "name": "s-..." }] }
}
```

## 取舍与后续

- 专家列表只取前 3 个 `{id,name}`，详情才返回完整 `{id,name,categoryCode,categoryLabel,summary}`；列表不承担详情载荷。
- `catalog.listExperts` 对每个专家最多调用 3 次 `SkillRead.getSummary`，属于组件内读组合，不是 BFF N+1；B1 数据量下接受，未提前做批量摘要契约或缓存。
- 若后续专家列表规模或预览字段继续增长，再评估 `SkillRead.getSummaries(ids)` 批量契约，不改变当前 REST 形状。
