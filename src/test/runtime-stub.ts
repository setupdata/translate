import type {
  RuntimeConfigurationState,
  RuyiRuntimeBridge,
} from "../runtime/contracts";

export const configuredRuntimeState: RuntimeConfigurationState = {
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
    hasApiKey: true,
    maskedApiKey: "••••••••1234",
    cachedModels: [],
    modelsFetchedAt: null,
    performanceSummary: null,
    thinkingEnabled: false,
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
    backgroundNotificationsEnabled: true,
  },
};

function configuredServiceState(
  backgroundNotificationsEnabled = true,
): import("../runtime/contracts").ServiceConfigurationsState {
  return {
    currentServiceConfigurationId: "deepseek-flash",
    serviceConfigurations: [configuredRuntimeState.serviceConfiguration!],
    backgroundNotificationsEnabled,
  };
}

export function createRuntimeStub(
  overrides: Partial<RuyiRuntimeBridge> = {},
): RuyiRuntimeBridge {
  const stub: RuyiRuntimeBridge = {
    subscribePluginEntry: () => () => undefined,
    openSettings: () => false,
    configureGlobalShortcut: () => false,
    getTerminologyState: async () => ({
      termbases: [],
      domainProfiles: [],
      referenceTranslations: [],
      currentDomainProfileId: null,
    }),
    saveTermbase: async () => ({
      termbases: [],
      domainProfiles: [],
      referenceTranslations: [],
      currentDomainProfileId: null,
    }),
    deleteTermbase: async () => ({
      termbases: [],
      domainProfiles: [],
      referenceTranslations: [],
      currentDomainProfileId: null,
    }),
    saveDomainProfile: async () => ({
      termbases: [],
      domainProfiles: [],
      referenceTranslations: [],
      currentDomainProfileId: null,
    }),
    deleteDomainProfile: async () => ({
      termbases: [],
      domainProfiles: [],
      referenceTranslations: [],
      currentDomainProfileId: null,
    }),
    setCurrentDomainProfile: async () => ({
      termbases: [],
      domainProfiles: [],
      referenceTranslations: [],
      currentDomainProfileId: null,
    }),
    saveReferenceTranslation: async () => ({
      termbases: [],
      domainProfiles: [],
      referenceTranslations: [],
      currentDomainProfileId: null,
    }),
    deleteReferenceTranslation: async () => ({
      termbases: [],
      domainProfiles: [],
      referenceTranslations: [],
      currentDomainProfileId: null,
    }),
    previewTermbaseCsv: async () => ({
      previewToken: null,
      columns: [],
      requiredFields: [],
      optionalFields: [],
      fieldMapping: {},
      issues: [],
      rowCount: 0,
      canImport: false,
    }),
    discardTermbaseCsvPreview: () => undefined,
    commitTermbaseCsv: async () => ({
      termbases: [],
      domainProfiles: [],
      referenceTranslations: [],
      currentDomainProfileId: null,
    }),
    exportTermbaseCsv: async () => ({
      fileName: "术语库.csv",
      bytes: new Uint8Array(),
    }),
    getServiceConfiguration: async () => configuredRuntimeState,
    getServiceConfigurations: async () => configuredServiceState(),
    saveServiceConfiguration: async () => configuredServiceState(),
    duplicateServiceConfiguration: async () => configuredServiceState(),
    moveServiceConfiguration: async () => configuredServiceState(),
    setCurrentServiceConfiguration: async () => configuredServiceState(),
    deleteServiceConfiguration: async () => configuredServiceState(),
    saveServiceApiKey: async () => configuredServiceState(),
    deleteServiceApiKey: async () => configuredServiceState(),
    clearServicePerformanceData: async () => configuredServiceState(),
    setBackgroundNotificationsEnabled: async (enabled) =>
      configuredServiceState(enabled),
    setServiceThinkingMode: async (_configurationId, enabled) => ({
      currentServiceConfigurationId: "deepseek-flash",
      serviceConfigurations: [
        { ...configuredRuntimeState.serviceConfiguration!, thinkingEnabled: enabled },
      ],
      backgroundNotificationsEnabled: true,
    }),
    getParallelAccelerationAdvice: (sourceText) => ({
      suggested: Array.from(sourceText.replace(/\r\n/gu, "\n")).length > 4_000,
      estimatedSeconds: null,
      reason:
        Array.from(sourceText.replace(/\r\n/gu, "\n")).length > 4_000
          ? "no_samples_long_source"
          : null,
    }),
    getTranslationCallPlan: ({ qualityMode = "standard" } = {}) => ({
      qualityMode: qualityMode === "precision" ? "precision" as const : "standard" as const,
      translationCalls: 1,
      maximumCallCount: qualityMode === "precision" ? 5 : 1,
      segmentCount: 1,
      ...(qualityMode === "precision"
        ? { analysisCalls: 1, reviewCalls: 2, maximumRevisionCalls: 1 }
        : {}),
    }),
    testServiceConnection: async () => ({ status: "completed" }),
    fetchServiceModels: async () => ({
      status: "completed",
      models: [],
      fetchedAt: new Date(0).toISOString(),
      currentModelPresent: false,
    }),
    cancelServiceOperation: () => undefined,
    saveApiKey: async () => configuredRuntimeState,
    startStandardTranslation: async (request) => ({
      status: "completed",
      taskId: request.taskId,
      translation: "译文",
      quality: { risks: [], pasteBlocked: false },
    }),
    startTranslation: async (request) => ({
      status: "completed",
      taskId: request.taskId,
      translation: "译文",
      quality: { risks: [], pasteBlocked: false },
    }),
    cancelTranslation: () => undefined,
    copyTranslation: () => ({ status: "copied" }),
    pasteTranslation: () => ({ status: "pasted" }),
    getCurrentTranslation: () => null,
    updateCurrentTranslationInputs: (inputs) => ({
      revision: 1,
      phase: "editing",
      inputs,
      task: null,
      partialTranslation: "",
      result: null,
      parallelProgress: null,
      stale: false,
    }),
    subscribeCurrentTranslation: () => () => undefined,
    clearCurrentTranslation: () => undefined,
    resetAllSettings: async () => configuredServiceState(),
    ...overrides,
  };
  if (
    overrides.startStandardTranslation &&
    !Object.prototype.hasOwnProperty.call(overrides, "startTranslation")
  ) {
    stub.startTranslation = overrides.startStandardTranslation;
  }
  return stub;
}
