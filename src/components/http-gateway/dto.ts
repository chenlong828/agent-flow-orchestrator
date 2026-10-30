import { ValidationError } from "../../core/kernel/index.ts";
import { assertAllowedFields, assertUuid, isPlainObject } from "./validation.ts";

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw new ValidationError(field, "必须是对象");
  return value;
}

export function normalizeToolParams(body: Record<string, unknown>): Record<string, unknown> {
  if (body.params === undefined) return body;
  if (!Array.isArray(body.params)) throw new ValidationError("params", "必须是数组");
  const params = body.params.map((item, index) => {
    const param = requireObject(item, `params[${index}]`);
    assertAllowedFields(param, ["key", "type", "description"], `params[${index}]`);
    if (typeof param.key !== "string" || param.key.trim() === "") {
      throw new ValidationError(`params[${index}].key`, "必须是非空字符串");
    }
    return {
      paramKey: param.key,
      type: param.type,
      description: param.description,
    };
  });
  return { ...body, params };
}

export function validateNestedRefs(body: Record<string, unknown>, key: string): void {
  if (body[key] === undefined) return;
  if (!Array.isArray(body[key])) throw new ValidationError(key, "必须是数组");
  (body[key] as unknown[]).forEach((item, index) => {
    const ref = requireObject(item, `${key}[${index}]`);
    assertAllowedFields(ref, ["label", "refType", "path"], `${key}[${index}]`);
  });
}

export function assemblyIds(body: Record<string, unknown>, key: "skillId" | "toolId"): string[] {
  if (!Array.isArray(body.items)) throw new ValidationError("items", "必须是数组");
  return body.items.map((item, index) => {
    const entry = requireObject(item, `items[${index}]`);
    assertAllowedFields(entry, [key], `items[${index}]`);
    const value = entry[key];
    if (typeof value !== "string") {
      throw new ValidationError(`items[${index}].${key}`, "必须是 UUID");
    }
    return assertUuid(value, `items[${index}].${key}`);
  });
}

export function validateOptionalIdArray(body: Record<string, unknown>, field: string): void {
  if (body[field] === undefined) return;
  if (!Array.isArray(body[field])) throw new ValidationError(field, "必须是 UUID 数组");
  body[field] = (body[field] as unknown[]).map((value, index) => {
    if (typeof value !== "string") {
      throw new ValidationError(`${field}[${index}]`, "必须是 UUID");
    }
    return assertUuid(value, `${field}[${index}]`);
  });
}
