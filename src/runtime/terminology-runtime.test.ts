import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const runtimePath = resolve(process.cwd(), "public/lib/ruyi-runtime.cjs");

function memoryStorage() {
  const values = new Map<string, unknown>();
  return {
    values,
    getItem: (key: string) => values.get(key),
    setItem: (key: string, value: unknown) => values.set(key, structuredClone(value)),
    removeItem: (key: string) => values.delete(key),
  };
}

const servicePreset = {
  id: "local-chat",
  name: "本地模型",
  type: "custom",
  protocol: "chat-completions",
  translationUrl: "http://127.0.0.1:11434/v1/chat/completions",
  modelListUrl: "http://127.0.0.1:11434/v1/models",
  authentication: "none",
  model: "fixture-model",
  stream: false,
  confirmedTranslationUrl: "http://127.0.0.1:11434/v1/chat/completions",
};

const targetLanguage = {
  kind: "preset",
  id: "zh-CN",
  modelLabel: "Simplified Chinese",
};

function term(overrides: Record<string, unknown> = {}) {
  return {
    id: "term-1",
    sourceTerm: "power grid",
    preferredTarget: "电网",
    sourceLanguage: "English",
    targetLanguage: "Simplified Chinese",
    allowedVariants: [],
    forbiddenTargets: ["电力网络"],
    meaning: "Electric power network.",
    strictness: "exact",
    caseSensitive: false,
    aliases: [],
    priority: 10,
    ...overrides,
  };
}

function termbase(overrides: Record<string, unknown> = {}) {
  return {
    id: "general-base",
    name: "通用术语",
    enabled: true,
    entries: [term()],
    ...overrides,
  };
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: "energy-profile",
    version: "1",
    name: "能源行业",
    field: "Energy",
    documentType: "Operating manual",
    audience: "Operators",
    style: "Accurate and concise",
    termbaseIds: ["domain-base"],
    preserveRules: ["Keep equipment tags unchanged."],
    ...overrides,
  };
}

function runtimeFixture(translation = "本次任务用于控制室中的电力网络。") {
  const plainStorage = memoryStorage();
  const cryptoStorage = memoryStorage();
  const transport = {
    request: vi.fn(async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ choices: [{ message: { content: translation } }] }),
      complete: true,
    })),
  };
  const { createRuyiRuntime } = require(runtimePath);
  const runtime = createRuyiRuntime({
    plainStorage,
    cryptoStorage,
    transport,
    servicePreset,
    terminologyIdFactory: (() => {
      let next = 0;
      return () => `generated-${++next}`;
    })(),
  });
  return { runtime, plainStorage, cryptoStorage, transport };
}

