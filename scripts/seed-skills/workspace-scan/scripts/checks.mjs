// 检查方案调度：发现已安装的 check scheme，按工作区事实决定启用，
// 并统一调用各方案的 doctor/precheck/report/gate/calibrate，聚合为 check-report@1。
// 本文件不认识任何语言规则；新增语言只需新增带 scripts/scheme.json 的技能包。
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isFile,
  matchesAny,
  parseArgs,
  readJson,
  run,
  walkFiles,
} from "./lib.mjs";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const defaultSkillsDir = join(SCRIPTS_DIR, "..", "..");
const CHECKS_FILE = ".workspace/checks.json";

function listSchemeManifests(skillsDir) {
  const manifests = [];
  let entries;
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return manifests;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(skillsDir, entry.name, "scripts", "scheme.json");
    const manifest = isFile(manifestPath) ? readJson(manifestPath) : null;
    if (manifest) manifests.push({ directory: join(skillsDir, entry.name), slug: entry.name, manifest });
  }
  return manifests;
}

function evaluateApplies(manifest, root, files) {
  const appliesTo = manifest.appliesTo ?? {};
  const reasons = [];
  if (Array.isArray(appliesTo.requires)) {
    for (const file of appliesTo.requires) {
      if (!isFile(join(root, file))) reasons.push(`缺少 ${file}`);
    }
  }
  const any = appliesTo.any ?? [];
  if (any.length > 0 && !files.some((file) => matchesAny(file, any))) {
    reasons.push(`没有文件匹配 ${any.join(", ")}`);
  }
  const not = appliesTo.not ?? [];
  const blocked = files.filter((file) => matchesAny(file, not));
  if (blocked.length > 0) reasons.push(`存在不适用文件，例如 ${blocked.slice(0, 3).join(", ")}`);
  return { applies: reasons.length === 0, reasons };
}

function loadChecks(root) {
  return readJson(join(root, CHECKS_FILE));
}

function resolveEnabled(root, skillsDir) {
  const files = walkFiles(root);
  const discovered = listSchemeManifests(skillsDir).map((entry) => {
    const evaluated = evaluateApplies(entry.manifest, root, files);
    return { ...entry, ...evaluated };
  });
  const saved = loadChecks(root);
  const enabledIds = new Set(
    (saved?.schemes ?? []).filter((scheme) => scheme.enabled !== false).map((scheme) => scheme.id),
  );
  const enabled = discovered.filter((entry) =>
    saved === null ? entry.applies : enabledIds.has(entry.manifest.id),
  );
  return { files, discovered, enabled };
}

function commandArgs(manifest, command, options) {
  const template = manifest.commands?.[command];
  if (!Array.isArray(template)) return null;
  const args = [...template];
  if (options.changed && !args.includes("--changed")) args.push("--changed");
  if (options.json && !args.includes("--json")) args.push("--json");
  return args;
}

function invoke(entry, command, options, root, skillsDir) {
  const args = commandArgs(entry.manifest, command, options);
  if (args === null) return { status: 3, stdout: "", stderr: `方案 ${entry.manifest.id} 未提供 ${command} 命令`, error: "" };
  const entryPath = join(entry.directory, entry.manifest.entry ?? "scripts/review.mjs");
  const stateDir = join(root, entry.manifest.stateDir ?? `.workspace/checks/${entry.manifest.id}`);
  const timeout = command === "precheck" || command === "doctor" ? 120_000 : 600_000;
  return run(
    process.execPath,
    [
      entryPath,
      ...args,
      "--root",
      root,
      "--skills-dir",
      skillsDir,
      "--state-dir",
      stateDir,
      ...(options.profile ? ["--profile", String(options.profile)] : []),
      ...(options["state-dir"] ? ["--state-dir", String(options["state-dir"])] : []),
      ...(options.reason ? ["--reason", String(options.reason)] : []),
      ...(options.accept ? ["--accept"] : []),
    ],
    { cwd: root, timeoutMs: timeout },
  );
}

function parseChildOutput(child) {
  const text = child.stdout.trim();
  const start = text.indexOf("{");
  if (start >= 0) {
    try {
      return JSON.parse(text.slice(start));
    } catch {
      // 继续走错误分支
    }
  }
  return null;
}

