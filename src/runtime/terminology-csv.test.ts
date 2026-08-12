import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const csvPath = resolve(process.cwd(), "public/lib/terminology-csv.cjs");

const encoder = new TextEncoder();

function existingEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "existing",
    sourceTerm: "power grid",
    preferredTarget: "电网",
    sourceLanguage: "English",
    targetLanguage: "Simplified Chinese",
    allowedVariants: [],
    forbiddenTargets: [],
    meaning: null,
    strictness: "exact",
    caseSensitive: false,
    aliases: [],
    priority: 10,
    ...overrides,
  };
}

describe("Terminology CSV", () => {
  it("parses UTF-8 BOM, quoted commas, quotes, and multiline fields", () => {
    const { previewTermbaseCsv } = require(csvPath);
    const csv =
      "\uFEFFsourceTerm,preferredTarget,sourceLanguage,targetLanguage,allowedVariants,forbiddenTargets,meaning,strictness,caseSensitive,aliases,priority\r\n" +
      'API gateway,"API, 网关",English,Simplified Chinese,"[""API 网关"",""接口网关""]",[],"say ""hi""\r\nnext",exact,false,[],20\r\n';
    const preview = previewTermbaseCsv({
      bytes: encoder.encode(csv),
      existingEntries: [],
      entryIdFactory: () => "imported",
    });

    expect(preview.canImport).toBe(true);
    expect(preview.issues).toEqual([]);
    expect(preview.fieldMapping).toMatchObject({
      sourceTerm: "sourceTerm",
      preferredTarget: "preferredTarget",
      sourceLanguage: "sourceLanguage",
      targetLanguage: "targetLanguage",
    });
    expect(preview.entries[0]).toMatchObject({
      id: "imported",
      preferredTarget: "API, 网关",
      allowedVariants: ["API 网关", "接口网关"],
      meaning: 'say "hi"\r\nnext',
      strictness: "exact",
      caseSensitive: false,
      priority: 20,
    });
  });

  it("reports mapping, duplicate, conflict, direction, and invalid-row issues together", () => {
    const { previewTermbaseCsv } = require(csvPath);
    const csv = [
      "sourceTerm,preferredTarget,sourceLanguage,targetLanguage,strictness,caseSensitive,priority",
      "power grid,电网,English,Simplified Chinese,exact,false,10",
      "power grid,电力网,English,Simplified Chinese,exact,false,10",
      "same,相同,English,English,preferred,false,0",
      "broken,,English,Simplified Chinese,invalid,maybe,1.5",
    ].join("\n");
    const preview = previewTermbaseCsv({
      bytes: encoder.encode(csv),
      existingEntries: [existingEntry()],
      entryIdFactory: (() => {
        let index = 0;
        return () => `imported-${++index}`;
      })(),
    });

    expect(preview.canImport).toBe(false);
    expect(preview.issues.map((issue: { code: string }) => issue.code)).toEqual(
      expect.arrayContaining([
        "duplicate",
        "conflict",
        "language_direction",
        "invalid_row",
      ]),
    );
    expect(preview.issues.every((issue: { row: number }) => Number.isInteger(issue.row))).toBe(
      true,
    );
  });

  it("treats malformed CSV and invalid UTF-8 as fatal without returning rows", () => {
    const { previewTermbaseCsv } = require(csvPath);
    for (const bytes of [
      encoder.encode('sourceTerm,preferredTarget\n"unfinished,value'),
      Uint8Array.from([0xc3, 0x28]),
    ]) {
      const preview = previewTermbaseCsv({ bytes, existingEntries: [] });
      expect(preview.canImport).toBe(false);
      expect(preview.entries).toEqual([]);
      expect(preview.issues).toEqual([
        expect.objectContaining({ code: "fatal_format", severity: "error" }),
      ]);
    }
  });

  it("rejects oversized CSV input instead of allocating an unbounded preview", () => {
    const { previewTermbaseCsv } = require(csvPath);
    const preview = previewTermbaseCsv({
      bytes: new Uint8Array(5 * 1024 * 1024 + 1),
      existingEntries: [],
    });

    expect(preview.canImport).toBe(false);
    expect(preview.issues).toEqual([
      expect.objectContaining({ code: "fatal_format", message: expect.stringContaining("5 MiB") }),
    ]);
  });

  it("rejects a field mapping that assigns one CSV column twice", () => {
    const { previewTermbaseCsv } = require(csvPath);
    const preview = previewTermbaseCsv({
      bytes: encoder.encode(
        "sourceTerm,preferredTarget,sourceLanguage,targetLanguage\npower grid,电网,English,Simplified Chinese",
      ),
      mapping: {
        sourceTerm: "sourceTerm",
        preferredTarget: "sourceTerm",
      },
      existingEntries: [],
    });

    expect(preview.canImport).toBe(false);
    expect(preview.issues).toContainEqual(
      expect.objectContaining({ code: "mapping", field: "preferredTarget" }),
    );
  });

  it("rejects CSV files that include runtime secret or current-translation columns", () => {
    const { previewTermbaseCsv } = require(csvPath);
    const preview = previewTermbaseCsv({
      bytes: encoder.encode(
        "sourceTerm,preferredTarget,sourceLanguage,targetLanguage,apiKey,sourceText,translation\n" +
          "power grid,电网,English,Simplified Chinese,sk-secret,current source,current translation",
      ),
      existingEntries: [],
    });

    expect(preview.canImport).toBe(false);
    expect(preview.issues).toContainEqual(
      expect.objectContaining({ code: "mapping", field: "apiKey" }),
    );
  });

  it("exports only canonical term fields and round-trips spreadsheet formula prefixes", () => {
    const { exportTermbaseCsv, previewTermbaseCsv } = require(csvPath);
    const exported = exportTermbaseCsv({
      id: "base",
      name: "Secret / Terms",
      enabled: true,
      entries: [
        existingEntry({
          sourceTerm: "=SUM(1,1)",
          preferredTarget: "+cmd",
          meaning: 'line 1\nline "2"',
          aliases: ["@A1", "'literal"],
        }),
      ],
      apiKey: "must-not-export",
      sourceText: "current-source-must-not-export",
      translation: "current-translation-must-not-export",
    });
    const text = new TextDecoder().decode(exported.bytes);

    expect(exported.fileName).toBe("Secret Terms.csv");
    expect(text).not.toContain("must-not-export");
    expect(text).not.toContain("sourceText");
    expect(text).not.toContain("translation,");
    const imported = previewTermbaseCsv({
      bytes: exported.bytes,
      existingEntries: [],
      entryIdFactory: () => "round-trip",
    });
    expect(imported.canImport).toBe(true);
    expect(imported.entries[0]).toMatchObject({
      sourceTerm: "=SUM(1,1)",
      preferredTarget: "+cmd",
      meaning: 'line 1\nline "2"',
      aliases: ["@A1", "'literal"],
    });
  });
});
