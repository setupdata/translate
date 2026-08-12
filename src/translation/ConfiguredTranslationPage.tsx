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
  const [resultSourceText, setResultSourceText] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [partialTranslation, setPartialTranslation] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [confirmRiskCopy, setConfirmRiskCopy] = useState(false);
  const [hostActionMessage, setHostActionMessage] = useState("");
  const taskId = useRef(createTaskId());
  const requestGeneration = useRef(0);
  const hasAutoStarted = useRef(false);
  const mounted = useRef(true);
  const riskCopyTrigger = useRef<HTMLButtonElement | null>(null);
  const riskCopyCancel = useRef<HTMLButtonElement | null>(null);
  const restoreRiskCopyFocus = useRef(false);

  const closeRiskCopy = useCallback(() => {
    restoreRiskCopyFocus.current = true;
    setConfirmRiskCopy(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
    };
  }, []);

  const startTranslation = useCallback(
    async (
      state: RuntimeConfigurationState,
      text: string,
      confirmationToken?: string,
      beginNewTask = false,
    ) => {
      if (!mounted.current) {
        return;
      }
      setErrorMessage("");
      setConfirmRiskCopy(false);
      setHostActionMessage("");
      if (beginNewTask) {
        runtime.cancelTranslation(taskId.current);
        taskId.current = createTaskId();
      }
      const generation = ++requestGeneration.current;
      setResult(null);
      setResultSourceText(null);
      setPartialTranslation("");
      setIsTranslating(false);
      if (Array.from(text.replace(/\r\n/gu, "\n")).length > 10_000) {
        setErrorMessage("源文本不能超过 10,000 个 Unicode 码点。");
        return;
      }
      try {
        const nextResult = await runtime.startStandardTranslation({
          taskId: taskId.current,
          sourceText: text,
          targetLanguage: state.defaults.targetLanguage,
          confirmationToken,
        }, (event) => {
          if (!mounted.current || generation !== requestGeneration.current) {
            return;
          }
          if (event.type === "started") {
            setIsTranslating(true);
          } else if (event.type === "text_delta") {
            setPartialTranslation((current) => current + event.delta);
          } else {
            setIsTranslating(false);
          }
        });
        if (mounted.current && generation === requestGeneration.current) {
          setIsTranslating(false);
          if (
            nextResult.status === "failed" &&
            nextResult.partialTranslation
          ) {
            setPartialTranslation(nextResult.partialTranslation);
          }
          setResult(nextResult);
          if (
            nextResult.status === "completed" ||
            (nextResult.status === "failed" && nextResult.partialTranslation)
          ) {
            setResultSourceText(text);
          }
        }
      } catch {
        if (mounted.current && generation === requestGeneration.current) {
          setIsTranslating(false);
          setErrorMessage("翻译运行时发生异常，请稍后重试。");
        }
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
  const quality =
    result?.status === "completed" || result?.status === "failed"
      ? result.quality
      : undefined;
  const resultIsStale =
    resultSourceText !== null && sourceText !== resultSourceText;

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && isTranslating) {
        event.preventDefault();
        runtime.cancelTranslation(taskId.current);
        setIsTranslating(false);
      }
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isTranslating, runtime]);

  useEffect(() => {
    if (!confirmRiskCopy) {
      if (restoreRiskCopyFocus.current) {
        restoreRiskCopyFocus.current = false;
        riskCopyTrigger.current?.focus();
      }
      return undefined;
    }
    riskCopyCancel.current?.focus();
    function handleRiskDialogEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRiskCopy();
      }
    }
    window.addEventListener("keydown", handleRiskDialogEscape);
    return () => window.removeEventListener("keydown", handleRiskDialogEscape);
  }, [closeRiskCopy, confirmRiskCopy]);

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
            void startTranslation(configuration, sourceText, undefined, true);
          }
        }}
      >
        <label htmlFor="source-text">源文本</label>
        <textarea
          id="source-text"
          value={sourceText}
          onChange={(event) => setSourceText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              if (configuration) {
                void startTranslation(
                  configuration,
                  sourceText,
                  undefined,
                  true,
                );
              }
            }
          }}
        />
        <button type="submit" disabled={!configuration}>
          开始翻译
        </button>
      </form>

      {isTranslating ? (
        <section className="translation-progress">
          <p role="status">正在翻译…</p>
          <div
            role="region"
            className="translation-live-text"
            aria-label="译文生成中"
            aria-live="off"
          >
            {partialTranslation || "正在等待模型返回译文…"}
          </div>
          <button
            type="button"
            onClick={() => {
              runtime.cancelTranslation(taskId.current);
              setIsTranslating(false);
            }}
          >
            取消翻译
          </button>
        </section>
      ) : null}

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
          aria-modal="true"
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
        <>
          <section aria-label="译文">{result.translation}</section>
          <div className="translation-actions">
            <button
              type="button"
              onClick={(event) => {
                riskCopyTrigger.current = event.currentTarget;
                const action = runtime.copyTranslation(result.taskId);
                if (action.status === "confirmation_required") {
                  setConfirmRiskCopy(true);
                  return;
                }
                setHostActionMessage(
                  action.status === "copied" ? "译文已复制。" : "当前环境无法复制译文。",
                );
              }}
            >
              复制译文
            </button>
            <button
              type="button"
              disabled={result.quality.pasteBlocked || resultIsStale}
              aria-describedby={
                result.quality.pasteBlocked || resultIsStale
                  ? "paste-blocked-reason"
                  : undefined
              }
              onClick={() => {
                const action = runtime.pasteTranslation(result.taskId, sourceText);
                setHostActionMessage(
                  action.status === "pasted"
                    ? "译文已粘贴回原窗口。"
                    : action.status === "blocked"
                      ? "确定性严重风险尚未解除，不能粘贴。"
                      : "当前环境无法粘贴译文。",
                );
              }}
            >
              粘贴回原窗口
            </button>
          </div>
          {result.quality.pasteBlocked || resultIsStale ? (
            <p id="paste-blocked-reason" className="quality-blocked-note">
              {resultIsStale
                ? "源文本已修改，当前译文对应修改前的内容；重新翻译前不能粘贴。"
                : "译文含确定性严重风险，已禁止直接粘贴；确认风险后仍可复制。"}
            </p>
          ) : null}
        </>
      ) : null}
      {result?.status === "failed" ? (
        <p role="alert">{result.error.message}</p>
      ) : null}
      {result?.status === "failed" && partialTranslation ? (
        <>
          <section aria-label="部分译文">{partialTranslation}</section>
          {result.quality ? (
            <div className="translation-actions">
              <button
                type="button"
                onClick={(event) => {
                  riskCopyTrigger.current = event.currentTarget;
                  const action = runtime.copyTranslation(result.taskId);
                  if (action.status === "confirmation_required") {
                    setConfirmRiskCopy(true);
                    return;
                  }
                  setHostActionMessage(
                    action.status === "copied"
                      ? "部分译文已复制。"
                      : "当前环境无法复制部分译文。",
                  );
                }}
              >
                复制部分译文
              </button>
              <button type="button" disabled>
                粘贴回原窗口
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {quality && quality.risks.length > 0 ? (
        <section className="quality-risks" aria-labelledby="quality-risk-heading">
          <h2 id="quality-risk-heading">质量风险</h2>
          <ul>
            {quality.risks.map((risk) => (
              <li key={risk.id}>
                <strong>
                  {risk.certainty === "deterministic" && risk.severity === "critical"
                    ? "严重风险"
                    : "请复核"}
                </strong>
                <span>{risk.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {confirmRiskCopy &&
      (result?.status === "completed" ||
        (result?.status === "failed" && result.partialTranslation)) ? (
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="risk-copy-heading"
          className="confirmation-card"
        >
          <h2 id="risk-copy-heading">确认复制风险译文</h2>
          <p>本地检查发现确定性严重风险。复制前请确认你会人工复核译文。</p>
          <div className="dialog-actions">
            <button ref={riskCopyCancel} type="button" onClick={closeRiskCopy}>
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                const action = runtime.copyTranslation(result.taskId, true);
                closeRiskCopy();
                setHostActionMessage(
                  action.status === "copied" ? "译文已复制。" : "当前环境无法复制译文。",
                );
              }}
            >
              确认并复制
            </button>
          </div>
        </section>
      ) : null}
      {result?.status === "validation_error" ? (
        <p role="alert">
          {result.reason === "invalid_source_text"
            ? "请输入需要翻译的有效文本。"
            : result.reason === "source_text_too_long"
              ? "源文本不能超过 10,000 个 Unicode 码点。"
              : "翻译请求已失效，请重新发起。"}
        </p>
      ) : null}

      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
      {hostActionMessage ? <p aria-live="polite">{hostActionMessage}</p> : null}
    </main>
  );
}
