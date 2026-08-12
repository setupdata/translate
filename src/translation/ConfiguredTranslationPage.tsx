import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CurrentTranslationInputs,
  CurrentTranslationSnapshot,
  RuntimeConfigurationState,
  RuyiRuntimeBridge,
  StandardTranslationResult,
  TaskTerm,
  TargetLanguage,
} from "../runtime/contracts";

type ConfiguredTranslationPageProps = {
  initialText: string;
  autoStart: boolean;
  runtime: RuyiRuntimeBridge;
};

type StartTranslationOptions = {
  confirmationToken?: string;
  beginNewTask?: boolean;
  targetLanguage: TargetLanguage;
  additionalRequirements: string;
  taskTerms: TaskTerm[];
};

function createTaskId(): string {
  return `translation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const TARGET_LANGUAGES: Array<TargetLanguage & { displayName: string }> = [
  { kind: "preset", id: "zh-CN", displayName: "简体中文", modelLabel: "Simplified Chinese" },
  { kind: "preset", id: "zh-TW", displayName: "繁体中文", modelLabel: "Traditional Chinese" },
  { kind: "preset", id: "en", displayName: "英语", modelLabel: "English" },
  { kind: "preset", id: "ja", displayName: "日语", modelLabel: "Japanese" },
  { kind: "preset", id: "ko", displayName: "韩语", modelLabel: "Korean" },
  { kind: "preset", id: "fr", displayName: "法语", modelLabel: "French" },
  { kind: "preset", id: "de", displayName: "德语", modelLabel: "German" },
  { kind: "preset", id: "es", displayName: "西班牙语", modelLabel: "Spanish" },
];

const INITIAL_TARGET_LANGUAGE = TARGET_LANGUAGES[0];

function buildCurrentInputs(
  sourceText: string,
  targetLanguage: TargetLanguage,
  serviceConfigurationId: string | null,
  additionalRequirements: string,
  taskTerms: TaskTerm[],
): CurrentTranslationInputs {
  return {
    sourceText,
    targetLanguage,
    serviceConfigurationId,
    qualityMode: "standard",
    additionalRequirements,
    taskTerms,
  };
}

export function ConfiguredTranslationPage({
  initialText,
  autoStart,
  runtime,
}: ConfiguredTranslationPageProps): React.JSX.Element {
  const [sourceText, setSourceText] = useState(initialText);
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>(
    INITIAL_TARGET_LANGUAGE,
  );
  const [additionalRequirements, setAdditionalRequirements] = useState("");
  const [taskTerms, setTaskTerms] = useState<TaskTerm[]>([]);
  const [configuration, setConfiguration] =
    useState<RuntimeConfigurationState | null>(null);
  const [result, setResult] = useState<StandardTranslationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [partialTranslation, setPartialTranslation] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [confirmRiskCopy, setConfirmRiskCopy] = useState(false);
  const [hostActionMessage, setHostActionMessage] = useState("");
  const [snapshotStale, setSnapshotStale] = useState(false);
  const taskId = useRef(createTaskId());
  const requestGeneration = useRef(0);
  const deferredActionGeneration = useRef(0);
  const hasAutoStarted = useRef(false);
  const mounted = useRef(true);
  const riskCopyTrigger = useRef<HTMLButtonElement | null>(null);
  const riskCopyCancel = useRef<HTMLButtonElement | null>(null);
  const restoreRiskCopyFocus = useRef(false);

  const applyCurrentSnapshot = useCallback(
    (snapshot: CurrentTranslationSnapshot | null) => {
      if (!snapshot) {
        setSourceText("");
        setTargetLanguage(INITIAL_TARGET_LANGUAGE);
        setAdditionalRequirements("");
        setTaskTerms([]);
        setResult(null);
        setPartialTranslation("");
        setIsTranslating(false);
        setConfirmRiskCopy(false);
        setHostActionMessage("");
        setSnapshotStale(false);
        return;
      }
      setSourceText(snapshot.inputs.sourceText);
      setTargetLanguage(snapshot.inputs.targetLanguage);
      setAdditionalRequirements(snapshot.inputs.additionalRequirements);
      setTaskTerms(snapshot.inputs.taskTerms);
      setResult(snapshot.result);
      setPartialTranslation(snapshot.partialTranslation);
      setIsTranslating(snapshot.phase === "translating");
      setSnapshotStale(snapshot.stale);
      if (snapshot.task) {
        taskId.current = snapshot.task.taskId;
      }
    },
    [],
  );

  const currentInputs = useCallback(
    (
      source = sourceText,
      language = targetLanguage,
      requirements = additionalRequirements,
    ): CurrentTranslationInputs =>
      buildCurrentInputs(
        source,
        language,
        configuration?.serviceConfiguration?.id ?? null,
        requirements,
        taskTerms,
      ),
    [additionalRequirements, configuration, sourceText, targetLanguage, taskTerms],
  );

  const publishInputs = useCallback(
    (inputs: CurrentTranslationInputs) => {
      setSnapshotStale(runtime.updateCurrentTranslationInputs(inputs).stale);
    },
    [runtime],
  );

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

  useEffect(() => {
    const existing = runtime.getCurrentTranslation();
    if (existing) {
      applyCurrentSnapshot(existing);
    }
    return runtime.subscribeCurrentTranslation(applyCurrentSnapshot);
  }, [applyCurrentSnapshot, runtime]);

  const startTranslation = useCallback(
    async (
      state: RuntimeConfigurationState,
      text: string,
      options: StartTranslationOptions,
    ) => {
      if (!mounted.current) {
        return;
      }
      setErrorMessage("");
      if (text.trim().length === 0) {
        setErrorMessage("请输入需要翻译的有效文本。");
        return;
      }
      if (Array.from(text.replace(/\r\n/gu, "\n")).length > 10_000) {
        setErrorMessage("源文本不能超过 10,000 个 Unicode 码点。");
        return;
      }
      setConfirmRiskCopy(false);
      setHostActionMessage("");
      if (options.beginNewTask) {
        runtime.cancelTranslation(taskId.current);
        taskId.current = createTaskId();
        setSourceText(text);
        setTargetLanguage(options.targetLanguage);
        setAdditionalRequirements(options.additionalRequirements);
        setTaskTerms(options.taskTerms);
      }
      const generation = ++requestGeneration.current;
      setResult(null);
      setPartialTranslation("");
      setIsTranslating(false);
      setSnapshotStale(false);
      const submittedInputs = buildCurrentInputs(
        text,
        options.targetLanguage,
        state.serviceConfiguration?.id ?? null,
        options.additionalRequirements,
        options.taskTerms,
      );
      try {
        const nextResult = await runtime.startStandardTranslation({
          taskId: taskId.current,
          sourceText: text,
          targetLanguage: options.targetLanguage,
          serviceConfigurationId: state.serviceConfiguration?.id ?? null,
          additionalRequirements: options.additionalRequirements,
          taskTerms: submittedInputs.taskTerms,
          confirmationToken: options.confirmationToken,
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
    const deferredGeneration = deferredActionGeneration.current;
    const shouldAutoStart = autoStart && !hasAutoStarted.current;
    const previousInputs = runtime.getCurrentTranslation()?.inputs ?? null;
    if (shouldAutoStart) {
      hasAutoStarted.current = true;
      runtime.clearCurrentTranslation();
      requestGeneration.current += 1;
      taskId.current = createTaskId();
      const replacementInputs = buildCurrentInputs(
        initialText,
        previousInputs?.targetLanguage ?? INITIAL_TARGET_LANGUAGE,
        previousInputs?.serviceConfigurationId ?? null,
        previousInputs?.additionalRequirements ?? "",
        previousInputs?.taskTerms ?? [],
      );
      runtime.updateCurrentTranslationInputs(replacementInputs);
      setSourceText(replacementInputs.sourceText);
      setTargetLanguage(replacementInputs.targetLanguage);
      setAdditionalRequirements(replacementInputs.additionalRequirements);
      setTaskTerms(replacementInputs.taskTerms);
      setResult(null);
      setPartialTranslation("");
      setIsTranslating(false);
      setConfirmRiskCopy(false);
      setHostActionMessage("");
      setSnapshotStale(false);
    }
    void runtime
      .getServiceConfiguration()
      .then(async (state) => {
        if (!active) {
          return;
        }
        setConfiguration(state);
        if (deferredGeneration !== deferredActionGeneration.current) {
          return;
        }
        if (shouldAutoStart) {
          const autoTargetLanguage =
            previousInputs?.targetLanguage ?? state.defaults.targetLanguage;
          const autoRequirements =
            previousInputs?.additionalRequirements ??
            state.defaults.additionalRequirements;
          const autoTaskTerms = previousInputs?.taskTerms ?? [];
          setTargetLanguage(autoTargetLanguage);
          setAdditionalRequirements(autoRequirements);
          setTaskTerms(autoTaskTerms);
          await startTranslation(
            state,
            initialText,
            {
              targetLanguage: autoTargetLanguage,
              additionalRequirements: autoRequirements,
              taskTerms: autoTaskTerms,
            },
          );
        } else if (!runtime.getCurrentTranslation()) {
          setTargetLanguage(state.defaults.targetLanguage);
          setAdditionalRequirements(state.defaults.additionalRequirements);
          runtime.updateCurrentTranslationInputs({
            sourceText: initialText,
            targetLanguage: state.defaults.targetLanguage,
            serviceConfigurationId: state.serviceConfiguration?.id ?? null,
            qualityMode: "standard",
            additionalRequirements: state.defaults.additionalRequirements,
            taskTerms: [],
          });
        }
      })
      .catch(() => {
        if (
          active &&
          deferredGeneration === deferredActionGeneration.current
        ) {
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
  const resultIsStale = snapshotStale;

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
        目标语言：{targetLanguage.displayName ?? targetLanguage.modelLabel}
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
            void startTranslation(configuration, sourceText, {
              beginNewTask: true,
              targetLanguage,
              additionalRequirements,
              taskTerms,
            });
          }
        }}
      >
        <label htmlFor="source-text">源文本</label>
        <textarea
          id="source-text"
          value={sourceText}
          onChange={(event) => {
            const nextSourceText = event.target.value;
            deferredActionGeneration.current += 1;
            setSourceText(nextSourceText);
            publishInputs(currentInputs(nextSourceText));
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              if (configuration) {
                void startTranslation(
                  configuration,
                  sourceText,
                  {
                    beginNewTask: true,
                    targetLanguage,
                    additionalRequirements,
                    taskTerms,
                  },
                );
              }
            }
          }}
        />
        <label htmlFor="target-language">目标语言</label>
        <select
          id="target-language"
          value={targetLanguage.id}
          onChange={(event) => {
            const nextTargetLanguage =
              TARGET_LANGUAGES.find(
                (candidate) => candidate.id === event.target.value,
              ) ?? INITIAL_TARGET_LANGUAGE;
            deferredActionGeneration.current += 1;
            setTargetLanguage(nextTargetLanguage);
            publishInputs(currentInputs(sourceText, nextTargetLanguage));
          }}
        >
          {TARGET_LANGUAGES.map((language) => (
            <option key={language.id} value={language.id}>
              {language.displayName}
            </option>
          ))}
        </select>
        <label htmlFor="additional-requirements">附加翻译要求</label>
        <textarea
          id="additional-requirements"
          value={additionalRequirements}
          onChange={(event) => {
            const nextRequirements = event.target.value;
            deferredActionGeneration.current += 1;
            setAdditionalRequirements(nextRequirements);
            publishInputs(
              currentInputs(sourceText, targetLanguage, nextRequirements),
            );
          }}
        />
        <button type="submit" disabled={!configuration}>
          开始翻译
        </button>
        <button
          type="button"
          onClick={() => {
            requestGeneration.current += 1;
            deferredActionGeneration.current += 1;
            runtime.clearCurrentTranslation();
            taskId.current = createTaskId();
            applyCurrentSnapshot(null);
            setTargetLanguage(
              configuration?.defaults.targetLanguage ?? INITIAL_TARGET_LANGUAGE,
            );
            setAdditionalRequirements(
              configuration?.defaults.additionalRequirements ?? "",
            );
            setErrorMessage("");
          }}
        >
          清空当前内容
        </button>
      </form>
      <p className="current-translation-note">
        当前内容只保留在本次插件进程内；清空后无法恢复。
      </p>

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
              const deferredGeneration = deferredActionGeneration.current;
              void runtime
                .saveApiKey(form)
                .then(async (savedState) => {
                  form.reset();
                  setConfiguration(savedState);
                  if (
                    !mounted.current ||
                    deferredGeneration !== deferredActionGeneration.current
                  ) {
                    return;
                  }
                  await startTranslation(savedState, sourceText, {
                    targetLanguage,
                    additionalRequirements,
                    taskTerms,
                  });
                })
                .catch(() => {
                  if (
                    mounted.current &&
                    deferredGeneration === deferredActionGeneration.current
                  ) {
                    setErrorMessage("API Key 保存失败。");
                  }
                });
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
                    {
                      confirmationToken: confirmation.confirmationToken,
                      targetLanguage,
                      additionalRequirements,
                      taskTerms,
                    },
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
                ? "源文本或任务设置已修改，当前译文对应修改前的任务设置；重新翻译前不能粘贴。"
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
          {resultIsStale ? (
            <p className="quality-blocked-note">
              源文本或任务设置已修改，当前部分译文对应修改前的任务设置。
            </p>
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
