import type { RuyiRuntimeBridge } from "../runtime/contracts";
import { ConfiguredTranslationPage } from "../translation/ConfiguredTranslationPage";
import type { EntryIntent } from "../utools/entry-intent";

export interface AppProps {
  intent: EntryIntent;
  runtime: RuyiRuntimeBridge;
}

export function App({ intent, runtime }: AppProps) {
  if (intent.page === "settings") {
    return (
      <main className="app-shell">
        <h1>设置</h1>
        <p>服务配置将在后续工单中提供。</p>
      </main>
    );
  }

  return (
    <ConfiguredTranslationPage
      autoStart={intent.autoStart}
      initialText={intent.sourceText}
      runtime={runtime}
    />
  );
}
