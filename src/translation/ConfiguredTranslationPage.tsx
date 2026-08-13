import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CurrentTranslationInputs,
  CurrentTranslationSnapshot,
  ParallelTranslationProgress,
  RuntimeConfigurationState,
  RuyiRuntimeBridge,
  ServiceConfigurationView,
  StandardTranslationResult,
  TaskTerm,
  TargetLanguage,
  TerminologyState,
  TranslationQualityMode,
} from "../runtime/contracts";

type ConfiguredTranslationPageProps = {
  initialText: string;
  autoStart: boolean;
  runtime: RuyiRuntimeBridge;
};

type StartTranslationOptions = {
  confirmationToken?: string;
  referencePreviewToken?: string;
  beginNewTask?: boolean;
  targetLanguage: TargetLanguage;
  domainProfileId: string | null;
  additionalRequirements: string;
  taskTerms: TaskTerm[];
  referenceTranslationIds: string[] | null;
  parallelAcceleration: boolean;
  parallelConcurrency: number;
  qualityMode: TranslationQualityMode;
  thinkingEnabled: boolean;
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

const PRECISION_STAGE_LABELS = {
  preparing: "准备",
  analysis: "分析",
  translation: "翻译",
  accuracy_review: "准确性审校",
  language_review: "语言审校",
  reviews: "审校",
  revision: "修订",
} as const;

const PRECISION_ISSUE_LABELS: Record<string, string> = {
  mistranslation: "误译",
  omission: "漏译",
  addition: "多译",
  number: "数字",
  date: "日期",
  unit: "单位",
  proper_name: "专有名称",
  terminology: "术语",
  target_language: "目标语言",
  protected_content: "受保护内容",
  instruction_injection: "指令注入",
  grammar: "语法",
  fluency: "流畅度",
  tone: "语气",
  style: "风格",
  consistency: "一致性",
  terminology_form: "术语词形",
  other: "其他",
};

function buildCurrentInputs(
  sourceText: string,
  targetLanguage: TargetLanguage,
  serviceConfigurationId: string | null,
  domainProfileId: string | null,
  additionalRequirements: string,
  taskTerms: TaskTerm[],
  referenceTranslationIds: string[] | null,
  parallelAcceleration = false,
  parallelConcurrency = 3,
  qualityMode: TranslationQualityMode = "standard",
  thinkingEnabled = false,
): CurrentTranslationInputs {
  return {
    sourceText,
    targetLanguage,
    serviceConfigurationId,
    domainProfileId,
    qualityMode,
    thinkingEnabled,
    additionalRequirements,
    taskTerms,
    referenceTranslationIds,
    parallelAcceleration,
    parallelConcurrency,
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
  const [referenceTranslationIds, setReferenceTranslationIds] = useState<string[] | null>(null);
  const [referencePreviewSelection, setReferencePreviewSelection] = useState<string[]>([]);
  const [domainProfiles, setDomainProfiles] = useState<TerminologyState["domainProfiles"]>([]);
  const [domainProfileId, setDomainProfileId] = useState<string | null>(null);
  const [configuration, setConfiguration] =
    useState<RuntimeConfigurationState | null>(null);
  const [serviceConfigurations, setServiceConfigurations] = useState<
    ServiceConfigurationView[]
  >([]);
  const [result, setResult] = useState<StandardTranslationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [partialTranslation, setPartialTranslation] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [parallelAcceleration, setParallelAcceleration] = useState(false);
  const [parallelConcurrency, setParallelConcurrency] = useState(3);
  const [qualityMode, setQualityMode] =
    useState<TranslationQualityMode>("standard");
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [isSwitchingService, setIsSwitchingService] = useState(false);
  const [precisionStage, setPrecisionStage] = useState<
    "preparing" | "analyzing" | "translating" | "reviewing" | "revising" | null
  >(null);
  const [parallelProgress, setParallelProgress] =
    useState<ParallelTranslationProgress | null>(null);
  const [confirmRiskCopy, setConfirmRiskCopy] = useState(false);
  const [hostActionMessage, setHostActionMessage] = useState("");
  const [snapshotStale, setSnapshotStale] = useState(false);
  const taskId = useRef(createTaskId());
  const requestGeneration = useRef(0);
  const deferredActionGeneration = useRef(0);
  const serviceSelectionGeneration = useRef(0);
  const domainSelectionGeneration = useRef(0);
  const thinkingUpdateGeneration = useRef(0);
  const hasAutoStarted = useRef(false);
  const mounted = useRef(true);
  const riskCopyTrigger = useRef<HTMLButtonElement | null>(null);
  const riskCopyCancel = useRef<HTMLButtonElement | null>(null);
  const referencePreviewCancel = useRef<HTMLButtonElement | null>(null);
  const restoreRiskCopyFocus = useRef(false);

  const applyCurrentSnapshot = useCallback(
    (snapshot: CurrentTranslationSnapshot | null) => {
      if (!snapshot) {
        setSourceText("");
        setTargetLanguage(INITIAL_TARGET_LANGUAGE);
        setAdditionalRequirements("");
        setTaskTerms([]);
        setReferenceTranslationIds(null);
        setReferencePreviewSelection([]);
        setDomainProfileId(null);
        setResult(null);
        setPartialTranslation("");
        setIsTranslating(false);
        setParallelAcceleration(false);
        setParallelConcurrency(3);
        setParallelProgress(null);
        setQualityMode("standard");
        setThinkingEnabled(false);
        setPrecisionStage(null);
        setConfirmRiskCopy(false);
        setHostActionMessage("");
        setSnapshotStale(false);
        return;
      }
      setSourceText(snapshot.inputs.sourceText);
      setTargetLanguage(
        TARGET_LANGUAGES.find(
          (language) => language.id === snapshot.inputs.targetLanguage.id,
        ) ?? snapshot.inputs.targetLanguage,
      );
      setAdditionalRequirements(snapshot.inputs.additionalRequirements);
      setTaskTerms(snapshot.inputs.taskTerms);
      setReferenceTranslationIds(snapshot.inputs.referenceTranslationIds);
      setDomainProfileId(snapshot.inputs.domainProfileId ?? null);
      setResult(snapshot.result);
      setReferencePreviewSelection(
        snapshot.result?.status === "reference_confirmation_required"
          ? snapshot.result.referenceTranslations.map((reference) => reference.id)
          : [],
      );
      setPartialTranslation(snapshot.partialTranslation);
      setIsTranslating(
        ["preparing", "analyzing", "translating", "reviewing", "revising"].includes(
          snapshot.phase,
        ),
      );
      setParallelAcceleration(snapshot.inputs.parallelAcceleration);
      setParallelConcurrency(snapshot.inputs.parallelConcurrency);
      setParallelProgress(snapshot.parallelProgress);
      setQualityMode(snapshot.inputs.qualityMode);
      setThinkingEnabled(Boolean(snapshot.inputs.thinkingEnabled));
      setPrecisionStage(
        ["preparing", "analyzing", "translating", "reviewing", "revising"].includes(
          snapshot.phase,
        )
          ? (snapshot.phase as
              | "preparing"
              | "analyzing"
              | "translating"
              | "reviewing"
              | "revising")
          : null,
      );
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
      serviceConfigurationId = configuration?.serviceConfiguration?.id ?? null,
      selectedDomainProfileId = domainProfileId,
      selectedTaskTerms = taskTerms,
      selectedReferenceTranslationIds = referenceTranslationIds,
      selectedParallelAcceleration = parallelAcceleration,
      selectedParallelConcurrency = parallelConcurrency,
      selectedQualityMode = qualityMode,
      selectedThinkingEnabled = thinkingEnabled,
    ): CurrentTranslationInputs =>
      buildCurrentInputs(
        source,
        language,
        serviceConfigurationId,
        selectedDomainProfileId,
        requirements,
        selectedTaskTerms,
        selectedReferenceTranslationIds,
        selectedParallelAcceleration,
        selectedParallelConcurrency,
        selectedQualityMode,
        selectedThinkingEnabled,
      ),
    [
      additionalRequirements,
      configuration,
      domainProfileId,
      sourceText,
      targetLanguage,
      taskTerms,
      referenceTranslationIds,
      parallelAcceleration,
      parallelConcurrency,
      qualityMode,
      thinkingEnabled,
    ],
  );

  const publishInputs = useCallback(
    (inputs: CurrentTranslationInputs) => {
      if (
        result?.status === "confirmation_required" ||
        result?.status === "reference_confirmation_required"
      ) {
        runtime.cancelTranslation(taskId.current);
        setResult(null);
      }
      setSnapshotStale(runtime.updateCurrentTranslationInputs(inputs).stale);
    },
    [result, runtime],
  );

  const closeRiskCopy = useCallback(() => {
    restoreRiskCopyFocus.current = true;
    setConfirmRiskCopy(false);
  }, []);

  const cancelReferencePreview = useCallback(() => {
    runtime.cancelTranslation(taskId.current);
    setResult(null);
    setReferencePreviewSelection([]);
  }, [runtime]);

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
      if (options.qualityMode === "precision" && !runtime.startTranslation) {
        setErrorMessage("当前运行时版本不支持精译，请更新插件后重试。");
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
        setDomainProfileId(options.domainProfileId);
        setReferenceTranslationIds(options.referenceTranslationIds);
        setParallelAcceleration(options.parallelAcceleration);
        setParallelConcurrency(options.parallelConcurrency);
        setQualityMode(options.qualityMode);
        setThinkingEnabled(options.thinkingEnabled);
      } else if (options.referencePreviewToken) {
        setReferenceTranslationIds(options.referenceTranslationIds);
      }
      const generation = ++requestGeneration.current;
      setResult(null);
      setPartialTranslation("");
      setIsTranslating(false);
      setParallelProgress(null);
      setPrecisionStage(null);
      setSnapshotStale(false);
      const submittedInputs = buildCurrentInputs(
        text,
        options.targetLanguage,
        state.serviceConfiguration?.id ?? null,
        options.domainProfileId,
        options.additionalRequirements,
        options.taskTerms,
        options.referenceTranslationIds,
        options.parallelAcceleration,
        options.parallelConcurrency,
        options.qualityMode,
        options.thinkingEnabled,
      );
      try {
        const startRuntimeTranslation =
          options.qualityMode === "precision"
            ? runtime.startTranslation!
            : runtime.startStandardTranslation;
        const nextResult = await startRuntimeTranslation({
          taskId: taskId.current,
          sourceText: text,
          targetLanguage: options.targetLanguage,
          serviceConfigurationId: state.serviceConfiguration?.id ?? null,
          domainProfileId: options.domainProfileId,
          additionalRequirements: options.additionalRequirements,
          taskTerms: submittedInputs.taskTerms,
          referenceTranslationIds: submittedInputs.referenceTranslationIds,
          referencePreviewToken: options.referencePreviewToken,
          confirmationToken: options.confirmationToken,
          parallelAcceleration: submittedInputs.parallelAcceleration,
          parallelConcurrency: submittedInputs.parallelConcurrency,
          qualityMode: submittedInputs.qualityMode,
          thinkingEnabled: Boolean(submittedInputs.thinkingEnabled),
        }, (event) => {
          if (!mounted.current || generation !== requestGeneration.current) {
            return;
          }
          if (event.type === "started") {
            setIsTranslating(true);
          } else if (event.type === "text_delta") {
            setPartialTranslation((current) => current + event.delta);
          } else if (event.type === "precision_stage") {
            setIsTranslating(true);
            setPrecisionStage(event.stage);
          } else if (event.type === "precision_plan") {
            setPrecisionStage("analyzing");
          } else if (event.type === "parallel_plan") {
            setParallelProgress({
              completed: 0,
              total: event.parallel.segmentCount,
              inFlight: 0,
              concurrency: event.parallel.concurrency,
              fallbackReason: event.parallel.fallbackReason,
            });
          } else if (event.type === "segment_progress") {
            setParallelProgress({
              completed: event.completed,
              total: event.total,
              inFlight: event.inFlight,
              concurrency: event.concurrency,
              fallbackReason: null,
            });
          } else if (event.type === "finished") {
            setIsTranslating(false);
            setPrecisionStage(null);
          }
        });
        if (mounted.current && generation === requestGeneration.current) {
          setIsTranslating(false);
          setPrecisionStage(null);
          if (
            nextResult.status === "failed" &&
            nextResult.partialTranslation
          ) {
            setPartialTranslation(nextResult.partialTranslation);
          }
          if (nextResult.status === "reference_confirmation_required") {
            setReferencePreviewSelection(
              nextResult.referenceTranslations.map((reference) => reference.id),
            );
          }
          setResult(nextResult);
        }
      } catch {
        if (mounted.current && generation === requestGeneration.current) {
          setIsTranslating(false);
          setPrecisionStage(null);
          setErrorMessage("翻译运行时发生异常，请稍后重试。");
        }
      }
    },
    [runtime],
  );

  useEffect(() => {
    let active = true;
    const deferredGeneration = deferredActionGeneration.current;
    const selectionGeneration = serviceSelectionGeneration.current;
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
        previousInputs?.domainProfileId ?? null,
        previousInputs?.additionalRequirements ?? "",
        [],
        null,
        previousInputs?.parallelAcceleration ?? false,
        previousInputs?.parallelConcurrency ?? 3,
        previousInputs?.qualityMode ?? "standard",
        Boolean(previousInputs?.thinkingEnabled),
      );
      runtime.updateCurrentTranslationInputs(replacementInputs);
      setSourceText(replacementInputs.sourceText);
      setTargetLanguage(replacementInputs.targetLanguage);
      setAdditionalRequirements(replacementInputs.additionalRequirements);
      setTaskTerms(replacementInputs.taskTerms);
      setReferenceTranslationIds(null);
      setParallelAcceleration(replacementInputs.parallelAcceleration);
      setParallelConcurrency(replacementInputs.parallelConcurrency);
      setQualityMode(replacementInputs.qualityMode);
      setThinkingEnabled(Boolean(replacementInputs.thinkingEnabled));
      setParallelProgress(null);
      setReferencePreviewSelection([]);
      setResult(null);
      setPartialTranslation("");
      setIsTranslating(false);
      setConfirmRiskCopy(false);
      setHostActionMessage("");
      setSnapshotStale(false);
    }
    void Promise.all([
      runtime.getServiceConfiguration(),
      runtime.getTerminologyState(),
    ])
      .then(async ([state, terminology]) => {
        if (
          !active ||
          selectionGeneration !== serviceSelectionGeneration.current
        ) {
          return;
        }
        setConfiguration(state);
        setDomainProfiles(terminology.domainProfiles);
        const selectedDomainProfileId = previousInputs
          ? previousInputs.domainProfileId
          : terminology.currentDomainProfileId;
        setDomainProfileId(selectedDomainProfileId);
        if (deferredGeneration !== deferredActionGeneration.current) {
          return;
        }
        if (shouldAutoStart) {
          const autoTargetLanguage =
            previousInputs?.targetLanguage ?? state.defaults.targetLanguage;
          const autoRequirements =
            previousInputs?.additionalRequirements ??
            state.defaults.additionalRequirements;
          const autoTaskTerms: TaskTerm[] = [];
          const autoQualityMode = previousInputs?.qualityMode ?? state.defaults.qualityMode;
          const autoThinkingEnabled =
            previousInputs?.thinkingEnabled ??
            Boolean(state.serviceConfiguration?.thinkingEnabled);
          setTargetLanguage(autoTargetLanguage);
          setAdditionalRequirements(autoRequirements);
          setTaskTerms(autoTaskTerms);
          setQualityMode(autoQualityMode);
          setThinkingEnabled(autoThinkingEnabled);
          await startTranslation(
            state,
            initialText,
            {
              targetLanguage: autoTargetLanguage,
              domainProfileId: selectedDomainProfileId,
              additionalRequirements: autoRequirements,
              taskTerms: autoTaskTerms,
              referenceTranslationIds: null,
              parallelAcceleration: previousInputs?.parallelAcceleration ?? false,
              parallelConcurrency: previousInputs?.parallelConcurrency ?? 3,
              qualityMode: autoQualityMode,
              thinkingEnabled: autoThinkingEnabled,
            },
          );
        } else if (!runtime.getCurrentTranslation()) {
          setTargetLanguage(state.defaults.targetLanguage);
          setAdditionalRequirements(state.defaults.additionalRequirements);
          setQualityMode(state.defaults.qualityMode);
          setThinkingEnabled(Boolean(state.serviceConfiguration?.thinkingEnabled));
          runtime.updateCurrentTranslationInputs({
            sourceText: initialText,
            targetLanguage: state.defaults.targetLanguage,
            serviceConfigurationId: state.serviceConfiguration?.id ?? null,
            domainProfileId: selectedDomainProfileId,
            qualityMode: state.defaults.qualityMode,
            thinkingEnabled: Boolean(state.serviceConfiguration?.thinkingEnabled),
            additionalRequirements: state.defaults.additionalRequirements,
            taskTerms: [],
            referenceTranslationIds: null,
            parallelAcceleration: false,
            parallelConcurrency: 3,
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
    void runtime
      .getServiceConfigurations()
      .then((serviceState) => {
        if (active) setServiceConfigurations(serviceState.serviceConfigurations);
      })
      .catch(() => {
        if (active) setErrorMessage("无法读取服务配置列表。");
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
  const referenceConfirmation =
    result?.status === "reference_confirmation_required" ? result : null;
  const quality =
    result?.status === "completed" || result?.status === "failed"
      ? result.quality
      : undefined;
  const resultIsStale = snapshotStale;
  const parallelAdvice = runtime.getParallelAccelerationAdvice(
    sourceText,
    configuration?.serviceConfiguration?.id,
  );
  const translationCallPlan = runtime.getTranslationCallPlan?.({
    sourceText,
    qualityMode,
    parallelAcceleration,
    parallelConcurrency,
  }) ?? {
    qualityMode,
    translationCalls: 1,
    segmentCount: 1,
    maximumCallCount: qualityMode === "precision" ? 5 : 1,
  };
  const precisionStageText =
    precisionStage === "preparing"
      ? "正在准备翻译任务…"
      : precisionStage === "analyzing"
      ? "正在分析全文…"
      : precisionStage === "reviewing"
        ? "正在并行进行准确性审校和语言审校…"
        : precisionStage === "revising"
          ? "正在定向修订风险段落…"
          : null;

  function replaceTaskTerms(nextTaskTerms: TaskTerm[]) {
    deferredActionGeneration.current += 1;
    setTaskTerms(nextTaskTerms);
    publishInputs(
      currentInputs(
        sourceText,
        targetLanguage,
        additionalRequirements,
        configuration?.serviceConfiguration?.id ?? null,
        domainProfileId,
        nextTaskTerms,
        referenceTranslationIds,
      ),
    );
  }

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

  useEffect(() => {
    if (!referenceConfirmation) return undefined;
    referencePreviewCancel.current?.focus();
    function handleReferencePreviewEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelReferencePreview();
      }
    }
    window.addEventListener("keydown", handleReferencePreviewEscape);
    return () => window.removeEventListener("keydown", handleReferencePreviewEscape);
  }, [cancelReferencePreview, referenceConfirmation]);

  return (
    <main>
      <h1>如意翻译</h1>
      <p className="task-summary">
        目标语言：{targetLanguage.displayName ?? targetLanguage.modelLabel}
        <span aria-hidden="true"> · </span>
        质量模式：{qualityMode === "precision" ? "精译模式" : "标准模式"}
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
          if (configuration && !isSwitchingService) {
            void startTranslation(configuration, sourceText, {
              beginNewTask: true,
              targetLanguage,
              domainProfileId,
              additionalRequirements,
              taskTerms,
              referenceTranslationIds: null,
              parallelAcceleration,
              parallelConcurrency,
              qualityMode,
              thinkingEnabled,
            });
          }
        }}
      >
        {serviceConfigurations.length > 0 && (
          <>
            <label htmlFor="service-configuration">服务配置</label>
            <select
              id="service-configuration"
              value={configuration?.serviceConfiguration?.id ?? ""}
              onChange={(event) => {
                const configurationId = event.target.value;
                if (result && result.status !== "completed" && result.status !== "failed") {
                  runtime.cancelTranslation(taskId.current);
                  setResult(null);
                }
                deferredActionGeneration.current += 1;
                const selectionGeneration = ++serviceSelectionGeneration.current;
                thinkingUpdateGeneration.current += 1;
                setIsSwitchingService(true);
                setErrorMessage("");
                void runtime
                  .setCurrentServiceConfiguration(configurationId)
                  .then((serviceState) => {
                    if (
                      !mounted.current ||
                      selectionGeneration !== serviceSelectionGeneration.current
                    ) {
                      return null;
                    }
                    setServiceConfigurations(serviceState.serviceConfigurations);
                    return runtime.getServiceConfiguration(configurationId);
                  })
                  .then((selectedConfiguration) => {
                    if (
                      !selectedConfiguration ||
                      !mounted.current ||
                      selectionGeneration !== serviceSelectionGeneration.current
                    ) {
                      return;
                    }
                    setConfiguration(selectedConfiguration);
                    setThinkingEnabled(
                      Boolean(selectedConfiguration.serviceConfiguration?.thinkingEnabled),
                    );
                    const latestInputs = runtime.getCurrentTranslation()?.inputs;
                    publishInputs({
                      ...(latestInputs ?? currentInputs()),
                      serviceConfigurationId: configurationId,
                      thinkingEnabled: Boolean(
                        selectedConfiguration.serviceConfiguration?.thinkingEnabled,
                      ),
                    });
                    setIsSwitchingService(false);
                  })
                  .catch(() => {
                    if (
                      mounted.current &&
                      selectionGeneration === serviceSelectionGeneration.current
                    ) {
                      setIsSwitchingService(false);
                      setErrorMessage("服务配置切换失败。");
                    }
                  });
              }}
            >
              {serviceConfigurations.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </>
        )}
        <label htmlFor="domain-profile">行业配置</label>
        <select
          id="domain-profile"
          value={domainProfileId ?? ""}
          onChange={(event) => {
            const nextDomainProfileId = event.target.value || null;
            const selectionGeneration = ++domainSelectionGeneration.current;
            deferredActionGeneration.current += 1;
            setDomainProfileId(nextDomainProfileId);
            setReferenceTranslationIds(null);
            void runtime
              .setCurrentDomainProfile(nextDomainProfileId)
              .then((terminology) => {
                if (
                  !mounted.current ||
                  selectionGeneration !== domainSelectionGeneration.current
                ) return;
                setDomainProfiles(terminology.domainProfiles);
                const latestInputs = runtime.getCurrentTranslation()?.inputs;
                publishInputs({
                  ...(latestInputs ?? currentInputs()),
                  domainProfileId: nextDomainProfileId,
                  referenceTranslationIds: null,
                });
              })
              .catch(() => {
                if (
                  mounted.current &&
                  selectionGeneration === domainSelectionGeneration.current
                ) setErrorMessage("行业配置切换失败。");
              });
          }}
        >
          <option value="">不使用行业配置</option>
          {domainProfiles.map((domainProfile) => (
            <option value={domainProfile.id} key={domainProfile.id}>
              {domainProfile.name}
            </option>
          ))}
        </select>
        <label htmlFor="source-text">源文本</label>
        <textarea
          id="source-text"
          value={sourceText}
          onChange={(event) => {
            const nextSourceText = event.target.value;
            deferredActionGeneration.current += 1;
            setSourceText(nextSourceText);
            setReferenceTranslationIds(null);
            publishInputs(
              currentInputs(
                nextSourceText,
                targetLanguage,
                additionalRequirements,
                configuration?.serviceConfiguration?.id ?? null,
                domainProfileId,
                taskTerms,
                null,
              ),
            );
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              if (configuration && !isSwitchingService) {
                void startTranslation(
                  configuration,
                  sourceText,
                  {
                    beginNewTask: true,
                    targetLanguage,
                    domainProfileId,
                    additionalRequirements,
                    taskTerms,
                    referenceTranslationIds: null,
                    parallelAcceleration,
                    parallelConcurrency,
                    qualityMode,
                    thinkingEnabled,
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
            setReferenceTranslationIds(null);
            publishInputs(
              currentInputs(
                sourceText,
                nextTargetLanguage,
                additionalRequirements,
                configuration?.serviceConfiguration?.id ?? null,
                domainProfileId,
                taskTerms,
                null,
              ),
            );
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
        <fieldset className="quality-mode-settings">
          <legend>翻译质量</legend>
          <label htmlFor="quality-mode">质量模式</label>
          <select
            id="quality-mode"
            value={qualityMode}
            onChange={(event) => {
              const nextQualityMode = event.target.value as TranslationQualityMode;
              deferredActionGeneration.current += 1;
              setQualityMode(nextQualityMode);
              publishInputs({
                ...currentInputs(),
                qualityMode: nextQualityMode,
              });
            }}
          >
            <option value="standard">标准模式</option>
            <option value="precision">精译模式</option>
          </select>
          {qualityMode === "precision" ? (
            <p className="precision-call-plan">
              本次计划：1 次分析 + {translationCallPlan.translationCalls} 次翻译 + 2
              次并行审校 + 最多 1 次修订。
            </p>
          ) : null}
          {qualityMode === "precision" &&
          configuration?.serviceConfiguration?.type === "deepseek-official" ? (
            <>
              <label htmlFor="deepseek-thinking">
                <input
                  id="deepseek-thinking"
                  type="checkbox"
                  checked={thinkingEnabled}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    const configurationId = configuration.serviceConfiguration?.id;
                    if (!configurationId || !runtime.setServiceThinkingMode) return;
                    const updateGeneration = ++thinkingUpdateGeneration.current;
                    const selectionGeneration = serviceSelectionGeneration.current;
                    deferredActionGeneration.current += 1;
                    setThinkingEnabled(enabled);
                    publishInputs({
                      ...currentInputs(),
                      thinkingEnabled: enabled,
                    });
                    void runtime
                      .setServiceThinkingMode(configurationId, enabled)
                      .then((serviceState) => {
                        if (
                          !mounted.current ||
                          updateGeneration !== thinkingUpdateGeneration.current ||
                          selectionGeneration !== serviceSelectionGeneration.current ||
                          configurationId !== configuration.serviceConfiguration?.id
                        ) return;
                        const serviceConfiguration = serviceState.serviceConfigurations.find(
                          (service) => service.id === configurationId,
                        );
                        if (serviceConfiguration) {
                          setConfiguration((current) =>
                            current?.serviceConfiguration?.id === configurationId
                              ? { ...current, serviceConfiguration }
                              : current,
                          );
                        }
                      })
                      .catch(() => {
                        if (
                          !mounted.current ||
                          updateGeneration !== thinkingUpdateGeneration.current ||
                          selectionGeneration !== serviceSelectionGeneration.current ||
                          configurationId !== configuration.serviceConfiguration?.id
                        ) return;
                        setThinkingEnabled(!enabled);
                        publishInputs({
                          ...currentInputs(),
                          thinkingEnabled: !enabled,
                        });
                        setErrorMessage("思考模式设置保存失败。");
                      });
                  }}
                />
                DeepSeek 思考模式
              </label>
              {thinkingEnabled ? (
                <p>精译的分析、翻译、审校和修订都会启用思考，等待时间和费用可能明显增加。</p>
              ) : null}
            </>
          ) : null}
        </fieldset>
        <fieldset className="parallel-acceleration-settings">
          <legend>长文本翻译</legend>
          <label htmlFor="parallel-acceleration">
            <input
              id="parallel-acceleration"
              type="checkbox"
              checked={parallelAcceleration}
              onChange={(event) => {
                const nextParallelAcceleration = event.target.checked;
                deferredActionGeneration.current += 1;
                setParallelAcceleration(nextParallelAcceleration);
                publishInputs({
                  ...currentInputs(),
                  parallelAcceleration: nextParallelAcceleration,
                });
              }}
            />
            并发加速
          </label>
          <label htmlFor="parallel-concurrency">并发数</label>
          <select
            id="parallel-concurrency"
            value={parallelConcurrency}
            disabled={!parallelAcceleration}
            onChange={(event) => {
              const nextParallelConcurrency = Number(event.target.value);
              deferredActionGeneration.current += 1;
              setParallelConcurrency(nextParallelConcurrency);
              publishInputs({
                ...currentInputs(),
                parallelConcurrency: nextParallelConcurrency,
              });
            }}
          >
            {[1, 2, 3, 4, 5, 6].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <p>
            并发加速只会在你手动开启后使用，默认并发数为 3；关闭时仍按全文发起一次翻译。
          </p>
          {parallelAdvice.suggested ? (
            <p className="parallel-advice">
              {parallelAdvice.reason === "no_samples_long_source"
                ? "当前服务暂无速度样本，源文本已超过 4,000 个码点，建议手动开启并发加速。"
                : `按当前服务的本地速度样本预计约 ${parallelAdvice.estimatedSeconds} 秒，建议手动开启并发加速。`}
            </p>
          ) : null}
        </fieldset>
        <fieldset className="task-terms-editor">
          <legend>本次术语</legend>
          <p>本次术语优先于行业术语和通用术语，只保留在当前翻译内存中。</p>
          {taskTerms.map((term, index) => (
            <div className="task-term-row" key={`task-term-${index}`}>
              <label>
                源术语
                <input
                  aria-label={index === 0 ? "本次术语源术语" : `本次术语源术语 ${index + 1}`}
                  value={term.sourceTerm}
                  onChange={(event) =>
                    replaceTaskTerms(
                      taskTerms.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, sourceTerm: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <label>
                译法
                <input
                  aria-label={index === 0 ? "本次术语译法" : `本次术语译法 ${index + 1}`}
                  value={term.preferredTarget}
                  onChange={(event) =>
                    replaceTaskTerms(
                      taskTerms.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, preferredTarget: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                aria-label={`删除本次术语 ${index + 1}`}
                onClick={() =>
                  replaceTaskTerms(taskTerms.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                删除
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              replaceTaskTerms([
                ...taskTerms,
                { sourceTerm: "", preferredTarget: "" },
              ])
            }
          >
            新增本次术语
          </button>
        </fieldset>
        <button type="submit" disabled={!configuration || isSwitchingService}>
          {qualityMode === "precision" ? "开始精译" : "开始翻译"}
        </button>
        <button
          type="button"
          onClick={() => {
            requestGeneration.current += 1;
            const clearGeneration = ++deferredActionGeneration.current;
            runtime.clearCurrentTranslation();
            taskId.current = createTaskId();
            applyCurrentSnapshot(null);
            setTargetLanguage(
              configuration?.defaults.targetLanguage ?? INITIAL_TARGET_LANGUAGE,
            );
            setAdditionalRequirements(
              configuration?.defaults.additionalRequirements ?? "",
            );
            setQualityMode(configuration?.defaults.qualityMode ?? "standard");
            setThinkingEnabled(
              Boolean(configuration?.serviceConfiguration?.thinkingEnabled),
            );
            setPrecisionStage(null);
            setErrorMessage("");
            void runtime
              .getTerminologyState()
              .then((terminology) => {
                if (
                  mounted.current &&
                  clearGeneration === deferredActionGeneration.current
                ) {
                  setDomainProfiles(terminology.domainProfiles);
                  setDomainProfileId(terminology.currentDomainProfileId);
                }
              })
              .catch(() => {
                if (
                  mounted.current &&
                  clearGeneration === deferredActionGeneration.current
                ) {
                  setErrorMessage("无法读取行业配置。");
                }
              });
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
          <p role="status">
            {precisionStageText ??
            (parallelProgress && parallelProgress.total > 1
              ? `并发翻译：已完成 ${parallelProgress.completed}/${parallelProgress.total} 段，正在处理 ${parallelProgress.inFlight} 段。`
              : qualityMode === "precision"
                ? "正在生成精译初稿…"
                : "正在翻译…")}
          </p>
          {parallelProgress?.fallbackReason ? (
            <p className="parallel-fallback-note">{parallelProgress.fallbackReason}</p>
          ) : null}
          <div
            role="region"
            className="translation-live-text"
            aria-label="译文生成中"
            aria-live="off"
          >
            {partialTranslation ||
              (precisionStage === "analyzing"
                ? "分析完成后开始生成译文。"
                : "正在等待模型返回译文…")}
          </div>
          <button
            type="button"
            onClick={() => {
              runtime.cancelTranslation(taskId.current);
              setIsTranslating(false);
              setPrecisionStage(null);
            }}
          >
            取消翻译
          </button>
        </section>
      ) : null}

      {(result?.status === "completed" || result?.status === "failed") &&
      result.parallel?.fallbackReason ? (
        <p className="parallel-fallback-note">{result.parallel.fallbackReason}</p>
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
                    domainProfileId,
                    additionalRequirements,
                    taskTerms,
                    referenceTranslationIds,
                    parallelAcceleration,
                    parallelConcurrency,
                    qualityMode,
                    thinkingEnabled,
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

      {referenceConfirmation ? (
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="reference-confirmation-heading"
          className="confirmation-card"
        >
          <h2 id="reference-confirmation-heading">确认参考译例</h2>
          <p>
            以下译例由本地文本相似度选出。只有勾选的译例会随本次请求发送，最多三条。
          </p>
          {qualityMode === "precision" ? (
            <p>
              本次计划：1 次分析 + {translationCallPlan.translationCalls} 次翻译 + 2
              次并行审校 + 最多 1 次修订。
            </p>
          ) : null}
          <fieldset>
            <legend>本次发送的参考译例</legend>
            {referenceConfirmation.referenceTranslations.map((reference, index) => (
              <label className="reference-translation-choice" key={reference.id}>
                <input
                  type="checkbox"
                  aria-label={`使用参考译例 ${index + 1}`}
                  checked={referencePreviewSelection.includes(reference.id)}
                  onChange={(event) => {
                    setReferencePreviewSelection((current) =>
                      event.target.checked
                        ? [...current, reference.id]
                        : current.filter((id) => id !== reference.id),
                    );
                  }}
                />
                <span>
                  <strong>{reference.source}</strong>
                  <span>{reference.translation}</span>
                  <small>
                    {reference.sourceLanguage} → {reference.targetLanguage}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="dialog-actions">
            <button
              ref={referencePreviewCancel}
              type="button"
              onClick={cancelReferencePreview}
            >
              取消本次翻译
            </button>
            <button
              type="button"
              onClick={() => {
                if (!configuration) return;
                void startTranslation(configuration, sourceText, {
                  referencePreviewToken: referenceConfirmation.previewToken,
                  targetLanguage,
                  domainProfileId,
                  additionalRequirements,
                  taskTerms,
                  referenceTranslationIds: referencePreviewSelection,
                  parallelAcceleration,
                  parallelConcurrency,
                  qualityMode,
                  thinkingEnabled,
                });
              }}
            >
              按所选译例继续
            </button>
          </div>
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
          {confirmation.preview.qualityMode === "precision" &&
          confirmation.preview.precisionCallPlan ? (
            <>
              <p>
                精译会让同一服务多次处理本次翻译数据，请确认后再发送。
              </p>
              <p>
                本次计划：1 次分析 + {confirmation.preview.precisionCallPlan.translationCalls}
                次翻译 + 2 次并行审校 + 最多 1 次修订，最多共
                {confirmation.preview.precisionCallPlan.maximumCallCount} 次调用。
              </p>
            </>
          ) : (
            <p>标准模式本次发起 {confirmation.preview.callCount} 次翻译调用。</p>
          )}
          {confirmation.preview.parallel?.fallbackReason ? (
            <p className="parallel-fallback-note">
              {confirmation.preview.parallel.fallbackReason}
            </p>
          ) : null}
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
                      domainProfileId,
                      additionalRequirements,
                      taskTerms,
                      referenceTranslationIds,
                      parallelAcceleration,
                      parallelConcurrency,
                      qualityMode,
                      thinkingEnabled,
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

      {result?.status === "validation_error" &&
      result.reason === "terminology_conflict" &&
      result.terminologyConflicts ? (
        <section
          className="configuration-card terminology-conflicts"
          aria-labelledby="terminology-conflicts-heading"
        >
          <h2 id="terminology-conflicts-heading">术语冲突</h2>
          <p role="alert">
            同一优先级的严格术语给出了不同译法。请选择本次翻译采用的译法。
          </p>
          {result.terminologyConflicts.map((conflict) => (
            <div key={conflict.source}>
              <h3>{conflict.source}</h3>
              <div className="compact-actions">
                {conflict.choices.map((choice) => (
                  <button
                    type="button"
                    aria-label={`使用译法 ${choice.preferredTarget}`}
                    key={`${choice.termId}:${choice.preferredTarget}`}
                    onClick={() => {
                      const nextTaskTerms = [
                        ...taskTerms.filter((term) => term.sourceTerm !== conflict.source),
                        {
                          sourceTerm: conflict.source,
                          preferredTarget: choice.preferredTarget,
                        },
                      ];
                      replaceTaskTerms(nextTaskTerms);
                      setResult(null);
                      setHostActionMessage(
                        `已将“${conflict.source}”加入本次术语，请重新开始翻译。`,
                      );
                    }}
                  >
                    {choice.preferredTarget}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {result?.status === "completed" ? (
        <>
          <p role="status">翻译已完成。</p>
          {result.precision && !result.precision.complete ? (
            <p role="alert">
              精译未完成，已保留初译。
              {result.precision.failedStage
                ? `未完成阶段：${PRECISION_STAGE_LABELS[result.precision.failedStage]}。`
                : ""}
            </p>
          ) : null}
          {result.precision?.analysis ? (
            <section aria-labelledby="precision-analysis-heading">
              <h2 id="precision-analysis-heading">精译分析</h2>
              <p>识别的源语言：{result.precision.analysis.detectedSourceLanguage}</p>
              {result.precision.analysis.inferredDomain.name ? (
                <p>
                  分析出的领域：{result.precision.analysis.inferredDomain.name}（置信度：
                  {result.precision.analysis.inferredDomain.confidence}）。用户选择的行业配置不会因此改变。
                </p>
              ) : null}
            </section>
          ) : null}
          {result.precision &&
          (result.precision.reviewIssues.length > 0 ||
            result.precision.revisedSegmentIds.length > 0 ||
            result.precision.unresolvedIssueIds.length > 0) ? (
            <section aria-labelledby="precision-review-heading">
              <h2 id="precision-review-heading">精译审校与修订</h2>
              {result.precision.reviewIssues.length > 0 ? (
                <ul>
                  {result.precision.reviewIssues.map((issue) => (
                    <li key={`${issue.reviewRole}:${issue.id}`}>
                      {issue.reviewRole === "accuracy" ? "准确性" : "语言"}风险（
                      {PRECISION_ISSUE_LABELS[issue.type] ?? issue.type}）：
                      {issue.suggestion}
                    </li>
                  ))}
                </ul>
              ) : null}
              {result.precision.revisedSegmentIds.length > 0 ? (
                <p>已定向修订 {result.precision.revisedSegmentIds.length} 个风险段落。</p>
              ) : null}
              {result.precision.unresolvedIssueIds.length > 0 ? (
                <p>仍有 {result.precision.unresolvedIssueIds.length} 项风险需要人工复核。</p>
              ) : null}
            </section>
          ) : null}
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
        <section>
          <p role="alert">
            {result.precision
              ? `精译未完成${
                  result.precision.failedStage
                    ? `，失败阶段：${PRECISION_STAGE_LABELS[result.precision.failedStage]}`
                    : ""
                }。${result.error.message}`
              : result.error.message}
          </p>
          {result.precision ? (
            <div className="compact-actions">
              <button
                type="button"
                disabled={!configuration || isSwitchingService}
                onClick={() => {
                  if (!configuration || isSwitchingService) return;
                  void startTranslation(configuration, sourceText, {
                    beginNewTask: true,
                    targetLanguage,
                    domainProfileId,
                    additionalRequirements,
                    taskTerms,
                    referenceTranslationIds,
                    parallelAcceleration,
                    parallelConcurrency,
                    qualityMode: "precision",
                    thinkingEnabled,
                  });
                }}
              >
                重试精译
              </button>
              <button
                type="button"
                onClick={() => {
                  setQualityMode("standard");
                  publishInputs({ ...currentInputs(), qualityMode: "standard" });
                }}
              >
                改用标准模式
              </button>
            </div>
          ) : null}
        </section>
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
        result.reason === "terminology_conflict" ? null : (
          <p role="alert">
            {result.message ??
              (result.reason === "invalid_source_text"
                ? "请输入需要翻译的有效文本。"
                : result.reason === "source_text_too_long"
                  ? "源文本不能超过 10,000 个 Unicode 码点。"
                  : result.reason === "invalid_terminology"
                    ? "术语配置无效，请检查后重新发起。"
                    : "翻译请求已失效，请重新发起。")}
          </p>
        )
      ) : null}

      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
      {hostActionMessage ? <p aria-live="polite">{hostActionMessage}</p> : null}
    </main>
  );
}
