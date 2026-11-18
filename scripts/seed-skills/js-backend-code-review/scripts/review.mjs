#!/usr/bin/env node
// JS/TS 后端检查引擎（check scheme: js-backend）。
// 设计要点：
// 1. 规则、阈值、路径、允许清单全部来自 profile；本文件不写死项目布局。
// 2. 管理态命令（init/calibrate/baseline/tools/adopt/profile-diff）才写状态；
//    执行态命令（doctor/precheck/report/gate）只读，输出 check-report@1。
// 3. ERROR 表示工具失效或输入缺失，不能当 PASS；退出码 0/1/2 由调用方统一解释。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = dirname(SCRIPTS_DIR);
const DEFAULTS = readJson(join(SCRIPTS_DIR, "config", "defaults.json"));
const TOOLS = readJson(join(SCRIPTS_DIR, "config", "tools.json")) ?? {};
const OXLINT_DEFAULT_CONFIG = join(SCRIPTS_DIR, "config", "oxlintrc.json");

// ---------- 通用 ----------
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split("=");
    if (inline !== undefined) {
      options[name] = inline;
    } else if (argv[index + 1] !== undefined && !argv[index + 1].startsWith("--")) {
      options[name] = argv[index + 1];
      index += 1;
    } else {
      options[name] = true;
    }
  }
  return options;
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override ?? base;
  if (typeof base !== "object" || base === null) return override ?? base;
  if (typeof override !== "object" || override === null) return base;
  const result = { ...base };
  for (const key of Object.keys(override)) {
    result[key] = key in base ? deepMerge(base[key], override[key]) : override[key];
  }
  return result;
}

function walk(dir, predicate) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if ([".git", "node_modules", "dist", "build", "out", ".workspace"].includes(entry.name)) continue;
      out.push(...walk(path, predicate));
    } else if (entry.isFile() && predicate(path)) {
      out.push(path);
    }
  }
  return out;
}

function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 120_000,
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ? String(result.error.message) : "",
  };
}

function matchAllowed(path, list) {
  if (!Array.isArray(list)) return false;
  return list.some((entry) => {
    if (typeof entry !== "string") return false;
    if (entry.endsWith("/")) return path.startsWith(entry);
    if (entry.includes("*")) {
      const pattern = entry.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
      return new RegExp(`^${pattern}$`).test(path);
    }
    return path === entry;
  });
}

// ---------- 运行参数与状态 ----------
const options = parseArgs(process.argv.slice(2));
const command = options._[0] ?? "report";
const root = realpathSync(String(options.root ?? process.cwd()));
const stateDir = resolve(root, String(options["state-dir"] ?? ".workspace/checks/js-backend"));
const profilePath = resolve(root, String(options.profile ?? join(stateDir, "profile.json")));
const baselinePath = resolve(root, String(options.baseline ?? join(stateDir, "baseline.json")));
const lockPath = join(stateDir, "tools.lock.json");
const jsonMode = Boolean(options.json);

const toolHealth = [];
function recordTool(name, ok, detail = "") {
  toolHealth.push({ name, ok, detail });
}

function loadProfile() {
  const project = readJson(profilePath);
  if (project === null) {
    throw new Error(`找不到 profile：${profilePath}。先运行 init 生成，或显式传 --profile。`);
  }
  const merged = deepMerge(DEFAULTS, project);
  merged.paths = { ...DEFAULTS.defaults.paths, ...(project.paths ?? {}) };
  merged.rules = { ...DEFAULTS.rules };
  for (const [id, override] of Object.entries(project.rules ?? {})) {
    merged.rules[id] = { ...(DEFAULTS.rules[id] ?? { name: id, level: "WARN", threshold: 0 }), ...override };
  }
  merged.defaults = deepMerge(DEFAULTS.defaults, project.defaults ?? {});
  merged.paths = { ...DEFAULTS.defaults.paths, ...merged.defaults.paths, ...(project.paths ?? {}) };
  merged.components = deepMerge(DEFAULTS.defaults.components, project.components ?? {});
  merged.routes = deepMerge(DEFAULTS.defaults.routes, project.routes ?? {});
  merged.allow = deepMerge(DEFAULTS.defaults.allow, project.allow ?? {});
  merged.commit = deepMerge(DEFAULTS.defaults.commit, project.commit ?? {});
  merged.jscpd = deepMerge(DEFAULTS.defaults.jscpd, project.jscpd ?? {});
  merged.tests = deepMerge(DEFAULTS.defaults.tests, project.tests ?? {});
  merged.precheckRules = project.precheckRules ?? DEFAULTS.defaults.precheckRules;
  merged.contracts = project.contracts ?? DEFAULTS.defaults.contracts;
  return merged;
}

