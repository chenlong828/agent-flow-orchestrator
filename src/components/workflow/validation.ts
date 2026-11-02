import { MultiFieldValidationError, ValidationError } from "../../core/kernel/index.ts";
import type { ValidationIssue } from "./graph.ts";

export function ensureDescription(value: unknown, field = "description"): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ValidationError(field, "必须是字符串");
  if (value.length > 500) throw new ValidationError(field, "长度不能超过 500");
  return value;
}

export function shapeToMultiField(errors: ValidationIssue[]): MultiFieldValidationError {
  return new MultiFieldValidationError(errors);
}
