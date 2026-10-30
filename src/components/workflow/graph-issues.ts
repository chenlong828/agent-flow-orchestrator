export type ValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export function addIssue(
  issues: ValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

export function unknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: ValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      errors.push({ code: "graph_shape", path: `${path}.${key}`, message: "未知字段" });
    }
  }
}
