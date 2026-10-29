import { describe, expect, test } from "bun:test";
import {
  buildSkillMarkdown,
  buildSkillPackage,
  parseSkillMarkdown,
  readSkillPackage,
} from "../../../src/components/skill/package.ts";
import {
  PayloadTooLargeError,
  SkillMdTooLargeError,
  ValidationError,
} from "../../../src/core/kernel/index.ts";

const INPUT = {
  name: "调用链分析",
  description: "基于 Call Trace 定位符号引用链，圈定影响面",
  version: "v1.0",
  body: "## 适用场景\n\n需要定位影响面时使用。",
};

describe("Skill 包构建", () => {
  test("生成三键 frontmatter、正文归一化并保证单个结尾换行", () => {
    const markdown = buildSkillMarkdown({
      ...INPUT,
      body: "## 适用场景\r\n\r\n内容\r\n",
    });
    expect(markdown).toBe(
      [
        "---",
        'name: "调用链分析"',
        'description: "基于 Call Trace 定位符号引用链，圈定影响面"',
        'version: "v1.0"',
        "---",
        "## 适用场景",
        "",
        "内容",
        "",
      ].join("\n"),
    );
    expect(parseSkillMarkdown(markdown)).toEqual({
      ...INPUT,
      body: "## 适用场景\n\n内容\n",
    });
  });

  test("构建 zip：SKILL.md 首项，附件可解压，顺序保留", () => {
    const zip = buildSkillPackage({
      ...INPUT,
      files: [
        {
          path: "scripts/run.sh",
          data: new TextEncoder().encode("echo hello"),
        },
        {
          path: "references/guide.md",
          data: new TextEncoder().encode("# guide"),
        },
      ],
    });
    const entries = readSkillPackage(zip);

    expect(entries.map((entry) => entry.path)).toEqual([
      "SKILL.md",
      "scripts/run.sh",
      "references/guide.md",
    ]);
    expect(new TextDecoder().decode(entries[0]!.data)).toBe(
      buildSkillMarkdown(INPUT),
    );
    expect(new TextDecoder().decode(entries[1]!.data)).toBe("echo hello");
  });

  test("拒绝非法包路径与重复路径", () => {
    for (const path of [
      "/SKILL.md",
      "../SKILL.md",
      "SKILL.md/../x",
      "scripts/run.sh/",
      "scripts\\run.sh",
      "root.txt",
      "scripts/\u0000.sh",
    ]) {
      expect(() =>
        buildSkillPackage({
          ...INPUT,
          files: [{ path, data: new Uint8Array([1]) }],
        }),
      ).toThrow(ValidationError);
    }

    expect(() =>
      buildSkillPackage({
        ...INPUT,
        files: [
          { path: "references/a.md", data: new Uint8Array([1]) },
          { path: "references/a.md", data: new Uint8Array([2]) },
        ],
      }),
    ).toThrow(ValidationError);
  });

  test("拒绝超限的 SKILL.md、文件数与单文件", () => {
    expect(() =>
      buildSkillMarkdown({ ...INPUT, body: "x".repeat(16_384) }),
    ).toThrow(SkillMdTooLargeError);

    const tooMany = Array.from({ length: 100 }, (_, index) => ({
      path: `references/${index}.md`,
      data: new Uint8Array([1]),
    }));
    expect(() => buildSkillPackage({ ...INPUT, files: tooMany })).toThrow(
      PayloadTooLargeError,
    );

    expect(() =>
      buildSkillPackage({
        ...INPUT,
        files: [
          {
            path: "references/big.bin",
            data: new Uint8Array(20 * 1024 * 1024 + 1),
          },
        ],
      }),
    ).toThrow(PayloadTooLargeError);
  });
});
