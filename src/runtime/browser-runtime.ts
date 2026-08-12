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
    testServiceConnection: unavailable,
    fetchServiceModels: unavailable,
    cancelServiceOperation: () => undefined,
    saveApiKey: unavailable,
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
