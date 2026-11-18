// 工作区扫描：只做事实采集与漂移判断，不执行任何语言检查。
// 输出 workspace.json（由 workspace-scan 拥有），供初始化、doctor、检查方案发现共用。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  contentHash,
  isDirectory,
  isFile,
  parseArgs,
  readJson,
  topLevelDirs,
  walkFiles,
} from "./lib.mjs";

const STATE_DIR = ".workspace";
const SCAN_FILE = ".workspace/scan.json";

function detect(root, files) {
  const stacks = new Set();
  const packageJsonPath = join(root, "package.json");
  const packageJson = isFile(packageJsonPath) ? readJson(packageJsonPath) : null;
  if (packageJson) {
    stacks.add("javascript");
    const deps = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };
    if (isFile(join(root, "tsconfig.json")) || deps.typescript || files.some((f) => f.endsWith(".ts"))) {
      stacks.add("typescript");
    }
    if (deps.vue || files.some((f) => f.endsWith(".vue"))) stacks.add("vue");
    if (deps.react || files.some((f) => /\.(jsx|tsx)$/.test(f))) stacks.add("react");
    if (deps.bun || isFile(join(root, "bun.lock")) || isFile(join(root, "bun.lockb"))) stacks.add("bun");
    if (
      ["express", "fastify", "koa", "hono", "@nestjs/core", "@hapi/hapi"].some((name) => deps[name]) ||
      isDirectory(join(root, "src"))
    ) {
      stacks.add("node");
    }
  }
  if (isFile(join(root, "pom.xml")) || isFile(join(root, "build.gradle")) || isFile(join(root, "build.gradle.kts"))) {
    stacks.add("java");
  }
  if (isFile(join(root, "Cargo.toml"))) stacks.add("rust");

  const packageManager =
    isFile(join(root, "bun.lock")) || isFile(join(root, "bun.lockb"))
      ? "bun"
      : isFile(join(root, "pnpm-lock.yaml"))
        ? "pnpm"
        : isFile(join(root, "yarn.lock"))
          ? "yarn"
          : isFile(join(root, "package-lock.json"))
            ? "npm"
            : null;
  const runtime = packageManager === "bun" ? "bun" : packageJson ? "node" : stacks.has("java") ? "jvm" : stacks.has("rust") ? "rust" : null;

  const sourceCandidates = ["src", "lib", "app", "server", "packages"];
  const source = sourceCandidates.filter((name) => isDirectory(join(root, name)));
  const testCandidates = ["tests", "test", "__tests__", "spec"];
  const tests = testCandidates.filter((name) => isDirectory(join(root, name)));
  const migrationCandidates = ["db/migrations", "migrations", "prisma/migrations"];
  const migrations = migrationCandidates.filter((name) => isDirectory(join(root, name)));

  const entries = [];
  if (packageJson) {
    const candidates = [
      packageJson.main,
      packageJson.module,
      typeof packageJson.exports === "string" ? packageJson.exports : undefined,
    ].filter((value) => typeof value === "string");
    for (const candidate of candidates) {
      const normalized = String(candidate).replace(/^\.\//, "");
      if (isFile(join(root, normalized))) entries.push(normalized);
    }
  }
  for (const candidate of ["src/main.ts", "src/index.ts", "src/server.ts", "index.ts", "main.ts", "server.ts"]) {
    if (isFile(join(root, candidate))) entries.push(candidate);
  }

  return {
    stacks: [...stacks],
    packageManager,
    runtime,
    dirs: { source, tests, migrations },
    entries: [...new Set(entries)],
    configs: {
      packageJson: packageJson !== null,
      tsconfig: isFile(join(root, "tsconfig.json")),
      cargo: isFile(join(root, "Cargo.toml")),
      maven: isFile(join(root, "pom.xml")),
      gradle: isFile(join(root, "build.gradle")) || isFile(join(root, "build.gradle.kts")),
    },
  };
}

function schemeState(root) {
  const checks = readJson(join(root, ".workspace/checks.json"));
  const schemes = checks?.schemes ?? [];
  return schemes.map((scheme) => ({
    id: scheme.id,
    slug: scheme.slug,
    enabled: scheme.enabled !== false,
    profile: isFile(join(root, ".workspace/checks", scheme.id, "profile.json")),
    baseline: isFile(join(root, ".workspace/checks", scheme.id, "baseline.json")),
    tools: isFile(join(root, ".workspace/checks", scheme.id, "tools.lock.json")),
  }));
}

function driftState(root, layoutHash, schemes) {
  const enabled = schemes.filter((scheme) => scheme.enabled);
  if (enabled.length === 0) return { state: "uninitialized", reasons: ["没有启用的检查方案"] };
  const reasons = [];
  for (const scheme of enabled) {
    if (!scheme.profile) {
      reasons.push(`${scheme.id}: 缺少 profile.json`);
      continue;
    }
    const profile = readJson(join(root, ".workspace/checks", scheme.id, "profile.json"));
    const recorded = profile?.meta?.layoutHash;
    if (recorded && recorded !== layoutHash) reasons.push(`${scheme.id}: 布局哈希变化`);
    if (!scheme.tools) reasons.push(`${scheme.id}: 缺少 tools.lock.json`);
  }
  return reasons.length === 0
    ? { state: "ready", reasons: [] }
    : { state: enabled.every((scheme) => !scheme.profile) ? "uninitialized" : "drift", reasons };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = options.root ? String(options.root) : process.cwd();
  const files = walkFiles(root);
  const detected = detect(root, files);
  const schemes = schemeState(root);
  const layoutHash = contentHash(root, [
    "package.json",
    "tsconfig.json",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "bun.lock",
    "pnpm-lock.yaml",
    "yarn.lock",
    "package-lock.json",
  ]);
  const output = {
    schemaVersion: 1,
    command: "scan",
    generatedAt: new Date().toISOString(),
    root,
    layoutHash,
    topLevelDirs: topLevelDirs(root),
    files: { count: files.length },
    ...detected,
    schemes,
    drift: driftState(root, layoutHash, schemes),
  };
  if (options.write) {
    mkdirSync(join(root, STATE_DIR), { recursive: true });
    writeFileSync(join(root, SCAN_FILE), `${JSON.stringify(output, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output.drift.state === "drift" && options.check) process.exitCode = 1;
}

main();
