import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const runtimePath = resolve(process.cwd(), "public/lib/ruyi-runtime.cjs");
const encoder = new TextEncoder();

function memoryStorage() {
  const values = new Map<string, unknown>();
  const setItem = vi.fn((key: string, value: unknown) =>
    values.set(key, structuredClone(value)),
  );
  return {
    values,
    getItem: (key: string) => values.get(key),
    setItem,
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}

const targetLanguage = {
  kind: "preset",
  id: "zh-CN",
  modelLabel: "Simplified Chinese",
};

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

function profile() {
  return {
    id: "energy-profile",
    version: "1",
    name: "能源行业",
    field: "Energy",
    documentType: null,
    audience: null,
    style: null,
    termbaseIds: [],
    preserveRules: [],
  };
}

function reference(id: string, source: string) {
  return {
    id,
    sourceLanguage: "English",
    targetLanguage: "Simplified Chinese",
    domainProfileId: "energy-profile",
    source,
    translation: `${source} 的批准译法`,
  };
}

function runtimeFixture(
  preset: Omit<typeof servicePreset, "confirmedTranslationUrl"> & {
    confirmedTranslationUrl: string | null;
  } = servicePreset,
) {
  const plainStorage = memoryStorage();
  const cryptoStorage = memoryStorage();
  const transport = {
    request: vi.fn(async (_options: { body: string }) => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ choices: [{ message: { content: "已批准的译文" } }] }),
      complete: true,
    })),
  };
  const { createRuyiRuntime } = require(runtimePath);
  const runtime = createRuyiRuntime({
    plainStorage,
    cryptoStorage,
    transport,
    servicePreset: preset,
    tokenFactory: (() => {
      let index = 0;
      return () => `token-${++index}`;
    })(),
  });
  return { runtime, plainStorage, cryptoStorage, transport };
}

