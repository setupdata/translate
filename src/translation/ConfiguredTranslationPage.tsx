import { useCallback, useEffect, useRef, useState } from "react";

import type {
  RuntimeConfigurationState,
  RuyiRuntimeBridge,
  StandardTranslationResult,
} from "../runtime/contracts";

type ConfiguredTranslationPageProps = {
  initialText: string;
  autoStart: boolean;
  runtime: RuyiRuntimeBridge;
};

function createTaskId(): string {
  return `translation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ConfiguredTranslationPage({
  initialText,
  autoStart,
  runtime,
}: ConfiguredTranslationPageProps): React.JSX.Element {
  const [sourceText, setSourceText] = useState(initialText);
  const [configuration, setConfiguration] =
    useState<RuntimeConfigurationState | null>(null);
  const [result, setResult] = useState<StandardTranslationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const taskId = useRef(createTaskId());
  const hasAutoStarted = useRef(false);

  const startTranslation = useCallback(
    async (
      state: RuntimeConfigurationState,
      text: string,
      confirmationToken?: string,
    ) => {
      setErrorMessage("");
      try {
        const nextResult = await runtime.startStandardTranslation({
          taskId: taskId.current,
          sourceText: text,
          targetLanguage: state.defaults.targetLanguage,
          confirmationToken,
        });
        setResult(nextResult);
      } catch {
        setErrorMessage("翻译运行时发生异常，请稍后重试。");
      }
    },
    [runtime],
  );

  useEffect(() => {
    let active = true;
    void runtime
      .getServiceConfiguration()
      .then(async (state) => {
        if (!active) {
          return;
        }
        setConfiguration(state);
        if (autoStart && !hasAutoStarted.current) {
          hasAutoStarted.current = true;
          await startTranslation(state, initialText);
        }
      })
      .catch(() => {
        if (active) {
          setErrorMessage("无法读取服务配置。");
        }
      });

    return () => {
      active = false;
    };
  }, [autoStart, initialText, runtime, startTranslation]);

  const needsApiKey =
    result?.status === "configuration_required" &&
    result.reason === "missing_api_key";
  const confirmation =
    result?.status === "confirmation_required" ? result : null;

  return (
    <main>
      <h1>如意翻译</h1>
      <p className="task-summary">
        目标语言：{configuration?.defaults.targetLanguage.displayName ?? "读取中…"}
        <span aria-hidden="true"> · </span>
        质量模式：标准模式
      </p>
      {configuration?.serviceConfiguration?.maskedApiKey ? (
        <p>
          当前服务：{configuration.serviceConfiguration.name}（
          <span>{configuration.serviceConfiguration.maskedApiKey}</span>）
        </p>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (configuration) {
            void startTranslation(configuration, sourceText);
          }
        }}
      >
        <label htmlFor="source-text">源文本</label>
        <textarea
          id="source-text"
          value={sourceText}
          onChange={(event) => setSourceText(event.target.value)}
        />
        <button type="submit" disabled={!configuration}>
          开始翻译
        </button>
      </form>

      {result?.status === "configuration_required" &&
      result.reason === "missing_configuration" ? (
        <section aria-labelledby="missing-configuration-heading">
          <h2 id="missing-configuration-heading">需要服务配置</h2>
          <p>当前没有可用服务配置，请打开“如意翻译设置”添加或修复配置。</p>
          <p>源文本仅保留在当前插件进程内，不会发送。</p>
        </section>
      ) : null}

      {needsApiKey ? (
        <section aria-labelledby="api-key-heading" className="configuration-card">
          <h2 id="api-key-heading">配置 DeepSeek API Key</h2>
          <p>源文本仅保留在当前插件进程内，保存密钥前不会发送。</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              void runtime
                .saveApiKey(form)
                .then(async (savedState) => {
                  form.reset();
                  setConfiguration(savedState);
                  await startTranslation(savedState, sourceText);
                })
                .catch(() => setErrorMessage("API Key 保存失败。"));
            }}
          >
            <label htmlFor="api-key">API Key</label>
            <input
              id="api-key"
              name="apiKey"
              type="password"
              autoComplete="off"
            />
            <button type="submit">保存密钥</button>
          </form>
        </section>
      ) : null}

      {confirmation ? (
        <section
          role="dialog"
          aria-labelledby="send-confirmation-heading"
          className="confirmation-card"
        >
          <h2 id="send-confirmation-heading">确认发送翻译数据</h2>
          <dl>
            <dt>服务</dt>
            <dd>{confirmation.preview.serviceName}</dd>
            <dt>完整翻译地址</dt>
            <dd>{confirmation.preview.normalizedTranslationUrl}</dd>
            <dt>协议</dt>
            <dd>{confirmation.preview.protocol}</dd>
          </dl>
          <p>将发送：</p>
          <ul>
            {confirmation.preview.dataSent.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>标准模式本次发起 {confirmation.preview.callCount} 次翻译调用。</p>
          <div className="dialog-actions">
            <button
              type="button"
              onClick={() => {
                runtime.cancelTranslation(taskId.current);
                setResult(null);
              }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                if (configuration) {
                  void startTranslation(
                    configuration,
                    sourceText,
                    confirmation.confirmationToken,
                  );
                }
              }}
            >
              同意并发送
            </button>
          </div>
        </section>
      ) : null}

      {result?.status === "completed" ? (
        <section aria-label="译文">{result.translation}</section>
      ) : null}
      {result?.status === "failed" ? (
        <p role="alert">{result.error.message}</p>
      ) : null}
      {result?.status === "validation_error" ? (
        <p role="alert">
          {result.reason === "invalid_source_text"
            ? "请输入需要翻译的有效文本。"
            : "翻译请求已失效，请重新发起。"}
        </p>
      ) : null}

      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
    </main>
  );
}
