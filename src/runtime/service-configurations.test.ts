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

function customConfiguration(overrides: Record<string, unknown> = {}) {
  return {
    id: null,
    name: "Local custom",
    type: "custom",
    protocol: "chat-completions",
    translationUrl: "http://127.0.0.1:43120/chat/completions",
    modelListUrl: "http://127.0.0.1:43120/models",
    authentication: "none",
    model: "local-model",
    stream: false,
    ...overrides,
  };
}

describe("Service configuration management", () => {
  it("creates, copies, renames, reorders, selects, and deletes configurations without copying keys", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const ids = ["custom-one", "custom-copy"];
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport: { request: vi.fn() },
      configurationIdFactory: () => ids.shift(),
    });

    expect(await runtime.getServiceConfigurations()).toMatchObject({
      currentServiceConfigurationId: "deepseek-flash",
      serviceConfigurations: [{ name: "DeepSeek Flash", hasApiKey: false }],
    });

    let state = await runtime.saveServiceConfiguration(
      customConfiguration({ authentication: "bearer" }),
    );
    expect(state.currentServiceConfigurationId).toBe("custom-one");
    expect(state.serviceConfigurations.map((item: { id: string }) => item.id)).toEqual([
      "deepseek-flash",
      "custom-one",
    ]);

    const apiKey = `fixture-${randomUUID()}-1234`;
    state = await runtime.saveServiceApiKey("custom-one", credentialForm(apiKey));
    expect(state.serviceConfigurations[1]).toMatchObject({
      hasApiKey: true,
      maskedApiKey: "••••••••1234",
    });

    state = await runtime.duplicateServiceConfiguration("custom-one");
    expect(state.currentServiceConfigurationId).toBe("custom-copy");
    expect(state.serviceConfigurations[2]).toMatchObject({
      id: "custom-copy",
      name: "Local custom 副本",
      hasApiKey: false,
      maskedApiKey: null,
      cachedModels: [],
      modelsFetchedAt: null,
    });
    expect([...cryptoStorage.values.values()]).toEqual([apiKey]);

    await expect(
      runtime.saveServiceConfiguration(
        customConfiguration({ id: "custom-copy", name: "Local custom" }),
      ),
    ).rejects.toMatchObject({ code: "configuration_error", field: "name" });

    state = await runtime.saveServiceConfiguration(
      customConfiguration({ id: "custom-copy", name: "Renamed custom" }),
    );
    state = await runtime.moveServiceConfiguration("custom-copy", "up");
    expect(state.serviceConfigurations.map((item: { id: string }) => item.id)).toEqual([
      "deepseek-flash",
      "custom-copy",
      "custom-one",
    ]);
    state = await runtime.setCurrentServiceConfiguration("custom-one");
    expect(state.currentServiceConfigurationId).toBe("custom-one");

    await expect(
      runtime.deleteServiceConfiguration("custom-one"),
    ).rejects.toMatchObject({ code: "confirmation_required" });
    state = await runtime.deleteServiceConfiguration("custom-one", true);
    expect(state.currentServiceConfigurationId).toBe("deepseek-flash");
    expect(state.serviceConfigurations.map((item: { id: string }) => item.id)).toEqual([
      "deepseek-flash",
      "custom-copy",
    ]);
    expect(cryptoStorage.values.size).toBe(0);

    state = await runtime.deleteServiceConfiguration("custom-copy", true);
    state = await runtime.deleteServiceConfiguration("deepseek-flash", true);
    expect(state).toEqual({
      currentServiceConfigurationId: null,
      serviceConfigurations: [],
      backgroundNotificationsEnabled: true,
    });
    await expect(runtime.getServiceConfiguration()).resolves.toMatchObject({
      serviceConfiguration: null,
    });
  });

  it("locks official DeepSeek fields and validates custom URL and protocol rules", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({
      plainStorage: memoryStorage(),
      cryptoStorage: memoryStorage(),
      transport: { request: vi.fn() },
      configurationIdFactory: () => "custom-safe",
    });

    await expect(
      runtime.saveServiceConfiguration({
        id: "deepseek-flash",
        name: "DeepSeek renamed",
        type: "deepseek-official",
        protocol: "responses",
        translationUrl: "https://example.test/responses",
        modelListUrl: "https://example.test/models",
        authentication: "bearer",
        model: "deepseek-v4-flash",
        stream: true,
      }),
    ).rejects.toMatchObject({ code: "configuration_error" });

    await expect(
      runtime.saveServiceConfiguration(
        customConfiguration({
          id: "deepseek-flash",
          name: "DeepSeek renamed",
          protocol: "responses",
          translationUrl: "https://example.test/responses",
          modelListUrl: "https://example.test/models",
        }),
      ),
    ).rejects.toMatchObject({ code: "configuration_error", field: "type" });

    for (const translationUrl of [
      "http://example.test/chat/completions",
      "https://user:password@example.test/chat/completions",
      "https://example.test/chat/completions?api_key=secret",
    ]) {
      await expect(
        runtime.saveServiceConfiguration(customConfiguration({ translationUrl })),
      ).rejects.toMatchObject({ code: "configuration_error", field: "translationUrl" });
    }

    await runtime.saveServiceConfiguration(
      customConfiguration({
        id: null,
        name: "Bearer custom",
        authentication: "bearer",
        translationUrl: "https://example.test/chat/completions",
        modelListUrl: "https://example.test/models",
      }),
    );
    for (const translationUrl of [
      "https://example.test/chat/secret-value",
      "https://example.test/chat/completions#secret-value",
    ]) {
      await runtime.saveServiceConfiguration(
        customConfiguration({
          id: "custom-safe",
          name: "Bearer custom",
          authentication: "bearer",
          translationUrl,
          modelListUrl: "https://example.test/models",
        }),
      );
      await expect(
        runtime.saveServiceApiKey(
          "custom-safe",
          credentialForm("secret-value"),
        ),
      ).rejects.toMatchObject({
        code: "configuration_error",
        field: "translationUrl",
      });
    }

    const state = await runtime.saveServiceConfiguration(
      customConfiguration({
        id: "custom-safe",
        protocol: "responses",
        translationUrl: "http://localhost:43120/responses",
      }),
    );
    expect(state.serviceConfigurations[1]).toMatchObject({
      id: "custom-safe",
      type: "custom",
      protocol: "responses",
      authentication: "none",
      translationUrl: "http://localhost:43120/responses",
    });
  });

  it("tests a saved configuration with fixed text and supports cancellation", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const requests: Array<Record<string, unknown>> = [];
    const transport = {
      request: vi.fn(async (request) => {
        requests.push(request);
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({ choices: [{ message: { content: "连接正常" } }] }),
          complete: true,
        };
      }),
    };
    const runtime = createRuyiRuntime({
      plainStorage: memoryStorage(),
      cryptoStorage: memoryStorage(),
      transport,
      configurationIdFactory: () => "test-service",
    });
    await runtime.saveServiceConfiguration(customConfiguration({ id: null }));
    runtime.updateCurrentTranslationInputs({
      sourceText: "不得发送的当前源文",
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
      serviceConfigurationId: "test-service",
      qualityMode: "standard",
      additionalRequirements: "",
      taskTerms: [],
    });

    await expect(
      runtime.testServiceConnection({
        operationId: "connection-ok",
        configurationId: "test-service",
      }),
    ).resolves.toEqual({ status: "completed" });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "POST",
      maxResponseBytes: 1024 * 1024,
      noDataTimeoutMilliseconds: 30_000,
      totalTimeoutMilliseconds: 120_000,
    });
    expect(requests[0].headers).not.toHaveProperty("Authorization");
    expect(String(requests[0].body)).not.toContain("不得发送的当前源文");
    expect(String(requests[0].body)).toContain("Connection test");

    let capturedSignal: AbortSignal | undefined;
    const cancellingRuntime = createRuyiRuntime({
      plainStorage: memoryStorage(),
      cryptoStorage: memoryStorage(),
      configurationIdFactory: () => "cancel-service",
      transport: {
        request: vi.fn((request) => {
          capturedSignal = request.signal;
          return new Promise((_resolve, reject) => {
            request.signal.addEventListener("abort", () => {
              reject(Object.assign(new Error("cancelled"), { code: "cancelled" }));
            });
          });
        }),
      },
    });
    await cancellingRuntime.saveServiceConfiguration(customConfiguration());
    const pending = cancellingRuntime.testServiceConnection({
      operationId: "connection-cancel",
      configurationId: "cancel-service",
    });
    await vi.waitFor(() => expect(capturedSignal).toBeDefined());
    cancellingRuntime.cancelServiceOperation("connection-cancel");
    await expect(pending).resolves.toMatchObject({
      status: "failed",
      error: { code: "cancelled" },
    });
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("reports the destination host when a service redirects across origins", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({
      plainStorage: memoryStorage(),
      cryptoStorage: memoryStorage(),
      configurationIdFactory: () => "redirect-service",
      transport: {
        request: vi.fn().mockRejectedValue(
          Object.assign(new Error("cross-origin redirect"), {
            code: "request_rejected",
            redirectOrigin: "https://other.example.test",
          }),
        ),
      },
    });
    await runtime.saveServiceConfiguration(customConfiguration());

    const result = await runtime.testServiceConnection({
      operationId: "connection-redirect",
      configurationId: "redirect-service",
    });

    expect(result).toMatchObject({
      status: "failed",
      error: {
        code: "request_rejected",
        message: expect.stringContaining("other.example.test"),
      },
    });
  });

  it("validates a replacement key and edited URLs before persisting either value", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport: { request: vi.fn() },
      configurationIdFactory: () => "atomic-service",
    });
    await runtime.saveServiceConfiguration(
      customConfiguration({
        authentication: "bearer",
        translationUrl: "https://example.test/chat/completions",
        modelListUrl: "https://example.test/models",
      }),
    );

    await expect(
      runtime.saveServiceConfiguration(
        customConfiguration({
          id: "atomic-service",
          authentication: "bearer",
          translationUrl: "https://example.test/chat/new-secret",
          modelListUrl: "https://example.test/models",
        }),
        credentialForm("new-secret"),
      ),
    ).rejects.toMatchObject({ code: "configuration_error", field: "translationUrl" });

    expect(
      (await runtime.getServiceConfiguration("atomic-service")).serviceConfiguration
        .translationUrl,
    ).toBe("https://example.test/chat/completions");
    expect(cryptoStorage.values.size).toBe(0);
  });

  it("requires an in-progress or awaiting-confirmation translation to be cancelled before editing", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({
      plainStorage: memoryStorage(),
      cryptoStorage: memoryStorage(),
      transport: { request: vi.fn() },
      tokenFactory: () => "pending-confirmation",
    });
    await runtime.saveServiceApiKey(
      "deepseek-flash",
      credentialForm(`fixture-${randomUUID()}`),
    );
    const renamedOfficial = {
      id: "deepseek-flash",
      name: "DeepSeek renamed",
      type: "deepseek-official",
      protocol: "chat-completions",
      translationUrl: "https://api.deepseek.com/chat/completions",
      modelListUrl: "https://api.deepseek.com/models",
      authentication: "bearer",
      model: "deepseek-v4-flash",
      stream: true,
    };
    const request = {
      taskId: "task-edit-lock",
      sourceText: "source",
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
      serviceConfigurationId: "deepseek-flash",
    };

    const pendingPreview = runtime.startStandardTranslation(request);
    await expect(
      runtime.saveServiceConfiguration(renamedOfficial),
    ).rejects.toMatchObject({ code: "translation_active" });
    await expect(pendingPreview).resolves.toMatchObject({
      status: "confirmation_required",
    });
    await expect(
      runtime.deleteServiceConfiguration("deepseek-flash", true),
    ).rejects.toMatchObject({ code: "translation_active" });

    runtime.cancelTranslation("task-edit-lock");
    await expect(
      runtime.saveServiceConfiguration(renamedOfficial),
    ).resolves.toMatchObject({
      serviceConfigurations: [expect.objectContaining({ name: "DeepSeek renamed" })],
    });
  });

  it("translates with the explicitly selected no-auth custom configuration", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const transport = {
      request: vi.fn().mockResolvedValue({
        status: 200,
        headers: {},
        body: JSON.stringify({ choices: [{ message: { content: "译文" } }] }),
        complete: true,
      }),
    };
    const runtime = createRuyiRuntime({
      plainStorage: memoryStorage(),
      cryptoStorage: memoryStorage(),
      transport,
      configurationIdFactory: () => "selected-custom",
      tokenFactory: () => "confirmation-selected-custom",
    });
    await runtime.saveServiceConfiguration(customConfiguration());
    await runtime.setCurrentServiceConfiguration("deepseek-flash");
    const request = {
      taskId: "task-selected-custom",
      sourceText: "Source",
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
      serviceConfigurationId: "selected-custom",
    };

    const preview = await runtime.startStandardTranslation(request);
    expect(preview).toMatchObject({
      status: "confirmation_required",
      confirmationToken: "confirmation-selected-custom",
      preview: { serviceName: "Local custom" },
    });
    const result = await runtime.startStandardTranslation({
      ...request,
      confirmationToken: "confirmation-selected-custom",
    });

    expect(result).toMatchObject({ status: "completed", translation: "译文" });
    expect(transport.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://127.0.0.1:43120/chat/completions",
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }),
    );
  });

  it("fetches models only on demand, applies authentication, and caches filtered IDs", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const apiKey = `fixture-${randomUUID()}-5678`;
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn().mockResolvedValue({
        status: 200,
        headers: {},
        body: JSON.stringify({
          object: "list",
          data: [
            { id: "model-b" },
            { id: "model-a" },
            { id: "model-b" },
            { id: " leading-space" },
            { id: "bad\u0001control" },
            { id: "x".repeat(201) },
            { id: 42 },
          ],
        }),
        complete: true,
      }),
    };
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      now: () => new Date("2026-08-13T00:00:00.000Z"),
    });
    await runtime.saveServiceApiKey("deepseek-flash", credentialForm(apiKey));

    expect(transport.request).not.toHaveBeenCalled();
    const result = await runtime.fetchServiceModels({
      operationId: "models-one",
      configurationId: "deepseek-flash",
    });

    expect(result).toEqual({
      status: "completed",
      models: ["model-b", "model-a"],
      fetchedAt: "2026-08-13T00:00:00.000Z",
      currentModelPresent: false,
    });
    expect(transport.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.deepseek.com/models",
        method: "GET",
        headers: expect.objectContaining({ Authorization: `Bearer ${apiKey}` }),
        body: "",
        maxResponseBytes: 2 * 1024 * 1024,
        noDataTimeoutMilliseconds: 30_000,
        totalTimeoutMilliseconds: 30_000,
      }),
    );
    const state = await runtime.getServiceConfigurations();
    expect(state.serviceConfigurations[0]).toMatchObject({
      model: "deepseek-v4-flash",
      cachedModels: ["model-b", "model-a"],
      modelsFetchedAt: "2026-08-13T00:00:00.000Z",
    });
  });

  it("does not overwrite a hand-entered model or cache partial model lists on failure", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: JSON.stringify({ data: [{ id: "listed-model" }] }),
          complete: true,
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: Array.from({ length: 5_001 }, (_, index) => ({ id: `model-${index}` })),
          }),
          complete: true,
        }),
    };
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      configurationIdFactory: () => "manual-model-service",
      now: () => new Date("2026-08-13T00:00:00.000Z"),
    });
    await runtime.saveServiceConfiguration(
      customConfiguration({ model: "hand-entered-model" }),
    );

    const first = await runtime.fetchServiceModels({
      operationId: "models-first",
      configurationId: "manual-model-service",
    });
    expect(first).toMatchObject({
      status: "completed",
      models: ["listed-model"],
      currentModelPresent: false,
    });
    expect(
      (await runtime.getServiceConfigurations()).serviceConfigurations[1].model,
    ).toBe("hand-entered-model");

    const second = await runtime.fetchServiceModels({
      operationId: "models-too-many",
      configurationId: "manual-model-service",
    });
    expect(second).toMatchObject({
      status: "failed",
      error: { code: "response_too_large" },
    });
    expect(
      (await runtime.getServiceConfigurations()).serviceConfigurations[1].cachedModels,
    ).toEqual(["listed-model"]);
  });
});