function toolRoots() {
  const candidate = [];
  if (options["tools-dir"]) candidate.push(resolve(root, String(options["tools-dir"])));
  candidate.push(join(stateDir, "tools", "node_modules"));
  let current = root;
  for (;;) {
    candidate.push(join(current, "node_modules"));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  candidate.push(join(SKILL_DIR, "node_modules"));
  return [...new Set(candidate)].filter((dir) => existsSync(dir));
}

function loadDep(name) {
  for (const dir of toolRoots()) {
    try {
      return createRequire(join(dir, "package.json"))(name);
    } catch {
      // 继续找下一个根
    }
  }
  return null;
}

function binPath(name) {
  for (const dir of toolRoots()) {
    const path = join(dir, ".bin", process.platform === "win32" ? `${name}.cmd` : name);
    if (existsSync(path)) return path;
  }
  return null;
}

function changedFiles() {
  const diff = run("git", ["diff", "--name-only", "--relative", "HEAD"], { cwd: root });
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root });
  if (diff.status !== 0 && untracked.status !== 0) return null;
  const paths = `${diff.stdout}\n${untracked.stdout}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return new Set(paths);
}

// ---------- 采集 ----------
function buildOxlintConfig(basePath, profile) {
  const base = readJson(basePath) ?? {};
  const rules = { ...(base.rules ?? {}) };
  rules["max-lines"] = ["warn", { max: Number(profile.rules["Q-01"].threshold) }];
  rules["max-lines-per-function"] = ["warn", { max: Number(profile.rules["Q-02"].threshold) }];
  rules["max-params"] = ["warn", Number(profile.rules["Q-03"].threshold)];
  rules["max-depth"] = ["warn", Number(profile.rules["Q-05"].threshold)];
  rules["complexity"] = ["warn", Number(profile.rules["Q-04"].threshold)];
  const path = join(tmpdir(), `js-backend-oxlint-${process.pid}.json`);
  writeFileSync(path, JSON.stringify({ ...base, rules }, null, 2));
  return path;
}

function collect(profile, mode) {
  const rules = profile.rules;
  const enabled = (id) => rules[id]?.enabled !== false;
  const precheck = mode === "precheck";
  const sourceDirs = profile.paths.source.map((dir) => resolve(root, dir));
  const sourceFiles = [];
  const baseOxConfig = profile.lintConfig
    ? resolve(root, profile.lintConfig)
    : existsSync(join(root, ".oxlintrc.json"))
      ? join(root, ".oxlintrc.json")
      : OXLINT_DEFAULT_CONFIG;
  const oxConfig = buildOxlintConfig(baseOxConfig, profile);

  // oxlint
  let oxDiagnostics = [];
  let byCode = new Map();
  const ox = binPath("oxlint");
  const expectedOxRules = profile.oxlintRules ?? [
    "max-lines",
    "max-lines-per-function",
    "max-params",
    "max-depth",
    "complexity",
    "typescript/no-explicit-any",
    "typescript/no-non-null-assertion",
    "typescript/ban-ts-comment",
  ];
  let oxOk = false;
  if (ox === null) {
    recordTool("oxlint", false, "未找到 oxlint 可执行文件");
  } else {
    const sample = profile.paths.entries.find((entry) => existsSync(join(root, entry))) ?? profile.paths.source[0];
    const printed = run(ox, ["--print-config", "-c", oxConfig, sample], { cwd: root });
    const printedJson = readJsonText(printed.stdout);
    const configured = Object.keys(printedJson?.rules ?? {});
    const missing = expectedOxRules.filter((rule) => !configured.includes(rule));
    const ignore = (profile.paths.ignore ?? []).flatMap((pattern) => ["--ignore-pattern", pattern]);
    const result = run(
      ox,
      [...profile.paths.source, "--import-plugin", ...ignore, "-c", oxConfig, "-f", "json"],
      { cwd: root, timeoutMs: 120_000 },
    );
    const parsed = readJsonText(result.stdout);
    oxDiagnostics = Array.isArray(parsed?.diagnostics) ? parsed.diagnostics : [];
    for (const diagnostic of oxDiagnostics) {
      const list = byCode.get(diagnostic.code) ?? [];
      list.push(diagnostic);
      byCode.set(diagnostic.code, list);
    }
    oxOk = printed.status === 0 && missing.length === 0 && result.status <= 1 && Array.isArray(parsed?.diagnostics);
    recordTool(
      "oxlint",
      oxOk,
      oxOk ? `${parsed?.number_of_rules ?? 0} 条规则；配置已加载` : `配置加载失败或缺少规则：${missing.join(",")}`,
    );
    if (!oxOk) recordTool("oxlint-config", false, `expected=${expectedOxRules.join(",")} missing=${missing.join(",")}`);
    rmSync(oxConfig, { force: true });
  }
  const oxCount = (code) => (byCode.get(code) ?? []).length;
  const oxMax = (code, regex) => {
    let max = null;
    for (const diagnostic of byCode.get(code) ?? []) {
      const match = String(diagnostic.message).match(regex);
      if (match) max = Math.max(max ?? 0, Number(match[1]));
    }
    return max;
  };

  // ts-morph
  const tsMorph = loadDep("ts-morph");
  let project = null;
  let tsMorphOk = false;
  if (tsMorph === null) {
    recordTool("ts-morph", false, "未找到 ts-morph 依赖");
  } else {
    try {
      const tsconfig = existsSync(join(root, "tsconfig.json")) ? join(root, "tsconfig.json") : undefined;
      project = new tsMorph.Project({ ...(tsconfig ? { tsConfigFilePath: tsconfig } : {}), skipAddingFilesFromTsConfig: true });
      for (const dir of sourceDirs) {
        project.addSourceFilesAtPaths(join(dir, "**/*.ts"));
        project.addSourceFilesAtPaths(join(dir, "**/*.tsx"));
      }
      const files = project.getSourceFiles().filter((file) => {
        const path = resolve(file.getFilePath());
        return sourceDirs.some((dir) => path.startsWith(dir + sep));
      });
      sourceFiles.push(...files);
      tsMorphOk = sourceFiles.length > 0;
      recordTool("ts-morph", tsMorphOk, tsMorphOk ? `${sourceFiles.length} 个源文件` : "源文件为空");
    } catch (error) {
      recordTool("ts-morph", false, String(error).slice(0, 200));
    }
  }
  const { SyntaxKind } = tsMorph ?? {};

  const normalize = (path) => resolve(path);
  const sourceByPath = new Map(sourceFiles.map((file) => [normalize(file.getFilePath()), file]));
  const componentOf = (path) => {
    const rel = relative(root, path).split(sep).join("/");
    for (const dir of profile.components.roots) {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`;
      if (rel.startsWith(prefix)) {
        const rest = rel.slice(prefix.length).split("/");
        return `${dir}/${rest[0]}`;
      }
    }
    return "(app)";
  };

  let cycles = [];
  let fanOutMax = 0;
  let fanOutFile = "";
  let deepImports = [];
  let orphans = [];
  let unresolvedDynamic = [];
  const graph = new Map();
  const importLines = new Map();
  if (tsMorphOk) {
    const resolveLocal = (fromPath, specifier) => {
      if (!specifier.startsWith(".")) return null;
      const base = resolve(dirname(fromPath), specifier);
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
        if (sourceByPath.has(normalize(candidate))) return normalize(candidate);
      }
      return null;
    };
    for (const file of sourceFiles) {
      const path = normalize(file.getFilePath());
      const targets = new Set();
      for (const declaration of file.getImportDeclarations()) {
        const specifier = declaration.getModuleSpecifierValue();
        if (!specifier) continue;
        const target = declaration.getModuleSpecifierSourceFile();
        const targetPath = target ? normalize(target.getFilePath()) : resolveLocal(path, specifier);
        if (targetPath && sourceByPath.has(targetPath)) targets.add(targetPath);
      }
      for (const declaration of file.getExportDeclarations()) {
        const specifier = declaration.getModuleSpecifierValue();
        if (!specifier) continue;
        const target = declaration.getModuleSpecifierSourceFile();
        const targetPath = target ? normalize(target.getFilePath()) : resolveLocal(path, specifier);
        if (targetPath && sourceByPath.has(targetPath)) targets.add(targetPath);
      }
      for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expression = call.getExpression().getText();
        if (expression !== "import" && expression !== "require") continue;
        const argument = call.getArguments()[0];
        if (!argument || argument.getKind() !== SyntaxKind.StringLiteral) {
          unresolvedDynamic.push(`${relative(root, path)}:${call.getStartLineNumber()}`);
          continue;
        }
        const targetPath = resolveLocal(path, argument.getLiteralValue());
        if (targetPath) targets.add(targetPath);
      }
      const importNodes = [
        ...file.getImportDeclarations(),
        ...file.getExportDeclarations(),
        ...file.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
          const expression = call.getExpression().getText();
          return expression === "import" || expression === "require";
        }),
      ];
      for (const node of importNodes) {
        const specifierNode =
          typeof node.getModuleSpecifierValue === "function"
            ? node.getDescendantsOfKind(SyntaxKind.StringLiteral)[0]
            : node.getArguments?.()[0];
        const specifier =
          typeof node.getModuleSpecifierValue === "function"
            ? node.getModuleSpecifierValue()
            : specifierNode?.getKind?.() === SyntaxKind.StringLiteral
              ? specifierNode.getLiteralValue()
              : null;
        if (!specifier) continue;
        const targetPath = resolveLocal(path, specifier);
        if (!targetPath || targetPath === path) continue;
        importLines.set(`${path}|${targetPath}`, specifierNode?.getStartLineNumber?.() ?? 0);
      }
      graph.set(path, targets);
    }

    // Tarjan SCC
    const indexOf = new Map();
    const lowOf = new Map();
    const stack = [];
    const onStack = new Set();
    let nextIndex = 0;
    const strongConnect = (node) => {
      indexOf.set(node, nextIndex);
      lowOf.set(node, nextIndex);
      nextIndex += 1;
      stack.push(node);
      onStack.add(node);
      for (const target of graph.get(node) ?? []) {
        if (!indexOf.has(target)) {
          strongConnect(target);
          lowOf.set(node, Math.min(lowOf.get(node), lowOf.get(target)));
        } else if (onStack.has(target)) {
          lowOf.set(node, Math.min(lowOf.get(node), indexOf.get(target)));
        }
      }
      if (lowOf.get(node) === indexOf.get(node)) {
        const component = [];
        let current;
        do {
          current = stack.pop();
          onStack.delete(current);
          component.push(current);
        } while (current !== node);
        if (component.length > 1) cycles.push(component);
      }
    };
    for (const path of graph.keys()) if (!indexOf.has(path)) strongConnect(path);

    for (const [path, targets] of graph) {
      const own = componentOf(path);
      const components = new Set();
      for (const target of targets) {
        const other = componentOf(target);
        if (other !== own) components.add(other);
        if (
          (profile.components.deepImportRoots ?? profile.components.roots).some((dir) => path.startsWith(resolve(root, dir) + sep)) &&
          (profile.components.deepImportRoots ?? profile.components.roots).some((dir) => target.startsWith(resolve(root, dir) + sep)) &&
          other !== own &&
          !profile.components.publicFiles.includes(basename(target)) &&
          !matchAllowed(relative(root, path).split(sep).join("/"), profile.components.deepImportExempt)
        ) {
          deepImports.push({
            path: relative(root, path),
            line: importLines.get(`${path}|${target}`) ?? 0,
            message: `导入 ${relative(root, target)}，绕过 ${other} 的公共入口`,
          });
        }
      }
      if (matchAllowed(relative(root, path).split(sep).join("/"), profile.components.fanoutExempt)) continue;
      if (components.size > fanOutMax) {
        fanOutMax = components.size;
        fanOutFile = relative(root, path);
      }
    }

    const reachable = new Set();
    const queue = profile.paths.entries
      .map((entry) => normalize(resolve(root, entry)))
      .filter((path) => sourceByPath.has(path));
    while (queue.length > 0) {
      const current = queue.pop();
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const target of graph.get(current) ?? []) if (!reachable.has(target)) queue.push(target);
    }
    orphans = [...graph.keys()].filter((path) => !reachable.has(path)).map((path) => relative(root, path));
  }

  // 单文件规模、导出、可选字段、路由分支
  let exportsMax = 0;
  let exportsFile = "";
  let functionsMax = 0;
  let functionsFile = "";
  let classMethodsMax = 0;
  let classMethodsName = "";
  let optionalRatioMax = 0;
  let optionalName = "";
  let routeBranchesMax = 0;
  let routeBranchesFile = "";
  let maxImports = 0;
  const duplicateStrings = [];
  const envOutside = [];
  const consoleOutside = [];
  const runtimeOutside = [];
  const todoLines = [];
  const fileLines = [];
  const classRouteRoots = profile.routes.roots.map((dir) => resolve(root, dir));
  for (const file of sourceFiles) {
    const path = normalize(file.getFilePath());
    const rel = relative(root, path).split(sep).join("/");
    const text = file.getFullText();
    fileLines.push({ file: rel, lines: text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length });
    const exportCount = directExportCount(file, SyntaxKind);
    if (exportCount > exportsMax) {
      exportsMax = exportCount;
      exportsFile = rel;
    }
    const functionCount =
      file.getFunctions().length +
      file.getVariableDeclarations().filter((declaration) => {
        const initializer = declaration.getInitializer();
        return (
          initializer?.getKind() === SyntaxKind.ArrowFunction ||
          initializer?.getKind() === SyntaxKind.FunctionExpression
        );
      }).length;
    if (functionCount > functionsMax) {
      functionsMax = functionCount;
      functionsFile = rel;
    }
    for (const klass of file.getClasses()) {
      const methods = klass.getMethods().length;
      if (methods > classMethodsMax) {
        classMethodsMax = methods;
        classMethodsName = `${rel}#${klass.getName() ?? "<anonymous>"}`;
      }
    }
    const considerProperties = (name, properties) => {
      if (properties.length < 5) return;
      if (/^(?:Update|Patch)/.test(name) || /(?:Patch|Query)$/.test(name)) return;
      const optional = properties.filter((property) => property.hasQuestionToken()).length;
      const ratio = optional / properties.length;
      if (ratio > optionalRatioMax) {
        optionalRatioMax = ratio;
        optionalName = `${rel}#${name}`;
      }
    };
    for (const declaration of file.getInterfaces()) considerProperties(declaration.getName(), declaration.getProperties());
    for (const declaration of file.getTypeAliases()) {
      const typeNode = declaration.getTypeNode();
      if (typeNode?.getKind() !== SyntaxKind.TypeLiteral) continue;
      considerProperties(declaration.getName(), typeNode.asKindOrThrow(SyntaxKind.TypeLiteral).getProperties());
    }
    if (classRouteRoots.some((dir) => path.startsWith(dir + sep))) {
      const branches = file
        .getDescendantsOfKind(SyntaxKind.IfStatement)
        .filter((statement) => statement.getExpression().getText().includes(profile.routes.methodSelector)).length;
      if (branches > routeBranchesMax) {
        routeBranchesMax = branches;
        routeBranchesFile = rel;
      }
    }
    maxImports = Math.max(maxImports, file.getImportDeclarations().length);

    for (const literal of file.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
      const parent = literal.getParent();
      if (!parent) continue;
      if (parent.getKind() === SyntaxKind.ImportDeclaration || parent.getKind() === SyntaxKind.ExportDeclaration) continue;
      const value = literal.getLiteralValue();
      if (value.length < 5) continue;
      if (["string", "number", "boolean", "object", "undefined", "function", "symbol", "bigint"].includes(value)) continue;
      if (parent.getKind() === SyntaxKind.PropertyAssignment && parent.asKindOrThrow(SyntaxKind.PropertyAssignment).getNameNode() === literal) continue;
      if (parent.getKind() === SyntaxKind.PropertySignature && parent.asKindOrThrow(SyntaxKind.PropertySignature).getNameNode() === literal) continue;
      const existing = duplicateStrings.find((item) => item.value === value);
      if (existing) existing.paths.add(rel);
      else duplicateStrings.push({ value, paths: new Set([rel]) });
    }

    const lines = text.split("\n");
    lines.forEach((line, index) => {
      if (/\b(TODO|FIXME|HACK)\b/.test(line)) todoLines.push({ path: rel, line: index + 1, text: line.trim() });
    });

    for (const access of file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      if (access.getText() !== "process.env") continue;
      if (!matchAllowed(rel, profile.allow.env)) {
        envOutside.push({ path: rel, line: access.getStartLineNumber(), message: "读取 process.env" });
      }
    }
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression().getText();
      if (expression.startsWith("console.")) {
        const allowed =
          matchAllowed(rel, profile.allow.console) || profile.allow.console.includes(`${rel}#${expression}`);
        if (!allowed) consoleOutside.push({ path: rel, line: call.getStartLineNumber(), message: expression });
      }
      const allowedForApi = profile.allow.runtimeApis?.[expression];
      if (allowedForApi !== undefined && !matchAllowed(rel, allowedForApi)) {
        runtimeOutside.push({ path: rel, line: call.getStartLineNumber(), message: expression });
      }
    }
  }
  const duplicateGroups = duplicateStrings.filter((item) => item.paths.size >= 3).sort((a, b) => b.paths.size - a.paths.size);

  // knip / jscpd / tsc / SQL / 契约 / git / 测试
  let knip = null;
  let jscpd = null;
  let tsc = null;
  let sql = null;
  let contract = null;
  let git = null;
  let tests = null;

    // 测试卫生
    const testFiles = [
      ...new Set([
        ...profile.paths.tests.flatMap((dir) => walk(resolve(root, dir), (path) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path))),
        ...sourceFiles
          .map((file) => file.getFilePath())
          .filter((path) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)),
      ]),
    ];
    const weak = [];
    const skipped = [];
    for (const path of testFiles) {
      const text = readFileSync(path, "utf8");
      for (const pattern of profile.tests.weakPatterns) {
        for (const match of text.matchAll(new RegExp(pattern, "g"))) {
          const line = text.slice(0, match.index).split("\n").length;
          weak.push({ path: relative(root, path), line, message: text.split("\n")[line - 1]?.trim().slice(0, 80) ?? "" });
        }
      }
      for (const pattern of profile.tests.skipPatterns) {
        for (const match of text.matchAll(new RegExp(pattern, "g"))) {
          const line = text.slice(0, match.index).split("\n").length;
          skipped.push({ path: relative(root, path), line, message: text.split("\n")[line - 1]?.trim().slice(0, 80) ?? "" });
        }
      }
    }
    tests = { files: testFiles.length, weak, skipped };

  if (!precheck) {
    const knipBin = binPath("knip");
    if (knipBin === null) {
      recordTool("knip", false, "未找到 knip");
    } else {
      const result = run(knipBin, ["--include", "files,exports,types", "--no-progress", "--reporter", "json"], { cwd: root });
      const parsed = readJsonText(result.stdout);
      const ok = result.status <= 1 && Array.isArray(parsed?.issues);
      knip = ok ? (parsed.issues ?? []).filter((issue) => !matchAllowed(String(issue.file), profile.paths.ignore ?? [])) : null;
      recordTool("knip", ok, ok ? `${knip.length} 个问题` : `status=${result.status}`);
    }

    const jscpdBin = binPath("jscpd");
    if (jscpdBin === null) {
      recordTool("jscpd", false, "未找到 jscpd");
    } else {
      const dir = mkdtempSync(join(tmpdir(), "js-backend-jscpd-"));
      const result = run(
        jscpdBin,
        [
          ...profile.paths.source,
          "--format",
          profile.jscpd.format,
          "--min-lines",
          String(profile.jscpd.minLines),
          "--min-tokens",
          String(profile.jscpd.minTokens),
          "--reporters",
          "json",
          "--output",
          dir,
        ],
        { cwd: root },
      );
      try {
        if (result.status !== 0) {
          recordTool("jscpd", false, `status=${result.status} ${result.stderr.slice(0, 160)}`);
        } else {
          const report = readJson(join(dir, "jscpd-report.json"));
          if (report?.statistics?.total) {
            jscpd = report;
            recordTool("jscpd", true, `${(report.duplicates ?? []).length} 个克隆块`);
          } else {
            recordTool("jscpd", false, "报告缺少 statistics.total");
          }
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    const tscBin = binPath("tsc");
    if (tscBin === null) {
      recordTool("tsc", false, "未找到 tsc");
    } else {
      const result = run(tscBin, ["--noEmit"], { cwd: root, timeoutMs: 240_000 });
      const errors = [];
      for (const line of result.stdout.split("\n")) {
        const match = line.match(/^(.+?)\((\d+),\d+\):\s+(error TS\d+:\s+.+)$/);
        if (match) errors.push({ path: match[1], line: Number(match[2]), message: match[3] });
      }
      const ok = !result.error && result.status <= 1;
      tsc = ok ? errors : null;
      recordTool("tsc", ok, ok ? `${errors.length} 个类型错误` : `status=${result.status}`);
    }

    const sqlFiles = profile.paths.migrations.flatMap((dir) => walk(resolve(root, dir), (path) => path.endsWith(".sql")));
    const parseSql = loadDep("pgsql-ast-parser")?.parse;
    if (parseSql === undefined) {
      recordTool("pgsql-ast-parser", false, "未找到 pgsql-ast-parser");
    } else if (sqlFiles.length === 0) {
      recordTool("pgsql-ast-parser", true, "没有 migration 目录，跳过");
    } else {
      try {
        const tables = new Map();
        const errors = [];
        for (const path of sqlFiles.sort()) {
          let ast = [];
          try {
            ast = parseSql(readFileSync(path, "utf8"));
          } catch (error) {
            errors.push(`${basename(path)}: ${String(error).slice(0, 120)}`);
            continue;
          }
          for (const statement of ast) {
            if (statement.type !== "create table") continue;
            const name = statement.name?.name ?? basename(path);
            const state = new Map();
            for (const column of statement.columns ?? []) {
              const constraints = column.constraints ?? [];
              state.set(
                column.name?.name ?? "",
                !constraints.some((constraint) => ["not null", "primary key"].includes(constraint.type)),
              );
            }
            tables.set(name, state);
          }
          for (const statement of ast) {
            if (statement.type !== "alter table") continue;
            const name = statement.table?.name;
            const state = tables.get(name);
            if (state === undefined) continue;
            for (const change of statement.changes ?? []) {
              const raw = change.column?.name;
              const column = typeof raw === "string" ? raw : raw?.name;
              if (typeof column !== "string") continue;
              if (change.type === "add column") {
                const constraints = change.column?.constraints ?? [];
                state.set(column, !constraints.some((constraint) => ["not null", "primary key"].includes(constraint.type)));
              } else if (change.type === "drop column") {
                state.delete(column);
              } else if (change.type === "alter column" && change.alter?.type === "set not null") {
                state.set(column, false);
              }
            }
          }
        }
        let width = 0;
        let widthName = "";
        let nullable = 0;
        let nullableName = "";
        for (const [name, state] of tables) {
          if (state.size === 0) continue;
          if (state.size > width) {
            width = state.size;
            widthName = name;
          }
          const ratio = [...state.values()].filter(Boolean).length / state.size;
          if (ratio > nullable) {
            nullable = ratio;
            nullableName = name;
          }
        }
        sql = { files: sqlFiles.length, errors, width, widthName, nullable, nullableName };
        recordTool("pgsql-ast-parser", errors.length === 0, errors.length === 0 ? `${sqlFiles.length} 个 migration` : errors.join("; "));
      } catch (error) {
        recordTool("pgsql-ast-parser", false, String(error).slice(0, 160));
      }
    }

    const contractCommand = profile.contracts?.command;
    if (!Array.isArray(contractCommand) || contractCommand.length === 0) {
      contract = { skipped: true };
    } else {
      const [bin, ...rest] = contractCommand;
      const result = run(bin, rest, { cwd: root, timeoutMs: 300_000 });
      contract = { status: result.status, skipped: false, error: result.error, output: `${result.stdout}\n${result.stderr}`.slice(0, 2000) };
      recordTool("contract-command", result.status <= 1 && !result.error, result.error || `exit=${result.status}`);
    }

    // git 历史
    const gitProbe = run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root });
    let gitOk = gitProbe.status === 0;
    const commitsResult = run("git", ["log", "-30", "--numstat", "--pretty=format:COMMIT\t%H\t%s"], { cwd: root });
    if (commitsResult.status !== 0) gitOk = false;
    const sourcePrefix = `${profile.paths.source[0]}/`;
    const touchCounts = new Map();
    let subject = "";
    for (const line of commitsResult.stdout.split("\n")) {
      if (line.startsWith("COMMIT\t")) {
        subject = line.split("\t").slice(2).join("\t");
        continue;
      }
      if (!line.trim()) continue;
      const file = line.split("\t")[2];
      if (file?.startsWith(sourcePrefix)) touchCounts.set(file, (touchCounts.get(file) ?? 0) + 1);
    }
    const hotspots = [...touchCounts.entries()]
      .filter(([file, count]) => count >= 5 && existsSync(join(root, file)) && statSync(join(root, file)).size > 0)
      .map(([file, count]) => `${file}（${count} 次）`);
    const recent = run("git", ["log", "--since=90.days", "--numstat", "--pretty=format:COMMIT\t%H\t%s"], { cwd: root });
    if (recent.status !== 0) gitOk = false;
    const fixCounts = new Map();
    const taskCounts = new Map();
    subject = "";
    for (const line of recent.stdout.split("\n")) {
      if (line.startsWith("COMMIT\t")) {
        subject = line.split("\t").slice(2).join("\t");
        continue;
      }
      if (!line.trim()) continue;
      const file = line.split("\t")[2];
      if (!file?.startsWith(sourcePrefix)) continue;
      if (subject.startsWith(profile.commit.fixPrefix)) fixCounts.set(file, (fixCounts.get(file) ?? 0) + 1);
      const tasks = subject.match(new RegExp(profile.commit.taskPattern, "g")) ?? [];
      const set = taskCounts.get(file) ?? new Set();
      for (const task of tasks) set.add(task);
      taskCounts.set(file, set);
    }
    const fixChurn = [...fixCounts.entries()].filter(([, count]) => count >= 3);
    const multiTask = [...taskCounts.entries()].filter(([, tasks]) => tasks.size >= profile.commit.churnTaskThreshold);
    const lastCommit = run("git", ["show", "--numstat", "--format=", "HEAD"], { cwd: root });
    if (lastCommit.status !== 0) gitOk = false;
    let lastLines = 0;
    let lastFiles = 0;
    for (const line of lastCommit.stdout.trim().split("\n").filter(Boolean)) {
      const [added, deleted] = line.split("\t");
      if (added === "-" || deleted === "-") continue;
      lastLines += Number(added) + Number(deleted);
      lastFiles += 1;
    }
    git = { ok: gitOk, hotspots, fixChurn, multiTask, lastLines, lastFiles };
    recordTool("git", gitOk, gitOk ? "历史可读" : "无法读取 git 历史");

    // TODO 年龄
    const todoByFile = new Map();
    for (const todo of todoLines) {
      const set = todoByFile.get(todo.path) ?? new Set();
      set.add(todo.line);
      todoByFile.set(todo.path, set);
    }
    let oldestDays = 0;
    let ageError = "";
    for (const [path, lines] of todoByFile) {
      const blame = run("git", ["blame", "--line-porcelain", "--", path], { cwd: root, timeoutMs: 30_000 });
      if (blame.status !== 0) {
        ageError = `${path}: ${blame.stderr.slice(0, 160)}`;
        continue;
      }
      let currentLine = 0;
      for (const line of blame.stdout.split("\n")) {
        const header = line.match(/^[0-9a-f]{40} \d+ (\d+)(?: \d+)?$/);
        if (header) currentLine = Number(header[1]);
        const time = line.match(/^committer-time (\d+)$/);
        if (time && lines.has(currentLine)) {
          oldestDays = Math.max(oldestDays, Math.floor((Date.now() / 1000 - Number(time[1])) / 86400));
        }
      }
    }
    git = { ...git, todoLines, oldestTodoDays: oldestDays, todoAgeError: ageError };


  }

  return {
    profile,
    precheck,
    oxOk,
    oxCount,
    oxMax,
    byCode,
    oxDiagnostics,
    tsMorphOk,
    sourceFiles,
    fileLines,
    cycles,
    fanOutMax,
    fanOutFile,
    deepImports,
    orphans,
    unresolvedDynamic,
    exportsMax,
    exportsFile,
    functionsMax,
    functionsFile,
    classMethodsMax,
    classMethodsName,
    optionalRatioMax,
    optionalName,
    routeBranchesMax,
    routeBranchesFile,
    maxImports,
    duplicateGroups,
    envOutside,
    consoleOutside,
    runtimeOutside,
    todoLines,
    knip,
    jscpd,
    tsc,
    sql,
    contract,
    git,
    tests,
  };
}

function readJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function directExportCount(file, SyntaxKind) {
  let total = 0;
  for (const statement of file.getStatements()) {
    const kind = statement.getKind();
    if (kind === SyntaxKind.ExportDeclaration) {
      const declaration = statement.asKindOrThrow(SyntaxKind.ExportDeclaration);
      if (!declaration.getModuleSpecifier()) {
        total += declaration.getNamedExports().length;
        if (declaration.getNamespaceExport()) total += 1;
      }
      continue;
    }
    if (kind === SyntaxKind.ExportAssignment) {
      total += 1;
      continue;
    }
    const modifiers = statement.getModifiers?.() ?? [];
    if (!modifiers.some((modifier) => modifier.getKind() === SyntaxKind.ExportKeyword)) continue;
    if (kind === SyntaxKind.VariableStatement) {
      total += statement.asKindOrThrow(SyntaxKind.VariableStatement).getDeclarationList().getDeclarations().length;
    } else {
      total += 1;
    }
  }
  return total;
}

// ---------- 判定 ----------
function evaluate(raw, baseline) {
  const { profile } = raw;
  const metrics = [];
  const violations = [];
  const sections = [];
  const levelOf = (id) => profile.rules[id]?.level ?? "WARN";
  const thresholdOf = (id) => profile.rules[id]?.threshold ?? 0;
  const addViolation = (ruleId, path, line, message) => {
    if (raw.precheck && !profile.precheckRules.includes(ruleId)) return;
    violations.push({ ruleId, level: levelOf(ruleId), path, line, message });
  };
  const status = (ruleId, over, measured = true) => {
    if (!measured) return "ERROR";
    if (profile.rules[ruleId]?.enabled === false) return "SKIP";
    const level = levelOf(ruleId);
    if (level === "INFO") return "INFO";
    if (!over) return "PASS";
    return level === "WARN" ? "WARN" : "FAIL";
  };
  const inPrecheck = (ruleId) => profile.precheckRules.includes(ruleId);
  const add = (ruleId, value, display, over, detail = "", measured = true) => {
    const skipped = raw.precheck && !inPrecheck(ruleId);
    metrics.push({
      id: ruleId,
      name: profile.rules[ruleId]?.name ?? ruleId,
      level: levelOf(ruleId),
      value: skipped ? "未执行" : display,
      threshold: String(thresholdOf(ruleId)),
      status: skipped ? "SKIP" : status(ruleId, over, measured),
      detail: skipped ? "precheck 不执行该规则" : detail,
    });
  };

  // 尺寸/复杂度（oxlint）
  const oxDiagnostics = raw.oxDiagnostics;
  const oxD = (code) => (raw.byCode.get(code) ?? []);
  const ruleRows = (code, matcher = () => true) =>
    oxD(code)
      .map((diagnostic) => ({
        path: String(diagnostic.filename ?? ""),
        line: Number(diagnostic.labels?.[0]?.span?.line ?? 0),
        message: String(diagnostic.message ?? ""),
      }))
      .filter((row) => matcher(row));
  const fileRows = ruleRows("eslint(max-lines)");
  const functionRows = ruleRows("eslint(max-lines-per-function)");
  const paramRows = ruleRows("eslint(max-params)");
  const depthRows = ruleRows("eslint(max-depth)");
  const complexityRows = ruleRows("eslint(complexity)");
  const anyRows = ruleRows("typescript(no-explicit-any)");
  const nonNullRows = ruleRows("typescript(no-non-null-assertion)");
  const tsIgnoreRows = ruleRows("typescript(ban-ts-comment)");

  const maxFile = raw.fileLines.reduce((best, row) => (row.lines > (best?.lines ?? 0) ? row : best), null);
  const warnLines = thresholdOf("Q-01") === 600 ? 500 : Math.round(thresholdOf("Q-01") * 0.83);
  add(
    "Q-01",
    maxFile?.lines ?? 0,
    maxFile ? `${maxFile.lines}（${maxFile.file}）` : "无源文件",
    (maxFile?.lines ?? 0) > thresholdOf("Q-01"),
    raw.tsMorphOk ? `>${warnLines} 的文件 ${raw.fileLines.filter((row) => row.lines > warnLines).length} 个` : "ts-morph 不可用",
    raw.tsMorphOk,
  );
  if (raw.tsMorphOk) {
    for (const row of raw.fileLines.filter((item) => item.lines > warnLines)) {
      if (row.lines > thresholdOf("Q-01")) addViolation("Q-01", row.file, 1, `${row.lines} 行`);
    }
    for (const row of fileRows) addViolation("Q-01", row.path, row.line, row.message);
  }
  add("Q-02", functionRows.length ? raw.oxMax("eslint(max-lines-per-function)", /\((\d+)\)/) ?? functionRows.length : 0, String(functionRows.length ? raw.oxMax("eslint(max-lines-per-function)", /\((\d+)\)/) ?? 0 : 0), functionRows.length > 0, "物理行；oxlint 配置已自检", raw.oxOk);
  for (const row of functionRows) addViolation("Q-02", row.path, row.line, row.message);
  add("Q-03", raw.oxMax("eslint(max-params)", /\((\d+)\)/) ?? paramRows.length, String(raw.oxMax("eslint(max-params)", /\((\d+)\)/) ?? 0), paramRows.length > 0, "", raw.oxOk);
  for (const row of paramRows) addViolation("Q-03", row.path, row.line, row.message);
  add("Q-04", raw.oxMax("eslint(complexity)", /complexity of (\d+)/) ?? complexityRows.length, String(raw.oxMax("eslint(complexity)", /complexity of (\d+)/) ?? 0), complexityRows.length > 0, "", raw.oxOk);
  for (const row of complexityRows) addViolation("Q-04", row.path, row.line, row.message);
  add("Q-05", raw.oxMax("eslint(max-depth)", /\((\d+)\)/) ?? depthRows.length, String(raw.oxMax("eslint(max-depth)", /\((\d+)\)/) ?? 0), depthRows.length > 0, "", raw.oxOk);
  for (const row of depthRows) addViolation("Q-05", row.path, row.line, row.message);

  // 依赖与死代码
  add("Q-06", raw.cycles.length, `${raw.cycles.length} 组`, raw.cycles.length > 0, raw.cycles.map((cycle) => cycle.map((path) => relative(root, path)).join(" ↔ ")).slice(0, 3).join("; "), raw.tsMorphOk);
  for (const cycle of raw.cycles) addViolation("Q-06", cycle.map((path) => relative(root, path)).join(" ↔ "), 0, "循环依赖");
  add("Q-07", raw.deepImports.length, String(raw.deepImports.length), raw.deepImports.length > 0, raw.deepImports.slice(0, 5).map((item) => `${item.path}:${item.line}`).join("; "), raw.tsMorphOk);
  for (const item of raw.deepImports) addViolation("Q-07", item.path, item.line, item.message);
  add("Q-08", raw.orphans.length, String(raw.orphans.length), raw.orphans.length > 0, raw.orphans.slice(0, 5).join("; "), raw.tsMorphOk);
  for (const path of raw.orphans) addViolation("Q-08", path, 1, "从入口不可达");
  const knipIssues = raw.knip ?? [];
  const unusedExports = knipIssues.reduce((sum, issue) => sum + (issue.exports?.length ?? 0), 0);
  const unusedTypes = knipIssues.reduce((sum, issue) => sum + (issue.types?.length ?? 0), 0);
  const unusedFiles = knipIssues.reduce((sum, issue) => sum + (issue.files?.length ?? 0), 0);
  const baselineOf = (id) => (baseline?.values?.[id] !== undefined ? Number(baseline.values[id]) : undefined);
  const ratchetOver = (id, value) => {
    const recorded = baselineOf(id);
    return recorded === undefined ? value > thresholdOf(id) : value > recorded;
  };
  add("Q-09", raw.knip ? unusedExports : 0, raw.knip ? String(unusedExports) : "无法测量", raw.knip ? ratchetOver("Q-09", unusedExports) : false, `未使用文件 ${unusedFiles}`, raw.knip !== null);
  for (const issue of knipIssues) for (const item of issue.exports ?? []) addViolation("Q-09", issue.file, item.line ?? 1, `未使用的导出 ${item.name ?? item}`);
  add("Q-10", raw.knip ? unusedTypes : 0, raw.knip ? String(unusedTypes) : "无法测量", false, "仅报告", raw.knip !== null);
  add("Q-11", raw.fanOutMax, `${raw.fanOutMax}（${raw.fanOutFile}）`, raw.fanOutMax > thresholdOf("Q-11"), "", raw.tsMorphOk);
  if (raw.tsMorphOk && raw.fanOutMax > thresholdOf("Q-11")) addViolation("Q-11", raw.fanOutFile, 1, `扇出 ${raw.fanOutMax}`);

  const clones = raw.jscpd?.duplicates ?? [];
  add("Q-12", clones.length, raw.jscpd ? `${clones.length} 块 / ${Number(raw.jscpd.statistics?.total?.percentage ?? 0).toFixed(2)}%` : "无法测量", clones.length > 0, "", raw.jscpd !== null);
  for (const clone of clones) addViolation("Q-12", String(clone.firstFile?.name ?? ""), Number(clone.firstFile?.start ?? 0), `与 ${clone.secondFile?.name}:${clone.secondFile?.start} 重复 ${clone.lines} 行`);

  add("Q-13", nonNullRows.length, String(nonNullRows.length), ratchetOver("Q-13", nonNullRows.length), "", raw.oxOk);
  for (const row of nonNullRows) addViolation("Q-13", row.path, row.line, "非空断言 !");
  const escapeCount = anyRows.length + tsIgnoreRows.length;
  add("Q-14", escapeCount, String(escapeCount), escapeCount > 0, `any ${anyRows.length}；ts-ignore ${tsIgnoreRows.length}`, raw.oxOk);
  for (const row of anyRows) addViolation("Q-14", row.path, row.line, "显式 any");
  for (const row of tsIgnoreRows) addViolation("Q-14", row.path, row.line, "ts-ignore/ts-expect-error");
  add("Q-15", raw.duplicateGroups.length, String(raw.duplicateGroups.length), false, "跨 ≥3 文件，仅报告", raw.tsMorphOk);
  add("Q-16", raw.optionalRatioMax, `${(raw.optionalRatioMax * 100).toFixed(1)}%（${raw.optionalName}）`, raw.optionalRatioMax > thresholdOf("Q-16"), "", raw.tsMorphOk);
  if (raw.tsMorphOk && raw.optionalRatioMax > thresholdOf("Q-16")) addViolation("Q-16", raw.optionalName, 1, `可选字段 ${(raw.optionalRatioMax * 100).toFixed(1)}%`);

  // 契约与数据
  const contract = raw.contract;
  if (contract?.skipped) {
    metrics.push({ id: "Q-17", name: profile.rules["Q-17"].name, level: "HARD", value: "未配置", threshold: "0 fail", status: "SKIP", detail: "profile.contracts.command 为空" });
  } else if (contract) {
    const ok = contract.status === 0 && !contract.error;
    add("Q-17", ok ? 0 : 1, ok ? "通过" : `exit ${contract.status}`, !ok, contract.output.slice(0, 300), true);
    if (!ok) addViolation("Q-17", "", 0, `契约命令退出 ${contract.status}`);
  } else {
    metrics.push({ id: "Q-17", name: profile.rules["Q-17"].name, level: "HARD", value: "未执行", threshold: "0 fail", status: "SKIP", detail: "precheck 不执行契约命令" });
  }
  if (raw.sql) {
    add("Q-18", raw.sql.width, `${raw.sql.width}（${raw.sql.widthName}）`, raw.sql.width > thresholdOf("Q-18"), raw.sql.errors.join("; "), true);
    if (raw.sql.width > thresholdOf("Q-18")) addViolation("Q-18", raw.sql.widthName, 1, `${raw.sql.width} 列`);
    add("Q-19", raw.sql.nullable, `${(raw.sql.nullable * 100).toFixed(1)}%（${raw.sql.nullableName}）`, raw.sql.nullable > thresholdOf("Q-19"), "", true);
    if (raw.sql.nullable > thresholdOf("Q-19")) addViolation("Q-19", raw.sql.nullableName, 1, `可空列 ${(raw.sql.nullable * 100).toFixed(1)}%`);
  } else {
    metrics.push({ id: "Q-18", name: profile.rules["Q-18"].name, level: "WARN", value: "未测量", threshold: String(thresholdOf("Q-18")), status: raw.precheck ? "SKIP" : "ERROR", detail: raw.precheck ? "precheck 不执行 SQL 解析" : "migration 无法解析" });
    metrics.push({ id: "Q-19", name: profile.rules["Q-19"].name, level: "WARN", value: "未测量", threshold: String(thresholdOf("Q-19")), status: raw.precheck ? "SKIP" : "ERROR", detail: raw.precheck ? "precheck 不执行 SQL 解析" : "migration 无法解析" });
  }
  add("Q-20", raw.routeBranchesMax, `${raw.routeBranchesMax}（${raw.routeBranchesFile}）`, raw.routeBranchesMax > thresholdOf("Q-20"), "", raw.tsMorphOk);
  if (raw.tsMorphOk && raw.routeBranchesMax > thresholdOf("Q-20")) addViolation("Q-20", raw.routeBranchesFile, 1, `${raw.routeBranchesMax} 个方法分支`);
  add("Q-21", raw.envOutside.length, String(raw.envOutside.length), raw.envOutside.length > 0, raw.envOutside.slice(0, 5).map((item) => `${item.path}:${item.line}`).join("; "), raw.tsMorphOk);
  for (const item of raw.envOutside) addViolation("Q-21", item.path, item.line, item.message);
  const runtimeConfigured = Object.keys(profile.allow.runtimeApis ?? {}).length > 0;
  if (!runtimeConfigured) {
    metrics.push({ id: "Q-22", name: profile.rules["Q-22"].name, level: "HARD", value: "未配置", threshold: String(thresholdOf("Q-22")), status: "SKIP", detail: "profile.allow.runtimeApis 为空" });
  } else {
    add("Q-22", raw.runtimeOutside.length, String(raw.runtimeOutside.length), raw.runtimeOutside.length > 0, raw.runtimeOutside.slice(0, 5).map((item) => `${item.path}:${item.line}`).join("; "), raw.tsMorphOk);
    for (const item of raw.runtimeOutside) addViolation("Q-22", item.path, item.line, item.message);
  }
  add("Q-23", raw.consoleOutside.length, String(raw.consoleOutside.length), raw.consoleOutside.length > 0, raw.consoleOutside.slice(0, 5).map((item) => `${item.path}:${item.line}`).join("; "), raw.tsMorphOk);
  for (const item of raw.consoleOutside) addViolation("Q-23", item.path, item.line, item.message);
  if (raw.git) {
    add("Q-24", raw.git.oldestTodoDays, `${raw.git.todoLines?.length ?? 0} 处，最老 ${raw.git.oldestTodoDays} 天`, raw.git.oldestTodoDays > thresholdOf("Q-24"), raw.git.todoAgeError || "", !raw.git.todoAgeError);
  } else {
    metrics.push({ id: "Q-24", name: profile.rules["Q-24"].name, level: "WARN", value: "未测量", threshold: String(thresholdOf("Q-24")), status: "SKIP", detail: "precheck 不读取 git blame" });
  }
  if (raw.tests) {
    const weakCount = raw.tests.weak.length + raw.tests.skipped.length;
    add("Q-25", weakCount, `${raw.tests.weak.length} / ${raw.tests.skipped.length}`, weakCount > 0, raw.tests.files === 0 ? "未找到测试文件" : "", raw.tests.files > 0);
    for (const item of raw.tests.weak) addViolation("Q-25", item.path, item.line, "弱断言");
    for (const item of raw.tests.skipped) addViolation("Q-25", item.path, item.line, "skip 测试");
  } else {
    metrics.push({ id: "Q-25", name: profile.rules["Q-25"].name, level: "HARD", value: "未测量", threshold: "0 / 0", status: "SKIP", detail: "precheck 不扫描测试" });
  }

  // 预算与历史
  add("Q-26", raw.exportsMax, `${raw.exportsMax}（${raw.exportsFile}）`, raw.exportsMax > thresholdOf("Q-26"), "", raw.tsMorphOk);
  if (raw.tsMorphOk && raw.exportsMax > thresholdOf("Q-26")) addViolation("Q-26", raw.exportsFile, 1, `${raw.exportsMax} 个导出`);
  add("Q-27", raw.maxImports, String(raw.maxImports), raw.maxImports > thresholdOf("Q-27"), "", raw.tsMorphOk);
  add("Q-28", raw.functionsMax, `${raw.functionsMax}（${raw.functionsFile}）`, raw.functionsMax > thresholdOf("Q-28"), "", raw.tsMorphOk);
  if (raw.tsMorphOk && raw.functionsMax > thresholdOf("Q-28")) addViolation("Q-28", raw.functionsFile, 1, `${raw.functionsMax} 个函数`);
  add("Q-29", raw.classMethodsMax, `${raw.classMethodsMax}（${raw.classMethodsName}）`, raw.classMethodsMax > thresholdOf("Q-29"), "", raw.tsMorphOk);
  if (raw.git) {
    add("Q-30", raw.git.hotspots.length + raw.git.fixChurn.length + raw.git.multiTask.length, `hotspot ${raw.git.hotspots.length}；fix ${raw.git.fixChurn.length}；多任务 ${raw.git.multiTask.length}；上次 commit ${raw.git.lastLines} 行/${raw.git.lastFiles} 文件`, false, "", raw.git.ok);
  } else {
    metrics.push({ id: "Q-30", name: profile.rules["Q-30"].name, level: "INFO", value: "未测量", threshold: "仅报告", status: "SKIP", detail: "precheck 不读取 git 历史" });
  }
  if (raw.tsc) {
    add("Q-31", raw.tsc.length, String(raw.tsc.length), raw.tsc.length > 0, "", true);
    for (const error of raw.tsc) addViolation("Q-31", error.path, error.line, error.message);
  } else {
    metrics.push({ id: "Q-31", name: profile.rules["Q-31"].name, level: "HARD", value: "未测量", threshold: "0", status: "SKIP", detail: "precheck 不执行 tsc" });
  }

  // 明细分组
  const section = (title, rows, info = false) => {
    if (rows.length > 0) sections.push({ title, rows: rows.sort(), info });
  };
  section("跨组件深导入", raw.deepImports.map((item) => `${item.path}:${item.line}  ${item.message}`));
  section("循环依赖", raw.cycles.map((cycle) => cycle.map((path) => relative(root, path)).join(" ↔ ")));
  section("孤儿文件", raw.orphans.map((path) => `${path}:1`));
  section("动态导入未解析", raw.unresolvedDynamic);
  section("knip 未引用文件", knipIssues.flatMap((issue) => (issue.files ?? []).map((item) => `${issue.file}:1  ${typeof item === "string" ? "文件未被引用" : item.reason ?? ""}`)));
  section("knip 孤儿运行时导出", knipIssues.flatMap((issue) => (issue.exports ?? []).map((item) => `${issue.file}:${item.line ?? 1}  ${item.name ?? item}`)));
  section("knip 孤儿类型", knipIssues.flatMap((issue) => (issue.types ?? []).map((item) => `${issue.file}:${item.line ?? 1}  ${item.name ?? item}`)), true);
  section("克隆块", clones.map((clone) => `${clone.firstFile?.name}:${clone.firstFile?.start ?? 0} ↔ ${clone.secondFile?.name}:${clone.secondFile?.start ?? 0}  ${clone.lines ?? "?"} 行`));
  section("非入口 console 调用", raw.consoleOutside.map((item) => `${item.path}:${item.line}  ${item.message}`));
  section("配置外 process.env", raw.envOutside.map((item) => `${item.path}:${item.line}  ${item.message}`));
  section("运行时 API 越界", raw.runtimeOutside.map((item) => `${item.path}:${item.line}  ${item.message}`));
  section("TODO / FIXME", raw.todoLines.map((todo) => `${todo.path}:${todo.line}  ${todo.text.slice(0, 90)}`), true);
  section("弱断言", (raw.tests?.weak ?? []).map((item) => `${item.path}:${item.line}  ${item.message}`));
  section("skip 测试", (raw.tests?.skipped ?? []).map((item) => `${item.path}:${item.line}  ${item.message}`));
  section("migration 解析失败", (raw.sql?.errors ?? []).map((error) => `migration  ${error}`));
  section("重复字符串组", raw.duplicateGroups.map((item) => `${[...item.paths].sort().slice(0, 3).join(", ")}${item.paths.size > 3 ? ` 等${item.paths.size}个文件` : ""}  "${item.value}"`).slice(0, 50), true);
  section("git 变化信号", raw.git ? [...raw.git.hotspots.map((item) => `热点 ${item}`), ...raw.git.fixChurn.map(([file, count]) => `fix 反复 ${file}（${count} 次）`), ...raw.git.multiTask.map(([file, tasks]) => `多任务 ${file}（${tasks.size} 个任务）`)] : [], true);

  // 改动过滤
  const changed = options.changed ? changedFiles() : null;
  let filteredViolations = violations;
  if (changed !== null) {
    filteredViolations = violations.filter((violation) => {
      if (violation.path === "" || violation.path.includes(" ↔ ")) {
        return violation.path.split(" ↔ ").some((path) => changed.has(path));
      }
      return changed.has(violation.path);
    });
    for (const metric of metrics) {
      const rule = profile.rules[metric.id];
      if (!rule || !["file", "repo"].includes(rule.scope)) continue;
      if (metric.status === "ERROR" || metric.status === "SKIP" || metric.status === "INFO") continue;
      const count = filteredViolations.filter((violation) => violation.ruleId === metric.id).length;
      if (rule.scope === "file") {
        metric.status = count > 0 ? (rule.level === "WARN" ? "WARN" : "FAIL") : "PASS";
      } else if (rule.level === "HARD" || rule.level === "RATCHET") {
        const recorded = baselineOf(metric.id);
        const numeric = Number.parseFloat(String(metric.value));
        metric.status = Number.isFinite(numeric) && recorded !== undefined && numeric <= recorded ? "PASS" : metric.status;
      }
    }
  }

  const calibration = [];
  if (!raw.precheck) {
    for (const metric of metrics) {
      if (metric.status === "ERROR") calibration.push({ ruleId: metric.id, kind: "tool-missing", suggestion: `修复或安装工具：${metric.detail}` });
      if (metric.status === "FAIL" || metric.status === "WARN") {
        calibration.push({
          ruleId: metric.id,
          kind: "threshold-or-fix",
          suggestion: `${metric.name}=${metric.value}，阈值 ${metric.threshold}；先修代码，确需调整时用 calibrate --rule ${metric.id} --threshold <值> --reason <依据>`,
        });
      }
    }
  }

  const violationRows = sections.filter((item) => !item.info).reduce((sum, item) => sum + item.rows.length, 0);
  const infoRows = sections.filter((item) => item.info).reduce((sum, item) => sum + item.rows.length, 0);
  const summary = { pass: 0, fail: 0, warn: 0, error: 0, info: 0, skip: 0, violations: violationRows, infoItems: infoRows, findings: filteredViolations.length };
  for (const metric of metrics) {
    const key = metric.status.toLowerCase();
    if (key in summary) summary[key] += 1;
  }
  return {
    schemaVersion: 1,
    reportSchema: "check-report@1",
    scheme: "js-backend",
    command,
    generatedAt: new Date().toISOString(),
    root,
    profile: { revision: profile.revision ?? 1, rulesVersion: profile.rulesVersion ?? DEFAULTS.rulesVersion, path: profilePath },
    precheck: raw.precheck,
    summary,
    tools: toolHealth,
    metrics,
    violations: filteredViolations,
    sections,
    calibration,
  };
}

