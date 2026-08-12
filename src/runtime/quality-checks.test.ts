import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const qualityChecksPath = resolve(
  import.meta.dirname,
  "../../public/lib/quality-checks.cjs",
);

type QualityRisk = {
  code: string;
  category: string;
  severity: "critical" | "major" | "minor";
  certainty: "deterministic" | "heuristic";
  message: string;
};

type QualityInspection = {
  risks: QualityRisk[];
  pasteBlocked: boolean;
};

function inspect(sourceText: string, translation: string): QualityInspection {
  const { inspectTranslationQuality } = require(qualityChecksPath);
  return inspectTranslationQuality({
    sourceText,
    translation,
    streamCompleted: true,
  });
}

describe("deterministic translation quality checks", () => {
  const protectedSource = [
    "Release 1.2 on 2026-08-13 uses 3.5 kW.",
    "Contact ops@example.com or https://example.test/a?q=1.",
    "Keep {name}, %1$s, `npm run build` and this block:",
    "```js",
    "const limit = 42;",
    "```",
  ].join("\n");
  const protectedTranslation = [
    "版本 1.2 于 2026-08-13 使用 3.5 kW。",
    "请联系 ops@example.com 或访问 https://example.test/a?q=1。",
    "保留 {name}、%1$s、`npm run build` 和以下代码块：",
    "```js",
    "const limit = 42;",
    "```",
  ].join("\n");

  it("accepts changed prose when every protected value is preserved", () => {
    expect(inspect(protectedSource, protectedTranslation)).toEqual({
      risks: [],
      pasteBlocked: false,
    });
  });

  it.each([
    ["number", "1.2", "1.3"],
    ["date", "2026-08-13", "2026-08-14"],
    ["unit", "3.5 kW", "3.5 MW"],
    ["email", "ops@example.com", "help@example.com"],
    ["url", "https://example.test/a?q=1", "https://example.test/a?q=2"],
    ["placeholder", "{name}", "{user}"],
    ["placeholder", "%1$s", "%2$s"],
    ["inline_code", "`npm run build`", "`npm run test`"],
    ["code_block", "const limit = 42;", "const limit = 43;"],
  ])("detects a changed %s", (kind, original, changed) => {
    const result = inspect(
      protectedSource,
      protectedTranslation.replace(original, changed),
    );

    expect(result.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: `protected.${kind}.mismatch`,
          severity: "critical",
          certainty: "deterministic",
        }),
      ]),
    );
    expect(result.pasteBlocked).toBe(true);
  });

  it("treats CRLF and LF as the same code-block line structure", () => {
    expect(
      inspect(
        "```js\r\nconst value = 1;\r\n```",
        "```js\nconst value = 1;\n```",
      ),
    ).toEqual({ risks: [], pasteBlocked: false });
  });

  it("compares duplicate protected values as multisets", () => {
    const result = inspect("IDs 42 and 42.", "编号 42。");

    expect(result.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "protected.number.mismatch" }),
      ]),
    );
  });

  it("detects newly added protected values", () => {
    expect(inspect("Hello", "你好 42")).toMatchObject({
      pasteBlocked: true,
      risks: expect.arrayContaining([
        expect.objectContaining({ code: "protected.number.mismatch" }),
      ]),
    });
  });

  it.each([
    ["版本2", "版本3", "protected.number.mismatch"],
    ["温度20°C", "温度21°C", "protected.unit.mismatch"],
    ["August 13, 2026", "September 13, 2026", "protected.date.mismatch"],
    ["版本１２", "版本１３", "protected.number.mismatch"],
    ["الإصدار ١٢", "الإصدار ١٣", "protected.number.mismatch"],
    ["功率 3.5 千瓦", "功率 3.5 兆瓦", "protected.unit.mismatch"],
    ["3.5 kilowatts", "3.5 megawatts", "protected.unit.mismatch"],
    ["2026年8月13日", "2026年8月14日", "protected.date.mismatch"],
    ["13 de agosto de 2026", "13 de septiembre de 2026", "protected.date.mismatch"],
  ])("detects protected values next to natural language in %s", (source, target, code) => {
    expect(inspect(source, target)).toMatchObject({
      pasteBlocked: true,
      risks: expect.arrayContaining([expect.objectContaining({ code })]),
    });
  });

  it("allows ICU branch prose to change while preserving its argument structure", () => {
    const source = "{count, plural, one {# file} other {# files}}";
    const translated = "{count, plural, one {# 个文件} other {# 个文件}}";
    expect(inspect(source, translated)).toEqual({ risks: [], pasteBlocked: false });

    expect(inspect(source, translated.replace("count", "total"))).toMatchObject({
      pasteBlocked: true,
      risks: expect.arrayContaining([
        expect.objectContaining({ code: "protected.placeholder.mismatch" }),
      ]),
    });
    expect(inspect(source, "{count, plural, one {} other {}}")).toMatchObject({
      pasteBlocked: true,
      risks: expect.arrayContaining([
        expect.objectContaining({ code: "protected.placeholder.mismatch" }),
      ]),
    });
  });

  it.each([
    ["See https://example.com/a_(b)", "See https://example.com/a_(c)"],
    ["Download ftp://example.com/a", "Download ftp://example.com/b"],
    ["Visit www.example.com/a", "Visit www.example.com/b"],
  ])("detects a changed URL in %s", (source, target) => {
    expect(inspect(source, target)).toMatchObject({
      pasteBlocked: true,
      risks: expect.arrayContaining([
        expect.objectContaining({ code: "protected.url.mismatch" }),
      ]),
    });
  });

  it("does not report numbers nested inside code, URLs or placeholders twice", () => {
    const result = inspect(
      "Keep `v2`, https://example.test/v2 and {item2}.",
      "保留 `v2`、https://example.test/v2 和 {item2}。",
    );

    expect(result).toEqual({ risks: [], pasteBlocked: false });
  });

  it("checks Markdown headings, lists, links, tables and fences without comparing prose", () => {
    const source = [
      "# Heading",
      "- first",
      "- second",
      "[docs](https://example.test/docs)",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    const translated = [
      "# 标题",
      "- 第一项",
      "- 第二项",
      "[文档](https://example.test/docs)",
      "| 甲 | 乙 |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");

    expect(inspect(source, translated)).toEqual({ risks: [], pasteBlocked: false });

    const broken = translated
      .replace("# 标题", "## 标题")
      .replace("- 第二项", "第二项")
      .replace("| 甲 | 乙 |", "| 甲乙 |");
    const result = inspect(source, broken);
    expect(result.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "structure.markdown.mismatch",
          severity: "critical",
        }),
      ]),
    );
  });

  it.each([
    ["> quoted text", "quoted text"],
    ["Use **strong text** here", "在这里使用普通文字"],
    ["before\n---\nafter", "之前\n之后"],
    ["> - item", "> item"],
    ["> # Heading", "> Heading"],
    ["<https://example.test/docs>", "https://example.test/docs"],
    ["[docs][id]\n\n[id]: https://example.test/docs", "docs\n\n[id]: https://example.test/docs"],
    ["[docs](https://example.test \"title\")", "[文档](https://example.test)"],
    ["| A | B |\n| :--- | ---: |", "| 甲 | 乙 |\n| --- | --- |"],
  ])("detects changed Markdown markers in %s", (source, target) => {
    expect(inspect(source, target)).toMatchObject({
      pasteBlocked: true,
      risks: expect.arrayContaining([
        expect.objectContaining({ code: "structure.markdown.mismatch" }),
      ]),
    });
  });

  it("detects a known translation wrapper only when the source lacks it", () => {
    const wrapped = inspect("Hello", "翻译如下：\n你好");
    expect(wrapped.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "output.known_wrapper" }),
      ]),
    );
    expect(inspect("翻译如下：Hello", "翻译如下：你好").risks).toEqual([]);
  });

  it("detects a fixed system-prompt fragment only when it was not source text", () => {
    const fragment = "You are the translation stage of Ruyi Translation.";
    expect(inspect("Hello", `${fragment}\n你好`)).toMatchObject({
      pasteBlocked: true,
      risks: expect.arrayContaining([
        expect.objectContaining({ code: "output.prompt_fragment" }),
      ]),
    });
    expect(inspect(fragment, fragment)).toEqual({ risks: [], pasteBlocked: false });

    expect(
      inspect("Hello", "Preserve protected content and document structure.\n你好"),
    ).toMatchObject({
      pasteBlocked: true,
      risks: expect.arrayContaining([
        expect.objectContaining({ code: "output.prompt_fragment" }),
      ]),
    });
  });

  it("blocks an empty completed translation as an output-contract risk", () => {
    expect(inspect("Hello", "")).toMatchObject({
      pasteBlocked: true,
      risks: expect.arrayContaining([
        expect.objectContaining({ code: "output.empty" }),
      ]),
    });
    expect(inspect("Hello", " \n\t")).toMatchObject({
      pasteBlocked: true,
      risks: expect.arrayContaining([
        expect.objectContaining({ code: "output.empty" }),
      ]),
    });
  });

  it("detects an extra copy of a fixed prompt fragment already present in source", () => {
    const fragment = "You are the translation stage of Ruyi Translation.";
    expect(inspect(fragment, `${fragment}\n${fragment}`)).toMatchObject({
      pasteBlocked: true,
      risks: expect.arrayContaining([
        expect.objectContaining({ code: "output.prompt_fragment" }),
      ]),
    });
  });

  it("handles many unmatched placeholder openings without quadratic scanning", () => {
    const startedAt = performance.now();
    inspect("source", "{a".repeat(50_000));
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("reports an incomplete stream as a deterministic risk without returning text", () => {
    const { inspectTranslationQuality } = require(qualityChecksPath);
    const result = inspectTranslationQuality({
      sourceText: "Hello",
      translation: "你好",
      streamCompleted: false,
    });

    expect(result).toEqual({
      risks: [
        expect.objectContaining({
          code: "stream.incomplete",
          severity: "critical",
          certainty: "deterministic",
        }),
      ],
      pasteBlocked: true,
    });
    expect(JSON.stringify(result)).not.toContain("Hello");
    expect(JSON.stringify(result)).not.toContain("你好");
  });

  it("extracts protected items with Unicode code-point ranges", () => {
    const { extractProtectedItems } = require(qualityChecksPath);
    const source = "😀 {name} and `x`";

    expect(extractProtectedItems(source)).toEqual([
      expect.objectContaining({
        type: "placeholder",
        sourceValue: "{name}",
        sourceRange: { start: 2, end: 8 },
      }),
      expect.objectContaining({
        type: "inline_code",
        sourceValue: "`x`",
        sourceRange: { start: 13, end: 16 },
      }),
    ]);
  });
});
