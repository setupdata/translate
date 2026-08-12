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
        cachedModels: [],
        modelsFetchedAt: null,
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
    expect(runtime.getCurrentTranslation()).toMatchObject({
      phase: "needs_configuration",
      stale: false,
      inputs: {
        sourceText,
        serviceConfigurationId: "deepseek-flash",
        qualityMode: "standard",
        additionalRequirements: "",
        taskTerms: [],
      },
      task: { taskId: "task-1", sourceText },
      result: { status: "configuration_required", reason: "missing_api_key" },
    });
    expect(Object.isFrozen(runtime.getCurrentTranslation())).toBe(true);

    const restartedRuntime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
    });
    expect(restartedRuntime.getCurrentTranslation()).toBeNull();
    expect(JSON.stringify([...plainStorage.values.values()])).not.toContain(sourceText);
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

  it("invalidates a first-send confirmation when task options change", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = { request: vi.fn() };
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      tokenFactory: () => "confirmation-options",
    });
    await runtime.saveApiKey(credentialForm(apiKeyFixture));
    const request = {
      taskId: "task-confirmation-options",
      sourceText: "Hello",
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
      additionalRequirements: "Keep headings short.",
      taskTerms: [{ sourceTerm: "heading", preferredTarget: "标题" }],
    };
    const preview = await runtime.startStandardTranslation(request);

    const result = await runtime.startStandardTranslation({
      ...request,
      additionalRequirements: "Use a formal tone.",
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
    const copyText = vi.fn(() => true);
    const pasteText = vi.fn(() => true);
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      tokenFactory: () => "confirmation-send",
      hostActions: { copyText, pasteText },
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
      quality: { risks: [], pasteBlocked: false },
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
    expect(runtime.copyTranslation("task-send")).toEqual({ status: "copied" });
    expect(runtime.pasteTranslation("task-send", request.sourceText)).toEqual({
      status: "pasted",
    });
    expect(runtime.pasteTranslation("task-send", "edited source")).toEqual({
      status: "blocked",
    });
    expect(copyText).toHaveBeenCalledWith("你好");
    expect(pasteText).toHaveBeenCalledWith("你好");

    const completedSnapshot = runtime.getCurrentTranslation();
    expect(completedSnapshot).toMatchObject({
      phase: "completed",
      stale: false,
      inputs: { sourceText: request.sourceText },
      task: { taskId: request.taskId, sourceText: request.sourceText },
      partialTranslation: "你好",
      result: { status: "completed", translation: "你好" },
    });
    const callsBeforeEdit = transport.request.mock.calls.length;
    const editedSnapshot = runtime.updateCurrentTranslationInputs({
      ...completedSnapshot.inputs,
      sourceText: "edited source",
      targetLanguage: {
        kind: "preset",
        id: "en",
        modelLabel: "English",
      },
      serviceConfigurationId: "another-service",
      additionalRequirements: "Use concise wording.",
      taskTerms: [{ sourceTerm: "world", preferredTarget: "世界" }],
    });
    expect(editedSnapshot).toMatchObject({
      stale: true,
      inputs: {
        sourceText: "edited source",
        targetLanguage: { id: "en" },
        serviceConfigurationId: "another-service",
        additionalRequirements: "Use concise wording.",
        taskTerms: [{ sourceTerm: "world", preferredTarget: "世界" }],
      },
      result: { status: "completed", translation: "你好" },
    });
    expect(transport.request).toHaveBeenCalledTimes(callsBeforeEdit);
    expect(runtime.copyTranslation("task-send")).toEqual({ status: "copied" });
    expect(runtime.pasteTranslation("task-send", "edited source")).toEqual({
      status: "blocked",
    });

    runtime.clearCurrentTranslation();
    expect(runtime.getCurrentTranslation()).toBeNull();
    expect(runtime.copyTranslation("task-send")).toEqual({ status: "unavailable" });
    expect(runtime.pasteTranslation("task-send", "edited source")).toEqual({
      status: "unavailable",
    });
  });

  it("keeps a translation and reports concrete protected-content risks", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn().mockResolvedValue({
        status: 200,
        headers: {},
        body: [
          'data: {"choices":[{"delta":{"content":"版本 2.0，访问 https://bad.test"}}]}',
          "",
          "data: [DONE]",
          "",
        ].join("\n"),
      }),
    };
    const copyText = vi.fn(() => true);
    const pasteText = vi.fn(() => true);
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      hostActions: { copyText, pasteText },
    });
    await runtime.saveApiKey(credentialForm(apiKeyFixture));
    const settings = plainStorage.values.get("ruyi.settings.v1") as {
      serviceConfigurations: Array<{ confirmedTranslationUrl?: string }>;
    };
    settings.serviceConfigurations[0].confirmedTranslationUrl =
      "https://api.deepseek.com/chat/completions";
    plainStorage.setItem("ruyi.settings.v1", settings);
    const sourceText = "Version 1.0, visit https://good.test";

    const result = await runtime.startStandardTranslation({
      taskId: "task-quality-risk",
      sourceText,
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      translation: "版本 2.0，访问 https://bad.test",
      quality: {
        pasteBlocked: true,
        risks: expect.arrayContaining([
          expect.objectContaining({ code: "protected.number.mismatch" }),
          expect.objectContaining({ code: "protected.url.mismatch" }),
        ]),
      },
    });
    const sentInput = JSON.parse(
      JSON.parse(transport.request.mock.calls[0][0].body).messages[1].content,
    );
    expect(sentInput.protectedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "number",
          sourceValue: "1.0",
        }),
        expect.objectContaining({
          type: "url",
          sourceValue: "https://good.test",
        }),
      ]),
    );
    expect(JSON.stringify(result.quality)).not.toContain(sourceText);
    expect(JSON.stringify(result.quality)).not.toContain(result.translation);
    expect(runtime.pasteTranslation("task-quality-risk", sourceText)).toEqual({
      status: "blocked",
    });
    expect(runtime.copyTranslation("task-quality-risk")).toEqual({
      status: "confirmation_required",
    });
    expect(copyText).not.toHaveBeenCalled();
    expect(pasteText).not.toHaveBeenCalled();
    expect(Object.isFrozen(result.quality)).toBe(true);
    expect(Object.isFrozen(result.quality.risks)).toBe(true);
    expect(runtime.copyTranslation("task-quality-risk", true)).toEqual({
      status: "copied",
    });
    expect(copyText).toHaveBeenCalledWith("版本 2.0，访问 https://bad.test");
  });

  it("keeps partial text and reports an incomplete stream as a quality risk", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn().mockResolvedValue({
        status: 200,
        headers: {},
        body: 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
        complete: true,
      }),
    };
    const copyText = vi.fn(() => true);
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      hostActions: { copyText },
    });
    await runtime.saveApiKey(credentialForm(apiKeyFixture));
    const settings = plainStorage.values.get("ruyi.settings.v1") as {
      serviceConfigurations: Array<{ confirmedTranslationUrl?: string }>;
    };
    settings.serviceConfigurations[0].confirmedTranslationUrl =
      "https://api.deepseek.com/chat/completions";
    plainStorage.setItem("ruyi.settings.v1", settings);

    const result = await runtime.startStandardTranslation({
      taskId: "task-incomplete-quality",
      sourceText: "Hello",
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      partialTranslation: "你好",
      error: { code: "protocol_error" },
      quality: {
        pasteBlocked: true,
        risks: expect.arrayContaining([
          expect.objectContaining({ code: "stream.incomplete" }),
        ]),
      },
    });
    expect(runtime.copyTranslation("task-incomplete-quality")).toEqual({
      status: "confirmation_required",
    });
    expect(runtime.copyTranslation("task-incomplete-quality", true)).toEqual({
      status: "copied",
    });
    expect(copyText).toHaveBeenCalledWith("你好");
  });

  it("streams text progress and cancels the previous in-flight task", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const pendingRequests: Array<{
      request: {
        signal: AbortSignal;
        onData(chunk: Buffer): void;
      };
      resolve(value: unknown): void;
    }> = [];
    const transport = {
      request: vi.fn((request) => {
        return new Promise((resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("cancelled"), { code: "cancelled" })),
            { once: true },
          );
          pendingRequests.push({ request, resolve });
        });
      }),
    };
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport });
    await runtime.saveApiKey(credentialForm(apiKeyFixture));
    const settings = plainStorage.values.get("ruyi.settings.v1") as {
      serviceConfigurations: Array<{ confirmedTranslationUrl?: string }>;
    };
    settings.serviceConfigurations[0].confirmedTranslationUrl =
      "https://api.deepseek.com/chat/completions";
    plainStorage.setItem("ruyi.settings.v1", settings);
    const progress = vi.fn();
    const first = runtime.startStandardTranslation(
      {
        taskId: "task-first",
        sourceText: "first",
        targetLanguage: {
          kind: "preset",
          id: "zh-CN",
          modelLabel: "Simplified Chinese",
        },
      },
      progress,
    );
    await Promise.resolve();
    const second = runtime.startStandardTranslation({
      taskId: "task-second",
      sourceText: "second",
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
    });
    await Promise.resolve();

    expect(await first).toMatchObject({
      status: "failed",
      taskId: "task-first",
      error: { code: "cancelled" },
    });
    const secondTransport = pendingRequests[1];
    secondTransport.request.onData(
      Buffer.from('data: {"choices":[{"delta":{"content":"你"}}]}\n\n'),
    );
    secondTransport.request.onData(
      Buffer.from('data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n'),
    );
    secondTransport.resolve({ status: 200, headers: {}, body: "", complete: true });

    expect(await second).toEqual({
      status: "completed",
      taskId: "task-second",
      translation: "你好",
      quality: { risks: [], pasteBlocked: false },
    });
    expect(progress).toHaveBeenCalledWith({
      type: "started",
      taskId: "task-first",
    });
  });

  it("publishes in-memory progress and clear cancels without letting late results return", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    let pendingRequest:
      | { signal: AbortSignal; onData(chunk: Buffer): void }
      | undefined;
    const copyText = vi.fn(() => true);
    const transport = {
      request: vi.fn((request) => {
        pendingRequest = request;
        return new Promise((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("cancelled"), { code: "cancelled" })),
            { once: true },
          );
        });
      }),
    };
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      hostActions: { copyText },
    });
    await runtime.saveApiKey(credentialForm(apiKeyFixture));
    const settings = plainStorage.values.get("ruyi.settings.v1") as {
      serviceConfigurations: Array<{ confirmedTranslationUrl?: string }>;
    };
    settings.serviceConfigurations[0].confirmedTranslationUrl =
      "https://api.deepseek.com/chat/completions";
    plainStorage.setItem("ruyi.settings.v1", settings);
    const snapshots = vi.fn();
    const unsubscribe = runtime.subscribeCurrentTranslation(snapshots);

    const pending = runtime.startStandardTranslation({
      taskId: "task-clear-current",
      sourceText: "source",
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
      additionalRequirements: "temporary requirement",
      taskTerms: [{ sourceTerm: "source", preferredTarget: "目标" }],
    });
    await vi.waitFor(() => expect(pendingRequest).toBeDefined());
    pendingRequest?.onData(
      Buffer.from('data: {"choices":[{"delta":{"content":"部分"}}]}\n\n'),
    );

    expect(runtime.getCurrentTranslation()).toMatchObject({
      phase: "translating",
      partialTranslation: "部分",
      inputs: {
        additionalRequirements: "temporary requirement",
        taskTerms: [{ sourceTerm: "source", preferredTarget: "目标" }],
      },
    });
    runtime.clearCurrentTranslation();

    await expect(pending).resolves.toMatchObject({
      status: "failed",
      error: { code: "cancelled" },
    });
    expect(pendingRequest?.signal.aborted).toBe(true);
    expect(runtime.getCurrentTranslation()).toBeNull();
    expect(runtime.copyTranslation("task-clear-current")).toEqual({
      status: "unavailable",
    });
    expect(copyText).not.toHaveBeenCalled();
    expect(snapshots).toHaveBeenLastCalledWith(null);
    unsubscribe();
  });

  it("honours cancellation while service configuration is still being resolved", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = { request: vi.fn() };
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport });
    await runtime.saveApiKey(credentialForm(apiKeyFixture));
    const settings = plainStorage.values.get("ruyi.settings.v1") as {
      serviceConfigurations: Array<{ confirmedTranslationUrl?: string }>;
    };
    settings.serviceConfigurations[0].confirmedTranslationUrl =
      "https://api.deepseek.com/chat/completions";
    plainStorage.setItem("ruyi.settings.v1", settings);

    const pending = runtime.startStandardTranslation({
      taskId: "task-cancel-before-request",
      sourceText: "source",
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
    });
    runtime.cancelTranslation("task-cancel-before-request");

    await expect(pending).resolves.toMatchObject({
      status: "failed",
      taskId: "task-cancel-before-request",
      error: { code: "cancelled" },
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("normalizes invalid service URLs and transport timeouts", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("socket timed out"), { code: "ETIMEDOUT" })),
    };
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport });
    await runtime.saveApiKey(credentialForm(apiKeyFixture));
    const settings = plainStorage.values.get("ruyi.settings.v1") as {
      serviceConfigurations: Array<{
        translationUrl: string;
        confirmedTranslationUrl?: string;
      }>;
    };
    settings.serviceConfigurations[0].translationUrl = "not a URL";
    plainStorage.setItem("ruyi.settings.v1", settings);

    const request = {
      taskId: "task-invalid-url",
      sourceText: "source",
      targetLanguage: {
        kind: "preset" as const,
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
    };
    await expect(runtime.startStandardTranslation(request)).resolves.toMatchObject({
      status: "failed",
      error: { code: "configuration_error" },
    });
    expect(transport.request).not.toHaveBeenCalled();

    settings.serviceConfigurations[0].translationUrl =
      "https://api.deepseek.com/chat/completions";
    settings.serviceConfigurations[0].confirmedTranslationUrl =
      "https://api.deepseek.com/chat/completions";
    plainStorage.setItem("ruyi.settings.v1", settings);
    await expect(
      runtime.startStandardTranslation({ ...request, taskId: "task-timeout" }),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "timeout" },
    });
  });

  it("rejects credentials and an API key embedded in the service URL", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = { request: vi.fn() };
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport });
    await runtime.saveApiKey(credentialForm(apiKeyFixture));
    const settings = plainStorage.values.get("ruyi.settings.v1") as {
      serviceConfigurations: Array<{ translationUrl: string }>;
    };

    for (const translationUrl of [
      "https://user:password@example.test/chat/completions",
      `https://example.test/chat/completions?api_key=${encodeURIComponent(apiKeyFixture)}`,
    ]) {
      settings.serviceConfigurations[0].translationUrl = translationUrl;
      plainStorage.setItem("ruyi.settings.v1", settings);
      const result = await runtime.startStandardTranslation({
        taskId: `task-sensitive-url-${translationUrl.length}`,
        sourceText: "source",
        targetLanguage: {
          kind: "preset",
          id: "zh-CN",
          modelLabel: "Simplified Chinese",
        },
      });

      expect(result).toMatchObject({
        status: "failed",
        error: { code: "configuration_error" },
      });
    }
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("does not let a throwing progress observer break request cleanup", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn().mockResolvedValue({
        status: 200,
        headers: {},
        body: 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
        complete: true,
      }),
    };
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport });
    await runtime.saveApiKey(credentialForm(apiKeyFixture));
    const settings = plainStorage.values.get("ruyi.settings.v1") as {
      serviceConfigurations: Array<{ confirmedTranslationUrl?: string }>;
    };
    settings.serviceConfigurations[0].confirmedTranslationUrl =
      "https://api.deepseek.com/chat/completions";
    plainStorage.setItem("ruyi.settings.v1", settings);

    const result = await runtime.startStandardTranslation(
      {
        taskId: "task-observer",
        sourceText: "source",
        targetLanguage: {
          kind: "preset",
          id: "zh-CN",
          modelLabel: "Simplified Chinese",
        },
      },
      () => {
        throw new Error("observer failed");
      },
    );

    expect(result).toEqual({
      status: "completed",
      taskId: "task-observer",
      translation: "ok",
      quality: { risks: [], pasteBlocked: false },
    });
  });

  it("keeps a cancelled task cancelled when a late transport chunk arrives", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    let lateRequest: { onData(chunk: Buffer): void } | undefined;
    let resolveLate: ((value: unknown) => void) | undefined;
    const transport = {
      request: vi.fn((request) => {
        if (!lateRequest) {
          lateRequest = request;
          return new Promise((resolve) => {
            resolveLate = resolve;
          });
        }
        request.onData(
          Buffer.from('data: {"choices":[{"delta":{"content":"new"}}]}\n\ndata: [DONE]\n\n'),
        );
        return Promise.resolve({ status: 200, headers: {}, body: "", complete: true });
      }),
    };
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport });
    await runtime.saveApiKey(credentialForm(apiKeyFixture));
    const settings = plainStorage.values.get("ruyi.settings.v1") as {
      serviceConfigurations: Array<{ confirmedTranslationUrl?: string }>;
    };
    settings.serviceConfigurations[0].confirmedTranslationUrl =
      "https://api.deepseek.com/chat/completions";
    plainStorage.setItem("ruyi.settings.v1", settings);
    const baseRequest = {
      sourceText: "source",
      targetLanguage: {
        kind: "preset" as const,
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
    };

    const oldTask = runtime.startStandardTranslation({
      ...baseRequest,
      taskId: "old-task",
    });
    await Promise.resolve();
    const newTask = runtime.startStandardTranslation({
      ...baseRequest,
      taskId: "new-task",
    });
    await Promise.resolve();
    lateRequest?.onData(
      Buffer.from('data: {"choices":[{"delta":{"tool_calls":[]}}]}\n\n'),
    );
    resolveLate?.({ status: 200, headers: {}, body: "", complete: true });

    await expect(oldTask).resolves.toMatchObject({ error: { code: "cancelled" } });
    await expect(newTask).resolves.toMatchObject({
      status: "completed",
      translation: "new",
    });
  });

  it.each([
    [401, "authentication_error"],
    [403, "permission_error"],
    [400, "request_rejected"],
    [429, "rate_limited"],
    [500, "server_error"],
    [504, "timeout"],
  ])("maps HTTP %i to %s without exposing response content", async (status, code) => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn().mockResolvedValue({
        status,
        headers: { "x-request-id": "safe-request-id" },
        body: "<html>secret upstream details</html>",
        complete: true,
      }),
    };
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport });
    await runtime.saveApiKey(credentialForm(apiKeyFixture));
    const settings = plainStorage.values.get("ruyi.settings.v1") as {
      serviceConfigurations: Array<{ confirmedTranslationUrl?: string }>;
    };
    settings.serviceConfigurations[0].confirmedTranslationUrl =
      "https://api.deepseek.com/chat/completions";
    plainStorage.setItem("ruyi.settings.v1", settings);

    const result = await runtime.startStandardTranslation({
      taskId: `task-http-${status}`,
      sourceText: "source",
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      error: { code, httpStatus: status, requestId: "safe-request-id" },
    });
    expect(JSON.stringify(result)).not.toContain("secret upstream details");
  });

  it("never exposes a transport-provided message containing source text", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const sourceText = "SECRET SOURCE FULL TEXT";
    const transport = {
      request: vi.fn().mockRejectedValue(
        Object.assign(new Error("external failure"), {
          code: "network_error",
          safeMessage: sourceText,
        }),
      ),
    };
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport });
    await runtime.saveApiKey(credentialForm(apiKeyFixture));
    const settings = plainStorage.values.get("ruyi.settings.v1") as {
      serviceConfigurations: Array<{ confirmedTranslationUrl?: string }>;
    };
    settings.serviceConfigurations[0].confirmedTranslationUrl =
      "https://api.deepseek.com/chat/completions";
    plainStorage.setItem("ruyi.settings.v1", settings);

    const result = await runtime.startStandardTranslation({
      taskId: "task-sanitized-transport-message",
      sourceText,
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      error: { code: "network_error" },
    });
    expect(JSON.stringify(result)).not.toContain(sourceText);
  });
});
