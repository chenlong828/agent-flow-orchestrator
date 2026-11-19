#!/usr/bin/env bun
/**
 * orchestrator 常驻托管（本机联调 / 调试）。
 *
 * 与 client 的 serve-bg 对齐：start 会拉起一个监督进程，监督进程再启动
 * `bun run src/main.ts`；服务被 kill 后自动拉起。所有运行文件放在 `.local/`：
 *   .local/run/orchestrator.pid  监督进程与子进程信息
 *   .local/logs/orchestrator.out 服务 stdout/stderr
 *   .local/logs/supervise.out    监督事件与退出码
 *
 * 用法（在系统终端执行）：
 *   ./scripts/start-dev.sh start
 *   ./scripts/start-dev.sh status
 *   ./scripts/start-dev.sh logs --follow
 *   ./scripts/start-dev.sh reload
 *   ./scripts/start-dev.sh stop
 *   ./scripts/start-dev.sh restart
 *
 * 直接调用：
 *   bun run scripts/start-bg.ts start [--url http://127.0.0.1:3100]
 */
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, closeSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const RUN_DIR = join(ROOT, ".local", "run");
const LOG_DIR = join(ROOT, ".local", "logs");
const PID_PATH = join(RUN_DIR, "orchestrator.pid");
const LOG_PATH = join(LOG_DIR, "orchestrator.out");
const SUPERVISE_LOG = join(LOG_DIR, "supervise.out");
const SCRIPT = join(ROOT, "scripts", "start-bg.ts");
const DEFAULT_URL = "http://127.0.0.1:3100";
const START_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 20_000;
const FAST_FAIL_MS = 3_000;
const MAX_BACKOFF_MS = 30_000;

type Command = "start" | "stop" | "status" | "logs" | "reload" | "restart" | "supervise" | "help";
type PidInfo = {
  pid: number;
  mode: "supervise";
  childPid: number | null;
  startedAt: string;
  url: string;
  logPath: string;
  restarts: number;
  lastExitCode: number | null;
  lastExitAt: string | null;
};

class UsageError extends Error {}

function help(): void {
  console.log(`orchestrator 常驻托管

用法：
  bun run scripts/start-bg.ts <command> [options]

命令：
  start     后台启动；服务被 kill 后自动拉起
  status    查看监督进程、服务进程、重启次数与 /healthz
  logs      查看服务日志；--follow 持续跟踪；--lines 指定行数（默认 50）
  reload    让监督进程立即重启服务
  stop      停止监督进程与服务；--force 强制
  restart   先 stop 再 start

选项：
  --url <url>   健康检查地址，默认 ${DEFAULT_URL}
  --lines <n>   logs 行数，默认 50
  --follow      logs 持续跟踪
  --force       stop 时强制
`);
}

function parseArgs(argv: readonly string[]): { command: Command; url: string; lines: number; follow: boolean; force: boolean } {
  let command: Command = "help";
  let url = DEFAULT_URL;
  let lines = 50;
  let follow = false;
  let force = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === "--help" || arg === "-h") {
      command = "help";
      continue;
    }
    if (arg === "--follow") {
      follow = true;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--url" || arg === "--lines") {
      const value = argv[index + 1];
      if (value === undefined || value === "") throw new UsageError(`${arg} 需要一个值`);
      if (arg === "--url") url = value;
      else {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1) throw new UsageError("--lines 必须是正整数");
        lines = parsed;
      }
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) throw new UsageError(`未知选项：${arg}`);
    if (command !== "help") throw new UsageError(`多余参数：${arg}`);
    command = arg as Command;
  }
  if (!["start", "stop", "status", "logs", "reload", "restart", "supervise", "help"].includes(command)) {
    throw new UsageError(`未知命令：${command}`);
  }
  return { command, url, lines, follow, force };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readPid(): Promise<PidInfo | null> {
  try {
    const text = (await readFile(PID_PATH, "utf8")).trim();
    if (text === "") return null;
    const value = JSON.parse(text) as Partial<PidInfo>;
    if (typeof value.pid !== "number" || !Number.isInteger(value.pid)) return null;
    return {
      pid: value.pid,
      mode: "supervise",
      childPid: typeof value.childPid === "number" ? value.childPid : null,
      startedAt: typeof value.startedAt === "string" ? value.startedAt : "",
      url: typeof value.url === "string" ? value.url : DEFAULT_URL,
      logPath: typeof value.logPath === "string" ? value.logPath : LOG_PATH,
      restarts: typeof value.restarts === "number" ? value.restarts : 0,
      lastExitCode: typeof value.lastExitCode === "number" ? value.lastExitCode : null,
      lastExitAt: typeof value.lastExitAt === "string" ? value.lastExitAt : null,
    };
  } catch {
    return null;
  }
}

