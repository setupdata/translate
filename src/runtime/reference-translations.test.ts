import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const modulePath = resolve(process.cwd(), "public/lib/reference-translations.cjs");

const targetLanguage = {
  kind: "preset",
  id: "zh-CN",
  modelLabel: "Simplified Chinese",
};

function reference(overrides: Record<string, unknown> = {}) {
  return {
    id: "reference-1",
    sourceLanguage: "English",
    targetLanguage: "Simplified Chinese",
    domainProfileId: "energy-profile",
    source: "Power grid alarm response procedure",
    translation: "电网告警处置规程",
    ...overrides,
  };
}

describe("Reference translations", () => {
  it("validates the complete record and its Unicode budgets", () => {
    const { validateReferenceTranslation } = require(modulePath);
    expect(
      validateReferenceTranslation(reference({ id: null }), {
        domainProfiles: [{ id: "energy-profile" }],
        idFactory: () => "generated-reference",
      }),
    ).toEqual({
      id: "generated-reference",
      sourceLanguage: "English",
      targetLanguage: "Simplified Chinese",
      domainProfileId: "energy-profile",
      source: "Power grid alarm response procedure",
      translation: "电网告警处置规程",
    });
    expect(() =>
      validateReferenceTranslation(reference({ source: "😀".repeat(2_001) }), {
        domainProfiles: [{ id: "energy-profile" }],
      }),
    ).toThrow("参考源文本不能超过 2,000 个 Unicode 码点");
    expect(() =>
      validateReferenceTranslation(reference({ translation: "译".repeat(2_001) }), {
        domainProfiles: [{ id: "energy-profile" }],
      }),
    ).toThrow("参考译文不能超过 2,000 个 Unicode 码点");
  });

  it("selects at most three locally similar records with stable ordering", () => {
    const { selectReferenceTranslations } = require(modulePath);
    const selected = selectReferenceTranslations({
      sourceText: "Handle a power grid alarm in the control room.",
      targetLanguage,
      domainProfileId: "energy-profile",
      referenceTranslations: [
        reference({ id: "third", source: "Control room shift handover" }),
        reference({ id: "best", source: "Power grid alarm handling" }),
        reference({ id: "second", source: "Alarm response in a power grid" }),
        reference({ id: "fourth", source: "Power grid maintenance" }),
        reference({ id: "wrong-profile", domainProfileId: "other" }),
        reference({ id: "wrong-target", targetLanguage: "Japanese" }),
        reference({ id: "wrong-source", sourceLanguage: "Japanese" }),
        reference({ id: "unrelated", source: "Steam turbine bearing" }),
      ],
    });

    expect(selected).toHaveLength(3);
    expect(selected.map((item: { id: string }) => item.id)).toEqual([
      "second",
      "best",
      "fourth",
    ]);
  });

  it("validates explicit selections instead of truncating a fourth record", () => {
    const { resolveReferenceSelection } = require(modulePath);
    const references = ["one", "two", "three", "four"].map((id) =>
      reference({ id, source: `Power grid alarm ${id}` }),
    );
    expect(() =>
      resolveReferenceSelection({
        selectedIds: ["one", "two", "three", "four"],
        candidates: references,
      }),
    ).toThrow("参考译例最多选择 3 条");
    expect(
      resolveReferenceSelection({
        selectedIds: ["three", "one"],
        candidates: references,
      }).map((item: { id: string }) => item.id),
    ).toEqual(["three", "one"]);
    expect(() =>
      resolveReferenceSelection({ selectedIds: ["missing"], candidates: references }),
    ).toThrow("选择的参考译例不在本次预览中");
  });
});