// ---------- 渲染 ----------
function renderText(result) {
  const lines = [];
  lines.push("id\t指标\t值\t阈值\t状态");
  for (const metric of result.metrics) {
    lines.push(`${metric.id}\t${metric.name}\t${metric.value}\t${metric.threshold}\t${metric.status}`);
  }
  lines.push("\n违规明细（路径:行号 → 详情）：");
  for (const section of result.sections) {
    lines.push(`\n[${section.title}]`);
    for (const row of section.rows) lines.push(`  ${row}`);
  }
  lines.push(
    `\n合计：违规 ${result.summary.violations} 条；PASS ${result.summary.pass} / FAIL ${result.summary.fail} / WARN ${result.summary.warn} / ERROR ${result.summary.error} / INFO ${result.summary.info} / SKIP ${result.summary.skip}`,
  );
  const tools = result.tools;
  lines.push(`工具：${tools.map((tool) => `${tool.name}${tool.ok ? "" : "(失败)"}`).join(", ")}`);
  return lines.join("\n");
}

function output(result, exitCode) {
  if (jsonMode) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${renderText(result)}\n`);
  process.exitCode = exitCode;
}

function computeExit(result, gateMode) {
  if (result.summary.error > 0) return 2;
  if (result.summary.fail > 0) return 1;
  if (gateMode && result.summary.warn > 0) return 1;
  return 0;
}

// ---------- 命令 ----------
function loadBaseline() {
  return readJson(baselinePath);
}

function cmdCheck(mode, gate) {
  const profile = loadProfile();
  const baseline = loadBaseline();
  const raw = collect(profile, mode);
  const result = evaluate(raw, baseline);
  output(result, computeExit(result, gate));
}

function cmdDoctor() {
  const checks = [];
  try {
    const profile = loadProfile();
    checks.push({ name: "profile", ok: true, detail: `${profilePath}（revision ${profile.revision ?? 1}）` });
    checks.push({ name: "tsconfig", ok: true, detail: existsSync(join(root, "tsconfig.json")) ? "tsconfig.json" : "未找到 tsconfig.json，ts-morph 使用默认选项" });
    for (const name of ["oxlint", "knip", "jscpd", "tsc"]) {
      const bin = binPath(name);
      checks.push({ name: `bin:${name}`, ok: bin !== null, detail: bin ?? "未找到" });
    }
    for (const dep of ["ts-morph", "pgsql-ast-parser"]) {
      checks.push({ name: `dep:${dep}`, ok: loadDep(dep) !== null, detail: loadDep(dep) ? "可加载" : "无法加载" });
    }
    const baseline = loadBaseline();
    checks.push({ name: "baseline", ok: baseline !== null, detail: baseline ? `采集于 ${baseline.capturedAt ?? "未知"}` : "缺少 baseline（ratchet 规则按阈值判定）" });
    const scan = readJson(join(root, ".workspace/scan.json"));
    if (scan?.layoutHash && profile.meta?.layoutHash) {
      checks.push({ name: "layout", ok: scan.layoutHash === profile.meta.layoutHash, detail: scan.layoutHash === profile.meta.layoutHash ? "未漂移" : "布局变化，需运行管理态校准" });
    }
  } catch (error) {
    checks.push({ name: "profile", ok: false, detail: String(error) });
  }
  const ok = checks.every((check) => check.ok || check.name === "baseline");
  const result = { schemaVersion: 1, reportSchema: "check-report@1", scheme: "js-backend", command: "doctor", root, ok, checks };
  if (jsonMode) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    for (const check of checks) process.stdout.write(`${check.ok ? "OK" : "FAIL"}\t${check.name}\t${check.detail}\n`);
  }
  process.exitCode = ok ? 0 : 2;
}

function detectForInit() {
  const files = [];
  const sourceCandidates = ["src", "lib", "app", "server"];
  const source = sourceCandidates.filter((dir) => existsSync(join(root, dir)));
  const tests = ["tests", "test", "__tests__"].filter((dir) => existsSync(join(root, dir)));
  const migrations = ["db/migrations", "migrations", "prisma/migrations"].filter((dir) => existsSync(join(root, dir)));
  const entries = ["src/main.ts", "src/index.ts", "index.ts", "main.ts", "server.ts"].filter((file) => existsSync(join(root, file)));
  const layoutHash = hashLayout();
  return {
    schemaVersion: 1,
    revision: 1,
    updated: new Date().toISOString().slice(0, 10),
    rulesVersion: DEFAULTS.rulesVersion,
    paths: { source: source.length ? source : ["src"], tests: tests.length ? tests : ["tests"], migrations: migrations.length ? migrations : ["db/migrations"], entries },
    components: { roots: source.filter((dir) => existsSync(join(root, dir, "components"))).map((dir) => `${dir}/components`) },
    meta: { skillVersion: "v0.1", layoutHash },
  };
}

function hashLayout() {
  const hash = createHash("sha256");
  for (const file of ["package.json", "tsconfig.json", "Cargo.toml", "pom.xml", "bun.lock", "pnpm-lock.yaml", "package-lock.json"]) {
    hash.update(file);
    hash.update(existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : "<missing>");
  }
  return hash.digest("hex");
}

function cmdInit() {
  const existing = readJson(profilePath);
  if (existing && !options.force) {
    process.stderr.write(`profile 已存在：${profilePath}（使用 --force 覆盖）\n`);
    process.exitCode = 1;
    return;
  }
  const draft = detectForInit();
  if (options.write) {
    mkdirSync(dirname(profilePath), { recursive: true });
    writeFileSync(profilePath, `${JSON.stringify(draft, null, 2)}\n`);
    process.stdout.write(`已写入 ${profilePath}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(draft, null, 2)}\n`);
  }
}

function metricValues(result) {
  const values = {};
  for (const metric of result.metrics) {
    const numeric = Number.parseFloat(String(metric.value));
    if (Number.isFinite(numeric)) values[metric.id] = numeric;
  }
  return values;
}

function cmdBaseline() {
  const profile = loadProfile();
  const raw = collect(profile, "full");
  const result = evaluate(raw, null);
  const payload = { schemaVersion: 1, capturedAt: new Date().toISOString(), profileRevision: profile.revision ?? 1, values: metricValues(result) };
  if (options.accept) {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`);
    process.stdout.write(`已写入 ${baselinePath}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

function cmdCalibrate() {
  const profile = loadProfile();
  const raw = collect(profile, "full");
  const result = evaluate(raw, loadBaseline());
  const ruleId = options.rule;
  const threshold = options.threshold;
  if (options.accept) {
    if (!ruleId || threshold === undefined) {
      process.stderr.write("calibrate --accept 需要 --rule <Q-xx> --threshold <值> --reason <依据>\n");
      process.exitCode = 2;
      return;
    }
    if (!options.reason) {
      process.stderr.write("改阈值必须带 --reason，记录前后数据与依据\n");
      process.exitCode = 2;
      return;
    }
    const current = profile.rules[ruleId];
    if (!current) {
      process.stderr.write(`未知规则：${ruleId}\n`);
      process.exitCode = 2;
      return;
    }
    const metric = result.metrics.find((item) => item.id === ruleId);
    const before = current.threshold;
    const next = Number(threshold);
    const project = readJson(profilePath) ?? { schemaVersion: 1, revision: 0 };
    const history = project.history ?? [];
    history.push({ ruleId, before, after: next, reason: String(options.reason), observed: metric?.value ?? null, at: new Date().toISOString() });
    const nextProfile = {
      ...project,
      revision: Number(project.revision ?? 0) + 1,
      updated: new Date().toISOString().slice(0, 10),
      rules: { ...(project.rules ?? {}), [ruleId]: { ...(project.rules?.[ruleId] ?? {}), threshold: next } },
      history,
    };
    writeFileSync(profilePath, `${JSON.stringify(nextProfile, null, 2)}\n`);
    process.stdout.write(`已更新 ${ruleId} 阈值 ${before} → ${next}，revision ${nextProfile.revision}\n`);
    return;
  }
  const suggestions = result.metrics
    .filter((metric) => metric.status === "FAIL" || metric.status === "WARN" || metric.status === "ERROR")
    .map((metric) => ({ ruleId: metric.id, status: metric.status, observed: metric.value, threshold: metric.threshold, level: metric.level }));
  const payload = { schemaVersion: 1, command: "calibrate", profileRevision: profile.revision ?? 1, suggestions };
  if (jsonMode) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else {
    for (const suggestion of suggestions) {
      process.stdout.write(`${suggestion.ruleId}\t${suggestion.status}\t实测 ${suggestion.observed}\t阈值 ${suggestion.threshold}\n`);
    }
  }
}

function cmdTools() {
  const sub = options._[1] ?? "check";
  if (sub === "install") {
    const versions = Object.entries(TOOLS).map(([name, version]) => `${name}@${version}`);
    const npm = run("npm", ["--version"], { cwd: root });
    if (npm.status !== 0) {
      process.stderr.write("未找到 npm，无法安装工具\n");
      process.exitCode = 2;
      return;
    }
    const target = join(stateDir, "tools");
    mkdirSync(target, { recursive: true });
    const install = run("npm", ["install", "--prefix", target, "--no-save", "--no-audit", "--no-fund", ...versions], {
      cwd: root,
      timeoutMs: 600_000,
    });
    if (install.status !== 0) {
      process.stderr.write(`工具安装失败：${(install.stderr || install.stdout).slice(0, 600)}\n`);
      process.exitCode = 2;
      return;
    }
    const lock = { schemaVersion: 1, platform: `${process.platform}-${process.arch}`, installedAt: new Date().toISOString(), tools: TOOLS, binaries: {} };
    for (const name of ["oxlint", "knip", "jscpd", "tsc"]) {
      const bin = join(target, "node_modules", ".bin", name);
      if (existsSync(bin)) {
        lock.binaries[name] = createHash("sha256").update(readFileSync(bin)).digest("hex");
      }
    }
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    process.stdout.write(`已安装到 ${target}\n`);
    return;
  }
  const lock = readJson(lockPath);
  const payload = {
    schemaVersion: 1,
    command: "tools",
    platform: `${process.platform}-${process.arch}`,
    lock: lock ?? null,
    resolved: Object.fromEntries(["oxlint", "knip", "jscpd", "tsc"].map((name) => [name, binPath(name)])),
    dependencies: Object.fromEntries(["ts-morph", "pgsql-ast-parser"].map((name) => [name, loadDep(name) !== null])),
  };
  if (jsonMode) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function cmdExplain() {
  const ruleId = options._[1];
  const profile = loadProfile();
  const rule = profile.rules[ruleId];
  if (!rule) {
    process.stderr.write(`未知规则：${ruleId}\n`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify({ id: ruleId, ...rule }, null, 2)}\n`);
}

