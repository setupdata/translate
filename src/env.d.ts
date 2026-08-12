interface RuyiTranslationBridge {
  translate(sourceText: string): Promise<string>;
}

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
