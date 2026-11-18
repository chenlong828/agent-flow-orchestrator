// 工作区扫描与检查方案调度的公共工具。
// 只做与语言无关的目录遍历、glob 匹配、哈希与子进程调用；不包含任何 JS 检查规则。
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".workspace",
  "dist",
  "build",
  "target",
  "out",
  ".next",
  ".nuxt",
]);

/** 把 glob 转成正则；只支持 *, **, ? 与字符类，足够匹配 scheme 的 appliesTo。 */
export function globToRegExp(glob) {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*") {
      if (glob[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else if ("\\^$+.()|{}[]".includes(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  return new RegExp(`^${source}$`);
}

export function matchesAny(path, globs) {
  if (!globs || globs.length === 0) return false;
  return globs.some((glob) => globToRegExp(glob).test(path));
}

/** 遍历工作区，返回相对 POSIX 路径；跳过依赖、构建产物与状态目录。 */
export function walkFiles(root, limit = 20000) {
  const out = [];
  const visit = (directory) => {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        visit(full);
      } else if (entry.isFile()) {
        out.push(relative(root, full).split(sep).join("/"));
      }
    }
  };
  visit(root);
  return out;
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** 关键文件内容哈希，用于判断工作区布局是否漂移。 */
export function contentHash(root, files) {
  const parts = [];
  for (const file of files.sort()) {
    const path = join(root, file);
    parts.push(file);
    parts.push(existsSync(path) ? readFileSync(path, "utf8") : "<missing>");
  }
  return sha256(parts.join("\n"));
}

export function topLevelDirs(root) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !IGNORED_DIRS.has(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 120_000,
    maxBuffer: 64 * 1024 * 1024,
    env: options.env ?? process.env,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ? String(result.error.message) : "",
  };
}

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function isDirectory(path) {
  return Boolean(statSync(path, { throwIfNoEntry: false })?.isDirectory());
}

export function isFile(path) {
  return Boolean(statSync(path, { throwIfNoEntry: false })?.isFile());
}

export function parseArgs(argv) {
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
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      options[name] = argv[index + 1];
      index += 1;
    } else {
      options[name] = true;
    }
  }
  return options;
}
