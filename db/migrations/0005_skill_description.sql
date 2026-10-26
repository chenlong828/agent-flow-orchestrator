-- Skill 契约 v2：summary 与 triggers 合并为 description。
-- 回填口径：原 summary；有触发词时追加「 触发：kw1、kw2…」。
-- 不截断：回填后超过 400 字会让本迁移失败，需人工修数据。

alter table skill add column description text;

update skill s
set description = s.summary || coalesce((
  select ' 触发：' || string_agg(t.keyword, '、' order by t.position)
  from skill_trigger t
  where t.skill_id = s.id
), '');

alter table skill alter column description set not null;
alter table skill add constraint skill_description_len
  check (char_length(description) between 1 and 400);

alter table skill drop column summary;
drop table skill_trigger;
