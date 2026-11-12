/** 从最终消息里取最后一段 ```json 代码块作为 verdict；非法返回 null。 */
export function parseVerdict(message: string): { verdict: "pass" | "fail"; reason?: string } | null {
  const blocks = [...message.matchAll(/```json\s*([\s\S]*?)```/g)];
  const last = blocks.at(-1);
  const body = last?.[1];
  if (body === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.trim());
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
