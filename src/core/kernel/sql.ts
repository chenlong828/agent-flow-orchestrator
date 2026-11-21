export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export type FilterField = {
  key: string;
  column: string;
  like?: boolean;
  /** 非 like 字段是否跳过空字符串；默认不跳过，保持与既有查询一致。 */
  skipEmpty?: boolean;
  /** 数组值按 `= any($n)` 过滤；空数组不产生条件。 */
  any?: boolean;
  /** `any` 过滤的参数类型，例如 `uuid[]`；缺省交给数据库推断。 */
  cast?: string;
};

export function buildWhere(
  query: Record<string, unknown>,
  fields: readonly FilterField[],
): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  for (const field of fields) {
    const value = query[field.key];
    if (value === undefined) continue;
    if (field.skipEmpty && value === "") continue;
    if (field.like) {
      if (value === "") continue;
      params.push(`%${escapeLike(String(value))}%`);
      clauses.push(`${field.column} ilike $${params.length} escape '\\'`);
    } else if (field.any) {
      if (!Array.isArray(value) || value.length === 0) continue;
      params.push(value);
      const cast = field.cast === undefined ? "" : `::${field.cast}`;
      clauses.push(`${field.column} = any($${params.length}${cast})`);
    } else {
      params.push(value);
      clauses.push(`${field.column} = $${params.length}`);
    }
  }
  return {
    where: clauses.length === 0 ? "" : `where ${clauses.join(" and ")}`,
    params,
  };
}
