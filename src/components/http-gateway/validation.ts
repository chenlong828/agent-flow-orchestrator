import {
  PreconditionRequiredError,
  ValidationError,
  normalizePageQuery,
  type PageQuery,
} from "../../core/kernel/index.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new ValidationError(field, "必须是 UUID");
  }
  return value;
}

export function assertAllowedFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path = "body",
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError(path, `未知字段 ${unknown.join(", ")}`);
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function readJsonObject(
  request: Request,
  allowedFields: readonly string[],
): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.trim() === "") {
    throw new ValidationError("body", "请求体不能为空");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ValidationError("body", "必须是合法 JSON");
  }
  if (!isPlainObject(parsed)) {
    throw new ValidationError("body", "必须是 JSON 对象");
  }
  assertAllowedFields(parsed, allowedFields);
  return parsed;
}

export function parseIfMatch(request: Request): number {
  const raw = request.headers.get("if-match");
  if (raw === null || raw === "") throw new PreconditionRequiredError();
  const match = /^"([1-9][0-9]*)"$/.exec(raw.trim());
  if (match === null) {
    throw new ValidationError("If-Match", '必须形如 "revision"，例如 "3"');
  }
  return Number(match[1]);
}

export function actorFrom(request: Request, fallback: string): string {
  const raw = request.headers.get("x-actor");
  if (raw === null || raw.trim() === "") return fallback;
  return raw.trim().slice(0, 200);
}

export function queryValue(url: URL, name: string): string | undefined {
  const values = url.searchParams.getAll(name);
  if (values.length === 0) return undefined;
  return values[values.length - 1];
}

export function parseBooleanQuery(url: URL, name: string): boolean | undefined {
  const raw = queryValue(url, name);
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new ValidationError(name, "必须是 true 或 false");
}

export function parseEnumQuery<T extends string>(
  url: URL,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const raw = queryValue(url, name);
  if (raw === undefined) return undefined;
  if (!allowed.includes(raw as T)) {
    throw new ValidationError(name, `必须是 ${allowed.join(" / ")} 之一`);
  }
  return raw as T;
}

export function parsePageQuery(url: URL): PageQuery {
  const parse = (name: string): number | undefined => {
    const raw = queryValue(url, name);
    if (raw === undefined) return undefined;
    if (raw.trim() === "" || !/^[+-]?[0-9]+$/.test(raw.trim())) {
      throw new ValidationError(name, "必须是整数");
    }
    return Number(raw);
  };
  return normalizePageQuery(parse("limit"), parse("offset"));
}

export function parseSortQuery<T extends string>(
  url: URL,
  allowed: Record<string, T>,
  defaultSort?: T,
): T | undefined {
  const raw = queryValue(url, "sort");
  if (raw === undefined) return defaultSort;
  const value = allowed[raw];
  if (value === undefined) {
    throw new ValidationError("sort", `必须是 ${Object.keys(allowed).join(" / ")} 之一`);
  }
  return value;
}
