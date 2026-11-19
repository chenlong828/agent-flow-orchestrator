import { MAX_PROMPT_BYTES, PayloadTooLargeError } from "../../core/kernel/index.ts";
import type { WorkflowNode } from "../workflow/index.ts";

/** prompt 只需要的专家字段；`CMP-run` 从 `CMP-expert` 的读模型里裁剪。 */
export type PromptExpert = {
  name: string;
  role: string;
  persona: string[];
  duty: string;
  verifyOrder: string;
  notes: string;
};

/** 回退进入信息：节点名与驳回理由（理由正文来自被驳回行的 verdict）。 */
export type PromptEntry = {
  kind: "review_fail" | "confirm_reject";
  fromName: string;
  reason: string;
};

export type PromptConfirmation = {
  question: string;
  decision: "pass" | "reject";
  comment: string | null;
  options?: string[];
};

export type PromptInput = {
  node: WorkflowNode;
  expert: PromptExpert;
  taskSpacePath: string;
  entry?: PromptEntry;
  intentMarkdown?: string;
  confirmation?: PromptConfirmation;
};

const ENTRY_REASON_LIMIT = 300;

/** 专家块：只写身份、性格与职责边界；具体做法由技能承载，空字段整行省略。 */
function expertBlock(expert: PromptExpert): string[] {
  const lines = ["[专家]", `名称：${expert.name}`];
  const fields: [string, string][] = [
    ["角色", expert.role],
    ["性格", expert.persona.join("、")],
    ["职责", expert.duty],
    ["验证顺序", expert.verifyOrder],
    ["注意事项", expert.notes],
  ];
  for (const [label, value] of fields) {
    if (value.trim() !== "") lines.push(`${label}：${value.trim()}`);
  }
  return lines;
}

/** 进入原因块：只在被驳回重跑时出现；理由截断到一行能读完的长度。 */
function entryBlock(entry: PromptEntry): string[] {
  const head =
    entry.kind === "confirm_reject"
      ? `[本次进入] 人工在「${entry.fromName}」节点驳回，本节点被回退重跑。`
      : `[本次进入] 节点「${entry.fromName}」判定 fail，本节点被回退重跑。`;
  const label = entry.kind === "confirm_reject" ? "驳回意见" : "驳回理由";
  const reason = entry.reason.trim() === "" ? "未提供理由" : truncate(entry.reason.trim());
  return [head, `${label}：${reason}`];
}

function confirmationBlock(confirmation: PromptConfirmation): string[] {
  const decision = confirmation.decision === "pass" ? "通过" : "拒绝";
  const answer = confirmation.comment?.trim();
  const lines = ["[人工确认]", `问题：${confirmation.question}`, `人工决定：${decision}`];
  if (confirmation.options !== undefined && confirmation.options.length > 0) {
    lines.push(`可选项：${confirmation.options.join(" / ")}`);
  }
  lines.push(`人的回答/意见：${answer === undefined || answer === "" ? "（无补充）" : truncate(answer)}`);
  lines.push(
    confirmation.decision === "pass"
      ? "继续完成本节点；按人工确认继续执行。"
      : "继续完成本节点；按拒绝意见调整，不要重复被拒绝的方案。",
  );
  return lines;
}

function truncate(text: string): string {
  const chars = [...text];
  return chars.length <= ENTRY_REASON_LIMIT
    ? text
    : `${chars.slice(0, ENTRY_REASON_LIMIT).join("")}…（已截断）`;
}

/**
 * 节点 prompt：一段固定的任务头 + 绑定专家的身份描述。
 * 不写工作流名、节点名、目录规范或输出格式——那些要么在 DSH 的运行上下文里，要么由技能承载。
 */
export function composeNodePrompt(input: PromptInput): string {
  const lines = [
    "[agent-flow工作流任务]",
    `本次任务执行相关记录的 task-space：${input.taskSpacePath}`,
  ];
  if (input.node.type === "start") {
    lines.push(
      "把下面的诉求原文写入 <task-space>/intent.md，再开始执行。",
      "[启动诉求原文]",
      input.intentMarkdown ?? "",
    );
  } else {
    lines.push(
      "读取 <task-space>/intent.md 作为本系列任务运行的目标与约束，方便后续其他任务了解情况。",
    );
  }
  lines.push("[输出要求] 无特别要求，跟随Skill执行。");
  if (input.node.type === "agent") {
    lines.push(
      "[确认通道] 仅严重场景调用 mcp__agentflow__confirm：契约变更、规则突破、不可逆/外部副作用、P0/P1、用户意图冲突、关键信息缺失；普通决策按 auto-confirm §2 默认确认，不打断人。",
    );
  }
  if (input.node.type === "review") {
    lines.push(
      "[确认通道] 评审节点仅在「必须澄清已 accepted 需求/契约口径，且该口径直接决定 verdict」时调用 mcp__agentflow__confirm；不得把评审判断本身交给人，不得用 confirm 代替 review_verdict；一次一个问题；回答后仍须自行提交 verdict。",
    );
  }
  if (input.entry !== undefined) lines.push(...entryBlock(input.entry));
  if (input.confirmation !== undefined) lines.push(...confirmationBlock(input.confirmation));
  lines.push("");
  lines.push(...expertBlock(input.expert));
  const prompt = lines.join("\n");
  const bytes = new TextEncoder().encode(prompt).byteLength;
  if (bytes > MAX_PROMPT_BYTES) {
    throw new PayloadTooLargeError("prompt_bytes", MAX_PROMPT_BYTES, bytes);
  }
  return prompt;
}
