// @ts-nocheck -- 诊断脚本，使用第三方 AST/CLI 的宽类型；不参与产品类型约束。
// 产品规则只扫描 src；本文件的 any/! 属于工具实现，不计入 Q-13/Q-14，
// 避免用产品标准要求一个专门做度量的脚本。
import { Project, SyntaxKind } from "ts-morph";
import { parse as parseSql } from "pgsql-ast-parser";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const root = realpathSync(process.cwd());
const srcDir = join(root, "src");
const gatewayDir = join(srcDir, "components/http-gateway");
const mainPath = join(srcDir, "main.ts");
const bunPath = process.versions.bun ? process.execPath : null;
const gate = process.argv.includes("--gate");
const oxlintConfigPath = join(root, ".oxlintrc.json");
const bin = (name: string) =>
  join(root, "node_modules/.bin", process.platform === "win32" ? `${name}.cmd` : name);

type ToolHealth = { name: string; ok: boolean; detail: string };
const toolHealth: ToolHealth[] = [];
function recordTool(name: string, ok: boolean, detail = "") {
  toolHealth.push({ name, ok, detail });
}

function run(
  command: string,
  args: string[],
  timeoutMs = 120_000,
): { status: number; stdout: string; stderr: string; error: string } {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ? String(result.error.message) : "",
  };
}

function parseJson(text: string): { ok: boolean; value: any; error: string } {
  try {
    return { ok: true, value: JSON.parse(text), error: "" };
  } catch (error) {
    return { ok: false, value: null, error: String(error) };
  }
}

function maxOrZero(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function walk(dir: string, predicate: (path: string) => boolean): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path, predicate));
    else if (predicate(path)) out.push(path);
  }
  return out;
}

function normalize(path: string): string {
  return resolve(path);
}

function componentOf(path: string): string {
  const parts = relative(srcDir, path).split(sep);
  if (parts[0] === "components" && parts[1]) return `components/${parts[1]}`;
  if (parts[0] === "core" && parts[1]) return `core/${parts[1]}`;
  return "app";
}

function lineCount(path: string): number {
  const text = readFileSync(path, "utf8");
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

function directExportCount(file: any): number {
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
    const modifiers = (statement as any).getModifiers?.() ?? [];
    if (!modifiers.some((modifier: any) => modifier.getKind() === SyntaxKind.ExportKeyword)) continue;
    if (kind === SyntaxKind.VariableStatement) {
      total += statement
        .asKindOrThrow(SyntaxKind.VariableStatement)
        .getDeclarationList()
        .getDeclarations().length;
    } else {
      total += 1;
    }
  }
  return total;
}

// ---------- oxlint：尺寸、复杂度、类型逃逸 ----------
const expectedOxRules = [
  "max-lines",
  "max-lines-per-function",
  "max-params",
  "max-depth",
  "complexity",
  "typescript/no-explicit-any",
  "typescript/no-non-null-assertion",
  "typescript/ban-ts-comment",
];
const oxConfigExists = existsSync(oxlintConfigPath);
const oxPrint = run(bin("oxlint"), ["--print-config", "-c", oxlintConfigPath, "src/main.ts"]);
const oxPrintJson = parseJson(oxPrint.stdout);
const oxConfiguredRules: string[] = Object.keys(oxPrintJson.value?.rules ?? {});
const missingOxRules = expectedOxRules.filter((rule) => !oxConfiguredRules.includes(rule));
const oxlint = run(bin("oxlint"), [
  "src",
  "--import-plugin",
  "--ignore-pattern",
  "src/components/http-gateway/docs-assets/**",
  "-c",
  oxlintConfigPath,
  "-f",
  "json",
]);
const oxParsed = parseJson(oxlint.stdout);
const oxDiagnostics: any[] = Array.isArray(oxParsed.value?.diagnostics)
  ? oxParsed.value.diagnostics
  : [];
const oxRulesLoaded = Number(oxParsed.value?.number_of_rules ?? 0);
const oxlintOk =
  oxConfigExists &&
  oxPrint.status === 0 &&
  oxPrintJson.ok &&
  missingOxRules.length === 0 &&
  (oxlint.status === 0 || oxlint.status === 1) &&
  oxParsed.ok &&
  oxRulesLoaded > 0;
recordTool(
  "oxlint",
  oxlintOk,
  oxlintOk
    ? `${oxRulesLoaded} 条规则；配置文件已加载`
    : `config=${oxConfigExists} print=${oxPrint.status} rules=${oxRulesLoaded} missing=${missingOxRules.join(",")} parse=${oxParsed.ok} err=${oxlint.error || oxlint.stderr.slice(0, 160)}`,
);
const byCode = new Map<string, any[]>();
for (const diagnostic of oxDiagnostics) {
  const list = byCode.get(diagnostic.code) ?? [];
  list.push(diagnostic);
  byCode.set(diagnostic.code, list);
}
const count = (code: string) => (byCode.get(code) ?? []).length;
const maxReported = (code: string, regex: RegExp): number | null => {
  let max: number | null = null;
  for (const diagnostic of byCode.get(code) ?? []) {
    const match = String(diagnostic.message).match(regex);
    if (match) max = Math.max(max ?? 0, Number(match[1]));
  }
  return max;
};

// ---------- ts-morph：项目与导入图 ----------
const project = new Project({
  tsConfigFilePath: join(root, "tsconfig.json"),
  skipAddingFilesFromTsConfig: true,
});
project.addSourceFilesAtPaths(join(srcDir, "**/*.ts"));
const sourceFiles = project
  .getSourceFiles()
  .filter((file) => normalize(file.getFilePath()).startsWith(srcDir + sep));
const sourceByPath = new Map(sourceFiles.map((file) => [normalize(file.getFilePath()), file]));
const tsMorphOk = sourceFiles.length > 0 && sourceByPath.has(normalize(mainPath));
recordTool(
  "ts-morph",
  tsMorphOk,
  tsMorphOk ? `${sourceFiles.length} 个源文件；main.ts 存在` : "源文件为空或 main.ts 不存在",
);

const graph = new Map<string, Set<string>>();
const unresolvedDynamic: string[] = [];
const importLines = new Map<string, number>();

