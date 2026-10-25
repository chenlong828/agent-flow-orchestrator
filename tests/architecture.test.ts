import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep, dirname } from "node:path";

const SRC = join(import.meta.dir, "../src");
const COMPONENTS = join(SRC, "components");
const DOMAIN_COMPONENTS = ["harness", "tool", "skill", "expert"] as const;

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function sourceFiles(directory: string): string[] {
  return walk(directory).filter((path) => path.endsWith(".ts"));
}

function importsOf(path: string): string[] {
  const content = readFileSync(path, "utf8");
  return [...content.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]!);
}

function componentOf(specifier: string): string | null {
  const match = /components\/([^/]+)\//.exec(specifier);
  return match === null ? null : match[1]!;
}

describe("组件依赖与数据所有权", () => {
  test("业务组件只依赖 kernel/platform，不互相 import", () => {
    const violations: string[] = [];
    for (const name of DOMAIN_COMPONENTS) {
      for (const file of sourceFiles(join(COMPONENTS, name))) {
        for (const specifier of importsOf(file)) {
          const target = componentOf(specifier);
          if (target !== null && target !== name && target !== "catalog") {
            violations.push(`${relative(SRC, file)} -> ${specifier}`);
          }
          if (target === "catalog") {
            violations.push(`${relative(SRC, file)} -> ${specifier}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("store 只能被本组件与 catalog 读模型引用，HTTP 网关不得直接读 store", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const fileOwner = componentOf(relative(SRC, file).split(sep).join("/"));
      for (const specifier of importsOf(file)) {
        if (!specifier.endsWith("/store.ts") && !specifier.endsWith("/store")) continue;
        if (specifier.startsWith(".")) {
          const resolved = resolve(dirname(file), specifier);
          const rel = relative(COMPONENTS, resolved);
          const owner = rel.startsWith("..") ? null : rel.split(sep)[0]!;
          if (owner === null || owner !== fileOwner) {
            violations.push(`${relative(SRC, file)} -> ${specifier}`);
          }
          continue;
        }
        const owner = componentOf(specifier);
        if (owner === null || fileOwner !== owner) {
          violations.push(`${relative(SRC, file)} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("HTTP 网关不依赖 Db/store，只通过组件服务与 catalog 编排", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(join(COMPONENTS, "http-gateway"))) {
      for (const specifier of importsOf(file)) {
        if (specifier.includes("core/platform/db")) violations.push(`${relative(SRC, file)} -> ${specifier}`);
        if (specifier.includes("/store")) violations.push(`${relative(SRC, file)} -> ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("catalog 是只读组合视图，不写任何业务表", () => {
    const writes: string[] = [];
    for (const file of sourceFiles(join(COMPONENTS, "catalog"))) {
      const content = readFileSync(file, "utf8");
      if (/\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i.test(content)) {
        writes.push(relative(SRC, file));
      }
    }
    expect(writes).toEqual([]);
  });

  test("config 只被组合根引用，组件不直接依赖启动配置", () => {
    const violations: string[] = [];
    const mainEntry = join(SRC, "main.ts");
    for (const file of sourceFiles(SRC)) {
      if (file === mainEntry) continue;
      for (const specifier of importsOf(file)) {
        if (specifier.includes("core/config")) {
          violations.push(`${relative(SRC, file)} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("Bun.sql 仅由 platform/db 持有，其他代码使用 Db 契约", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (file === join(SRC, "core", "platform", "db.ts")) continue;
      const content = readFileSync(file, "utf8");
      if (/from\s+["']bun["']/.test(content) || /\bnew\s+SQL\b|\bBun\.sql\b/.test(content)) {
        violations.push(relative(SRC, file));
      }
    }
    expect(violations).toEqual([]);
  });
});
