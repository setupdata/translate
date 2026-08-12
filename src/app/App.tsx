import type { TranslationAdapter } from "../translation/translation-adapter";
import { TranslationPage } from "../translation/TranslationPage";
import type { EntryIntent } from "../utools/entry-intent";

export interface AppProps {
  intent: EntryIntent;
  translate: TranslationAdapter;
}

export function App({ intent, translate }: AppProps) {
  if (intent.page === "settings") {
    return (
      <main className="app-shell">
        <h1>设置</h1>
        <p>服务配置将在后续工单中提供。</p>
      </main>
    );
  }

  return (
    <TranslationPage
      autoStart={intent.autoStart}
      initialText={intent.sourceText}
      translate={translate}
    />
  );
}
