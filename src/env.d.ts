type RuyiTranslationBridge = import("./runtime/contracts").RuyiRuntimeBridge;

interface Window {
  ruyiTranslation?: RuyiTranslationBridge;
}

declare module "*.css";
