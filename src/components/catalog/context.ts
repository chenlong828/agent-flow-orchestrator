import type { Reference } from "../../core/kernel/index.ts";
import type { CatalogDeps, ReferenceAsset, ReferencePage } from "./types.ts";

/** 各读模型共用的依赖上下文。 */
export type CatalogContext = CatalogDeps;

/** 把带 id/name 的读取结果投影成内核引用摘要。 */
export function toReferences<T extends { id: string; name: string }>(
  type: Reference["type"],
  items: T[],
): Reference[] {
  return items.map((item) => ({ type, id: item.id, name: item.name }));
}

export function referencePage(asset: ReferenceAsset, items: Reference[]): ReferencePage {
  return { asset, total: items.length, items };
}
