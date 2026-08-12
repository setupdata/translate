export type PluginEntryAction = {
  code: "translate" | "settings";
  type: string;
  payload: unknown;
};

export type EntryIntent =
  | {
      page: "translation";
      sourceText: string;
      autoStart: boolean;
    }
  | { page: "settings" };

export function resolveEntryIntent(action: PluginEntryAction): EntryIntent {
  if (action.code === "settings") {
    return { page: "settings" };
  }

  if (action.type === "over" && typeof action.payload === "string") {
    return {
      page: "translation",
      sourceText: action.payload,
      autoStart: true,
    };
  }

  return { page: "translation", sourceText: "", autoStart: false };
}
