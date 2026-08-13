import type { RuyiRuntimeBridge } from "./contracts";

function unavailableRuntime(): RuyiRuntimeBridge {
  const unavailable = () =>
    Promise.reject(new Error("如意翻译运行时尚未就绪，请在 uTools 中打开插件。"));

  return Object.freeze({
    getTerminologyState: unavailable,
    saveTermbase: unavailable,
    deleteTermbase: unavailable,
    saveDomainProfile: unavailable,
    deleteDomainProfile: unavailable,
    setCurrentDomainProfile: unavailable,
    saveReferenceTranslation: unavailable,
    deleteReferenceTranslation: unavailable,
    previewTermbaseCsv: unavailable,
    discardTermbaseCsvPreview: () => undefined,
    commitTermbaseCsv: unavailable,
    exportTermbaseCsv: unavailable,
    getServiceConfiguration: unavailable,
    getServiceConfigurations: unavailable,
    saveServiceConfiguration: unavailable,
    duplicateServiceConfiguration: unavailable,
    moveServiceConfiguration: unavailable,
    setCurrentServiceConfiguration: unavailable,
    deleteServiceConfiguration: unavailable,
    saveServiceApiKey: unavailable,
    deleteServiceApiKey: unavailable,
    clearServicePerformanceData: unavailable,
    setBackgroundNotificationsEnabled: unavailable,
    setServiceThinkingMode: unavailable,
    getParallelAccelerationAdvice: () => ({
      suggested: false,
      estimatedSeconds: null,
      reason: null,
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
    testServiceConnection: unavailable,
    fetchServiceModels: unavailable,
    cancelServiceOperation: () => undefined,
    saveApiKey: unavailable,
    startTranslation: unavailable,
    startStandardTranslation: unavailable,
    cancelTranslation: () => undefined,
    copyTranslation: () => ({ status: "unavailable" as const }),
    pasteTranslation: () => ({ status: "unavailable" as const }),
    getCurrentTranslation: () => null,
    updateCurrentTranslationInputs: () => {
      throw new Error("如意翻译运行时尚未就绪，请在 uTools 中打开插件。");
    },
    subscribeCurrentTranslation: () => () => undefined,
    clearCurrentTranslation: () => undefined,
  });
}

export function getBrowserRuntime(): RuyiRuntimeBridge {
  return window.ruyiTranslation ?? unavailableRuntime();
}
