import { useEffect, useRef, useState } from "react";

import type { TranslationAdapter } from "./translation-adapter";

type TranslationPageProps = {
  initialText: string;
  autoStart: boolean;
  translate: TranslationAdapter;
};

export function TranslationPage({
  initialText,
  autoStart,
  translate,
}: TranslationPageProps): React.JSX.Element {
  const [sourceText, setSourceText] = useState(initialText);
  const [translationResult, setTranslationResult] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const hasAutoStarted = useRef(false);

  async function submitTranslation(text: string): Promise<void> {
    if (text.trim().length === 0) {
      setValidationMessage("请输入需要翻译的有效文本。");
      return;
    }

    setValidationMessage("");
    try {
      const result = await translate(text);
      setTranslationResult(result);
    } catch {
      setValidationMessage("翻译失败，请确认受控本地模拟服务已经启动。");
    }
  }

  useEffect(() => {
    if (autoStart && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      void submitTranslation(sourceText);
    }
  }, [autoStart, sourceText, translate]);

  return (
    <main>
      <h1>如意翻译</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submitTranslation(sourceText);
        }}
      >
        <label htmlFor="source-text">源文本</label>
        <textarea
          id="source-text"
          value={sourceText}
          onChange={(event) => setSourceText(event.target.value)}
        />
        <button type="submit">开始翻译</button>
      </form>
      {validationMessage ? <p role="alert">{validationMessage}</p> : null}
      {translationResult ? (
        <section aria-label="译文">{translationResult}</section>
      ) : null}
    </main>
  );
}