function resolveLocalSpecifier(fromPath: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromPath), specifier);
  for (const candidate of [base, `${base}.ts`, join(base, "index.ts")]) {
    const normalized = normalize(candidate);
    if (sourceByPath.has(normalized)) return normalized;
  }
  return null;
}

for (const file of sourceFiles) {
  const path = normalize(file.getFilePath());
  const targets = new Set<string>();
  for (const declaration of file.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (!specifier) continue;
    const target = declaration.getModuleSpecifierSourceFile();
    const targetPath = target
      ? normalize(target.getFilePath())
      : resolveLocalSpecifier(path, specifier);
    if (targetPath && sourceByPath.has(targetPath)) targets.add(targetPath);
  }
  for (const declaration of file.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (!specifier) continue;
    const target = declaration.getModuleSpecifierSourceFile();
    const targetPath = target
      ? normalize(target.getFilePath())
      : resolveLocalSpecifier(path, specifier);
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
    const targetPath = resolveLocalSpecifier(path, argument.getLiteralValue());
    if (targetPath) targets.add(targetPath);
  }
  const importNodes: any[] = [
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
    const targetPath = resolveLocalSpecifier(path, specifier);
    if (!targetPath || targetPath === path) continue;
    importLines.set(`${path}|${targetPath}`, specifierNode?.getStartLineNumber?.() ?? 0);
  }
  graph.set(path, targets);
}

// 循环依赖（Tarjan SCC）
const indexOf = new Map<string, number>();
const lowOf = new Map<string, number>();
const stack: string[] = [];
const onStack = new Set<string>();
const sccs: string[][] = [];
let nextIndex = 0;
function strongConnect(node: string) {
  indexOf.set(node, nextIndex);
  lowOf.set(node, nextIndex);
  nextIndex += 1;
  stack.push(node);
  onStack.add(node);
  for (const target of graph.get(node) ?? []) {
    if (!indexOf.has(target)) {
      strongConnect(target);
      lowOf.set(node, Math.min(lowOf.get(node)!, lowOf.get(target)!));
    } else if (onStack.has(target)) {
      lowOf.set(node, Math.min(lowOf.get(node)!, indexOf.get(target)!));
    }
  }
  if (lowOf.get(node) === indexOf.get(node)) {
    const component: string[] = [];
    let current: string;
    do {
      current = stack.pop()!;
      onStack.delete(current);
      component.push(current);
    } while (current !== node);
    if (component.length > 1) sccs.push(component);
  }
}
for (const path of graph.keys()) if (!indexOf.has(path)) strongConnect(path);

// 扇出、深导入
let fanOutMax = 0;
let fanOutFile = "";
let mainFanOut = 0;
const deepImports: string[] = [];
const deepImportDetails: string[] = [];
for (const [path, targets] of graph) {
  const own = componentOf(path);
  const components = new Set<string>();
  for (const target of targets) {
    const other = componentOf(target);
    if (other !== own) components.add(other);
    const pathInComponents = path.startsWith(join(srcDir, "components") + sep) || path === mainPath;
    const targetInComponents = target.startsWith(join(srcDir, "components") + sep);
    if (
      pathInComponents &&
      targetInComponents &&
      other !== own &&
      basename(target) !== "index.ts" &&
      basename(target) !== "contract.ts"
    ) {
      const line = importLines.get(`${path}|${target}`) ?? 0;
      deepImportDetails.push(
        `${relative(root, path)}:${line} 导入 ${relative(root, target)}（绕过 ${other} 的 index.ts）`,
      );
      deepImports.push(`${relative(root, path)} -> ${relative(root, target)}`);
    }
  }
  if (path === mainPath) {
    mainFanOut = components.size;
    continue;
  }
  if (components.size > fanOutMax) {
    fanOutMax = components.size;
    fanOutFile = relative(root, path);
  }
}

// 从 main 可达，找孤儿文件
const reachable = new Set<string>();
const queue = [normalize(join(srcDir, "main.ts"))];
while (queue.length > 0) {
  const current = queue.pop()!;
  if (reachable.has(current)) continue;
  reachable.add(current);
  for (const target of graph.get(current) ?? []) if (!reachable.has(target)) queue.push(target);
}
const orphanFiles = [...graph.keys()].filter((path) => !reachable.has(path));

// 导出数量、函数数量、类方法数、可选字段、路由分支
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
for (const file of sourceFiles) {
  const path = normalize(file.getFilePath());
  const relativePath = relative(root, path);
  const exportCount = directExportCount(file);
  if (exportCount > exportsMax) {
    exportsMax = exportCount;
    exportsFile = relativePath;
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
    functionsFile = relativePath;
  }
  for (const klass of file.getClasses()) {
    const methods = klass.getMethods().length;
    if (methods > classMethodsMax) {
      classMethodsMax = methods;
      classMethodsName = `${relativePath}#${klass.getName() ?? "<anonymous>"}`;
    }
  }
  const considerProperties = (name: string, properties: any[]) => {
    if (properties.length < 5) return;
    if (/^(?:Update|Patch)/.test(name) || /(?:Patch|Query)$/.test(name)) return;
    const optional = properties.filter((property) => property.hasQuestionToken()).length;
    const ratio = optional / properties.length;
    if (ratio > optionalRatioMax) {
      optionalRatioMax = ratio;
      optionalName = `${relativePath}#${name}`;
    }
  };
  for (const declaration of file.getInterfaces()) {
    considerProperties(declaration.getName(), declaration.getProperties());
  }
  for (const declaration of file.getTypeAliases()) {
    const typeNode = declaration.getTypeNode();
    if (typeNode?.getKind() !== SyntaxKind.TypeLiteral) continue;
    considerProperties(
      declaration.getName(),
      typeNode.asKindOrThrow(SyntaxKind.TypeLiteral).getProperties(),
    );
  }
  if (path.startsWith(gatewayDir + sep)) {
    const branches = file
      .getDescendantsOfKind(SyntaxKind.IfStatement)
      .filter((statement) => statement.getExpression().getText().includes("request.method")).length;
    if (branches > routeBranchesMax) {
      routeBranchesMax = branches;
      routeBranchesFile = relativePath;
    }
  }
}

