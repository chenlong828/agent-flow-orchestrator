---
layer: history
module: skill
status: frozen
updated: 2026-10-28
---

# 2026-10-28 Skill 包形态：不做升级迁移，开发库原地重建

## 背景

Skill 要从五章结构化子表改为“一个 zip + 数据库 brief”。现有 `skill_section`、`skill_pitfall`、`skill_ref` 三张子表存正文，`skill` 行没有包指针；`expert_skill.skill_id` 是 `on delete restrict`。如果保留旧行，新模型下详情、文档、包下载都没有包；如果删除旧行，装配边会先挡住。

用户确认：当前数据库中的 Skill 都是测试/演示数据，没有生产使用，删掉重做即可，数据不能用于生产。

## 决策

1. **不做升级迁移、不回填、不保留旧 Skill 数据**：五章、踩坑、引用子表与旧行随重建消失。
2. **开发库原地重建**：drop/recreate 开发库，按新 schema 建，再用 seed 重建 12 个 Skill 的包与专家装配边。
3. **不保留升级路径**：schema 变更以 fresh-only 基线落成，只服务空库；不处理旧库升级，也不保证旧库可迁移。
4. **不做 `/api/v2`**：单消费方、无生产数据，直接替换 `/api/v1` 的 Skill 契约；作为破坏性变更记录。
5. **不要求备份与回滚**：演示数据可重建；包与草稿目录在重建时清空。

## 被否决的方案

- **升级迁移 + 删旧数据**：能保留升级路径，但需要处理 `expert_skill` restrict、旧行无包、种子重建；当前没有生产数据，收益不足。
- **把五章/踩坑/引用回填成 `SKILL.md` 与附件**：属于数据迁移，用户明确不做。
- **保留旧 `skill` 行并允许包为空**：详情、文档、下载会出现不可用状态，违反“包是唯一真相”。
- **按 Skill 保留旧 revision / 版本历史**：本轮不做版本历史，旧包不保留。

## 后果

- `seed.ts` 要重写为“生成 `SKILL.md` + 打包 + 写 `package_key`”，并重建 12 个 Skill 与专家装配边。
- 测试的表清单、迁移版本、清理表要同步为重建后的结构；当前 15 张业务表、5 个迁移的断言会变。
- `design/skill`、`catalog`、`http-gateway`、`platform`、`config`、`architecture` 规格同步；`openapi.yaml` 同步。
- UI 侧 2026-10-27 提案的 `body` + staging 部分被取代，需要另起 UI 工序同步。
- 旧数据不可恢复；开发库可再次 drop/recreate。
