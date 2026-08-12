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
};

export function createRuntimeStub(
  overrides: Partial<RuyiRuntimeBridge> = {},
): RuyiRuntimeBridge {
  return {
    getServiceConfiguration: async () => configuredRuntimeState,
    saveApiKey: async () => configuredRuntimeState,
    startStandardTranslation: async (request) => ({
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
      stale: false,
    }),
    subscribeCurrentTranslation: () => () => undefined,
    clearCurrentTranslation: () => undefined,
    ...overrides,
  };
}
