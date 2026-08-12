import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const textLimitsPath = resolve(
  import.meta.dirname,
  "../../public/lib/text-limits.cjs",
);

describe("Unicode code point limits", () => {
  it("normalizes CRLF only for source counting and preserves the original text", () => {
    const { inspectSourceText } = require(textLimitsPath);
    const sourceText = "A\r\n😀e\u0301";

    expect(inspectSourceText(sourceText)).toEqual({
      originalText: sourceText,
      normalizedCodePointCount: 5,
      valid: true,
    });
  });

  it.each([
    [9_999, true],
    [10_000, true],
    [10_001, false],
  ])("accepts exactly the configured source boundary: %i", (length, valid) => {
    const { inspectSourceText } = require(textLimitsPath);
    const result = inspectSourceText("😀".repeat(length));

    expect(result.normalizedCodePointCount).toBe(length);
    expect(result.valid).toBe(valid);
  });

  it("counts combining marks as separate code points", () => {
    const { countCodePoints } = require(textLimitsPath);

    expect(countCodePoints("e\u0301")).toBe(2);
  });

  it("accepts 100,000 output code points and rejects the next one", () => {
    const { createOutputAccumulator } = require(textLimitsPath);
    const accumulator = createOutputAccumulator(100_000);

    expect(accumulator.append("😀".repeat(99_999))).toBe(true);
    expect(accumulator.append("好")).toBe(true);
    expect(accumulator.append("界")).toBe(false);
    expect(accumulator.text()).toBe(`${"😀".repeat(99_999)}好`);
    expect(accumulator.codePointCount()).toBe(100_000);
  });

  it("retains the allowed prefix when one delta crosses the output limit", () => {
    const { createOutputAccumulator } = require(textLimitsPath);
    const accumulator = createOutputAccumulator(3);

    expect(accumulator.append("你好世界")).toBe(false);
    expect(accumulator.text()).toBe("你好世");
    expect(accumulator.codePointCount()).toBe(3);
  });
});
