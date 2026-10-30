import { ensureText, ValidationError } from "../../core/kernel/index.ts";
import type { CreateExpert, UpdateExpertAggregate } from "./types.ts";

type NormalizedRef = { label: string; refType: string; path: string | null };

export type NormalizedWrite = {
  name: string;
  color: string;
  role: string;
  duty: string;
  skillOrder: string;
  verifyOrder: string;
  notes: string;
  persona: string[];
  refs: NormalizedRef[];
};

export type NormalizedPatch = {
  name?: string;
  color?: string;
  role?: string;
  duty?: string;
  skillOrder?: string;
  verifyOrder?: string;
  notes?: string;
  persona?: string[];
  refs?: NormalizedRef[];
  skillIds?: string[];
  toolIds?: string[];
};

const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function ensureOptionalText(value: unknown, field: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ValidationError(field, "必须是字符串");
  return value;
}

function ensureColor(value: unknown): string {
  if (typeof value !== "string" || !COLOR_PATTERN.test(value)) {
    throw new ValidationError("color", "必须是 #RRGGBB 格式");
  }
  return value;
}

function ensureStringList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ValidationError(field, "必须是字符串数组");
  return value.map((item) => {
    if (typeof item !== "string") throw new ValidationError(field, "必须是字符串数组");
    const trimmed = item.trim();
    if (trimmed.length === 0) throw new ValidationError(field, "元素不能为空");
    return trimmed;
  });
}

function ensureRefs(value: unknown): NormalizedRef[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ValidationError("refs", "必须是数组");
  return value.map((item, index) => {
    if (item === null || typeof item !== "object") {
      throw new ValidationError("refs", "每个引用必须是对象");
    }
    const input = item as Record<string, unknown>;
    const label = ensureText(input.label, `refs.${index}.label`, 200);
    const refType = ensureText(input.refType, `refs.${index}.refType`, 100);
    let path: string | null = null;
    if (input.path !== undefined && input.path !== null) {
      if (typeof input.path !== "string") {
        throw new ValidationError(`refs.${index}.path`, "必须是字符串或 null");
      }
      path = input.path;
    }
    return { label, refType, path };
  });
}

export function normalizeWrite(input: CreateExpert): NormalizedWrite {
  if (input === null || typeof input !== "object") {
    throw new ValidationError("body", "必须是对象");
  }
  return {
    name: ensureText(input.name, "name", 80),
    color: ensureColor(input.color),
    role: ensureText(input.role, "role", 200),
    duty: ensureOptionalText(input.duty, "duty"),
    skillOrder: ensureOptionalText(input.skillOrder, "skillOrder"),
    verifyOrder: ensureOptionalText(input.verifyOrder, "verifyOrder"),
    notes: ensureOptionalText(input.notes, "notes"),
    persona: ensureStringList(input.persona, "persona"),
    refs: ensureRefs(input.refs),
  };
}

export function enabledFrom(input: CreateExpert): boolean {
  if (input.enabled === undefined) return true;
  if (typeof input.enabled !== "boolean") {
    throw new ValidationError("enabled", "必须是布尔值");
  }
  return input.enabled;
}

export function normalizeIds(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new ValidationError(field, "必须是字符串数组");
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new ValidationError(field, "必须是字符串数组");
    }
    const id = item.trim();
    if (seen.has(id)) throw new ValidationError(field, `目标 ${id} 重复`);
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function applyTextPatch(patch: NormalizedPatch, input: UpdateExpertAggregate): void {
  if (input.name !== undefined) patch.name = ensureText(input.name, "name", 80);
  if (input.color !== undefined) patch.color = ensureColor(input.color);
  if (input.role !== undefined) patch.role = ensureText(input.role, "role", 200);
  if (input.duty !== undefined) patch.duty = ensureOptionalText(input.duty, "duty");
  if (input.skillOrder !== undefined) {
    patch.skillOrder = ensureOptionalText(input.skillOrder, "skillOrder");
  }
  if (input.verifyOrder !== undefined) {
    patch.verifyOrder = ensureOptionalText(input.verifyOrder, "verifyOrder");
  }
  if (input.notes !== undefined) patch.notes = ensureOptionalText(input.notes, "notes");
}

function applyListPatch(patch: NormalizedPatch, input: UpdateExpertAggregate): void {
  if (input.persona !== undefined) patch.persona = ensureStringList(input.persona, "persona");
  if (input.refs !== undefined) patch.refs = ensureRefs(input.refs);
  if (input.skillIds !== undefined) patch.skillIds = normalizeIds(input.skillIds, "skillIds");
  if (input.toolIds !== undefined) patch.toolIds = normalizeIds(input.toolIds, "toolIds");
}

export function normalizePatch(input: UpdateExpertAggregate): NormalizedPatch {
  if (input === null || typeof input !== "object") {
    throw new ValidationError("body", "必须是对象");
  }
  const patch: NormalizedPatch = {};
  applyTextPatch(patch, input);
  applyListPatch(patch, input);
  if (Object.keys(patch).length === 0) {
    throw new ValidationError("body", "至少提供一个字段");
  }
  return patch;
}
