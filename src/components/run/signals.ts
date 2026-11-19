import type { ResultSignalContract, TaskSignal } from "../scheduler/index.ts";
import type { NodeType } from "../workflow/index.ts";

/** review 节点的判决信号契约；schema 与 client 的 MCP inputSchema 投影同源。 */
const REVIEW_VERDICT_SIGNAL: ResultSignalContract = {
  version: 1,
  kind: "review_verdict",
  required: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "reason"],
    properties: {
      verdict: { type: "string", enum: ["pass", "fail"] },
      reason: { type: "string", minLength: 1, maxLength: 8192 },
      evidence: { type: "string[]", maxItems: 16, maxLength: 512 },
    },
  },
};

/** agent 节点的确认点契约：模型在必须人工确认时发问。 */
const CONFIRMATION_SIGNAL: ResultSignalContract = {
  version: 1,
  kind: "confirmation_request",
  required: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["question"],
    properties: {
      question: { type: "string", minLength: 1, maxLength: 2048 },
      context: { type: "string", maxLength: 8192 },
      options: { type: "string[]", maxItems: 8, maxLength: 200 },
      allowFreeText: { type: "boolean" },
    },
  },
};

/**
 * review 节点的可选确认契约：与 agent 共用同一 schema，但 `required=false`——
 * verdict 才是必需结果，呼人只是评审的补充入口。
 */
const REVIEW_CONFIRMATION_SIGNAL: ResultSignalContract = {
  version: CONFIRMATION_SIGNAL.version,
  kind: CONFIRMATION_SIGNAL.kind,
  required: false,
  schema: CONFIRMATION_SIGNAL.schema,
};

export function signalForNode(type: NodeType): ResultSignalContract | undefined {
  if (type === "review") return REVIEW_VERDICT_SIGNAL;
  if (type === "agent") return CONFIRMATION_SIGNAL;
  return undefined;
}

/** 节点额外挂载的确认工具契约；目前只有 review 需要（agent 的确认走 `resultSignal`）。 */
export function confirmationForNode(type: NodeType): ResultSignalContract | undefined {
  return type === "review" ? REVIEW_CONFIRMATION_SIGNAL : undefined;
}

export type ReviewVerdict = {
  verdict: "pass" | "fail";
  reason: string;
  evidence?: string[];
};

export type ConfirmationRequest = {
  question: string;
  context?: string;
  options?: string[];
  allowFreeText?: boolean;
};

function lastBySeq(signals: readonly TaskSignal[]): TaskSignal[] {
  return [...signals].sort((left, right) => left.seq - right.seq);
}

export function reviewSignalOf(signals: readonly TaskSignal[] | undefined): TaskSignal | undefined {
  return signals === undefined ? undefined : lastBySeq(signals).filter((s) => s.kind === "review_verdict").at(-1);
}

export function confirmationSignalOf(signals: readonly TaskSignal[] | undefined): TaskSignal | undefined {
  return signals === undefined ? undefined : lastBySeq(signals).filter((s) => s.kind === "confirmation_request").at(-1);
}

export function reviewVerdictOf(signal: TaskSignal | undefined): ReviewVerdict | null {
  if (signal === undefined) return null;
  const data = signal.data;
  const verdict = data.verdict;
  if (verdict !== "pass" && verdict !== "fail") return null;
  const reason = data.reason;
  if (typeof reason !== "string" || reason.trim() === "") return null;
  const evidence = data.evidence;
  if (evidence !== undefined && (!Array.isArray(evidence) || evidence.some((item) => typeof item !== "string"))) {
    return null;
  }
  return {
    verdict,
    reason,
    ...(evidence === undefined ? {} : { evidence: evidence as string[] }),
  };
}

export function confirmationOf(signal: TaskSignal | undefined): ConfirmationRequest | null {
  if (signal === undefined) return null;
  const data = signal.data;
  const question = data.question;
  if (typeof question !== "string" || question.trim() === "") return null;
  const context = data.context;
  if (context !== undefined && typeof context !== "string") return null;
  const options = data.options;
  if (options !== undefined && (!Array.isArray(options) || options.some((item) => typeof item !== "string"))) {
    return null;
  }
  const allowFreeText = data.allowFreeText;
  if (allowFreeText !== undefined && typeof allowFreeText !== "boolean") return null;
  return {
    question,
    ...(context === undefined ? {} : { context }),
    ...(options === undefined ? {} : { options: options as string[] }),
    ...(allowFreeText === undefined ? {} : { allowFreeText }),
  };
}

/** 从 run_node.verdict 读取确认点数据（等待人工期间由 applyResult 写入）。 */
export function confirmationFromVerdict(
  value: Record<string, unknown> | string | null | undefined,
): ConfirmationRequest | null {
  if (value === null || value === undefined) return null;
  const verdict = typeof value === "string" ? (JSON.parse(value) as Record<string, unknown>) : value;
  if (verdict === null || typeof verdict !== "object" || verdict.kind !== "confirmation_request") return null;
  return confirmationOf({
    seq: 1,
    at: "",
    kind: "confirmation_request",
    data: verdict,
  });
}
