import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const runtimePath = resolve(import.meta.dirname, "../../public/lib/ruyi-runtime.cjs");
const migrationPath = resolve(
  import.meta.dirname,
  "../../public/lib/storage-migrations.cjs",
);

function memoryStorage(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key)),
    setItem: vi.fn((key: string, value: unknown) =>
      values.set(key, structuredClone(value)),
    ),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}

function legacyConfiguration(overrides: Record<string, unknown> = {}) {
  return {
    id: "legacy-service",
    name: "旧版服务",
    type: "custom",
    protocol: "responses",
    translationUrl: "https://legacy.example.test/responses",
    modelListUrl: "https://legacy.example.test/models",
    authentication: "bearer",
    model: "legacy-model",
    stream: false,
    cachedModels: ["legacy-model"],
    modelsFetchedAt: "2026-08-01T00:00:00.000Z",
    performanceSamples: [],
    ...overrides,
  };
}

function legacySettings(configuration = legacyConfiguration()) {
  return {
    version: 1,
    currentServiceConfigurationId: configuration.id,
    serviceConfigurations: [configuration],
    defaults: {
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        displayName: "简体中文",
        modelLabel: "Simplified Chinese",
      },
      qualityMode: "standard",
      additionalRequirements: "保留旧要求",
      backgroundNotificationsEnabled: false,
    },
  };
}

function repairedConfiguration() {
  return {
    id: "legacy-service",
    name: "修复后的服务",
    type: "custom" as const,
    protocol: "responses" as const,
    translationUrl: "https://repaired.example.test/responses",
    modelListUrl: "https://repaired.example.test/models",
    authentication: "bearer" as const,
    model: "repaired-model",
    stream: false,
  };
}

