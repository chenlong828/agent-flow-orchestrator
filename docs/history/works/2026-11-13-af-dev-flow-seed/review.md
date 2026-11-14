---
layer: works
module: global
status: frozen
updated: 2026-11-13
procedure: 2026-11-13-af-dev-flow-seed
level: P2
---

# 评审：af-dev-flow 种子（P2）

## 结论

**通过。** 第一次提交把虚构的 UI 夹具内容当作演示种子写入，且未标明来源；按用户要求剔除后复验通过：blocker 0；decision 4（已落代码/迁移/文档）；verified sound 5；hold 3（已转出）。

## Blocker

无。第一次提交存在「虚构内容进入种子」的 blocker，已由 `D-04` 清除并在本次复验中确认无残留。

## Decision now

| 决策 | 内容 | 落点 |
|---|---|---|
| `D-01` | 技能分类「流程」「文档」作为参考数据写入迁移 `0008`，不由演示种子插入 | `db/migrations/0008_skill_category_flow.sql`、`tests/db/schema.test.ts` |
| `D-02` | `arch-design-spec` 采用「单技能 + references」：`SKILL.md` 保留判据、定级门、评审清单与完成定义（10,822 B），完整八步工作流与输出模板移入 `references/arch-design-workflow.md` | `scripts/seed-skills/arch-design-spec/` |
| `D-03` | 种子替换采用重建演示库；旧技能/归档目录改名备份而非删除 | 本工序 `result.md` §4 |
| `D-04` | 种子只含有真实出处的技能；移除 `svo` / `test-data` / `ab-review`、全部 Harness/工具预置与专家工具装配 | `scripts/seed.ts`、本工序 `result.md` §5 |

## Verified sound

| 项 | 查了什么 | 结论 |
|---|---|---|
| `V-01` 流程图可运行性 | `GET /api/v1/workflows/{id}` 读图 | 1 start / 1 end；8 节点各绑不同专家；两条回退边目标 `n3`、`n5` 均为祖先 |
| `V-02` 技能包合法性 | 解压 `arch-design-spec` 包；`tests/scripts/seed.test.ts` 校验 frontmatter 与大小 | 2 个条目、路径合法、≤16 KiB、`name` kebab-case |
| `V-03` 种子幂等 | `tests/scripts/seed.test.ts` 双次执行 | 行数、包数、装配边不变；版本不被覆盖 |
| `V-04` 分类与引用完整性 | 分类计数、`expert_skill` 悬空查询、`expert_tool` 计数 | 4 类合计 7 技能；11 条装配边无悬空；工具装配 0 |
| `V-05` 无虚构内容残留 | `GET /api/v1/tools`、`/harnesses`、技能列表 | 工具 0；Harness 仅 1 条且为 client 自注册（非种子写入）；技能 7 个均有文件出处 |

## Hold

| 项 | 不阻塞理由 | 去向 |
|---|---|---|
| 节点名仍进提示词 | 本次只替换内容；prompt 重组是独立工序 | 下一工序 |
| 真实 client 联调缺席 | 新流程尚未端到端执行 | 联调工序 |
| 测试验证专家无技能 | 虚构技能已清除，需要真实能力型技能 | 后续内容补充 |
