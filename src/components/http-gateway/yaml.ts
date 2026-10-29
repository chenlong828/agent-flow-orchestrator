import { ValidationError } from "../../core/kernel/index.ts";

function yamlScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new ValidationError("dsl", "DSL 包含无法序列化的值");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function toYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value
      .map((item) => {
        if (!isPlainRecord(item)) return `${pad}- ${yamlScalar(item)}`;
        const entries = Object.entries(item);
        if (entries.length === 0) return `${pad}- {}`;
        const [first, ...rest] = entries;
        if (first === undefined) return `${pad}- {}`;
        const firstValue = isPlainRecord(first[1])
          ? `\n${toYaml(first[1], indent + 4)}`
          : yamlScalar(first[1]);
        const lines = [`${pad}- ${first[0]}: ${firstValue}`];
        for (const [key, entry] of rest) {
          if (isPlainRecord(entry)) {
            lines.push(`${" ".repeat(indent + 2)}${key}:\n${toYaml(entry, indent + 4)}`);
          } else {
            lines.push(`${" ".repeat(indent + 2)}${key}: ${yamlScalar(entry)}`);
          }
        }
        return lines.join("\n");
      })
      .join("\n");
  }
  if (isPlainRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${pad}{}`;
    return entries
      .map(([key, entry]) => {
        if (isPlainRecord(entry) || Array.isArray(entry)) {
          return `${pad}${key}:\n${toYaml(entry, indent + 2)}`;
        }
        return `${pad}${key}: ${yamlScalar(entry)}`;
      })
      .join("\n");
  }
  return `${pad}${yamlScalar(value)}`;
}
