import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const runtimePath = resolve(
  import.meta.dirname,
  "../../public/lib/ruyi-runtime.cjs",
);

type Storage = {
  getItem(key: string): unknown;
  setItem(key: string, value: unknown): void;
  removeItem(key: string): void;
};

function memoryStorage(): Storage & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  return {
    values,
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, structuredClone(value)),
    removeItem: (key) => values.delete(key),
  };
}

function credentialForm(value: string) {
  return {
    elements: {
      namedItem(name: string) {
        return name === "apiKey" ? { value } : null;
      },
    },
  };
}

describe("Ruyi runtime", () => {
  const apiKeyFixture = `fixture-${randomUUID()}-1234`;

  it("creates the empty-key DeepSeek Flash preset on first access", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = { request: vi.fn() };
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport });

    const state = await runtime.getServiceConfiguration();

    expect(state).toEqual({
      serviceConfiguration: {
        id: "deepseek-flash",
        name: "DeepSeek Flash",
        type: "deepseek-official",
        protocol: "chat-completions",
        translationUrl: "https://api.deepseek.com/chat/completions",
        modelListUrl: "https://api.deepseek.com/models",
        authentication: "bearer",
        model: "deepseek-v4-flash",
        stream: true,
        hasApiKey: false,
        maskedApiKey: null,
      },
      defaults: {
        targetLanguage: {
          kind: "preset",
          id: "zh-CN",
          displayName: "简体中文",
          modelLabel: "Simplified Chinese",
        },
        qualityMode: "standard",
        additionalRequirements: "",
      },
    });
    expect(plainStorage.values.size).toBe(1);
    expect(cryptoStorage.values.size).toBe(0);
    expect(JSON.stringify(state)).not.toContain("apiKey");
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("stores the API key only in encrypted storage and returns a mask", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = { request: vi.fn() };
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport });

    const state = await runtime.saveApiKey(credentialForm(apiKeyFixture));

    expect(state.serviceConfiguration).toMatchObject({
      hasApiKey: true,
      maskedApiKey: "••••••••1234",
    });
    expect([...cryptoStorage.values.values()]).toEqual([
      apiKeyFixture,
    ]);
    expect(JSON.stringify([...plainStorage.values.values()])).not.toContain(
      apiKeyFixture,
    );
    expect(JSON.stringify(state)).not.toContain(apiKeyFixture);
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("keeps the source text in the current process and never sends without a key", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = { request: vi.fn() };
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport });
    const sourceText = "  first line\n    second line  ";

    const result = await runtime.startStandardTranslation({
      taskId: "task-1",
      sourceText,
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
    });

    expect(result).toMatchObject({
      status: "configuration_required",
      reason: "missing_api_key",
      sourceRetained: true,
      serviceConfiguration: {
        id: "deepseek-flash",
        hasApiKey: false,
        maskedApiKey: null,
      },
    });
    expect(transport.request).not.toHaveBeenCalled();
    expect(JSON.stringify([...plainStorage.values.values()])).not.toContain(
      sourceText,
    );
    expect(JSON.stringify([...cryptoStorage.values.values()])).not.toContain(
      sourceText,
    );
  });

  it("reports a missing configuration without dereferencing damaged settings", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = { request: vi.fn() };
    plainStorage.setItem("ruyi.settings.v1", {
      version: 1,
      currentServiceConfigurationId: "missing",
      serviceConfigurations: [],
      defaults: {
        targetLanguage: {
          kind: "preset",
          id: "zh-CN",
          displayName: "简体中文",
          modelLabel: "Simplified Chinese",
        },
        qualityMode: "standard",
        additionalRequirements: "",
      },
    });
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport });

    const state = await runtime.getServiceConfiguration();
    const result = await runtime.startStandardTranslation({
      taskId: "task-no-config",
      sourceText: "Hello",
      targetLanguage: state.defaults.targetLanguage,
    });

    expect(state.serviceConfiguration).toBeNull();
    expect(result).toEqual({
      status: "configuration_required",
      reason: "missing_configuration",
      sourceRetained: true,
      serviceConfiguration: null,
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only source text without a network request", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = { request: vi.fn() };
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport });
    await runtime.saveApiKey(credentialForm(apiKeyFixture));

    const result = await runtime.startStandardTranslation({
      taskId: "task-blank",
      sourceText: " \r\n  ",
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
    });

    expect(result).toEqual({
      status: "validation_error",
      reason: "invalid_source_text",
      sourceRetained: true,
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("returns the first-send preview without making a network request", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = { request: vi.fn() };
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      tokenFactory: () => "confirmation-1",
    });
    await runtime.saveApiKey(credentialForm(apiKeyFixture));

    const result = await runtime.startStandardTranslation({
      taskId: "task-confirm",
      sourceText: "  Hello\n  ",
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
    });

    expect(result).toEqual({
      status: "confirmation_required",
      sourceRetained: true,
      confirmationToken: "confirmation-1",
      preview: {
        serviceName: "DeepSeek Flash",
        normalizedTranslationUrl:
          "https://api.deepseek.com/chat/completions",
        protocol: "Chat Completions",
        model: "deepseek-v4-flash",
        dataSent: [
          "源文本",
          "目标语言",
          "命中的术语",
          "参考译例",
          "附加翻译要求",
        ],
        callCount: 1,
      },
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("invalidates an unused confirmation when the task is cancelled", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = { request: vi.fn() };
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      tokenFactory: () => "confirmation-cancelled",
    });
    await runtime.saveApiKey(credentialForm(apiKeyFixture));
    const request = {
      taskId: "task-cancelled",
      sourceText: "Hello",
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
    };
    const preview = await runtime.startStandardTranslation(request);

    runtime.cancelTranslation(request.taskId);
    const result = await runtime.startStandardTranslation({
      ...request,
      confirmationToken: preview.confirmationToken,
    });

    expect(result).toEqual({
      status: "validation_error",
      reason: "invalid_confirmation",
      sourceRetained: true,
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("sends one fixed standard full-document request after confirmation", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn().mockResolvedValue({
        status: 200,
        headers: {},
        body: [
          'data: {"choices":[{"delta":{"reasoning_content":"hidden","content":"你"}}]}',
          "",
          'data: {"choices":[{"delta":{"content":"好"}}]}',
          "",
          "data: [DONE]",
          "",
        ].join("\n"),
      }),
    };
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      tokenFactory: () => "confirmation-send",
    });
    await runtime.saveApiKey(credentialForm(apiKeyFixture));
    const request = {
      taskId: "task-send",
      sourceText: "  Hello\n    world  ",
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        displayName: "简体中文",
        modelLabel: "Simplified Chinese",
      },
    };
    const preview = await runtime.startStandardTranslation(request);

    const result = await runtime.startStandardTranslation({
      ...request,
      confirmationToken: preview.confirmationToken,
    });

    expect(result).toEqual({
      status: "completed",
      taskId: "task-send",
      translation: "你好",
    });
    expect(transport.request).toHaveBeenCalledOnce();
    const sent = transport.request.mock.calls[0][0];
    expect(sent).toMatchObject({
      url: "https://api.deepseek.com/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${apiKeyFixture}`,
      },
    });
    const requestBody = JSON.parse(sent.body);
    expect(requestBody).toMatchObject({
      model: "deepseek-v4-flash",
      stream: true,
      thinking: { type: "disabled" },
    });
    expect(requestBody.messages).toHaveLength(2);
    expect(requestBody.messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining(
        "You are the translation stage of Ruyi Translation.",
      ),
    });
    expect(JSON.parse(requestBody.messages[1].content)).toEqual({
      schemaVersion: "translation-input.v1",
      taskId: "task-send",
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
      domainProfile: null,
      matchedTerms: [],
      referenceTranslations: [],
      additionalRequirements: "",
      protectedItems: [],
      qualityMode: "standard",
      mode: "full_document",
      analysis: null,
      sourceText: request.sourceText,
    });
    expect(JSON.stringify([...plainStorage.values.values()])).not.toContain(
      request.sourceText,
    );
  });
});
