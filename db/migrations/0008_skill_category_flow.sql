-- af-dev-flow 种子引入「流程」「文档」两类技能；分类是参考数据，随迁移落库而不是由演示种子写入。
insert into skill_category (code, label, position) values
  ('process', '流程', 4),
  ('docs', '文档', 5)
on conflict (code) do nothing;
