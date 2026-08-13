import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  CHUNKING_VERSION,
  createTranslationPlan,
  mergeSegmentTranslations,
  parallelAccelerationAdvice,
  runSegmentPool,
} = require("../../public/lib/translation-segmentation.cjs");

function paragraph(label: string, length = 900) {
  return `${label}${"文".repeat(length)}。\n\n`;
}

describe("translation segmentation", () => {
  it("creates stable, contiguous segments on structural boundaries", () => {
    const sourceText = [
      "# 标题\r\n\r\n",
      paragraph("第一段"),
      paragraph("第二段"),
      paragraph("第三段"),
      paragraph("第四段"),
      paragraph("第五段"),
    ].join("");

    const first = createTranslationPlan(sourceText);
    const second = createTranslationPlan(sourceText);

    expect(first.mode).toBe("segmented");
    expect(first.chunkingVersion).toBe(CHUNKING_VERSION);
    expect(first.segments).toEqual(second.segments);
    expect(first.segments.length).toBeGreaterThan(1);
    expect(first.segments.map((segment: { ordinal: number }) => segment.ordinal)).toEqual(
      first.segments.map((_: unknown, ordinal: number) => ordinal),
    );
    expect(first.segments.every((segment: { ownedSource: string }) =>
      Array.from(segment.ownedSource).length <= 3_000,
    )).toBe(true);
    expect(first.segments.map((segment: { ownedSource: string }) => segment.ownedSource).join(""))
      .toBe(sourceText.replace(/\r\n/gu, "\n"));
    expect(first.segments[0].sourceStart).toBe(0);
    expect(first.segments.at(-1).sourceEnd).toBe(Array.from(first.normalizedSourceText).length);
    expect(first.segments.every((segment: { sourceContextBefore: string; sourceContextAfter: string }) =>
      Array.from(segment.sourceContextBefore).length <= 500 &&
      Array.from(segment.sourceContextAfter).length <= 500,
    )).toBe(true);
    for (let index = 1; index < first.segments.length; index += 1) {
      expect(first.segments[index - 1].sourceEnd).toBe(first.segments[index].sourceStart);
    }
  });

  it("never cuts protected Markdown, URLs, placeholders, or table rows", () => {
    const fenced = `\`\`\`js\n${"const value = 1;\n".repeat(80)}\`\`\`\n`;
    const url = `https://example.test/${"path-".repeat(120)}end?q={query}`;
    const tableRow = `| ${"cell ".repeat(180)} | value |\n`;
    const sourceText = [
      paragraph("开头", 1_500),
      fenced,
      paragraph("中间", 1_000),
      `${url}\n\n`,
      tableRow,
      paragraph("结尾", 1_500),
    ].join("");

    const plan = createTranslationPlan(sourceText);
    expect(plan.mode).toBe("segmented");
    const normalized = plan.normalizedSourceText;
    const spans = [fenced.trimEnd(), url, tableRow.trimEnd(), "{query}"].map((value) => {
      const start = Array.from(normalized.slice(0, normalized.indexOf(value))).length;
      return { start, end: start + Array.from(value).length };
    });
    const boundaries = plan.segments.slice(0, -1).map((segment: { sourceEnd: number }) => segment.sourceEnd);
    for (const boundary of boundaries) {
      expect(spans.some((span) => boundary > span.start && boundary < span.end)).toBe(false);
    }
  });

  it("falls back to a full-document request for an indivisible unit over 3000 code points", () => {
    const sourceText = `before\n\n\`\`\`text\n${"x".repeat(3_001)}\n\`\`\`\nafter`;

    const plan = createTranslationPlan(sourceText);

    expect(plan.mode).toBe("full_document");
    expect(plan.segments).toEqual([]);
    expect(plan.fallbackReason).toContain("代码块");
    expect(plan.fallbackReason).toContain("3,000");
  });

  it("treats indented code blocks and long inline Markdown spans as indivisible", () => {
    const indentedCode = Array.from(
      { length: 60 },
      (_, index) => `    ${"x".repeat(70)} // ${index}\n`,
    ).join("");
    const indentedPlan = createTranslationPlan(`说明\n\n${indentedCode}\n结尾`);
    expect(indentedPlan.mode).toBe("full_document");
    expect(indentedPlan.fallbackReason).toContain("代码块");

    const emphasisPlan = createTranslationPlan(`**${"x ".repeat(1_500)}**`);
    expect(emphasisPlan.mode).toBe("full_document");
    expect(emphasisPlan.fallbackReason).toContain("Markdown");
  });

  it("does not mistake an ordinary line containing one pipe for a Markdown table", () => {
    const plan = createTranslationPlan(`说明\n\na|${"x".repeat(5_000)}\n\n结尾`);

    expect(plan.mode).toBe("segmented");
    expect(plan.fallbackReason).toBeNull();
  });

  it("uses normalized Unicode code-point ranges for CRLF, emoji, and combining marks", () => {
    const sourceText = `${"A".repeat(2_100)}\r\n😀e\u0301。\r\n${"B".repeat(2_100)}`;
    const plan = createTranslationPlan(sourceText);

    expect(plan.mode).toBe("segmented");
    for (const segment of plan.segments) {
      const owned = Array.from(plan.normalizedSourceText)
        .slice(segment.sourceStart, segment.sourceEnd)
        .join("");
      expect(segment.ownedSource).toBe(owned);
    }
  });

  it("merges completed segments by ordinal instead of arrival order", () => {
    const plan = createTranslationPlan(
      [paragraph("一", 1_400), paragraph("二", 1_400), paragraph("三", 1_400)].join(""),
    );
    expect(plan.mode).toBe("segmented");
    const results = plan.segments
      .map((segment: { id: string; ordinal: number; sourceStart: number; sourceEnd: number }) => ({
        id: segment.id,
        ordinal: segment.ordinal,
        sourceStart: segment.sourceStart,
        sourceEnd: segment.sourceEnd,
        translation: `[${segment.ordinal}]`,
      }))
      .reverse();

    const merged = mergeSegmentTranslations(plan.segments, results);

    expect(merged.translation).toBe(plan.segments.map((segment: { ordinal: number }) => `[${segment.ordinal}]`).join(""));
    expect(merged.risks).toEqual([]);
  });

  it("reports missing, duplicate, unknown, and mismatched segment metadata", () => {
    const plan = createTranslationPlan(
      [paragraph("一", 1_400), paragraph("二", 1_400), paragraph("三", 1_400)].join(""),
    );
    const first = plan.segments[0];
    const merged = mergeSegmentTranslations(plan.segments, [
      { ...first, translation: "一" },
      { ...first, translation: "重复" },
      { ...plan.segments[1], ordinal: 99, translation: "错序" },
      { id: "unknown", ordinal: 2, sourceStart: 0, sourceEnd: 1, translation: "未知" },
    ]);

    expect(merged.risks.map((risk: { code: string }) => risk.code)).toEqual(
      expect.arrayContaining([
        "segment.duplicate",
        "segment.metadata_mismatch",
        "segment.unknown",
        "segment.missing",
      ]),
    );
    expect(merged.pasteBlocked).toBe(true);
  });

  it("reports when a segment repeats a substantial suffix of its read-only context", () => {
    const plan = createTranslationPlan(
      [paragraph("一", 1_400), paragraph("二", 1_400), paragraph("三", 1_400)].join(""),
    );
    const repeatedSegment = plan.segments[1];
    const repeatedSuffix = Array.from(repeatedSegment.sourceContextBefore)
      .slice(-32)
      .join("");
    const results = plan.segments.map((segment: {
      id: string;
      ordinal: number;
      sourceStart: number;
      sourceEnd: number;
    }) => ({
      ...segment,
      translation:
        segment.id === repeatedSegment.id ? `${repeatedSuffix}译文` : `译文${segment.ordinal}`,
    }));

    const merged = mergeSegmentTranslations(plan.segments, results);

    expect(merged.risks).toEqual([
      expect.objectContaining({ code: "segment.context_repeated" }),
    ]);
  });
});