async function writePid(info: PidInfo): Promise<void> {
  await mkdir(RUN_DIR, { recursive: true });
  await writeFile(PID_PATH, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
}

async function removePid(): Promise<void> {
  await rm(PID_PATH, { force: true });
}

function logSupervise(message: string): void {
  try {
    appendFileSync(SUPERVISE_LOG, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // 日志失败不影响托管。
  }
}

async function readTail(path: string, lines: number): Promise<string> {
  const text = await readFile(path, "utf8").catch(() => "");
  return text.split("\n").slice(-lines - 1).join("\n");
}

async function health(url: string): Promise<number | null> {
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/healthz`, { signal: AbortSignal.timeout(2_000) });
    return response.status;
  } catch {
    return null;
  }
}

async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await health(url)) === 200) return true;
    await Bun.sleep(250);
  }
  return false;
}

/** 监督进程：子服务退出后按 1s 退避重启；连续快速失败改为 30s。 */
async function supervise(url: string): Promise<void> {
  await mkdir(LOG_DIR, { recursive: true });
  await mkdir(RUN_DIR, { recursive: true });
  const fd = openSync(LOG_PATH, "a", 0o600);
  let child: ChildProcess | null = null;
  let stopping = false;
  let restarts = 0;
  let lastExitCode: number | null = null;
  let lastExitAt: string | null = null;
  let fastFails = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const startedAt = new Date().toISOString();
  const closeLog = (): void => {
    if (closed) return;
    closed = true;
    try {
      closeSync(fd);
    } catch {
      // 已关闭或子进程收尾时关闭失败都不影响退出。
    }
  };

  const info = (): PidInfo => ({
    pid: process.pid,
    mode: "supervise",
    childPid: child?.pid ?? null,
    startedAt,
    url,
    logPath: LOG_PATH,
    restarts,
    lastExitCode,
    lastExitAt,
  });

  const startChild = (): void => {
    if (stopping) return;
    const startedAt = Date.now();
    child = spawn(process.execPath, ["run", join(ROOT, "src", "main.ts")], {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ["ignore", fd, fd],
    });
    logSupervise(`started pid=${child.pid ?? "null"}`);
    void writePid(info());
    child.once("exit", (code, signal) => {
      const uptime = Date.now() - startedAt;
      lastExitCode = code;
      lastExitAt = new Date().toISOString();
      child = null;
      logSupervise(`child exit code=${code ?? "null"} signal=${signal ?? "null"} uptimeMs=${uptime}`);
      if (stopping) {
        closeLog();
        void removePid().finally(() => process.exit(0));
        return;
      }
      restarts += 1;
      fastFails = uptime < FAST_FAIL_MS ? fastFails + 1 : 0;
      const delay = fastFails >= 5 ? MAX_BACKOFF_MS : Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** Math.min(fastFails, 5));
      void writePid(info());
      logSupervise(`restart in ${delay}ms (fastFails=${fastFails})`);
      timer = setTimeout(startChild, delay);
    });
  };

  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    if (timer !== null) clearTimeout(timer);
    logSupervise("stopping");
    if (child !== null) child.kill("SIGTERM");
    setTimeout(() => {
      if (child !== null) child.kill("SIGKILL");
      closeLog();
      void removePid().finally(() => process.exit(0));
    }, 5_000).unref();
  };

  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("SIGUSR1", () => {
    logSupervise("reload requested");
    if (child !== null) child.kill("SIGTERM");
  });
  startChild();
}

async function start(url: string): Promise<number> {
  const existing = await readPid();
  if (existing !== null && isAlive(existing.pid)) {
    console.error(`orchestrator 已托管运行：supervisor pid=${existing.pid}，child pid=${existing.childPid ?? "null"}`);
    return 1;
  }
  if ((await health(url)) === 200) {
    console.error(`${url} 已有服务在运行，但不是本脚本托管；先停止它再启动。`);
    return 1;
  }
  await mkdir(LOG_DIR, { recursive: true });
  await mkdir(RUN_DIR, { recursive: true });
  const child = spawn(process.execPath, [SCRIPT, "supervise", "--url", url], {
    cwd: ROOT,
    env: { ...process.env },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  const pidDeadline = Date.now() + START_TIMEOUT_MS;
  let info: PidInfo | null = null;
  while (Date.now() < pidDeadline) {
    info = await readPid();
    if (info !== null && isAlive(info.pid)) break;
    await Bun.sleep(200);
  }
  if (info === null || !isAlive(info.pid)) {
    console.error("监督进程未能启动。最近日志：");
    console.error(await readTail(SUPERVISE_LOG, 20));
    return 1;
  }
  if (!(await waitForHealth(url, START_TIMEOUT_MS))) {
    console.error(`服务未在 ${START_TIMEOUT_MS / 1000}s 内通过 /healthz。最近日志：`);
    console.error(await readTail(LOG_PATH, 30));
    process.kill(info.pid, "SIGTERM");
    return 1;
  }
  console.log(`orchestrator 已启动：${url}`);
  console.log(`supervisor pid=${info.pid}，日志=${LOG_PATH}`);
  return 0;
}

async function stop(force: boolean): Promise<number> {
  const info = await readPid();
  if (info === null || !isAlive(info.pid)) {
    if (info !== null) await removePid();
    console.log("orchestrator 未托管运行");
    return 0;
  }
  process.kill(info.pid, "SIGTERM");
  const deadline = Date.now() + (force ? 1_000 : STOP_TIMEOUT_MS);
  while (Date.now() < deadline) {
    if (!isAlive(info.pid)) {
      console.log("orchestrator 已停止");
      await removePid();
      return 0;
    }
    await Bun.sleep(250);
  }
  if (force) {
    process.kill(info.pid, "SIGKILL");
    if (info.childPid !== null && isAlive(info.childPid)) process.kill(info.childPid, "SIGKILL");
    await removePid();
    console.log("orchestrator 已强制停止");
    return 0;
  }
  console.error("监督进程未在 20s 内退出；可加 --force");
  return 1;
}

async function status(): Promise<number> {
  const info = await readPid();
  if (info === null) {
    console.log("orchestrator 未托管运行");
    return 1;
  }
  const alive = isAlive(info.pid);
  const code = await health(info.url);
  console.log(`supervisor pid=${info.pid} ${alive ? "alive" : "stale"}`);
  console.log(`child pid=${info.childPid ?? "null"}`);
  console.log(`url=${info.url} healthz=${code ?? "unreachable"}`);
  console.log(`restarts=${info.restarts} lastExit=${info.lastExitCode ?? "null"} at=${info.lastExitAt ?? "null"}`);
  return alive && code === 200 ? 0 : 1;
}

async function logs(lines: number, follow: boolean): Promise<number> {
  if (!follow) {
    console.log(await readTail(LOG_PATH, lines));
    return 0;
  }
  const tail = spawn("tail", ["-n", String(lines), "-f", LOG_PATH], { stdio: "inherit" });
  return await new Promise((resolve) => tail.once("exit", (code) => resolve(code ?? 0)));
}

async function reload(): Promise<number> {
  const info = await readPid();
  if (info === null || !isAlive(info.pid)) {
    console.error("orchestrator 未托管运行");
    return 1;
  }
  const previous = info.childPid;
  process.kill(info.pid, "SIGUSR1");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const current = await readPid();
    if (current !== null && current.childPid !== null && current.childPid !== previous && isAlive(current.childPid)) {
      console.log(`已重启：child pid=${current.childPid}`);
      return 0;
    }
    await Bun.sleep(250);
  }
  console.error("重启超时，检查 logs");
  return 1;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help") {
    help();
    return 0;
  }
  await mkdir(LOG_DIR, { recursive: true });
  await mkdir(RUN_DIR, { recursive: true });
  if (options.command === "supervise") {
    await supervise(options.url);
    await new Promise<void>(() => {});
    return 0;
  }
  if (options.command === "start") return start(options.url);
  if (options.command === "stop") return stop(options.force);
  if (options.command === "status") return status();
  if (options.command === "logs") return logs(options.lines, options.follow);
  if (options.command === "reload") return reload();
  if (options.command === "restart") {
    const stopped = await stop(false);
    if (stopped !== 0) return stopped;
    return start(options.url);
  }
  return 1;
}

try {
  process.exit(await main());
} catch (error) {
  if (error instanceof UsageError) {
    console.error(error.message);
    process.exit(2);
  }
  console.error((error as Error).message);
  process.exit(1);
}
