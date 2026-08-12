import type { RuyiRuntimeBridge } from "./contracts";

function unavailableRuntime(): RuyiRuntimeBridge {
  const unavailable = () =>
    Promise.reject(new Error("如意翻译运行时尚未就绪，请在 uTools 中打开插件。"));

  return Object.freeze({
    getServiceConfiguration: unavailable,
    saveApiKey: unavailable,
    startStandardTranslation: unavailable,
    cancelTranslation: () => undefined,
    copyTranslation: () => ({ status: "unavailable" as const }),
    pasteTranslation: () => ({ status: "unavailable" as const }),
  });
}

export function getBrowserRuntime(): RuyiRuntimeBridge {
  return window.ruyiTranslation ?? unavailableRuntime();
}
