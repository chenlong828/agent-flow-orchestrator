export type Verdict = { verdict: "pass" | "fail"; reason?: string };

/** 消息按契约至多 256 KiB（`maxResultBytes`）；窗口与上限同宽，长理由里的 verdict 也不会被切掉。 */
const TAIL_WINDOW = 256 * 1024;
const MAX_CANDIDATES = 200;

function matchBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function toVerdict(candidate: string): Verdict | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const value = (parsed as { verdict?: unknown }).verdict;
  if (value !== "pass" && value !== "fail") return null;
  const reason = (parsed as { reason?: unknown }).reason;
  return {
    verdict: value,
    ...(typeof reason === "string" ? { reason } : {}),
  };
}

/**
 * verdict 协议：review 节点在最终消息里输出一个**裸 JSON 对象**
 * `{"verdict":"pass"|"fail","reason":"…"}`，通常放在末尾（最后一行，或紧跟最后一句之后）。
 *
 * 解析规则：取消息末尾窗口内**最后一个**可解析且 `verdict` 合法的 JSON 对象；
 * 不要求它独占一行，也不要求代码围栏。正文中间的示例 JSON 会被更靠后的真实结论覆盖。
 */
export function parseVerdict(message: string): Verdict | null {
  const from = Math.max(0, message.length - TAIL_WINDOW);
  const window = message.slice(from);
  const opens: number[] = [];
  for (let index = 0; index < window.length; index += 1) {
    if (window[index] === "{") opens.push(index);
  }
  let tried = 0;
  for (let cursor = opens.length - 1; cursor >= 0 && tried < MAX_CANDIDATES; cursor -= 1) {
    const start = opens[cursor];
    if (start === undefined) break;
    const end = matchBrace(window, start);
    if (end < 0) continue;
    tried += 1;
    const verdict = toVerdict(window.slice(start, end + 1));
    if (verdict !== null) return verdict;
  }
  return null;
}