describe("Ruyi runtime terminology integration", () => {
  it("stores reusable terminology only in encrypted storage and cleans profile links", async () => {
    const { runtime, plainStorage, cryptoStorage, transport } = runtimeFixture();

    expect(await runtime.getTerminologyState()).toEqual({
      termbases: [],
      domainProfiles: [],
      currentDomainProfileId: null,
    });
    await runtime.saveTermbase(termbase({ id: null, entries: [term({ id: null })] }));
    const generatedBase = (await runtime.getTerminologyState()).termbases[0];
    await runtime.saveDomainProfile(
      profile({ id: null, termbaseIds: [generatedBase.id] }),
    );
    const generatedProfile = (await runtime.getTerminologyState()).domainProfiles[0];
    await runtime.setCurrentDomainProfile(generatedProfile.id);

    expect(await runtime.getTerminologyState()).toMatchObject({
      currentDomainProfileId: generatedProfile.id,
      termbases: [{ id: generatedBase.id, entries: [{ id: expect.any(String) }] }],
      domainProfiles: [{ id: generatedProfile.id, termbaseIds: [generatedBase.id] }],
    });
    expect(JSON.stringify([...plainStorage.values.values()])).not.toContain("power grid");
    expect(JSON.stringify([...cryptoStorage.values.values()])).toContain("power grid");
    expect(transport.request).not.toHaveBeenCalled();

    await runtime.deleteTermbase(generatedBase.id);
    expect((await runtime.getTerminologyState()).domainProfiles[0].termbaseIds).toEqual([]);
    await runtime.deleteDomainProfile(generatedProfile.id);
    expect(await runtime.getTerminologyState()).toEqual({
      termbases: [],
      domainProfiles: [],
      currentDomainProfileId: null,
    });
  });

  it("sends only matched task, domain, and general terms in priority order", async () => {
    const { runtime, transport } = runtimeFixture();
    await runtime.saveTermbase(
      termbase({
        id: "general-base",
        entries: [term(), term({ id: "not-present", sourceTerm: "boiler" })],
      }),
    );
    await runtime.saveTermbase(
      termbase({
        id: "domain-base",
        name: "行业术语",
        enabled: false,
        entries: [
          term({
            id: "control-room",
            sourceTerm: "control room",
            preferredTarget: "控制室",
            forbiddenTargets: [],
          }),
        ],
      }),
    );
    await runtime.saveDomainProfile(profile());
    await runtime.setCurrentDomainProfile("energy-profile");

    const result = await runtime.startStandardTranslation({
      taskId: "task-terms",
      sourceText: "Use the power grid in the control room for current task.",
      targetLanguage,
      domainProfileId: "energy-profile",
      taskTerms: [{ sourceTerm: "current task", preferredTarget: "本次任务" }],
    });

    expect(result).toMatchObject({
      status: "completed",
      quality: {
        pasteBlocked: true,
        risks: expect.arrayContaining([
          expect.objectContaining({ code: "terminology.exact_missing" }),
          expect.objectContaining({ code: "terminology.forbidden_target" }),
        ]),
      },
    });
    const request = (transport.request as unknown as { mock: { calls: Array<[any]> } }).mock
      .calls[0][0];
    const body = JSON.parse(request.body);
    const input = JSON.parse(body.messages[1].content);
    expect(input.domainProfile).toEqual({
      id: "energy-profile",
      version: "1",
      name: "能源行业",
      field: "Energy",
      documentType: "Operating manual",
      audience: "Operators",
      style: "Accurate and concise",
      preserveRules: ["Keep equipment tags unchanged."],
    });
    expect(
      input.matchedTerms.map((item: { origin: string; source: string }) =>
        `${item.origin}:${item.source}`,
      ),
    ).toEqual([
      "task:current task",
      "domain:control room",
      "general:power grid",
    ]);
    expect(request.body).not.toContain("boiler");
  });

  it("stops before the network for a same-level strict conflict and accepts a task choice", async () => {
    const { runtime, transport } = runtimeFixture("采用本次选择。");
    await runtime.saveTermbase(
      termbase({
        id: "one",
        name: "术语库一",
        entries: [term({ id: "one", preferredTarget: "接口网关" })],
      }),
    );
    await runtime.saveTermbase(
      termbase({
        id: "two",
        name: "术语库二",
        entries: [term({ id: "two", preferredTarget: "API 网关" })],
      }),
    );

    const conflicted = await runtime.startStandardTranslation({
      taskId: "conflict",
      sourceText: "power grid",
      targetLanguage,
    });
    expect(conflicted).toMatchObject({
      status: "validation_error",
      reason: "terminology_conflict",
      sourceRetained: true,
      terminologyConflicts: [
        expect.objectContaining({
          source: "power grid",
          choices: expect.arrayContaining([
            expect.objectContaining({ preferredTarget: "接口网关" }),
            expect.objectContaining({ preferredTarget: "API 网关" }),
          ]),
        }),
      ],
    });
    expect(transport.request).not.toHaveBeenCalled();

    const resolved = await runtime.startStandardTranslation({
      taskId: "resolved",
      sourceText: "power grid",
      targetLanguage,
      taskTerms: [{ sourceTerm: "power grid", preferredTarget: "本次选择" }],
    });
    expect(resolved).toMatchObject({
      status: "completed",
      quality: { risks: [], pasteBlocked: false },
    });
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it("reports term-count and field budgets without truncating or sending a request", async () => {
    const { runtime, transport } = runtimeFixture();
    await runtime.saveTermbase(
      termbase({
        entries: Array.from({ length: 101 }, (_, index) =>
          term({
            id: `term-${index}`,
            sourceTerm: `word${index}`,
            preferredTarget: `词${index}`,
            forbiddenTargets: [],
          }),
        ),
      }),
    );
    const sourceText = Array.from({ length: 101 }, (_, index) => `word${index}`).join(" ");

    const tooMany = await runtime.startStandardTranslation({
      taskId: "too-many",
      sourceText,
      targetLanguage,
    });
    expect(tooMany).toMatchObject({
      status: "validation_error",
      reason: "terminology_limit_exceeded",
      field: "matchedTerms",
      message: expect.stringContaining("101 条"),
    });

    const oversizedRequirements = await runtime.startStandardTranslation({
      taskId: "oversized-requirements",
      sourceText: "ordinary source",
      targetLanguage,
      additionalRequirements: "x".repeat(2_001),
    });
    expect(oversizedRequirements).toMatchObject({
      status: "validation_error",
      reason: "input_budget_exceeded",
      field: "additionalRequirements",
      message: expect.stringContaining("2,000"),
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("checks input budgets before asking for first-send confirmation", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const transport = { request: vi.fn() };
    const runtime = createRuyiRuntime({
      plainStorage: memoryStorage(),
      cryptoStorage: memoryStorage(),
      transport,
      servicePreset: {
        ...servicePreset,
        confirmedTranslationUrl: undefined,
      },
    });

    const result = await runtime.startStandardTranslation({
      taskId: "budget-before-confirmation",
      sourceText: "source",
      targetLanguage,
      additionalRequirements: "x".repeat(2_001),
    });

    expect(result).toMatchObject({
      status: "validation_error",
      reason: "input_budget_exceeded",
      field: "additionalRequirements",
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("rejects malformed task terms instead of silently omitting them", async () => {
    const { runtime, transport } = runtimeFixture();
    const result = await runtime.startStandardTranslation({
      taskId: "bad-task-term",
      sourceText: "power grid",
      targetLanguage,
      taskTerms: [{ sourceTerm: "power grid" }],
    });

    expect(result).toMatchObject({
      status: "validation_error",
      reason: "invalid_terminology",
      field: "taskTerms[0].preferredTarget",
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("rejects a non-array task term payload instead of treating it as empty", async () => {
    const { runtime, transport } = runtimeFixture();
    const result = await runtime.startStandardTranslation({
      taskId: "bad-task-terms-container",
      sourceText: "power grid",
      targetLanguage,
      taskTerms: "bad",
    } as never);

    expect(result).toMatchObject({
      status: "validation_error",
      reason: "invalid_terminology",
      field: "taskTerms",
    });
    expect(transport.request).not.toHaveBeenCalled();
  });
});
