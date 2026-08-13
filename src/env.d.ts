type RuyiTranslationBridge = import("./runtime/contracts").RuyiRuntimeBridge;

interface UToolsPluginEnterAction {
  code: string;
  type: string;
  payload?: unknown;
}

interface Window {
  ruyiTranslation?: RuyiTranslationBridge;
  utools?: {
    onPluginEnter(callback: (action: UToolsPluginEnterAction) => void): void;
    onPluginOut(callback: (isKill: boolean) => void): void;
    showNotification(body: string, clickFeatureCode?: string): void;
  };
}

declare module "*.css";