// 重复字符串（长度 >= 5，出现 >= 3 次）
const stringOccurrences = new Map<string, Set<string>>();
for (const file of sourceFiles) {
  const path = relative(root, file.getFilePath());
  for (const literal of file.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    const parent = literal.getParent();
    if (!parent) continue;
    if (
      parent.getKind() === SyntaxKind.ImportDeclaration ||
      parent.getKind() === SyntaxKind.ExportDeclaration
    ) continue;
    const value = literal.getLiteralValue();
    if (value.length < 5) continue;
    if (["string", "number", "boolean", "object", "undefined", "function", "symbol", "bigint"].includes(value)) continue;
    if (parent.getKind() === SyntaxKind.PropertyAssignment && parent.asKindOrThrow(SyntaxKind.PropertyAssignment).getNameNode() === literal) continue;
    if (parent.getKind() === SyntaxKind.PropertySignature && parent.asKindOrThrow(SyntaxKind.PropertySignature).getNameNode() === literal) continue;
    const paths = stringOccurrences.get(value) ?? new Set<string>();
    paths.add(path);
    stringOccurrences.set(value, paths);
  }
}
const duplicateStrings = [...stringOccurrences.entries()]
  .filter(([, paths]) => paths.size >= 3)
  .sort((a, b) => b[1].size - a[1].size);

// env / Bun API / generic Error
const envReads: string[] = [];
const envReadDetails: string[] = [];
const bunOutside: string[] = [];
const consoleOutside: string[] = [];
const bunFileApis = new Set(["Bun.sql", "Bun.file", "Bun.write"]);
const bunAllow: Record<string, string[]> = {
  "Bun.sql": ["src/core/platform/db.ts"],
  "Bun.file": [
    "src/core/config/config.ts",
    "src/core/platform/storage.ts",
    "src/components/http-gateway/docs.ts",
  ],
  "Bun.write": ["src/core/platform/storage.ts"],
};
for (const file of sourceFiles) {
  const path = relative(root, file.getFilePath());
  for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression().getText();
    const line = call.getStartLineNumber();
    if (bunFileApis.has(expression)) {
      const allowed = bunAllow[expression] ?? [];
      if (!allowed.includes(path)) bunOutside.push(`${path}:${line} ${expression}`);
    }
    if (expression.startsWith("console.")) {
      const allowed = path === "src/main.ts" || (path === "src/components/http-gateway/respond.ts" && expression === "console.error");
      if (!allowed) consoleOutside.push(`${path}:${line} ${expression}`);
    }
  }
  for (const access of file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (access.getText() === "process.env") {
      envReads.push(path);
      envReadDetails.push(`${path}:${access.getStartLineNumber()} 读取 process.env`);
    }
  }
}
const envOutsideConfig = [...new Set(envReads)].filter((path) => !path.startsWith("src/core/config/"));
const envOutsideDetails = envReadDetails.filter((item) => !item.startsWith("src/core/config/"));

// TODO / FIXME 与年龄
const todoLines: { path: string; line: number; text: string }[] = [];
for (const file of sourceFiles) {
  const path = relative(root, file.getFilePath());
  const lines = file.getFullText().split("\n");
  lines.forEach((text, index) => {
    if (/\b(TODO|FIXME|HACK)\b/.test(text)) todoLines.push({ path, line: index + 1, text: text.trim() });
  });
}
const todoByFile = new Map<string, Set<number>>();
for (const todo of todoLines) {
  const lines = todoByFile.get(todo.path) ?? new Set<number>();
  lines.add(todo.line);
  todoByFile.set(todo.path, lines);
}
let oldestTodoDays = 0;
let todoAgeError = "";
for (const [path, lines] of todoByFile) {
  const blame = run("git", ["blame", "--line-porcelain", "--", path], 30_000);
  if (blame.error || blame.status !== 0) {
    todoAgeError = `${path}: ${blame.error || blame.stderr.slice(0, 160)}`;
    continue;
  }
  let currentLine = 0;
  for (const line of blame.stdout.split("\n")) {
    const header = line.match(/^[0-9a-f]{40} \d+ (\d+)(?: \d+)?$/);
    if (header) currentLine = Number(header[1]);
    const time = line.match(/^committer-time (\d+)$/);
    if (time && lines.has(currentLine)) {
      oldestTodoDays = Math.max(
        oldestTodoDays,
        Math.floor((Date.now() / 1000 - Number(time[1])) / 86400),
      );
    }
  }
}

