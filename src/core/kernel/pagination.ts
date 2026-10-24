import { ValidationError } from "./errors.ts";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

export type PageQuery = {
  limit: number;
  offset: number;
};

export type Page<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

/**
 * 规范化分页参数。缺失值取默认，非法值抛 ValidationError。
 */
export function normalizePageQuery(limit?: number, offset?: number): PageQuery {
  const normalizedLimit = limit === undefined ? DEFAULT_PAGE_LIMIT : limit;
  if (
    typeof normalizedLimit !== "number" ||
    !Number.isInteger(normalizedLimit) ||
    normalizedLimit < 1 ||
    normalizedLimit > MAX_PAGE_LIMIT
  ) {
    throw new ValidationError("limit", `必须是 1 到 ${MAX_PAGE_LIMIT} 之间的整数`);
  }

  const normalizedOffset = offset === undefined ? 0 : offset;
  if (
    typeof normalizedOffset !== "number" ||
    !Number.isInteger(normalizedOffset) ||
    normalizedOffset < 0
  ) {
    throw new ValidationError("offset", "必须是不小于 0 的整数");
  }

  return { limit: normalizedLimit, offset: normalizedOffset };
}
