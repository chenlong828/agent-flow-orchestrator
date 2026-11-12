-- 技能系统标识：skill.name 继续做展示名，新增 skill.slug 承载 DSH 技能名
-- （SKILL.md frontmatter 的 name 必须是 kebab-case，展示名可以是中文）。
-- 存量行按 id 前 8 位生成占位 slug（skill-<id8>），需要可读名的技能在保存时改。

alter table skill add column slug text;

update skill
   set slug = 'skill-' || right(replace(id::text, '-', ''), 8)
 where slug is null;

alter table skill alter column slug set not null;

alter table skill add constraint skill_slug_format check (
  char_length(slug) between 1 and 64
  and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
);

create unique index skill_slug_lower_key on skill (lower(slug));
