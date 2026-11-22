-- 专家结构精简：职责、技能配合顺序、重点验证顺序、对承担任务的解读合并为一段 Markdown「职责范围」。
-- 合并顺序固定为：主要职责 → 技能配合顺序 → 重点验证顺序 → 对承担任务的解读。
-- 只处理仍有旧列数据的行；合并后旧列清空（内容已保留在 duty 内）。
-- 回滚：Markdown 无法自动还原为四列，需从备份恢复，或重跑 seed 覆盖种子专家。

update expert
   set duty = concat_ws(
         E'\n\n',
         case when btrim(duty) <> '' then '## 主要职责' || E'\n\n' || btrim(duty) end,
         case when btrim(skill_order) <> '' then '## 技能配合顺序' || E'\n\n' || btrim(skill_order) end,
         case when btrim(verify_order) <> '' then '## 重点验证顺序' || E'\n\n' || btrim(verify_order) end,
         case when btrim(notes) <> '' then '## 对承担任务的解读' || E'\n\n' || btrim(notes) end
       ),
       skill_order = '',
       verify_order = '',
       notes = ''
 where btrim(skill_order) <> ''
    or btrim(verify_order) <> ''
    or btrim(notes) <> '';