describe("translation segment scheduling", () => {
  it("uses default concurrency 3 and never exceeds the configured limit", async () => {
    const segments = Array.from({ length: 7 }, (_, ordinal) => ({ id: `s-${ordinal}`, ordinal }));
    let active = 0;
    let maximumActive = 0;
    const releases: Array<() => void> = [];
    const translate = vi.fn(async (segment) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return { ...segment, sourceStart: segment.ordinal, sourceEnd: segment.ordinal + 1, translation: String(segment.ordinal) };
    });

    const running = runSegmentPool({ segments, translate });
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(3));
    while (releases.length > 0 || translate.mock.calls.length < segments.length) {
      releases.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const results = await running;

    expect(maximumActive).toBe(3);
    expect(results).toHaveLength(segments.length);
  });

  it("stops queued work and aborts in-flight requests when cancelled", async () => {
    const segments = Array.from({ length: 5 }, (_, ordinal) => ({ id: `s-${ordinal}`, ordinal }));
    const root = new AbortController();
    const signals: AbortSignal[] = [];
    const translate = vi.fn(
      (segment, { signal }: { signal: AbortSignal }) =>
        new Promise((resolve, reject) => {
          signals.push(signal);
          signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { code: "cancelled" })));
        }),
    );

    const running = runSegmentPool({ segments, concurrency: 2, signal: root.signal, translate });
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2));
    root.abort();

    await expect(running).rejects.toMatchObject({ code: "cancelled" });
    expect(translate).toHaveBeenCalledTimes(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("preserves partial results reported by every in-flight worker when one segment fails", async () => {
    const segments = Array.from({ length: 2 }, (_, ordinal) => ({
      id: `s-${ordinal}`,
      ordinal,
      sourceStart: ordinal,
      sourceEnd: ordinal + 1,
    }));
    const translate = vi.fn(
      (segment, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const error = Object.assign(new Error(segment.ordinal === 0 ? "failed" : "cancelled"), {
            code: segment.ordinal === 0 ? "protocol_error" : "cancelled",
            partialSegmentResult: { ...segment, translation: String(segment.ordinal) },
          });
          if (segment.ordinal === 0) {
            queueMicrotask(() => reject(error));
          } else {
            signal.addEventListener("abort", () => reject(error), { once: true });
          }
        }),
    );

    const error = await runSegmentPool({ segments, concurrency: 2, translate }).catch(
      (caught: unknown) => caught as { code: string; partialSegmentResults: unknown[] },
    );

    expect(error).toMatchObject({ code: "protocol_error" });
    expect(error.partialSegmentResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "s-0", translation: "0" }),
        expect.objectContaining({ id: "s-1", translation: "1" }),
      ]),
    );
  });

  it("validates concurrency and computes the documented suggestion threshold", async () => {
    await expect(runSegmentPool({ segments: [], concurrency: 0, translate: vi.fn() }))
      .rejects.toMatchObject({ code: "invalid_parallel_configuration" });
    await expect(runSegmentPool({ segments: [], concurrency: 7, translate: vi.fn() }))
      .rejects.toMatchObject({ code: "invalid_parallel_configuration" });

    expect(parallelAccelerationAdvice({ sourceCodePoints: 4_000, performanceSummary: null }).suggested)
      .toBe(false);
    expect(parallelAccelerationAdvice({ sourceCodePoints: 4_001, performanceSummary: null })).toMatchObject({
      suggested: true,
      estimatedSeconds: null,
    });
    expect(parallelAccelerationAdvice({
      sourceCodePoints: 5_000,
      performanceSummary: {
        sampleCount: 3,
        averageFirstOutputMilliseconds: 2_000,
        averageCompletionMilliseconds: 40_000,
        averageOutputCodePointsPerSecond: 100,
      },
    })).toMatchObject({ suggested: true, estimatedSeconds: 52 });
  });
});
