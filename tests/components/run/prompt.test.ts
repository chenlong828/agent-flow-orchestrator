import { describe, expect, test } from "bun:test";
import { composeNodePrompt, type PromptExpert } from "../../../src/components/run/prompt.ts";
import type { WorkflowNode } from "../../../src/components/workflow/index.ts";

const expert: PromptExpert = {
  name: "执行专家",
  role: "实现",
  persona: ["严谨"],
  duty: "## 主要职责\n完成任务\n\n## 重点验证顺序\n先读后写",
};

function node(type: WorkflowNode["type"]): WorkflowNode {
  return { id: "n1", type, name: "节点", stageId: "s1", expertId: "e1" };
}

function promptFor(type: WorkflowNode["type"]): string {
  return composeNodePrompt({ node: node(type), expert, taskSpacePath: "/work/task-space" });
}

describe("节点 prompt 的确认通道", () => {
  test("agent 列出六类严重场景，并指向 auto-confirm 默认确认", () => {
    const prompt = promptFor("agent");
    expect(prompt).toContain(
      "[确认通道] 仅严重场景调用 mcp__agentflow__confirm：契约变更、规则突破、不可逆/外部副作用、P0/P1、用户意图冲突、关键信息缺失；",
    );
    expect(prompt).toContain("普通决策按 auto-confirm §2 默认确认，不打断人。");
    expect(prompt).not.toContain("评审节点仅在");
  });

  test("review 使用严格确认通道：只澄清口径、不外包判断、一次一问、仍须提交 verdict", () => {
    const prompt = promptFor("review");
    expect(prompt).toContain(
      "[确认通道] 评审节点仅在「必须澄清已 accepted 需求/契约口径，且该口径直接决定 verdict」时调用 mcp__agentflow__confirm；",
    );
    expect(prompt).toContain("不得把评审判断本身交给人，不得用 confirm 代替 review_verdict；");
    expect(prompt).toContain("一次一个问题；回答后仍须自行提交 verdict。");
    expect(prompt).not.toContain("仅严重场景");
  });

  test("start / end / confirm 不出现确认通道文案", () => {
    for (const type of ["start", "end", "confirm"] as const) {
      expect(promptFor(type)).not.toContain("[确认通道]");
    }
  });

  test("review prompt 仍保留任务头、task-space 与专家块", () => {
    const prompt = promptFor("review");
    expect(prompt).toContain("[agent-flow工作流任务]");
    expect(prompt).toContain("本次任务执行相关记录的 task-space：/work/task-space");
    expect(prompt).toContain("[专家]");
    expect(prompt).toContain("名称：执行专家");
  });

  test("专家块输出 Markdown 职责范围，不再输出已并入的旧标签", () => {
    const prompt = promptFor("agent");
    expect(prompt).toContain("角色：实现");
    expect(prompt).toContain("性格：严谨");
    expect(prompt).toContain("职责范围：\n## 主要职责\n完成任务");
    expect(prompt).not.toContain("职责：");
    expect(prompt).not.toContain("验证顺序：");
    expect(prompt).not.toContain("注意事项：");
  });
});
