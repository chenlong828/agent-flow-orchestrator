import { describe, expect, test } from "bun:test";
import { parseVerdict } from "../../../src/components/run/verdict.ts";

describe("parseVerdict", () => {
  test("末尾裸 JSON 独占一行", () => {
    expect(parseVerdict('核验摘要：…\n\n{"verdict":"pass","reason":"已落地"}')).toEqual({
      verdict: "pass",
      reason: "已落地",
    });
  });

  test("裸 JSON 紧跟在最后一句之后（同一行）也能解析", () => {
    const message =
      '复核完成，报告写入 review.md。{"verdict":"pass","reason":"B1–B4 已修复；当前无阻塞缺陷。"}';
    expect(parseVerdict(message)).toEqual({
      verdict: "pass",
      reason: "B1–B4 已修复；当前无阻塞缺陷。",
    });
  });

  test("取最后一个 verdict 对象，中间示例被覆盖", () => {
    const message = '示例：{"verdict":"fail","reason":"旧理由"}\n实际结论：{"verdict":"pass","reason":"新理由"}';
    expect(parseVerdict(message)).toEqual({ verdict: "pass", reason: "新理由" });
  });

  test("代码围栏内的 JSON 同样可解析", () => {
    expect(parseVerdict('结论：\n```json\n{"verdict":"pass","reason":"围栏内"}\n```')).toEqual({
      verdict: "pass",
      reason: "围栏内",
    });
  });

  test("理由很长（接近消息上限）时仍取到末尾 verdict", () => {
    const reason = "复".repeat(40_000);
    expect(parseVerdict(`评审报告\n{"verdict":"fail","reason":"${reason}"}`)).toEqual({
      verdict: "fail",
      reason,
    });
  });

  test("reason 里含大括号、引号也不破坏解析", () => {
    const message = '详见 {review.md}。{"verdict":"fail","reason":"补齐 {A} 与 \\"B\\" 后复审"}';
    expect(parseVerdict(message)).toEqual({
      verdict: "fail",
      reason: '补齐 {A} 与 "B" 后复审',
    });
  });

  test("缺少 verdict、值非法或 JSON 损坏返回 null", () => {
    expect(parseVerdict("没有结论")).toBeNull();
    expect(parseVerdict('{"verdict":"ok"}')).toBeNull();
    expect(parseVerdict('{"verdict":"pass"')).toBeNull();
    expect(parseVerdict("")).toBeNull();
  });

  test("reason 非字符串时省略，不影响 verdict", () => {
    expect(parseVerdict('{"verdict":"fail","reason":42}')).toEqual({ verdict: "fail" });
  });
});
