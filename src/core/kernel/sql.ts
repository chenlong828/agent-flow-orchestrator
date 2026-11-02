export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export type FilterField = {
  key: string;
  column: string;
  like?: boolean;
  /** 非 like 字段是否跳过空字符串；默认不跳过，保持与既有查询一致。 */
  skipEmpty?: boolean;
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