describe("versioned storage migration", () => {
  it("migrates version 1 settings as a pure metadata transformation", () => {
    const { migrateSettingsPayload } = require(migrationPath);
    const initial = { ...legacySettings(), version: 2 };
    const migration = migrateSettingsPayload(legacySettings(), initial);

    expect(migration).toMatchObject({
      blocked: false,
      shouldWrite: true,
      state: {
        version: 2,
        currentServiceConfigurationId: "legacy-service",
        serviceConfigurations: [
          {
            id: "legacy-service",
            name: "旧版服务",
            model: "legacy-model",
          },
        ],
        defaults: {
          additionalRequirements: "保留旧要求",
          backgroundNotificationsEnabled: false,
        },
      },
    });
    expect(migration.state.apiKeyConfigurationIds).toEqual(["legacy-service"]);
  });

  it("blocks every service when shared defaults are damaged instead of sending a request", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const configuration = legacyConfiguration({
      protocol: "chat-completions",
      authentication: "none",
      confirmedTranslationUrl: "https://legacy.example.test/responses",
    });
    const damaged = {
      ...legacySettings(configuration),
      version: 2,
      defaults: {},
    };
    const transport = {
      request: vi.fn(async () => ({
        status: 200,
        headers: {},
        body: JSON.stringify({ choices: [{ message: { content: "译文" } }] }),
        complete: true,
      })),
    };
    const runtime = createRuyiRuntime({
      plainStorage: memoryStorage({ "ruyi.settings.v1": damaged }),
      cryptoStorage: memoryStorage(),
      transport,
    });

    const state = await runtime.getServiceConfigurations();
    const result = await runtime.startStandardTranslation({
      taskId: "damaged-defaults",
      sourceText: "Source",
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
    });

    expect(state.storageIssue).toMatchObject({ code: "migration_failed" });
    expect(state.serviceConfigurations[0]).toMatchObject({
      disabled: true,
      repairable: false,
    });
    expect(result).toMatchObject({
      status: "configuration_required",
      reason: "invalid_configuration",
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("keeps damaged settings untouched, disables the affected configuration, and repairs only after editing", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const damaged = legacySettings(
      legacyConfiguration({ translationUrl: "not-a-valid-url" }),
    );
    const plainStorage = memoryStorage({ "ruyi.settings.v1": damaged });
    const cryptoStorage = memoryStorage({
      "ruyi.secret.api-key.legacy-service": "complete-secret-value-1234",
    });
    plainStorage.setItem.mockClear();
    cryptoStorage.getItem.mockClear();
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport: { request: vi.fn() },
    });

    const state = await runtime.getServiceConfigurations();

    expect(state.storageIssue).toMatchObject({ code: "migration_failed" });
    expect(state.serviceConfigurations).toEqual([
      expect.objectContaining({
        id: "legacy-service",
        disabled: true,
        hasApiKey: false,
        maskedApiKey: null,
        migrationError: expect.stringMatching(/重新编辑/u),
      }),
    ]);
    expect(plainStorage.setItem).not.toHaveBeenCalled();
    expect(plainStorage.values.get("ruyi.settings.v1")).toEqual(damaged);
    expect(cryptoStorage.getItem).not.toHaveBeenCalledWith(
      "ruyi.secret.api-key.legacy-service",
    );
    expect(JSON.stringify(state)).not.toContain("complete-secret-value-1234");

    const repaired = await runtime.saveServiceConfiguration(repairedConfiguration());

    expect(repaired.storageIssue).toBeUndefined();
    expect(repaired.serviceConfigurations).toEqual([
      expect.objectContaining({
        id: "legacy-service",
        name: "修复后的服务",
      }),
    ]);
    expect(repaired.serviceConfigurations[0]).not.toHaveProperty("disabled");
    expect(plainStorage.values.get("ruyi.settings.v1")).toMatchObject({
      version: 2,
      serviceConfigurations: [
        expect.objectContaining({ name: "修复后的服务", model: "repaired-model" }),
      ],
    });
    expect(cryptoStorage.values.get("ruyi.secret.api-key.legacy-service")).toBe(
      "complete-secret-value-1234",
    );
  });

  it("does not overwrite an unsupported future settings version", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const future = {
      ...legacySettings(),
      version: 99,
    };
    const plainStorage = memoryStorage({ "ruyi.settings.v1": future });
    plainStorage.setItem.mockClear();
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage: memoryStorage(),
      transport: { request: vi.fn() },
    });

    const state = await runtime.getServiceConfigurations();

    expect(state.storageIssue).toMatchObject({ code: "unsupported_version" });
    expect(state.serviceConfigurations[0]).toMatchObject({
      disabled: true,
      repairable: false,
    });
    expect(state.serviceConfigurations[0].migrationError).toMatch(/更新插件|恢复所有设置/u);
    expect(state.serviceConfigurations[0].migrationError).not.toMatch(/重新编辑/u);
    expect(plainStorage.setItem).not.toHaveBeenCalled();
    expect(plainStorage.values.get("ruyi.settings.v1")).toEqual(future);
  });

  it("does not silently normalize damaged optional metadata or unknown default fields", () => {
    const { migrateSettingsPayload } = require(migrationPath);
    const initial = { ...legacySettings(), version: 2, apiKeyConfigurationIds: [] };
    const damaged = legacySettings(
      legacyConfiguration({
        cachedModels: "damaged",
        modelsFetchedAt: 42,
        performanceSamples: "damaged",
      }),
    );
    damaged.defaults.targetLanguage = {
      ...damaged.defaults.targetLanguage,
      apiKey: "must-not-enter-plain-storage",
    } as typeof damaged.defaults.targetLanguage;

    const migration = migrateSettingsPayload(damaged, initial);

    expect(migration).toMatchObject({ blocked: true, shouldWrite: false });
    expect(migration.state.serviceConfigurations[0]).toMatchObject({ disabled: true });
    expect(JSON.stringify(migration.state)).not.toContain("must-not-enter-plain-storage");
  });

  it("keeps legacy payloads available when a migration write fails", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const legacy = legacySettings();
    const plainStorage = memoryStorage({ "ruyi.settings.v1": legacy });
    plainStorage.setItem.mockImplementation(() => {
      throw new Error("write failed");
    });
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage: memoryStorage(),
      transport: { request: vi.fn() },
    });

    const state = await runtime.getServiceConfigurations();

    expect(state.storageIssue).toMatchObject({ code: "migration_failed" });
    expect(state.serviceConfigurations[0]).toMatchObject({
      id: "legacy-service",
      disabled: true,
      repairable: true,
    });
    expect(plainStorage.values.get("ruyi.settings.v1")).toEqual(legacy);
  });

  it("migrates valid encrypted terminology data and blocks writes over damaged data", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const validLegacyTerminology = {
      version: 1,
      termbases: [],
      domainProfiles: [
        {
          id: "profile-1",
          version: "1",
          name: "行业",
          field: null,
          documentType: null,
          audience: null,
          style: null,
          termbaseIds: [],
          preserveRules: [],
        },
      ],
      referenceTranslations: [
        {
          id: "reference-1",
          sourceLanguage: "English",
          targetLanguage: "Simplified Chinese",
          domainProfileId: "profile-1",
          source: "Source fixture",
          translation: "译例夹具",
        },
      ],
      currentDomainProfileId: null,
    };
    const cryptoStorage = memoryStorage({
      "ruyi.secret.terminology.v1": validLegacyTerminology,
    });
    const runtime = createRuyiRuntime({
      plainStorage: memoryStorage(),
      cryptoStorage,
      transport: { request: vi.fn() },
    });

    expect(await runtime.getTerminologyState()).toMatchObject({
      referenceTranslations: [{ id: "reference-1", translation: "译例夹具" }],
    });
    expect(cryptoStorage.values.get("ruyi.secret.terminology.v1")).toMatchObject({
      version: 2,
    });

    const damagedCryptoStorage = memoryStorage({
      "ruyi.secret.terminology.v1": {
        version: 1,
        termbases: "damaged",
        domainProfiles: [],
      },
    });
    damagedCryptoStorage.setItem.mockClear();
    const damagedRuntime = createRuyiRuntime({
      plainStorage: memoryStorage(),
      cryptoStorage: damagedCryptoStorage,
      transport: { request: vi.fn() },
    });
    const damagedState = await damagedRuntime.getTerminologyState();

    expect(damagedState.storageIssue).toMatchObject({ code: "data_corrupted" });
    await expect(
      damagedRuntime.saveTermbase({
        id: null,
        name: "不得覆盖",
        enabled: true,
        entries: [],
      }),
    ).rejects.toMatchObject({ code: "storage_migration_required" });
    expect(damagedCryptoStorage.setItem).not.toHaveBeenCalled();
    expect(damagedCryptoStorage.values.get("ruyi.secret.terminology.v1")).toMatchObject({
      termbases: "damaged",
    });

    const failedWriteCryptoStorage = memoryStorage({
      "ruyi.secret.terminology.v1": validLegacyTerminology,
    });
    failedWriteCryptoStorage.setItem.mockImplementation(() => {
      throw new Error("write failed");
    });
    const failedWriteRuntime = createRuyiRuntime({
      plainStorage: memoryStorage(),
      cryptoStorage: failedWriteCryptoStorage,
      transport: { request: vi.fn() },
    });
    expect(await failedWriteRuntime.getTerminologyState()).toMatchObject({
      storageIssue: { code: "migration_failed" },
      referenceTranslations: [{ id: "reference-1" }],
    });
    expect(
      failedWriteCryptoStorage.values.get("ruyi.secret.terminology.v1"),
    ).toEqual(validLegacyTerminology);
  });

  it("blocks translation when encrypted terminology data is damaged at any depth", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const configuration = legacyConfiguration({
      protocol: "chat-completions",
      authentication: "none",
      confirmedTranslationUrl: "https://legacy.example.test/responses",
    });
    const settings = {
      ...legacySettings(configuration),
      version: 2,
      apiKeyConfigurationIds: [],
    };
    const cryptoStorage = memoryStorage({
      "ruyi.secret.terminology.v1": {
        version: 2,
        termbases: [{ id: "broken", name: "损坏术语库", enabled: true, entries: [null] }],
        domainProfiles: [],
        referenceTranslations: [],
        currentDomainProfileId: null,
      },
    });
    const transport = { request: vi.fn() };
    const runtime = createRuyiRuntime({
      plainStorage: memoryStorage({ "ruyi.settings.v1": settings }),
      cryptoStorage,
      transport,
    });

    expect(await runtime.getTerminologyState()).toMatchObject({
      storageIssue: { code: "data_corrupted" },
    });
    const result = await runtime.startStandardTranslation({
      taskId: "damaged-terminology",
      sourceText: "Source",
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
    });
    expect(result).toMatchObject({
      status: "validation_error",
      reason: "invalid_terminology",
      message: expect.stringMatching(/加密数据|术语数据/u),
    });
    expect(transport.request).not.toHaveBeenCalled();
  });
});