function cmdProfileDiff() {
  const project = readJson(profilePath);
  if (project === null) {
    process.stderr.write(`找不到 profile：${profilePath}\n`);
    process.exitCode = 2;
    return;
  }
  const overrides = {};
  for (const [id, override] of Object.entries(project.rules ?? {})) {
    const base = DEFAULTS.rules[id];
    const changed = Object.fromEntries(Object.entries(override).filter(([key, value]) => base?.[key] !== value));
    if (Object.keys(changed).length > 0) overrides[id] = changed;
  }
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, command: "profile-diff", revision: project.revision ?? 1, rulesVersion: project.rulesVersion ?? null, overrides }, null, 2)}\n`);
}

function cmdAdopt() {
  const project = readJson(profilePath);
  if (project === null) {
    process.stderr.write(`找不到 profile：${profilePath}\n`);
    process.exitCode = 2;
    return;
  }
  const adopted = project.rulesVersion ?? null;
  const next = DEFAULTS.rulesVersion;
  const added = Object.keys(DEFAULTS.rules).filter((id) => !(project.rules?.[id] !== undefined));
  const payload = { schemaVersion: 1, command: "adopt", current: adopted, available: next, addedRules: added };
  if (options.accept) {
    const updated = { ...project, rulesVersion: next, revision: Number(project.revision ?? 0) + 1, updated: new Date().toISOString().slice(0, 10) };
    writeFileSync(profilePath, `${JSON.stringify(updated, null, 2)}\n`);
    payload.applied = true;
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

// ---------- 入口 ----------
try {
  if (command === "report") cmdCheck("full", false);
  else if (command === "gate") cmdCheck("full", true);
  else if (command === "precheck") cmdCheck("precheck", false);
  else if (command === "doctor") cmdDoctor();
  else if (command === "init") cmdInit();
  else if (command === "baseline") cmdBaseline();
  else if (command === "calibrate") cmdCalibrate();
  else if (command === "tools") cmdTools();
  else if (command === "explain") cmdExplain();
  else if (command === "profile-diff") cmdProfileDiff();
  else if (command === "adopt") cmdAdopt();
  else {
    process.stderr.write(`未知命令：${command}（report/gate/precheck/doctor/init/baseline/calibrate/tools/explain/profile-diff/adopt）\n`);
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`${String(error?.stack ?? error)}\n`);
  process.exitCode = 2;
}
