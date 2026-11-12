---
layer: works
module: global
status: frozen
updated: 2026-11-12
procedure: 2026-11-12-expert-skill-slug-guard
---

# 结果：专家装配入口校验技能系统标识唯一

## 1 结论

`CMP-expert` 的 `create` / `updateAggregate` / `setSkills` 在写入前读取绑定 Skill 的 `slug`；同一专家内重复时返回 `400 validation_error`，整批不写、`revision` 不变。读取通过 kernel 的 `SkillSlugReader` 只读端口完成，由 `CMP-skill` 实现、组合根注入，`CMP-expert` 不直接读 `skill` 表。

该断言是入口防线：`skill.slug` 已有全局唯一索引，正常写路径下不同 Skill 不可能共享 `slug`；本次把「同一专家内名称唯一」写成显式契约与可测行为，避免唯一性范围变化、数据绕过写入口或包内名称漂移时错误推迟到 client 才暴露。

## 2 验收结果

| 项 | 命令/方式 | 结果 |
|---|---|---|
| 重复 slug：创建 | `tests/components/expert/service.test.ts`「同一专家内技能系统标识重复时入口拒绝…」 | 400 `validation_error`，`details.field=skillIds`，专家根未创建 |
| 重复 slug：聚合更新 | 同上 | 400，`details.field=skillIds`，`revision=1`、`skillCount=0` |
| 重复 slug：独立装配 | 同上 | 400，`details.field=items`，装配与 `revision` 不变 |
| 正常装配回归 | 既有「装配整体替换并保持顺序」「创建可带有序装配」 | 通过；顺序、计数与 `revision` 不变 |
| 端口读取 | `tests/components/skill/read.test.ts`「系统标识读取…」 | 已存在 id 返回 `id → slug`；未知 id 不出现；空输入返回 `{}` |
| 全量检查 | `bun run check` | **392 pass / 0 fail**；typecheck、`docs:check` 通过 |
| 质量门禁 | `bun run quality:report` | 违规 0；工具健康 8/8 |
| 运行时契约 | 重启 3100 后 `curl /openapi.yaml`、`/healthz`、`/docs` | `/healthz` 200、`/docs` 200；OpenAPI 已含本次 `slug` 唯一描述 |
| 真实重复数据 | 不构造（全局唯一索引下无法通过 API 产生） | 未验证；见 §5 |

## 3 结论落点

| 产物 | 落点 |
|---|---|
| 端口 | `src/core/kernel/ports.ts` 的 `SkillSlugReader`；`src/components/skill/slug-reader.ts` 实现 |
| 入口断言 | `src/components/expert/write.ts` 的 `assertSkillSlugsUnique`；三处装配入口调用 |
| 组合根 | `src/main.ts`、`tests/helpers/app.ts` 注入 `skillSlugs` |
| 组件规格 | [`expert/spec.md`](../../../design/components/expert/spec.md) §2/§3.2/§4/§5；[`skill/spec.md`](../../../design/components/skill/spec.md) §3.4/§4/§5；[`kernel/spec.md`](../../../design/components/kernel/spec.md) §3.3/§3.9/§5 |
| 架构 | [`architecture.md`](../../../design/architecture.md) 组件地图与依赖规则 |
| REST 契约 | `openapi.yaml` 的 `createExpert` / `patchExpertAggregate` / `setExpertSkills` 描述与 `skillIds` 字段说明；[`http-gateway/spec.md`](../../../design/components/http-gateway/spec.md) §5.4 |
| 场景 | `SCN-0001` 失败路径与覆盖边界（新增断言不占用 3+1 映射） |
| 开放问题 | `OQ-33` 关闭，指向本工序 |
| 测试 | `tests/components/expert/service.test.ts`、`tests/components/skill/read.test.ts` |

## 4 裁决摘要

通过：blocker 0 / decision 5（已落规格与测试）/ hold 0。用户已于 2026-11-12 确认并提交。详见 [`review.md`](review.md)。

## 5 偏差与未覆盖

- 未新增迁移、索引或字段；没有改变既有全局唯一索引与正常装配语义。
- 由于 `skill_slug_lower_key` 全局唯一，真实数据无法通过 API 构造「两个不同 Skill 同 slug」；重复分支用假端口在领域测试覆盖。HTTP 层 400 映射复用既有 `ValidationError` 契约测试，未单独构造重复 slug 的 HTTP 用例。
- 未做「包内 frontmatter `name` 与库内 `slug` 漂移」的对账；当前保存与改名都会重建包，漂移只可能来自绕过写入口，超出本次范围。
- 未重新跑 client 端到端；客户端冲突行为从 `agent-flow-client` 的 `skill-layout.ts` / `assets.ts` 与 commit `bef1bb5` 核对。
- 新断言未纳入 `SCN-0001` 的 3 正 1 反（该场景固定 R1/R2/R3/N1）；在场景文档中记为额外领域测试。