describe("Ruyi runtime reference translations and CSV", () => {
  it("stores approved references encrypted and never creates them from daily results", async () => {
    const { runtime, plainStorage, cryptoStorage, transport } = runtimeFixture();
    await runtime.saveDomainProfile(profile());
    await runtime.saveReferenceTranslation(
      reference("reference-1", "Power grid alarm response"),
    );

    expect((await runtime.getTerminologyState()).referenceTranslations).toHaveLength(1);
    expect(JSON.stringify([...plainStorage.values.values()])).not.toContain(
      "Power grid alarm response",
    );
    expect(JSON.stringify([...cryptoStorage.values.values()])).toContain(
      "Power grid alarm response",
    );

    const preview = await runtime.startStandardTranslation({
      taskId: "reference-preview",
      sourceText: "Power grid alarm response in the control room",
      targetLanguage,
      domainProfileId: "energy-profile",
    });
    expect(preview).toMatchObject({
      status: "reference_confirmation_required",
      sourceRetained: true,
      previewToken: "token-1",
      referenceTranslations: [
        expect.objectContaining({ id: "reference-1", source: "Power grid alarm response" }),
      ],
    });
    expect(transport.request).not.toHaveBeenCalled();

    const completed = await runtime.startStandardTranslation({
      taskId: "reference-preview",
      sourceText: "Power grid alarm response in the control room",
      targetLanguage,
      domainProfileId: "energy-profile",
      referencePreviewToken: "token-1",
      referenceTranslationIds: ["reference-1"],
    });
    expect(completed.status).toBe("completed");
    const requestBody = JSON.parse(transport.request.mock.calls[0][0].body);
    const input = JSON.parse(requestBody.messages[1].content);
    expect(input.referenceTranslations).toEqual([
      expect.objectContaining({ id: "reference-1" }),
    ]);
    expect((await runtime.getTerminologyState()).referenceTranslations).toHaveLength(1);
  });

  it("previews at most three references and rejects an explicit fourth selection", async () => {
    const { runtime, transport } = runtimeFixture();
    await runtime.saveDomainProfile(profile());
    for (const [index, source] of [
      "Power grid alarm response",
      "Power grid alarm handling",
      "Power grid operating alarm",
      "Power grid maintenance alarm",
    ].entries()) {
      await runtime.saveReferenceTranslation(reference(`reference-${index}`, source));
    }
    const preview = await runtime.startStandardTranslation({
      taskId: "three-only",
      sourceText: "Power grid alarm response procedure",
      targetLanguage,
      domainProfileId: "energy-profile",
    });
    expect(preview).toMatchObject({
      status: "reference_confirmation_required",
      referenceTranslations: expect.any(Array),
    });
    if (preview.status !== "reference_confirmation_required") throw new Error("missing preview");
    expect(preview.referenceTranslations).toHaveLength(3);

    const rejected = await runtime.startStandardTranslation({
      taskId: "too-many-references",
      sourceText: "Power grid alarm response procedure",
      targetLanguage,
      domainProfileId: "energy-profile",
      referenceTranslationIds: ["reference-0", "reference-1", "reference-2", "reference-3"],
    });
    expect(rejected).toMatchObject({
      status: "validation_error",
      reason: "input_budget_exceeded",
      field: "referenceTranslationIds",
      message: expect.stringContaining("最多选择 3 条"),
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("does not allow explicit reference ids to bypass the preview", async () => {
    const { runtime, transport } = runtimeFixture();
    await runtime.saveDomainProfile(profile());
    await runtime.saveReferenceTranslation(
      reference("reference-1", "Power grid alarm response"),
    );

    const result = await runtime.startStandardTranslation({
      taskId: "reference-bypass",
      sourceText: "Power grid alarm response in the control room",
      targetLanguage,
      domainProfileId: "energy-profile",
      referenceTranslationIds: ["reference-1"],
    });

    expect(result).toMatchObject({
      status: "reference_confirmation_required",
      referenceTranslations: [expect.objectContaining({ id: "reference-1" })],
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("keeps the approved subset through the first-send data confirmation", async () => {
    const { runtime, transport } = runtimeFixture({
      ...servicePreset,
      confirmedTranslationUrl: null,
    });
    await runtime.saveDomainProfile(profile());
    await runtime.saveReferenceTranslation(
      reference("reference-1", "Power grid alarm response"),
    );
    const initialRequest = {
      taskId: "reference-and-data-preview",
      sourceText: "Power grid alarm response in the control room",
      targetLanguage,
      domainProfileId: "energy-profile",
    };

    const referencePreview = await runtime.startStandardTranslation(initialRequest);
    expect(referencePreview.status).toBe("reference_confirmation_required");
    if (referencePreview.status !== "reference_confirmation_required") {
      throw new Error("missing reference preview");
    }
    const dataPreview = await runtime.startStandardTranslation({
      ...initialRequest,
      referencePreviewToken: referencePreview.previewToken,
      referenceTranslationIds: ["reference-1"],
    });
    expect(dataPreview.status).toBe("confirmation_required");
    if (dataPreview.status !== "confirmation_required") {
      throw new Error("missing data preview");
    }
    expect(transport.request).not.toHaveBeenCalled();
    expect(dataPreview.preview.dataSent).toContain("参考译例");

    const completed = await runtime.startStandardTranslation({
      ...initialRequest,
      confirmationToken: dataPreview.confirmationToken,
      referenceTranslationIds: ["reference-1"],
    });
    expect(completed.status).toBe("completed");
    const body = JSON.parse(transport.request.mock.calls[0][0].body);
    const input = JSON.parse(body.messages[1].content);
    expect(input.referenceTranslations).toEqual([
      expect.objectContaining({ id: "reference-1" }),
    ]);
  });

  it("does not claim that references will be sent after the user deselects all", async () => {
    const { runtime } = runtimeFixture({
      ...servicePreset,
      confirmedTranslationUrl: null,
    });
    await runtime.saveDomainProfile(profile());
    await runtime.saveReferenceTranslation(
      reference("reference-1", "Power grid alarm response"),
    );
    const request = {
      taskId: "empty-reference-selection",
      sourceText: "Power grid alarm response in the control room",
      targetLanguage,
      domainProfileId: "energy-profile",
    };
    const preview = await runtime.startStandardTranslation(request);
    expect(preview.status).toBe("reference_confirmation_required");
    if (preview.status !== "reference_confirmation_required") {
      throw new Error("missing reference preview");
    }
    const dataPreview = await runtime.startStandardTranslation({
      ...request,
      referencePreviewToken: preview.previewToken,
      referenceTranslationIds: [],
    });

    expect(dataPreview.status).toBe("confirmation_required");
    if (dataPreview.status !== "confirmation_required") {
      throw new Error("missing data preview");
    }
    expect(dataPreview.preview.dataSent).not.toContain("参考译例");
  });

  it("cancels a CSV preview without writing and commits a valid preview in one write", async () => {
    const { runtime, cryptoStorage } = runtimeFixture();
    await runtime.saveTermbase({ id: "base", name: "能源术语", enabled: true, entries: [] });
    cryptoStorage.setItem.mockClear();
    const bytes = encoder.encode(
      "sourceTerm,preferredTarget,sourceLanguage,targetLanguage,strictness,caseSensitive,priority\n" +
        "power grid,电网,English,Simplified Chinese,exact,false,10\n",
    );

    const first = await runtime.previewTermbaseCsv({ termbaseId: "base", bytes });
    expect(first).toMatchObject({ canImport: true, previewToken: expect.any(String) });
    expect(cryptoStorage.setItem).not.toHaveBeenCalled();
    runtime.discardTermbaseCsvPreview(first.previewToken);
    expect((await runtime.getTerminologyState()).termbases[0].entries).toEqual([]);
    expect(cryptoStorage.setItem).not.toHaveBeenCalled();

    const second = await runtime.previewTermbaseCsv({ termbaseId: "base", bytes });
    const state = await runtime.commitTermbaseCsv(second.previewToken);
    expect(state.termbases[0].entries).toHaveLength(1);
    expect(cryptoStorage.setItem).toHaveBeenCalledOnce();
  });

  it("exports a reusable CSV without runtime secrets", async () => {
    const { runtime } = runtimeFixture();
    await runtime.saveTermbase({
      id: "base",
      name: "能源术语",
      enabled: true,
      entries: [
        {
          id: "term",
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
        },
      ],
    });
    const output = await runtime.exportTermbaseCsv("base");
    const text = new TextDecoder().decode(output.bytes);
    expect(output.fileName).toBe("能源术语.csv");
    expect(text).toContain("power grid");
    expect(text).not.toMatch(/Authorization|api.?key|current source|current translation/iu);
  });
});