describe("reset all settings", () => {
  it("requires confirmation, deletes only plugin-owned keys, and rebuilds an empty-key preset", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const settings = {
      ...legacySettings(),
      version: 2,
      serviceConfigurations: [
        legacyConfiguration(),
        legacyConfiguration({ id: "second-service", name: "第二项" }),
      ],
    };
    const plainStorage = memoryStorage({
      "ruyi.settings.v1": settings,
      "unrelated.plugin.value": { keep: true },
    });
    const cryptoStorage = memoryStorage({
      "ruyi.secret.api-key.legacy-service": "secret-one",
      "ruyi.secret.api-key.second-service": "secret-two",
      "ruyi.secret.terminology.v1": {
        version: 2,
        termbases: [],
        domainProfiles: [],
        referenceTranslations: [],
        currentDomainProfileId: null,
      },
      "unrelated.secret.value": "keep-secret",
    });
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport: { request: vi.fn() },
    }) as {
      resetAllSettings(confirm?: boolean): Promise<{
        currentServiceConfigurationId: string | null;
        serviceConfigurations: Array<Record<string, unknown>>;
      }>;
      updateCurrentTranslationInputs(inputs: Record<string, unknown>): unknown;
      getCurrentTranslation(): unknown;
    };
    runtime.updateCurrentTranslationInputs({
      sourceText: "只存在内存中的源文",
      targetLanguage: {
        kind: "preset",
        id: "zh-CN",
        modelLabel: "Simplified Chinese",
      },
      serviceConfigurationId: "legacy-service",
      domainProfileId: null,
      qualityMode: "standard",
      additionalRequirements: "",
      taskTerms: [],
      referenceTranslationIds: null,
      parallelAcceleration: false,
      parallelConcurrency: 3,
    });

    await expect(runtime.resetAllSettings()).rejects.toMatchObject({
      code: "confirmation_required",
    });
    expect(plainStorage.values.get("ruyi.settings.v1")).toEqual(settings);

    const resetState = await runtime.resetAllSettings(true);

    expect(resetState).toMatchObject({
      currentServiceConfigurationId: "deepseek-flash",
      serviceConfigurations: [
        {
          id: "deepseek-flash",
          name: "DeepSeek Flash",
          hasApiKey: false,
          maskedApiKey: null,
        },
      ],
    });
    expect(runtime.getCurrentTranslation()).toBeNull();
    expect(plainStorage.values.get("unrelated.plugin.value")).toEqual({ keep: true });
    expect(cryptoStorage.values.get("unrelated.secret.value")).toBe("keep-secret");
    expect(cryptoStorage.values.has("ruyi.secret.api-key.legacy-service")).toBe(false);
    expect(cryptoStorage.values.has("ruyi.secret.api-key.second-service")).toBe(false);
    expect(cryptoStorage.values.has("ruyi.secret.terminology.v1")).toBe(false);
    expect(plainStorage.values.get("ruyi.settings.v1")).toMatchObject({
      version: 2,
      currentServiceConfigurationId: "deepseek-flash",
      serviceConfigurations: [{ id: "deepseek-flash" }],
    });
  });

  it("deletes the preset key and every registered orphan key even when no configuration remains", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const settings = {
      version: 2,
      currentServiceConfigurationId: null,
      serviceConfigurations: [],
      apiKeyConfigurationIds: ["orphan-service"],
      defaults: legacySettings().defaults,
    };
    const plainStorage = memoryStorage({ "ruyi.settings.v1": settings });
    const cryptoStorage = memoryStorage({
      "ruyi.secret.api-key.deepseek-flash": "preset-secret",
      "ruyi.secret.api-key.orphan-service": "orphan-secret",
    });
    const { resetAllSettings } = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport: { request: vi.fn() },
    });

    await resetAllSettings(true);

    expect(cryptoStorage.values.has("ruyi.secret.api-key.deepseek-flash")).toBe(false);
    expect(cryptoStorage.values.has("ruyi.secret.api-key.orphan-service")).toBe(false);
  });

  it("reports that a failed reset may already have deleted part of the local data", async () => {
    const { createRuyiRuntime } = require(runtimePath);
    const plainStorage = memoryStorage({ "ruyi.settings.v1": legacySettings() });
    const cryptoStorage = memoryStorage({
      "ruyi.secret.api-key.legacy-service": "secret",
    });
    cryptoStorage.removeItem.mockImplementation((key: string) => {
      cryptoStorage.values.delete(key);
      throw new Error("remove failed after deletion");
    });
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport: { request: vi.fn() },
    });

    await expect(runtime.resetAllSettings(true)).rejects.toMatchObject({
      code: "storage_reset_failed",
      message: expect.stringMatching(/部分删除/u),
    });
  });
});
