import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const SRC = join(import.meta.dir, "../src");
const COMPONENTS = join(SRC, "components");
const KERNEL = join(SRC, "core", "kernel");
const DOMAIN_COMPONENTS = ["harness", "tool", "skill", "expert", "workflow"] as const;
const ALLOWED_DOMAIN_TARGETS = new Set(["core/kernel", "core/platform"]);

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

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

/** 把 src 相对路径归到组件或 core 单元；main.ts 单独成单元，其余顶层文件忽略。 */
function unitOf(relPath: string): string | null {
  const parts = relPath.split(sep);
  if (parts[0] === "components" && parts[1] !== undefined) return parts[1];
  if (parts[0] === "core" && parts[1] !== undefined) return `core/${parts[1]}`;
  if (relPath === "main.ts") return "main";
  return null;
}

/** 只解析相对导入；裸包（node:zlib 等）不参与组件依赖判定。 */
function importedPath(file: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  return toPosix(relative(SRC, resolve(dirname(file), specifier)));
}

function componentOf(specifier: string): string | null {
  const match = /components\/([^/]+)\//.exec(specifier);
  return match === null ? null : match[1]!;
}

function allImports(): { file: string; specifier: string }[] {
  return sourceFiles(SRC).flatMap((file) =>
    importsOf(file).map((specifier) => ({ file, specifier })),
  );
}

/**
 * 领域组件的导入只允许指向自身、kernel、platform。
 * 关键点：先把相对路径解析成 src 下的绝对路径，再判归属；
 * 之前的实现用 specifier 里的 "components/" 匹配，对相对导入永远返回 null。
 */
function domainImportViolations(entries: { file: string; specifier: string }[]): string[] {
  const violations: string[] = [];
  for (const { file, specifier } of entries) {
    const owner = unitOf(relative(SRC, file));
    if (owner === null || !(DOMAIN_COMPONENTS as readonly string[]).includes(owner)) continue;
    const imported = importedPath(file, specifier);
    if (imported === null) continue;
    const target = unitOf(imported);
    if (target === null || target === owner || ALLOWED_DOMAIN_TARGETS.has(target)) continue;
    violations.push(`${toPosix(relative(SRC, file))} -> ${specifier} (${target})`);
  }
  return violations;
}

function unitGraph(): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const { file, specifier } of allImports()) {
    const owner = unitOf(relative(SRC, file));
    if (owner === null) continue;
    const imported = importedPath(file, specifier);
    if (imported === null) continue;
    const target = unitOf(imported);
    if (target === null || target === owner) continue;
    if (!graph.has(owner)) graph.set(owner, new Set());
    graph.get(owner)!.add(target);
  }
  return graph;
}

function findCycles(graph: Map<string, Set<string>>): string[][] {
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (node: string): void => {
    if (visiting.has(node)) {
      cycles.push([...stack.slice(stack.indexOf(node)), node]);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) visit(next);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  };

  for (const node of graph.keys()) visit(node);
  return cycles;
}

describe("组件依赖与数据所有权", () => {
  test("业务组件只依赖 kernel/platform，不互相 import", () => {
    expect(domainImportViolations(allImports())).toEqual([]);
  });

  test("护栏自测：相对路径跨组件导入必须被识别", () => {
    const synthetic = (file: string, specifier: string) =>
      domainImportViolations([{ file: join(SRC, file), specifier }]);

    expect(synthetic("components/workflow/graph.ts", "../harness/index.ts")).toHaveLength(1);
    expect(synthetic("components/workflow/graph.ts", "../catalog/index.ts")).toHaveLength(1);
    expect(synthetic("components/workflow/graph.ts", "../../core/kernel/index.ts")).toEqual([]);
    expect(synthetic("components/workflow/graph.ts", "../../core/platform/index.ts")).toEqual([]);
    expect(synthetic("components/workflow/graph.ts", "./types.ts")).toEqual([]);
  });

  test("组件之间无循环依赖", () => {
    expect(findCycles(unitGraph())).toEqual([]);
  });

  test("store 只能被本组件与 catalog 读模型引用，HTTP 网关不得直接读 store", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const fileOwner = componentOf(toPosix(relative(SRC, file)));
      for (const specifier of importsOf(file)) {
        if (!specifier.endsWith("/store.ts") && !specifier.endsWith("/store")) continue;
        if (specifier.startsWith(".")) {
          const resolved = resolve(dirname(file), specifier);
          const rel = relative(COMPONENTS, resolved);
          const owner = rel.startsWith("..") ? null : rel.split(sep)[0]!;
          if (owner === null || owner !== fileOwner) {
            violations.push(`${toPosix(relative(SRC, file))} -> ${specifier}`);
          }
          continue;
        }
        const owner = componentOf(specifier);
        if (owner === null || fileOwner !== owner) {
          violations.push(`${toPosix(relative(SRC, file))} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("HTTP 网关不依赖 Db/store，只通过组件服务与 catalog 编排", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(join(COMPONENTS, "http-gateway"))) {
      for (const specifier of importsOf(file)) {
        if (specifier.includes("core/platform/db")) violations.push(`${toPosix(relative(SRC, file))} -> ${specifier}`);
        if (specifier.includes("/store")) violations.push(`${toPosix(relative(SRC, file))} -> ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("catalog 是只读组合视图，不写任何业务表", () => {
    const writes: string[] = [];
    for (const file of sourceFiles(join(COMPONENTS, "catalog"))) {
      const content = readFileSync(file, "utf8");
      if (/\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i.test(content)) {
        writes.push(toPosix(relative(SRC, file)));
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
          violations.push(`${toPosix(relative(SRC, file))} -> ${specifier}`);
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
        violations.push(toPosix(relative(SRC, file)));
      }
    }
    expect(violations).toEqual([]);
  });

  test("Bun 文件 API 只允许在 config、platform 与文档静态资源", () => {
    const allowed = new Set([
      "core/config/config.ts",
      "core/platform/storage.ts",
      "core/platform/migrator.ts",
      "components/http-gateway/docs.ts",
    ]);
    const pattern = /\bBun\.(file|write)\b|from\s+["'](?:node:)?fs(?:\/promises)?["']/;
    const violations: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = toPosix(relative(SRC, file));
      if (allowed.has(rel)) continue;
      if (pattern.test(readFileSync(file, "utf8"))) violations.push(rel);
    }
    expect(violations).toEqual([]);
  });

  test("FileStore 只由 skill 依赖", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(COMPONENTS)) {
      const owner = unitOf(relative(SRC, file));
      if (owner === "skill") continue;
      if (/\bFileStore\b/.test(readFileSync(file, "utf8"))) {
        violations.push(toPosix(relative(SRC, file)));
      }
    }
    expect(violations).toEqual([]);
  });

  test("kernel 不导入运行时组件", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(KERNEL)) {
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith(".")) {
          violations.push(`${toPosix(relative(SRC, file))} -> ${specifier}`);
          continue;
        }
        const target = resolve(dirname(file), specifier);
        const rel = relative(KERNEL, target);
        if (rel.startsWith("..") || rel.startsWith(sep)) {
          violations.push(`${toPosix(relative(SRC, file))} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
