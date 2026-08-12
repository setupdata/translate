import type { RuyiRuntimeBridge } from "../runtime/contracts";
import { ServiceSettingsPage } from "../settings/ServiceSettingsPage";
import { ConfiguredTranslationPage } from "../translation/ConfiguredTranslationPage";
import type { EntryIntent } from "../utools/entry-intent";

export interface AppProps {
  intent: EntryIntent;
  runtime: RuyiRuntimeBridge;
}

export function App({ intent, runtime }: AppProps) {
  if (intent.page === "settings") {
    return <ServiceSettingsPage runtime={runtime} />;
  }

  return (
    <ConfiguredTranslationPage
      autoStart={intent.autoStart}
      initialText={intent.sourceText}
      runtime={runtime}
    />
  );
}
