import { MAX_PROMPT_BYTES, PayloadTooLargeError } from "../../core/kernel/index.ts";
import type { WorkflowNode } from "../workflow/index.ts";

export type PromptInput = {
  workflowName: string;
  node: WorkflowNode;
  expertName: string;
  taskSpacePath: string;
  intentMarkdown?: string;
};

/** 按设计提案 §4.4 的顺序拼接节点 prompt；超限直接失败，不截断。 */
export function composeNodePrompt(input: PromptInput): string {
  const { workflowName, node, expertName, taskSpacePath } = input;
  const lines = [
    "[运行上下文]",
    `工作流：${workflowName}`,
    `当前节点：${node.name}（${node.type}）`,
    `本次运行的 task-space：${taskSpacePath}（所有产物写入此目录；启动诉求在 intent.md）`,
  ];
  if (node.type === "start") {
    lines.push(
      "[启动诉求] 先把下面的诉求原文写入 <task-space>/intent.md，再开始执行。",
      "[启动诉求原文]",
      input.intentMarkdown ?? "",
    );
  } else {
    lines.push("[启动诉求] 读取 <task-space>/intent.md 作为本次运行的目标与约束。");
  }
  lines.push(
    `[节点说明] ${node.name}；绑定专家：${expertName}`,
    "[输出要求] 产物写入 task-space 并说明文件名；不要写到 task-space 之外。",
  );
  if (node.type === "review") {
    lines.push(
      '[审核要求] 结束前在最后一段 ```json 代码块给出 {"verdict":"pass"|"fail","reason":"…"}。',
    );
  }
  const prompt = lines.join("\n");
  const bytes = new TextEncoder().encode(prompt).byteLength;
  if (bytes > MAX_PROMPT_BYTES) {
    throw new PayloadTooLargeError("prompt_bytes", MAX_PROMPT_BYTES, bytes);
  }
  return prompt;
}
