import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const terminologyPath = resolve(process.cwd(), "public/lib/terminology.cjs");

const targetLanguage = {
  kind: "preset",
  id: "zh-CN",
  modelLabel: "Simplified Chinese",
};

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "term-api-gateway",
    sourceTerm: "API gateway",
    preferredTarget: "API 网关",
    sourceLanguage: "English",
    targetLanguage: "Simplified Chinese",
    allowedVariants: ["接口网关"],
    forbiddenTargets: ["API 门户"],
    meaning: "A gateway in an API architecture.",
    strictness: "exact",
    caseSensitive: false,
    aliases: ["gateway API"],
    priority: 10,
    ...overrides,
  };
}

function termbase(overrides: Record<string, unknown> = {}) {
  return {
    id: "general-terms",
    name: "通用术语",
    enabled: true,
    entries: [entry()],
    ...overrides,
  };
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: "software-profile",
    version: "1",
    name: "软件开发",
    field: "Software engineering",
    documentType: "Technical documentation",
    audience: "Developers",
    style: "Concise and precise",
    termbaseIds: ["domain-terms"],
    preserveRules: ["Keep command names unchanged."],
    ...overrides,
  };
}

describe("Terminology", () => {
  it("validates and normalizes every supported term field without truncating", () => {
    const { validateTermbase } = require(terminologyPath);
    const normalized = validateTermbase(
      termbase({ id: null, entries: [entry({ id: null })] }),
      { termbases: [], idFactory: () => "new-termbase", entryIdFactory: () => "new-term" },
    );

    expect(normalized).toEqual({
      id: "new-termbase",
      name: "通用术语",
      enabled: true,
      entries: [{ ...entry(), id: "new-term" }],
    });
    expect(Object.isFrozen(normalized)).toBe(true);
  });

  it.each([
    ["sourceTerm", "x".repeat(201), "源术语"],
    ["preferredTarget", "译".repeat(201), "首选译法"],
    ["allowedVariants", Array.from({ length: 21 }, (_, index) => `v${index}`), "允许变体"],
    ["forbiddenTargets", Array.from({ length: 21 }, (_, index) => `f${index}`), "禁止译法"],
    ["aliases", Array.from({ length: 21 }, (_, index) => `a${index}`), "别名"],
    ["meaning", "m".repeat(1_001), "含义或适用语境"],
  ])("rejects an over-budget %s field with a concrete message", (field, value, label) => {
    const { validateTermbase } = require(terminologyPath);
    expect(() =>
      validateTermbase(
        termbase({ entries: [entry({ [field]: value })] }),
        { termbases: [], idFactory: () => "unused", entryIdFactory: () => "unused" },
      ),
    ).toThrow(label);
  });

  it("validates domain profile fields and linked termbases", () => {
    const { validateDomainProfile } = require(terminologyPath);
    const normalized = validateDomainProfile(
      profile({ id: null }),
      {
        domainProfiles: [],
        termbases: [termbase({ id: "domain-terms" })],
        idFactory: () => "new-profile",
      },
    );

    expect(normalized).toEqual({ ...profile(), id: "new-profile" });
    expect(() =>
      validateDomainProfile(profile({ termbaseIds: ["missing"] }), {
        domainProfiles: [],
        termbases: [],
        idFactory: () => "unused",
      }),
    ).toThrow("关联的术语库不存在");
  });

  it("matches phrase boundaries, punctuation, hyphen variants, aliases, and case rules", () => {
    const { resolveTerminology } = require(terminologyPath);
    const result = resolveTerminology({
      sourceText:
        "The API-gateway differs from an api gateway. gateway API is an alias; apigateway is not.",
      targetLanguage,
      taskTerms: [],
      termbases: [
        termbase({
          entries: [
            entry({ sourceTerm: "API-gateway", aliases: ["gateway API"] }),
            entry({
              id: "case-sensitive",
              sourceTerm: "HTTP",
              preferredTarget: "HTTP",
              aliases: [],
              caseSensitive: true,
            }),
          ],
        }),
      ],
      domainProfile: null,
    });

    expect(result.matchedTerms).toHaveLength(1);
    expect(result.matchedTerms[0]).toMatchObject({
      id: "general-terms:term-api-gateway",
      source: "API-gateway",
      origin: "general",
    });
    expect(result.conflicts).toEqual([]);
  });

  it("treats a CJK character next to a Latin term as a phrase boundary", () => {
    const { resolveTerminology } = require(terminologyPath);
    const result = resolveTerminology({
      sourceText: "请检查API gateway状态。",
      targetLanguage,
      taskTerms: [],
      termbases: [termbase()],
      domainProfile: null,
    });

    expect(result.matchedTerms).toHaveLength(1);
  });

  it("filters the target direction and sends only terms actually present in the source", () => {
    const { resolveTerminology } = require(terminologyPath);
    const result = resolveTerminology({
      sourceText: "Use an API gateway.",
      targetLanguage,
      taskTerms: [],
      termbases: [
        termbase({
          entries: [
            entry(),
            entry({ id: "not-present", sourceTerm: "load balancer" }),
            entry({ id: "wrong-direction", targetLanguage: "Japanese" }),
          ],
        }),
      ],
      domainProfile: null,
    });

    expect(result.matchedTerms.map((term: { id: string }) => term.id)).toEqual([
      "general-terms:term-api-gateway",
    ]);
  });

  it("accepts the localized label of a preset target language", () => {
    const { resolveTerminology } = require(terminologyPath);
    expect(
      resolveTerminology({
        sourceText: "Use an API gateway.",
        targetLanguage,
        taskTerms: [],
        termbases: [
          termbase({ entries: [entry({ targetLanguage: "简体中文" })] }),
        ],
        domainProfile: null,
      }).matchedTerms,
    ).toHaveLength(1);
  });

  it("filters terms whose source-language script does not match the source text", () => {
    const { resolveTerminology } = require(terminologyPath);
    const englishSource = resolveTerminology({
      sourceText: "Use the API gateway.",
      targetLanguage,
      taskTerms: [],
      termbases: [
        termbase({
          entries: [entry({ sourceLanguage: "Japanese" })],
        }),
      ],
      domainProfile: null,
    });
    expect(englishSource.matchedTerms).toEqual([]);

    const japaneseSource = resolveTerminology({
      sourceText: "API gatewayを使用します。",
      targetLanguage,
      taskTerms: [],
      termbases: [
        termbase({
          entries: [entry({ sourceLanguage: "Japanese" })],
        }),
      ],
      domainProfile: null,
    });
    expect(japaneseSource.matchedTerms).toHaveLength(1);
  });

  it("accepts an explicitly configured alias even when it uses another script", () => {
    const { resolveTerminology } = require(terminologyPath);
    const result = resolveTerminology({
      sourceText: "I saw Tokyo.",
      targetLanguage,
      taskTerms: [],
      termbases: [
        termbase({
          entries: [
            entry({
              sourceTerm: "東京",
              sourceLanguage: "Japanese",
              aliases: ["Tokyo"],
            }),
          ],
        }),
      ],
      domainProfile: null,
    });

    expect(result.matchedTerms).toHaveLength(1);
  });

  it("does not reject a Japanese term merely because the text contains only Han characters", () => {
    const { resolveTerminology } = require(terminologyPath);
    const result = resolveTerminology({
      sourceText: "東京",
      targetLanguage,
      taskTerms: [],
      termbases: [
        termbase({
          entries: [entry({ sourceTerm: "東京", sourceLanguage: "Japanese" })],
        }),
      ],
      domainProfile: null,
    });

    expect(result.matchedTerms).toHaveLength(1);
  });

  it("orders task, domain, and general terms before priority and longer phrases", () => {
    const { resolveTerminology } = require(terminologyPath);
    const result = resolveTerminology({
      sourceText: "API gateway gateway API",
      targetLanguage,
      taskTerms: [{ sourceTerm: "API gateway", preferredTarget: "本次网关" }],
      termbases: [
        termbase({
          id: "domain-terms",
          enabled: true,
          entries: [
            entry({ id: "domain-short", sourceTerm: "gateway", priority: 50 }),
            entry({ id: "domain-long", sourceTerm: "API gateway", priority: 50 }),
          ],
        }),
        termbase({
          id: "other-general",
          entries: [entry({ id: "general-high", priority: 999 })],
        }),
      ],
      domainProfile: profile(),
    });

    expect(
      result.matchedTerms.map(
        (term: { origin: string; id: string }) => `${term.origin}:${term.id}`,
      ),
    ).toEqual([
      "task:task:0",
      "domain:domain-terms:domain-long",
      "domain:domain-terms:domain-short",
      "general:other-general:general-high",
    ]);
  });

  it("reports same-level exact conflicts but lets a task term resolve lower-level conflicts", () => {
    const { resolveTerminology } = require(terminologyPath);
    const conflictingTermbases = [
      termbase({
        id: "one",
        entries: [entry({ id: "one", preferredTarget: "接口网关", priority: 5 })],
      }),
      termbase({
        id: "two",
        entries: [entry({ id: "two", preferredTarget: "API 网关", priority: 5 })],
      }),
    ];
    const conflict = resolveTerminology({
      sourceText: "API gateway",
      targetLanguage,
      taskTerms: [],
      termbases: conflictingTermbases,
      domainProfile: null,
    });
    expect(conflict.conflicts).toEqual([
      expect.objectContaining({
        source: "API gateway",
        choices: expect.arrayContaining([
          expect.objectContaining({ preferredTarget: "接口网关" }),
          expect.objectContaining({ preferredTarget: "API 网关" }),
        ]),
      }),
    ]);

    const resolved = resolveTerminology({
      sourceText: "API gateway",
      targetLanguage,
      taskTerms: [{ sourceTerm: "API gateway", preferredTarget: "本次选择" }],
      termbases: conflictingTermbases,
      domainProfile: null,
    });
    expect(resolved.conflicts).toEqual([]);
    expect(resolved.matchedTerms[0]).toMatchObject({
      origin: "task",
      preferredTarget: "本次选择",
    });
  });

  it("reports the source surface that actually matched an alias conflict", () => {
    const { resolveTerminology } = require(terminologyPath);
    const conflict = resolveTerminology({
      sourceText: "gateway API",
      targetLanguage,
      taskTerms: [],
      termbases: [
        termbase({
          id: "one",
          entries: [
            entry({
              id: "one",
              sourceTerm: "API gateway",
              aliases: ["gateway API"],
              preferredTarget: "接口网关",
            }),
          ],
        }),
        termbase({
          id: "two",
          entries: [
            entry({
              id: "two",
              sourceTerm: "gateway API",
              aliases: ["API gateway"],
              preferredTarget: "API 网关",
            }),
          ],
        }),
      ],
      domainProfile: null,
    });

    expect(conflict.conflicts[0].source).toBe("gateway API");
    const resolved = resolveTerminology({
      sourceText: "gateway API",
      targetLanguage,
      taskTerms: [{ sourceTerm: "gateway API", preferredTarget: "本次选择" }],
      termbases: [
        termbase({
          id: "one",
          entries: [entry({ id: "one", aliases: ["gateway API"] })],
        }),
        termbase({
          id: "two",
          entries: [
            entry({
              id: "two",
              sourceTerm: "gateway API",
              preferredTarget: "另一个译法",
            }),
          ],
        }),
      ],
      domainProfile: null,
    });
    expect(resolved.conflicts).toEqual([]);
  });

  it("compares overlapping candidates by the matched alias length", () => {
    const { resolveTerminology } = require(terminologyPath);
    const result = resolveTerminology({
      sourceText: "power grid",
      targetLanguage,
      taskTerms: [],
      termbases: [
        termbase({
          id: "one",
          entries: [
            entry({
              id: "one",
              sourceTerm: "power grid",
              aliases: ["grid"],
              preferredTarget: "电网",
            }),
          ],
        }),
        termbase({
          id: "two",
          entries: [
            entry({
              id: "two",
              sourceTerm: "grid",
              aliases: ["power grid"],
              preferredTarget: "电力网",
            }),
          ],
        }),
      ],
      domainProfile: null,
    });
    expect(result.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "power grid" })]),
    );
  });

  it("detects a conflict from the shared surface even if one term also matches a longer alias", () => {
    const { resolveTerminology } = require(terminologyPath);
    const result = resolveTerminology({
      sourceText: "power grid and long alias phrase",
      targetLanguage,
      taskTerms: [],
      termbases: [
        termbase({
          id: "one",
          entries: [
            entry({
              id: "one",
              sourceTerm: "grid",
              aliases: ["power grid", "long alias phrase"],
              preferredTarget: "电网",
            }),
          ],
        }),
        termbase({
          id: "two",
          entries: [
            entry({
              id: "two",
              sourceTerm: "power grid",
              preferredTarget: "电力网",
            }),
          ],
        }),
      ],
      domainProfile: null,
    });

    expect(result.conflicts).toEqual([
      expect.objectContaining({ source: "power grid" }),
    ]);
  });

  it("normalizes fullwidth and small hyphen variants", () => {
    const { resolveTerminology } = require(terminologyPath);
    for (const sourceText of ["API﹣gateway", "API－gateway"]) {
      expect(
        resolveTerminology({
          sourceText,
          targetLanguage,
          taskTerms: [],
          termbases: [
            termbase({ entries: [entry({ sourceTerm: "API-gateway" })] }),
          ],
          domainProfile: null,
        }).matchedTerms,
      ).toHaveLength(1);
    }
  });

  it("rejects malformed task terms instead of silently dropping them", () => {
    const { resolveTerminology } = require(terminologyPath);
    expect(() =>
      resolveTerminology({
        sourceText: "power grid",
        targetLanguage,
        taskTerms: [{ sourceTerm: "power grid" }],
        termbases: [],
        domainProfile: null,
      }),
    ).toThrow("本次术语的目标译法");
  });

  it("rejects more than 100 matched terms instead of truncating", () => {
    const { resolveTerminology } = require(terminologyPath);
    const entries = Array.from({ length: 101 }, (_, index) =>
      entry({
        id: `term-${index}`,
        sourceTerm: `word${index}`,
        preferredTarget: `词${index}`,
        aliases: [],
      }),
    );
    expect(() =>
      resolveTerminology({
        sourceText: entries.map((item) => item.sourceTerm).join(" "),
        targetLanguage,
        taskTerms: [],
        termbases: [termbase({ entries })],
        domainProfile: null,
      }),
    ).toThrow("命中术语为 101 条，超过 100 条上限");
  });

  it("reports the exact runtime field that exceeds a prompt budget", () => {
    const { validateTranslationInputBudget } = require(terminologyPath);
    const baseInput = {
      sourceText: "source",
      additionalRequirements: "",
      matchedTerms: [],
      domainProfile: null,
    };
    expect(() =>
      validateTranslationInputBudget({
        input: { ...baseInput, additionalRequirements: "x".repeat(2_001) },
      }),
    ).toThrow("附加翻译要求不能超过 2,000 个 Unicode 码点");
    expect(() =>
      validateTranslationInputBudget({
        input: {
          ...baseInput,
          domainProfile: {
            id: "profile",
            version: "1",
            name: "Profile",
            field: "x".repeat(501),
            documentType: null,
            audience: null,
            style: null,
            preserveRules: [],
          },
        },
      }),
    ).toThrow("行业字段不能超过 500 个 Unicode 码点");
  });

  it("marks exact and forbidden terminology violations as critical deterministic risks", () => {
    const { inspectTerminologyQuality } = require(terminologyPath);
    const risks = inspectTerminologyQuality({
      translation: "使用了 API 门户。",
      matchedTerms: [
        {
          ...entry(),
          id: "general-terms:term-api-gateway",
          source: "API gateway",
          origin: "general",
        },
      ],
    });

    expect(risks.map((risk: { code: string }) => risk.code)).toEqual([
      "terminology.exact_missing",
      "terminology.forbidden_target",
    ]);
    expect(risks.every((risk: { category: string }) => risk.category === "terminology")).toBe(
      true,
    );
    expect(
      risks.every(
        (risk: { certainty: string; severity: string }) =>
          risk.certainty === "deterministic" && risk.severity === "critical",
      ),
    ).toBe(true);
  });

  it("requires the preferred target for exact terms and honors the case-sensitive flag", () => {
    const { inspectTerminologyQuality } = require(terminologyPath);
    expect(
      inspectTerminologyQuality({
        translation: "接口网关",
        matchedTerms: [
          {
            ...entry({ caseSensitive: false }),
            source: "API gateway",
            preferredTarget: "API 网关",
            allowedVariants: ["接口网关"],
          },
        ],
      }).map((risk: { code: string }) => risk.code),
    ).toContain("terminology.exact_missing");
    expect(
      inspectTerminologyQuality({
        translation: "api 网关",
        matchedTerms: [
          {
            ...entry({ caseSensitive: false }),
            source: "API gateway",
            preferredTarget: "API 网关",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("requires an exact target for every source occurrence", () => {
    const { inspectTerminologyQuality } = require(terminologyPath);
    const risks = inspectTerminologyQuality({
      translation: "电网和错误译法",
      matchedTerms: [
        {
          ...entry(),
          source: "power grid",
          requiredOccurrences: 2,
        },
      ],
    });

    expect(risks).toEqual([
      expect.objectContaining({
        code: "terminology.exact_missing",
        severity: "critical",
      }),
    ]);
  });
});
