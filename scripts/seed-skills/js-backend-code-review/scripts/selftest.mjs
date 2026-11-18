#!/usr/bin/env node
// 固定夹具自检：不依赖被测仓库，只验证引擎在坏样本上能命中预期规则。
// 用法：node scripts/selftest.mjs
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const review = join(SCRIPTS_DIR, "review.mjs");
const fixture = join(SCRIPTS_DIR, "..", "references", "fixtures", "bad");
const profile = join(SCRIPTS_DIR, "..", "references", "fixtures", "bad-profile.json");

const result = spawnSync(
  process.execPath,
  [review, "precheck", "--root", fixture, "--profile", profile, "--json"],
  { encoding: "utf8", timeout: 120_000 },
);
const report = (() => {
  const start = result.stdout.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(result.stdout.slice(start));
  } catch {
    return null;
  }
})();

const failures = [];
const checks = [];
const expect = (label, condition) => {
  checks.push({ label, ok: Boolean(condition) });
  if (!condition) failures.push(label);
};

expect("precheck 退出码为 1（存在 FAIL）", result.status === 1);
expect("输出可解析为 check-report@1", report?.reportSchema === "check-report@1");
expect("工具无 ERROR", (report?.summary?.error ?? 1) === 0);
const statusOf = (id) => report?.metrics?.find((metric) => metric.id === id)?.status;
for (const [id, expected] of [
  ["Q-01", "FAIL"],
  ["Q-02", "FAIL"],
  ["Q-06", "FAIL"],
  ["Q-07", "FAIL"],
  ["Q-08", "FAIL"],
  ["Q-13", "FAIL"],
  ["Q-14", "FAIL"],
  ["Q-21", "FAIL"],
  ["Q-22", "FAIL"],
  ["Q-23", "FAIL"],
  ["Q-25", "FAIL"],
]) {
  expect(`${id} 应为 ${expected}（实际 ${statusOf(id)}）`, statusOf(id) === expected);
}
expect("Q-03 应通过（参数未超限）", statusOf("Q-03") === "PASS");
expect("Q-16 不应为 ERROR", statusOf("Q-16") !== "ERROR");
expect("违规明细非空", (report?.summary?.violations ?? 0) > 0 || (report?.violations ?? []).length > 0);

for (const check of checks) process.stdout.write(`${check.ok ? "PASS" : "FAIL"}  ${check.label}\n`);
process.stdout.write(`\n${checks.length - failures.length}/${checks.length} 项通过\n`);
if (failures.length > 0) {
  process.stderr.write(`\n未通过：\n${failures.map((item) => `- ${item}`).join("\n")}\n`);
  process.exitCode = 1;
}
