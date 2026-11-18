import { test, expect } from "bun:test";
import { a } from "../src/components/a/index.ts";

test("存在性断言", () => {
  expect(a).toBeDefined();
});

test.skip("跳过的用例", () => {
  expect(1).toBe(1);
});