// 测试卫生
const testFiles = [
  ...new Set([
    ...walk(join(root, "tests"), (path) => /\.(?:test|spec)\.ts$/.test(path)),
    ...walk(srcDir, (path) => /\.(?:test|spec)\.ts$/.test(path)),
  ]),
];
let weakAssertions = 0;
let skippedTests = 0;
const weakAssertionDetails: string[] = [];
const skippedTestDetails: string[] = [];
function collectMatches(text: string, file: string, pattern: RegExp, sink: string[]) {
  for (const match of text.matchAll(pattern)) {
    const line = text.slice(0, match.index ?? 0).split("\n").length;
    sink.push(`${relative(root, file)}:${line} ${(text.split("\n")[line - 1] ?? "").trim().slice(0, 80)}`);
  }
}
for (const path of testFiles) {
  const text = readFileSync(path, "utf8");
  collectMatches(text, path, /\btoBeDefined\(|\btoBeTruthy\(/g, weakAssertionDetails);
  collectMatches(text, path, /\b(?:test|describe|it)\.skip\(/g, skippedTestDetails);
  weakAssertions += (text.match(/\btoBeDefined\(|\btoBeTruthy\(/g) ?? []).length;
  skippedTests += (text.match(/\b(?:test|describe|it)\.skip\(/g) ?? []).length;
}

// ---------- 外部工具 ----------
const oxCounts = {
  maxFunctionLines: count("eslint(max-lines-per-function)"),
  maxParams: count("eslint(max-params)"),
  maxDepth: count("eslint(max-depth)"),
  complexity: count("eslint(complexity)"),
  any: count("typescript(no-explicit-any)"),
  nonNull: count("typescript(no-non-null-assertion)"),
  tsIgnore: count("typescript(ban-ts-comment)"),
};

const knip = run(bin("knip"), [
  "--include",
  "files,exports,types",
  "--no-progress",
  "--reporter",
  "json",
]);
const knipParsed = parseJson(knip.stdout);
const knipOk =
  (knip.status === 0 || knip.status === 1) &&
  knipParsed.ok &&
  Array.isArray(knipParsed.value?.issues);
let knipIssues: any[] = knipOk ? knipParsed.value.issues : [];
knipIssues = knipIssues.filter((issue) => !String(issue.file).includes("docs-assets"));
const unusedFiles = knipIssues.reduce((sum, issue) => sum + (issue.files?.length ?? 0), 0);
const unusedExports = knipIssues.reduce((sum, issue) => sum + (issue.exports?.length ?? 0), 0);
const unusedTypes = knipIssues.reduce((sum, issue) => sum + (issue.types?.length ?? 0), 0);
recordTool(
  "knip",
  knipOk,
  knipOk ? `${knipIssues.length} 个问题` : `status=${knip.status} parse=${knipParsed.ok} err=${knip.error || knip.stderr.slice(0, 160)}`,
);

const jscpdDir = mkdtempSync(join(tmpdir(), "agentflow-jscpd-"));
const jscpd = run(bin("jscpd"), [
  "src",
  "--format",
  "typescript",
  "--min-lines",
  "8",
  "--min-tokens",
  "70",
  "--reporters",
  "json",
  "--output",
  jscpdDir,
]);
let jscpdStats: any = {};
let jscpdDuplicates: any[] = [];
let jscpdOk = false;
try {
  if (jscpd.error || jscpd.status !== 0) {
    recordTool("jscpd", false, jscpd.error || `status=${jscpd.status} ${jscpd.stderr.slice(0, 160)}`);
  } else {
    const report = parseJson(readFileSync(join(jscpdDir, "jscpd-report.json"), "utf8"));
    if (report.ok && report.value?.statistics?.total) {
      jscpdStats = report.value.statistics.total;
      jscpdDuplicates = report.value.duplicates ?? [];
      jscpdOk = true;
      recordTool("jscpd", true, `${jscpdDuplicates.length} 个克隆块`);
    } else {
      recordTool("jscpd", false, report.error || "报告缺少 statistics.total");
    }
  }
} catch (error) {
  recordTool("jscpd", false, String(error));
} finally {
  rmSync(jscpdDir, { recursive: true, force: true });
}

const openapiTest = run(bunPath ?? "bun", [
  "test",
  "tests/components/http-gateway/openapi-fields.test.ts",
]);
const openapiOutput = `${openapiTest.stdout}\n${openapiTest.stderr}`;
const openapiPass = Number(openapiOutput.match(/(\d+) pass/)?.[1] ?? 0);
const openapiFail = Number(openapiOutput.match(/(\d+) fail/)?.[1] ?? 0);
const openapiMeasured = Boolean(bunPath) && openapiPass + openapiFail > 0;
recordTool(
  "openapi-test",
  openapiMeasured,
  openapiMeasured
    ? `${openapiPass} pass / ${openapiFail} fail`
    : `bun=${Boolean(bunPath)} status=${openapiTest.status} output=${openapiOutput.slice(0, 160)}`,
);

// 类型检查：tsc --noEmit（此前 31 项指标无一覆盖类型错误）
const tsc = run(bin("tsc"), ["--noEmit"], 240_000);
const typeErrors: string[] = [];
let tscOk = false;
if (!existsSync(bin("tsc"))) {
  recordTool("tsc", false, "未找到 node_modules/.bin/tsc");
} else if (tsc.error || (tsc.status !== 0 && tsc.status !== 1) || tsc.stdout.includes("error TS5")) {
  recordTool("tsc", false, `status=${tsc.status} ${tsc.error || tsc.stderr.slice(0, 160)}`);
} else {
  for (const line of tsc.stdout.split("\n")) {
    const match = line.match(/^(.+?)\((\d+),\d+\):\s+(error TS\d+:\s+.+)$/);
    if (match) typeErrors.push(`${match[1]}:${match[2]} ${match[3]}`);
  }
  tscOk = true;
  recordTool("tsc", true, `${typeErrors.length} 个类型错误`);
}

// 表宽度 / 可空列
let tableColumnsMax = 0;
let tableColumnsName = "";
let nullableRatioMax = 0;
let nullableTableName = "";
const sqlFiles = walk(join(root, "db/migrations"), (file) => file.endsWith(".sql"));
const sqlErrors: string[] = [];
const tableStats = new Map<string, { total: number; nullable: number }>();
for (const path of sqlFiles) {
  let ast: any[] = [];
  try {
    ast = parseSql(readFileSync(path, "utf8"));
  } catch (error) {
    sqlErrors.push(`${basename(path)}: ${String(error).slice(0, 120)}`);
    continue;
  }
  for (const statement of ast) {
    if (statement.type !== "create table") continue;
    const name = statement.name?.name ?? basename(path);
    const columns = statement.columns ?? [];
    if (columns.length > tableColumnsMax) {
      tableColumnsMax = columns.length;
      tableColumnsName = name;
    }
    if (columns.length === 0) continue;
    const nullable = columns.filter((column: any) => {
      const constraints = column.constraints ?? [];
      return !constraints.some((constraint: any) =>
        ["not null", "primary key"].includes(constraint.type),
      );
    }).length;
    tableStats.set(name, { total: columns.length, nullable });
  }
  for (const statement of ast) {
    if (statement.type !== "alter table") continue;
    const name = statement.table?.name;
    if (typeof name !== "string") continue;
    const stats = tableStats.get(name);
    if (stats === undefined) continue;
    for (const change of statement.changes ?? []) {
      if (change.type === "alter column" && change.alter?.type === "set not null") {
        stats.nullable = Math.max(0, stats.nullable - 1);
      }
    }
  }
}
for (const [name, stats] of tableStats) {
  const ratio = stats.nullable / stats.total;
  if (ratio > nullableRatioMax) {
    nullableRatioMax = ratio;
    nullableTableName = name;
  }
}
const sqlOk = sqlFiles.length > 0 && sqlErrors.length === 0;
recordTool("pgsql-ast-parser", sqlOk, sqlOk ? `${sqlFiles.length} 个 migration` : sqlErrors.join("; "));

// git 变化
function gitLog(args: string[]): { ok: boolean; stdout: string } {
  const result = run("git", args);
  return { ok: result.status === 0 && !result.error, stdout: result.stdout };
}
const gitProbe = run("git", ["rev-parse", "--is-inside-work-tree"]);
let gitOk = gitProbe.status === 0 && !gitProbe.error;
const commitsResult = gitLog(["log", "-30", "--numstat", "--pretty=format:COMMIT\t%H\t%s"]);
if (!commitsResult.ok) gitOk = false;
const commits = commitsResult.stdout.split("\n");
const touchCounts = new Map<string, number>();
let currentSubject = "";
for (const line of commits) {
  if (line.startsWith("COMMIT\t")) {
    currentSubject = line.split("\t").slice(2).join("\t");
    continue;
  }
  if (!line.trim() || !currentSubject) continue;
  const parts = line.split("\t");
  const file = parts[2];
  if (file?.startsWith("src/")) touchCounts.set(file, (touchCounts.get(file) ?? 0) + 1);
}
const hotspotFiles = [...touchCounts.entries()]
  .filter(([file, touches]) => touches >= 5 && lineCount(join(root, file)) > 300)
  .map(([file, touches]) => `${file} (${touches} 次)`);

const recentResult = gitLog(["log", "--since=90.days", "--numstat", "--pretty=format:COMMIT\t%H\t%s"]);
if (!recentResult.ok) gitOk = false;
const recent = recentResult.stdout.split("\n");
const fixCounts = new Map<string, number>();
const taskCounts = new Map<string, Set<string>>();
let subject = "";
for (const line of recent) {
  if (line.startsWith("COMMIT\t")) {
    subject = line.split("\t").slice(2).join("\t");
    continue;
  }
  if (!line.trim()) continue;
  const file = line.split("\t")[2];
  if (!file?.startsWith("src/")) continue;
  if (subject.startsWith("fix")) fixCounts.set(file, (fixCounts.get(file) ?? 0) + 1);
  const tasks = subject.match(/T-[A-Z0-9-]+/g) ?? [];
  const set = taskCounts.get(file) ?? new Set<string>();
  for (const task of tasks) set.add(task);
  taskCounts.set(file, set);
}
const fixChurn = [...fixCounts.entries()].filter(([, count]) => count >= 3);
const multiTask = [...taskCounts.entries()].filter(([, tasks]) => tasks.size >= 3);

const lastCommitResult = gitLog(["show", "--numstat", "--format=", "HEAD"]);
if (!lastCommitResult.ok) gitOk = false;
const lastCommit = lastCommitResult.stdout.trim().split("\n").filter(Boolean);
let lastCommitLines = 0;
let lastCommitFiles = 0;
for (const line of lastCommit) {
  const [added, deleted] = line.split("\t");
  if (added === "-" || deleted === "-") continue;
  lastCommitLines += Number(added) + Number(deleted);
  lastCommitFiles += 1;
}
recordTool("git", gitOk, gitOk ? "历史可读" : gitProbe.stderr.slice(0, 160));

// ---------- 输出 ----------
const metrics: { id: number; name: string; value: string; threshold: string; status: string; detail?: string }[] = [];
function add(id: number, name: string, value: string, threshold: string, ok: boolean, detail = "", status?: string) {
  metrics.push({ id, name, value, threshold, status: status ?? (ok ? "PASS" : "WARN"), detail });
}
const fileLines = sourceFiles
  .map((file) => ({ file: relative(root, file.getFilePath()), lines: lineCount(file.getFilePath()) }))
  .sort((a, b) => b.lines - a.lines);
const filesOver500 = fileLines.filter((row) => row.lines > 500);
const maxImports = maxOrZero(sourceFiles.map((file) => file.getImportDeclarations().length));
const failedTools = toolHealth.filter((tool) => !tool.ok);
add(
  0,
  "外部工具健康",
  `${toolHealth.length - failedTools.length}/${toolHealth.length}`,
  "全部可用",
  failedTools.length === 0,
  failedTools.map((tool) => `${tool.name}: ${tool.detail}`).join("; "),
  failedTools.length === 0 ? "PASS" : "ERROR",
);
add(
  1,
  "文件行数最大值",
  fileLines[0] ? `${fileLines[0].lines}（${fileLines[0].file}）` : "无源文件",
  "≤600（>500 提醒）",
  tsMorphOk && (fileLines[0]?.lines ?? 0) <= 600,
  `>500 的文件 ${filesOver500.length} 个`,
  tsMorphOk ? undefined : "ERROR",
);
add(
  2,
  "函数行数最大值",
  oxlintOk ? (maxReported("eslint(max-lines-per-function)", /\((\d+)\)/)?.toString() ?? "0（无超限）") : "无法测量",
  "≤80",
  oxlintOk && oxCounts.maxFunctionLines === 0,
  "物理行；oxlint 配置已自检",
  oxlintOk ? undefined : "ERROR",
);
add(
  3,
  "函数参数最大值",
  oxlintOk ? (maxReported("eslint(max-params)", /\((\d+)\)/)?.toString() ?? "0（无超限）") : "无法测量",
  "≤5",
  oxlintOk && oxCounts.maxParams === 0,
  "",
  oxlintOk ? undefined : "ERROR",
);
add(
  4,
  "嵌套深度最大值",
  oxlintOk ? (maxReported("eslint(max-depth)", /\((\d+)\)/)?.toString() ?? "0（无超限）") : "无法测量",
  "≤4",
  oxlintOk && oxCounts.maxDepth === 0,
  "",
  oxlintOk ? undefined : "ERROR",
);
add(
  5,
  "圈复杂度最大值",
  oxlintOk ? (maxReported("eslint(complexity)", /complexity of (\d+)/)?.toString() ?? "0（无超限）") : "无法测量",
  "≤15",
  oxlintOk && oxCounts.complexity === 0,
  "",
  oxlintOk ? undefined : "ERROR",
);
add(
  6,
  "单文件直接导出最大值（含类型/默认导出，排除 re-export）",
  `${exportsMax}（${exportsFile}）`,
  "≤20",
  tsMorphOk && exportsMax <= 20,
  "",
  tsMorphOk ? undefined : "ERROR",
);
add(
  7,
  "单文件 import 最大值",
  String(maxImports),
  "≤20",
  tsMorphOk && maxImports <= 20,
  "",
  tsMorphOk ? undefined : "ERROR",
);
add(
  8,
  "单文件函数数量最大值（含箭头函数）",
  `${functionsMax}（${functionsFile}）`,
  "≤20",
  tsMorphOk && functionsMax <= 20,
  "",
  tsMorphOk ? undefined : "ERROR",
);
add(
  9,
  "组件扇出最大值（排除 main）",
  `${fanOutMax}（${fanOutFile}）`,
  "≤8",
  tsMorphOk && fanOutMax <= 8,
  `main 组合根扇出 ${mainFanOut}`,
  tsMorphOk ? undefined : "ERROR",
);
add(
  10,
  "跨组件深导入",
  String(deepImports.length),
  "0",
  tsMorphOk && deepImports.length === 0,
  deepImports.slice(0, 5).join("; "),
  tsMorphOk ? undefined : "ERROR",
);
add(
  11,
  "循环依赖 SCC",
  String(sccs.length),
  "0",
  tsMorphOk && sccs.length === 0,
  sccs.map((scc) => scc.map((path) => relative(root, path)).join(" ↔ ")).slice(0, 3).join("; "),
  tsMorphOk ? undefined : "ERROR",
);
add(
  12,
  "孤儿文件",
  String(orphanFiles.length),
  "0",
  tsMorphOk && unresolvedDynamic.length === 0 && orphanFiles.length === 0,
  unresolvedDynamic.length > 0
    ? `动态导入无法解析: ${unresolvedDynamic.slice(0, 5).join("; ")}`
    : orphanFiles.map((path) => relative(root, path)).slice(0, 5).join("; "),
  tsMorphOk && unresolvedDynamic.length === 0 ? undefined : "ERROR",
);
add(
  13,
  "孤儿运行时导出（knip）",
  knipOk ? String(unusedExports) : "无法测量",
  "0",
  knipOk && unusedExports === 0,
  knipOk
    ? `未使用类型 ${unusedTypes}（多为 barrel 再导出，仅报告）: ${knipIssues.flatMap((issue) => [...(issue.exports ?? []), ...(issue.types ?? [])].map((item) => `${issue.file}#${item.name ?? item}`)).slice(0, 8).join("; ")}`
    : "knip 未返回可解析的 issues",
  knipOk ? undefined : "ERROR",
);
add(
  14,
  "单类方法数最大值",
  `${classMethodsMax}（${classMethodsName}）`,
  "≤10",
  tsMorphOk && classMethodsMax <= 10,
  "",
  tsMorphOk ? undefined : "ERROR",
);
add(
  15,
  "重复字符串组（跨 ≥3 个文件）",
  String(duplicateStrings.length),
  "报告（噪声高）",
  tsMorphOk,
  duplicateStrings.slice(0, 3).map(([value, paths]) => `"${value}"×${paths.size} 文件`).join("; "),
  tsMorphOk ? "INFO" : "ERROR",
);
add(
  16,
  "克隆块",
  jscpdOk ? `${jscpdStats.clones ?? 0} 块 / ${Number(jscpdStats.percentage ?? 0).toFixed(2)}%` : "无法测量",
  "0",
  jscpdOk && (jscpdStats.clones ?? 0) === 0,
  "",
  jscpdOk ? undefined : "ERROR",
);
add(17, "any 使用", oxlintOk ? String(oxCounts.any) : "无法测量", "0", oxlintOk && oxCounts.any === 0, "", oxlintOk ? undefined : "ERROR");
add(18, "ts-ignore/ts-expect-error", oxlintOk ? String(oxCounts.tsIgnore) : "无法测量", "0", oxlintOk && oxCounts.tsIgnore === 0, "", oxlintOk ? undefined : "ERROR");
add(19, "非空断言 !", oxlintOk ? String(oxCounts.nonNull) : "无法测量", "0", oxlintOk && oxCounts.nonNull === 0, "", oxlintOk ? undefined : "ERROR");
add(
  20,
  "可选字段比例最大值",
  `${(optionalRatioMax * 100).toFixed(1)}%（${optionalName}）`,
  "≤30%",
  tsMorphOk && optionalRatioMax <= 0.3,
  "",
  tsMorphOk ? undefined : "ERROR",
);
add(
  21,
  "路由方法分支最大值",
  `${routeBranchesMax}（${routeBranchesFile}）`,
  "≤12",
  tsMorphOk && routeBranchesMax <= 12,
  "按 IfStatement 计数，避免 && 重复计数",
  tsMorphOk ? undefined : "ERROR",
);
add(
  22,
  "OpenAPI/DTO 字段测试",
  openapiMeasured ? `${openapiPass} pass / ${openapiFail} fail` : "无法解析测试输出",
  "0 fail",
  openapiMeasured && openapiTest.status === 0 && openapiFail === 0,
  openapiMeasured
    ? openapiTest.status === 0
      ? ""
      : `测试进程退出 ${openapiTest.status}，不能只看 pass 计数`
    : openapiOutput.slice(0, 300),
  openapiMeasured ? undefined : "ERROR",
);
add(
  23,
  "表最大列数",
  sqlOk ? `${tableColumnsMax}（${tableColumnsName}）` : "无法解析 migration",
  "≤20",
  sqlOk && tableColumnsMax <= 20,
  sqlErrors.join("; "),
  sqlOk ? undefined : "ERROR",
);
add(
  24,
  "可空列比例最大值",
  sqlOk ? `${(nullableRatioMax * 100).toFixed(1)}%（${nullableTableName}）` : "无法解析 migration",
  "≤50%",
  sqlOk && nullableRatioMax <= 0.5,
  "",
  sqlOk ? undefined : "ERROR",
);
add(25, "非入口 console 调用", tsMorphOk ? String(consoleOutside.length) : "无法测量", "0", tsMorphOk && consoleOutside.length === 0, consoleOutside.slice(0, 5).join("; "), tsMorphOk ? undefined : "ERROR");
add(26, "配置外 process.env", tsMorphOk ? String(envOutsideConfig.length) : "无法测量", "0", tsMorphOk && envOutsideConfig.length === 0, envOutsideConfig.slice(0, 5).join("; "), tsMorphOk ? undefined : "ERROR");
add(27, "Bun 文件/SQL API 越界", tsMorphOk ? String(bunOutside.length) : "无法测量", "0", tsMorphOk && bunOutside.length === 0, bunOutside.slice(0, 5).join("; "), tsMorphOk ? undefined : "ERROR");
add(
  28,
  "TODO/FIXME 债务",
  `${todoLines.length} 处，最老 ${oldestTodoDays} 天`,
  "≤90 天",
  !todoAgeError && oldestTodoDays <= 90,
  todoAgeError ? `git blame 失败: ${todoAgeError}` : "",
  todoAgeError ? "ERROR" : undefined,
);
add(
  29,
  "弱断言 / skip",
  testFiles.length === 0 ? "未找到测试文件" : `${weakAssertions} / ${skippedTests}`,
  "0 / 0",
  testFiles.length > 0 && weakAssertions === 0 && skippedTests === 0,
  testFiles.length === 0 ? "tests/ 与 src/ 均未找到 *.test.ts / *.spec.ts" : "",
  testFiles.length === 0 ? "ERROR" : undefined,
);
add(
  30,
  "git 变化信号",
  gitOk
    ? `hotspot ${hotspotFiles.length}；fix churn ${fixChurn.length}；多任务 ${multiTask.length}；上次 commit ${lastCommitLines} 行/${lastCommitFiles} 文件`
    : "无法读取 git 历史",
  "仅报告",
  true,
  gitOk
    ? `多任务示例: ${multiTask.slice(0, 5).map(([file, tasks]) => `${file}(${tasks.size} 任务)`).join("; ")}`
    : gitProbe.stderr.slice(0, 300),
  gitOk ? "INFO" : "ERROR",
);

add(
  31,
  "类型错误（tsc --noEmit）",
  tscOk ? String(typeErrors.length) : "无法测量",
  "0",
  tscOk && typeErrors.length === 0,
  "",
  tscOk ? undefined : "ERROR",
);

console.log("id\t指标\t值\t阈值\t状态");
for (const metric of metrics) {
  console.log(`${metric.id}\t${metric.name}\t${metric.value}\t${metric.threshold}\t${metric.status}${metric.detail ? `\t${metric.detail}` : ""}`);
}

// ---------- 违规明细：每条违规一行「路径:行号 → 详情」，不截断 ----------
type ViolationSection = { title: string; rows: string[]; info?: boolean };
const sections: ViolationSection[] = [];
function section(title: string, rows: string[], info = false) {
  if (rows.length > 0) sections.push({ title, rows, info });
}

type OxSection = [code: string, label: string, unit: string, fallbackLimit?: string, snippetOnly?: boolean];
const oxSections: OxSection[] = [
  ["eslint(max-lines)", "文件行数超限", "行", "600"],
  ["eslint(max-lines-per-function)", "函数行数超限", "行"],
  ["eslint(max-params)", "函数参数超限", "个参数"],
  ["eslint(max-depth)", "嵌套深度超限", "层"],
  ["eslint(complexity)", "圈复杂度超限", ""],
  ["typescript(no-explicit-any)", "显式 any", "", undefined, true],
  ["typescript(no-non-null-assertion)", "非空断言 !", "", undefined, true],
  ["typescript(ban-ts-comment)", "ts-ignore / ts-expect-error", "", undefined, true],
];
const cleanName = (head: string) =>
  head.includes("has ") ||
  head.includes(" at ") ||
  head.length > 40 ||
  /^(File|Function|Blocks|The)$/.test(head)
    ? ""
    : head;
const ruleName = (text: string) => {
  const head = text
    .replace(/^The /, "")
    .replace(/^(?:async |function |method )+/, "")
    .split(" has ")[0];
  return cleanName(head);
};
const limitOf = (text: string) => String(text).match(/Maximum allowed is (\d+(?:\.\d+)?)/)?.[1] ?? "";
const valueOf = (text: string) =>
  String(text).match(/\((\d+(?:\.\d+)?)\)/)?.[1] ?? String(text).match(/complexity of (\d+(?:\.\d+)?)/)?.[1] ?? "";
const snippetCache = new Map<string, string[]>();
function snippetOf(file: string, line: number): string {
  if (!file) return "";
  const absolute = join(root, file);
  if (!snippetCache.has(absolute)) {
    try {
      snippetCache.set(absolute, readFileSync(absolute, "utf8").split("\n"));
    } catch {
      snippetCache.set(absolute, []);
    }
  }
  return (snippetCache.get(absolute)?.[line - 1] ?? "").trim().slice(0, 90);
}
for (const [code, label, unit, fallbackLimit, snippetOnly] of oxSections) {
  const numeric = !snippetOnly && (unit !== "" || code === "eslint(complexity)");
  const rows = (byCode.get(code) ?? [])
    .map((d) => {
      const name = numeric
        ? ruleName(String(d.message))
        : snippetOnly
          ? ""
          : cleanName(String(d.message).split(" at ")[0]);
      const file = String(d.filename ?? "");
      const line = Number(d.labels?.[0]?.span?.line ?? 0);
      const value = valueOf(String(d.message));
      const limit = limitOf(String(d.message)) || (fallbackLimit ?? "");
      const tail = numeric
        ? value && limit
          ? `  实测 ${value}${unit}（限 ${limit}${unit}）`
          : value
            ? `  实测 ${value}${unit}`
            : ""
        : `  ${snippetOf(file, line)}`;
      return { file, line, name, sortValue: Number(value || 0), tail };
    })
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
    .map((row) => `${row.file}:${row.line}  ${row.name}${row.tail}`.trimEnd());
  section(`${label}（${rows.length} 处）`, rows);
}

section(
  `类型错误（${typeErrors.length} 处）`,
  [...typeErrors].sort((a, b) => a.localeCompare(b)),
);
section(
  `文件超过 500 行（${fileLines.filter((row) => row.lines > 500).length} 个）`,
  fileLines
    .filter((row) => row.lines > 500)
    .map((row) => `${row.file}:1  ${row.lines} 行`),
);
section(
  `跨组件深导入（${deepImportDetails.length} 处）`,
  [...deepImportDetails].sort((a, b) => a.localeCompare(b)),
);
section(
  `孤儿文件（${orphanFiles.length} 个，从 main.ts 不可达）`,
  orphanFiles.map((path) => `${relative(root, path)}:1`).sort((a, b) => a.localeCompare(b)),
);
section(
  `循环依赖（${sccs.length} 组）`,
  sccs.map((scc) => scc.map((path) => relative(root, path)).join(" ↔ ")),
);
section(
  `动态导入未解析（${unresolvedDynamic.length} 处）`,
  [...unresolvedDynamic].sort((a, b) => a.localeCompare(b)),
);
section(
  `knip 未被引用的文件（${unusedFiles} 个）`,
  knipIssues
    .flatMap((issue) => (issue.files ?? []).map((item: any) => `${issue.file}:1  ${typeof item === "string" ? "文件未被引用" : item.reason ?? ""}`.trimEnd()))
    .sort((a, b) => a.localeCompare(b)),
);
section(
  `knip 孤儿运行时导出（${unusedExports} 个）`,
  knipIssues
    .flatMap((issue) => (issue.exports ?? []).map((item: any) => `${issue.file}:${item.line ?? 1}  ${item.name ?? item}`))
    .sort((a, b) => a.localeCompare(b)),
);
section(
  `knip 孤儿类型（${unusedTypes} 个，仅报告）`,
  knipIssues
    .flatMap((issue) => (issue.types ?? []).map((item: any) => `${issue.file}:${item.line ?? 1}  ${item.name ?? item}`))
    .sort((a, b) => a.localeCompare(b)),
  true,
);
section(
  `克隆块（${jscpdDuplicates.length} 个）`,
  jscpdDuplicates.map(
    (clone) =>
      `${clone.firstFile?.name}:${clone.firstFile?.start ?? 0} ↔ ${clone.secondFile?.name}:${clone.secondFile?.start ?? 0}  ${clone.lines ?? "?"} 行 ${clone.tokens ?? "?"} tokens`,
  ),
);
section(
  `非入口 console 调用（${consoleOutside.length} 处）`,
  [...consoleOutside].sort((a, b) => a.localeCompare(b)),
);
section(
  `配置外 process.env（${envOutsideDetails.length} 处）`,
  [...envOutsideDetails].sort((a, b) => a.localeCompare(b)),
);
section(
  `Bun 文件/SQL API 越界（${bunOutside.length} 处）`,
  [...bunOutside].sort((a, b) => a.localeCompare(b)),
);
section(
  `TODO / FIXME（${todoLines.length} 处，年龄见指标 28）`,
  todoLines.map((todo) => `${todo.path}:${todo.line}  ${todo.text.slice(0, 90)}`),
  true,
);
section(
  `弱断言 toBeDefined/toBeTruthy（${weakAssertionDetails.length} 处）`,
  [...weakAssertionDetails].sort((a, b) => a.localeCompare(b)),
);
section(
  `skip 的测试（${skippedTestDetails.length} 处）`,
  [...skippedTestDetails].sort((a, b) => a.localeCompare(b)),
);
section(
  `migration 解析失败（${sqlErrors.length} 个）`,
  sqlErrors.map((err) => `db/migrations  ${err}`),
);
section(
  `重复字符串组（跨 ≥3 文件，${duplicateStrings.length} 组，仅报告）`,
  duplicateStrings
    .map(([value, paths]) => `${Array.from(paths).sort((a, b) => a.localeCompare(b)).slice(0, 3).join(", ")}${paths.size > 3 ? ` 等${paths.size}个文件` : ""}  "${value}"`)
    .slice(0, 50),
  true,
);
section(
  `git 变化信号（仅报告）`,
  [
    ...hotspotFiles.map((item) => `热点 ${item}`),
    ...fixChurn.map(([file, times]) => `fix 反复 ${file}（${times} 次）`),
    ...multiTask.map(([file, tasks]) => `多任务 ${file}（${tasks.size} 个任务）`),
  ],
  true,
);

console.log(`\n违规明细（每条一行 路径:行号 → 详情）：`);
let violationTotal = 0;
let infoTotal = 0;
for (const item of sections) {
  console.log(`\n[${item.title}]`);
  for (const row of item.rows) console.log(`  ${row}`);
  if (item.info) infoTotal += item.rows.length;
  else violationTotal += item.rows.length;
}
console.log(
  `\n合计：违规 ${violationTotal} 条；仅报告 ${infoTotal} 条；规则分组 ${sections.length} 组；工具健康 ${toolHealth.length - failedTools.length}/${toolHealth.length}`,
);
console.log(
  `工具：oxlint, tsc, knip, jscpd, ts-morph, pgsql-ast-parser, git, OpenAPI 测试（oxlint diagnostics=${oxDiagnostics.length}; knip issues=${knipIssues.length}; jscpd=${jscpdStats.clones ?? 0}/${Number(jscpdStats.percentage ?? 0).toFixed(2)}%）`
);

const errors = metrics.filter((metric) => metric.status === "ERROR");
const warnings = metrics.filter((metric) => metric.status === "WARN");
if (errors.length > 0) {
  console.error(`质量报告不可信：${errors.length} 项 ERROR（${errors.map((metric) => metric.name).join("、")}）`);
  process.exitCode = 2;
} else if (gate && warnings.length > 0) {
  console.error(`质量门禁失败：${warnings.length} 项 WARN（使用 --gate）`);
  process.exitCode = 1;
}