function aggregate(command, root, enabled, options) {
  const results = [];
  for (const entry of enabled) {
    const child = invoke(entry, command, options, root, options.skillsDir);
    const parsed = parseChildOutput(child);
    results.push({
      scheme: entry.manifest.id,
      slug: entry.slug,
      version: entry.manifest.version ?? null,
      exitCode: child.status,
      ok: child.status === 0,
      result: parsed,
      ...(parsed ? {} : { stdout: child.stdout.slice(0, 4000), stderr: child.stderr.slice(0, 4000) }),
    });
  }
  const summary = { pass: 0, fail: 0, warn: 0, error: 0, info: 0, skip: 0, violations: 0 };
  for (const item of results) {
    const childSummary = item.result?.summary;
    if (childSummary) {
      for (const key of Object.keys(summary)) summary[key] += Number(childSummary[key] ?? 0);
    }
    if (item.exitCode === 2) summary.error += 1;
  }
  const exitCode = results.some((item) => item.exitCode === 2)
    ? 2
    : results.some((item) => item.exitCode === 1)
      ? 1
      : 0;
  return {
    schemaVersion: 1,
    reportSchema: "check-report@1",
    command,
    generatedAt: new Date().toISOString(),
    root,
    schemes: results,
    summary,
    exitCode,
  };
}

function discoverOutput(entry, root) {
  const files = walkFiles(root);
  return {
    id: entry.manifest.id,
    slug: entry.slug,
    displayName: entry.manifest.displayName ?? entry.manifest.id,
    version: entry.manifest.version ?? null,
    stacks: entry.manifest.stacks ?? [],
    applies: entry.applies,
    reasons: entry.reasons,
    stateDir: entry.manifest.stateDir ?? `.workspace/checks/${entry.manifest.id}`,
  };
}

function writeChecks(root, schemes) {
  mkdirSync(join(root, ".workspace"), { recursive: true });
  const existing = loadChecks(root);
  const next = {
    schemaVersion: 1,
    revision: (existing?.revision ?? 0) + 1,
    updatedAt: new Date().toISOString(),
    schemes,
  };
  writeFileSync(join(root, CHECKS_FILE), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const command = options._[0] ?? "discover";
  const root = options.root ? String(options.root) : process.cwd();
  const skillsDir = options["skills-dir"] ? String(options["skills-dir"]) : defaultSkillsDir;
  options.skillsDir = skillsDir;
  const resolved = resolveEnabled(root, skillsDir);

  if (command === "discover") {
    const output = {
      schemaVersion: 1,
      command: "discover",
      root,
      schemes: resolved.discovered.map((entry) => discoverOutput(entry, root)),
      enabled: resolved.enabled.map((entry) => entry.manifest.id),
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (command === "enable" || command === "disable") {
    const id = options._[1];
    if (!id) {
      process.stderr.write("用法：checks.mjs enable|disable <scheme-id>\n");
      process.exitCode = 2;
      return;
    }
    const known = resolved.discovered.find((entry) => entry.manifest.id === id);
    if (!known) {
      process.stderr.write(`未知检查方案：${id}\n`);
      process.exitCode = 2;
      return;
    }
    const existing = loadChecks(root)?.schemes ?? resolved.discovered.map((entry) => ({
      id: entry.manifest.id,
      slug: entry.slug,
      enabled: entry.applies,
    }));
    const schemes = existing.map((scheme) =>
      scheme.id === id ? { ...scheme, enabled: command === "enable" } : scheme,
    );
    const written = writeChecks(root, schemes);
    process.stdout.write(`${JSON.stringify(written, null, 2)}\n`);
    return;
  }

  if (command === "status") {
    const output = {
      schemaVersion: 1,
      command: "status",
      root,
      schemes: resolved.discovered.map((entry) => ({
        ...discoverOutput(entry, root),
        enabled: resolved.enabled.some((item) => item.manifest.id === entry.manifest.id),
      })),
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  const delegated = new Set(["doctor", "precheck", "report", "gate", "calibrate"]);
  if (!delegated.has(command)) {
    process.stderr.write(`未知命令：${command}（discover/enable/disable/status/doctor/precheck/report/gate/calibrate）\n`);
    process.exitCode = 2;
    return;
  }
  if (resolved.enabled.length === 0) {
    process.stderr.write("没有可用的检查方案：先运行 discover，并用 enable 启用适用的方案。\n");
    process.exitCode = 2;
    return;
  }
  const output = aggregate(command, root, resolved.enabled, options);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = output.exitCode;
}

main();
