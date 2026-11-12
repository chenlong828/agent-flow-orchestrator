---
layer: works
module: global
status: frozen
updated: 2026-11-12
procedure: 2026-11-12-expert-skill-slug-guard
---

# 评审与裁决：专家装配入口的 `slug` 唯一断言

## 1 结论

**通过**。用户已于 2026-11-12 确认 P2 设计并提交。无 blocker；决策 5 条已落规格与测试；无 hold。

## 2 Blocker

无。

## 3 Decision now

| # | 决策 | 备选与否决理由 | 落点 |
|---|---|---|---|
| `D-01` | 断言放在 `CMP-expert` 的装配入口（`create` / `updateAggregate` / `setSkills`），不放到 `CMP-scheduler` / `CMP-run` | 放到派发或入队：错误推迟到运行期，且要先解析包；用户要求「入口断言」。放到 HTTP 路由：领域直接调用（测试、内部用例）绕过，不变量不成立 | `expert/write.ts#assertSkillSlugsUnique` |
| `D-02` | 通过 kernel 新增只读端口 `SkillSlugReader` 取 `slug`，由 `skill` 实现、组合根注入 | 直接查 `skill` 表：违反数据所有权与既有架构测试的跨组件读约束；注入 `SkillRead`：契约过宽，expert 只需 `id → slug` | `kernel/ports.ts`、`skill/slug-reader.ts`、`main.ts` |
| `D-03` | 重复返回 `400 validation_error`，`details.field` 跟随入口字段（`skillIds` / `items`） | 409：这是请求组合非法，不是并发/唯一约束冲突；409 会让调用方误以为可重试刷新 | `expert/write.ts`、OpenAPI `BadRequest` |
| `D-04` | 在事务外先读 `slug` 并判重，再进入写事务 | 事务内加锁读：当前全局唯一索引已保证不同 Skill 不会共享 `slug`，本断言是入口防线，不需要为它放大事务或加锁 | `expert/write.ts` |
| `D-05` | `OQ-33` 收口：客户端已按 `name` 建独立目录并显式报冲突，编排侧补入口断言 | 保持待定：客户端修复已落地（`agent-flow-client` commit `bef1bb5`），编排侧现在有对应防线 | `plan/open-questions.md` `OQ-33` |

## 4 Verified sound

| 项 | 查了什么 | 结果 |
|---|---|---|
| 全局唯一 | `db/migrations/0006_skill_slug.sql` 的 `skill_slug_lower_key` | 正常写路径下两个不同 Skill 不可能共享 `slug`；本断言是防御层，不替代唯一索引 |
| ID 去重 | `expert/normalize.ts#normalizeIds` | 同一 Skill ID 重复已在入口拒绝，本次不重复实现 |
| 客户端行为 | `agent-flow-client/src/components/assets/skill-layout.ts`、`assets.ts` | 按 frontmatter `name` 落 `<skills>/<name>/`；目标已存在抛 `invalid_skill_format`，不再静默覆盖 |
| 事务与 revision | `expert/service.test.ts` 新增用例 | 三种入口均 400；`skillCount=0`、`revision` 不变 |
| 端口实现 | `skill/read.test.ts` 新增用例 | 已存在 id 返回 `id → slug`；未知 id 不出现；空输入返回空对象 |
| 契约与文档一致性 | `bun run check`、`bun run quality:report`、重启 3100 后 `GET /openapi.yaml` | 392 pass / 0 fail；违规 0；OpenAPI 已是本次描述 |

## 5 Hold

无。未覆盖项记入 `result.md` §5：包内 frontmatter 与库内 `slug` 漂移的独立对账不在本次范围。
