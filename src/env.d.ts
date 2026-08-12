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
  };
}

declare module "*.css";
