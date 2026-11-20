import { describe, expect, test } from "bun:test";
import { validateDraft } from "../../../src/components/scheduler/validate.ts";
import type { ResultSignalContract, TaskDraft } from "../../../src/components/scheduler/index.ts";

const baseDraft: TaskDraft = {
  instanceId: "0191f2f0-3333-7000-8000-000000000001",
  nodeId: "n1",
  prompt: "任务",
  timeoutMs: 1000,
  skillIds: [],
  taskSpacePath: "/work/task-space",
};

const resultSignal: ResultSignalContract = {
  version: 1,
  kind: "review_verdict",
  required: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["verdict"],
    properties: { verdict: { type: "string", enum: ["pass", "fail"] } },
  },
};

const confirmation: ResultSignalContract = {
  version: 1,
  kind: "confirmation_request",
  required: false,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["question"],
    properties: { question: { type: "string" } },
  },
};

describe("TaskDraft.confirmation 校验", () => {
  test("接受 confirmation_request 且 required=false，与 resultSignal 一起原样返回", () => {
    const draft = validateDraft({ ...baseDraft, resultSignal, confirmation });
    expect(draft.resultSignal).toEqual(resultSignal);
    expect(draft.confirmation).toEqual(confirmation);
  });

  test("confirmation 必须是 confirmation_request", () => {
    expect(() =>
      validateDraft({ ...baseDraft, confirmation: { ...confirmation, kind: "review_verdict" } }),
    ).toThrow("字段 confirmation.kind 不合法：必须是 confirmation_request");
  });

  test("confirmation 必须 required=false", () => {
    expect(() =>
      validateDraft({ ...baseDraft, confirmation: { ...confirmation, required: true } }),
    ).toThrow("字段 confirmation.required 不合法：必须是 false");
  });

  test("confirmation 超过 8 KiB 拒绝", () => {
    const oversized: ResultSignalContract = {
      ...confirmation,
      schema: {
        type: "object",
        additionalProperties: false,
        required: [],
        properties: { question: { type: "string", description: "x".repeat(9000) } },
      },
    };
    expect(() => validateDraft({ ...baseDraft, confirmation: oversized })).toThrow(
      "字段 confirmation 不合法：超过 8192 字节",
    );
  });

  test("timeoutMs 上限一天，0/负值拒绝", () => {
    expect(validateDraft({ ...baseDraft, timeoutMs: 86400000 }).timeoutMs).toBe(86400000);
    expect(() => validateDraft({ ...baseDraft, timeoutMs: 0 })).toThrow(
      "字段 timeoutMs 不合法：必须是 1–86400000 的整数",
    );
    expect(() => validateDraft({ ...baseDraft, timeoutMs: -1 })).toThrow(
      "字段 timeoutMs 不合法：必须是 1–86400000 的整数",
    );
  });

  test("没有 confirmation 的旧任务保持原形状", () => {
    const draft = validateDraft({ ...baseDraft, resultSignal });
    expect(draft.confirmation).toBeUndefined();
    expect(draft.resultSignal).toEqual(resultSignal);
  });
});
