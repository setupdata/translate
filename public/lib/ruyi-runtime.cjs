const SETTINGS_KEY = "ruyi.settings.v1";
const API_KEY_PREFIX = "ruyi.secret.api-key.";
const TERMINOLOGY_KEY = "ruyi.secret.terminology.v1";
const { randomBytes } = require("crypto");
const {
  OUTPUT_CODE_POINT_LIMIT,
  countCodePoints,
  createOutputAccumulator,
  inspectSourceText,
} = require("./text-limits.cjs");
const {
  extractProtectedItems,
  inspectTranslationQuality,
} = require("./quality-checks.cjs");
const {
  createProtocolOperation,
  createTranslationProtocolOperation,
} = require("./translation-protocol.cjs");
const {
  parseStructuredOutput,
  validatePromptContract,
} = require("./prompt-contracts.cjs");
const {
  ACCURACY_REVIEW_SYSTEM_PROMPT,
  ANALYSIS_SYSTEM_PROMPT,
  LANGUAGE_REVIEW_SYSTEM_PROMPT,
  REVISION_SYSTEM_PROMPT,
} = require("./prompts.cjs");
const {
  DEEPSEEK_FLASH_PRESET,
  configurationError,
  normalizeServiceUrl,
  parseModelIds,
  serviceConfigurationView,
  uniqueCopyName,
  validateServiceConfiguration,
} = require("./service-configurations.cjs");
const {
  inspectTerminologyQuality,
  resolveTerminology,
  validateDomainProfile,
  validateTermbase,
  validateTranslationInputBudget,
} = require("./terminology.cjs");
const {
  resolveReferenceSelection,
  selectReferenceTranslations,
  validateReferenceTranslation,
} = require("./reference-translations.cjs");
const {
  exportTermbaseCsv: serializeTermbaseCsv,
  previewTermbaseCsv: inspectTermbaseCsv,
} = require("./terminology-csv.cjs");
const {
  createTranslationPlan,
  mergeSegmentTranslations,
  parallelAccelerationAdvice,
  runSegmentPool,
} = require("./translation-segmentation.cjs");

const CONNECTION_TEST_SOURCE_TEXT = "Connection test";
const CONNECTION_TEST_MAX_RESPONSE_BYTES = 1024 * 1024;
const CONNECTION_TEST_NO_DATA_TIMEOUT_MILLISECONDS = 30_000;
const CONNECTION_TEST_TOTAL_TIMEOUT_MILLISECONDS = 120_000;
const MODEL_LIST_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MODEL_LIST_TOTAL_TIMEOUT_MILLISECONDS = 30_000;
const TRANSLATION_TOTAL_TIMEOUT_MILLISECONDS = 10 * 60 * 1_000;

const DEFAULTS = Object.freeze({
  targetLanguage: Object.freeze({
    kind: "preset",
    id: "zh-CN",
    displayName: "简体中文",
    modelLabel: "Simplified Chinese",
  }),
  qualityMode: "standard",
  additionalRequirements: "",
});

function createInitialSettings(servicePreset = DEEPSEEK_FLASH_PRESET) {
  const initialConfiguration = {
    cachedModels: [],
    modelsFetchedAt: null,
    performanceSamples: [],
    ...servicePreset,
  };
  return {
    version: 1,
    currentServiceConfigurationId: initialConfiguration.id,
    serviceConfigurations: [initialConfiguration],
    defaults: {
      targetLanguage: { ...DEFAULTS.targetLanguage },
      qualityMode: DEFAULTS.qualityMode,
      additionalRequirements: DEFAULTS.additionalRequirements,
    },
  };
}

function normalizeTargetLanguage(targetLanguage) {
  if (
    !targetLanguage ||
    targetLanguage.kind !== "preset" ||
    typeof targetLanguage.id !== "string" ||
    typeof targetLanguage.modelLabel !== "string"
  ) {
    return null;
  }
  return {
    kind: "preset",
    id: targetLanguage.id,
    modelLabel: targetLanguage.modelLabel,
  };
}

function sameConfirmationRequest(
  pending,
  request,
  targetLanguage,
  configuration,
  normalizedUrl,
  submittedInputs,
) {
  return (
    pending &&
    pending.taskId === request.taskId &&
    pending.sourceText === request.sourceText &&
    JSON.stringify(pending.targetLanguage) === JSON.stringify(targetLanguage) &&
    pending.configurationId === configuration.id &&
    pending.normalizedTranslationUrl === normalizedUrl &&
    pending.inputsFingerprint === inputsFingerprint(submittedInputs)
  );
}

function errorMessage(code) {
  const messages = {
    configuration_error: "服务配置无效。",
    authentication_error: "API Key 鉴权失败。",
    permission_error: "模型服务拒绝访问。",
    request_rejected: "模型服务拒绝了请求。",
    rate_limited: "请求过于频繁，请稍后由你重新发起。",
    server_error: "模型服务暂时不可用，请稍后由你重新发起。",
    network_error: "无法连接模型服务，请检查网络后重新发起。",
    tls_error: "模型服务的安全连接失败。",
    timeout: "模型服务请求超时。",
    cancelled: "翻译已取消。",
    response_too_large: "模型服务响应超过大小限制。",
    protocol_error: "模型服务返回了无法识别的响应。",
    content_rejected: "模型服务拒绝处理该文本。",
    unknown_error: "翻译请求失败。",
  };
  return messages[code] || messages.unknown_error;
}

function safeTransportErrorMessage(error, code) {
  if (
    code === "request_rejected" &&
    error &&
    typeof error.redirectOrigin === "string"
  ) {
    try {
      const destination = new URL(error.redirectOrigin).host;
      return `模型服务尝试重定向到不同来源 ${destination}，请求已停止。`;
    } catch {
      // Fall back to the stable message when the transport detail is malformed.
    }
  }
  return errorMessage(code);
}

function mapHttpError(status) {
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  if ([400, 402, 404, 405, 413, 422].includes(status)) {
    return "request_rejected";
  }
  return "unknown_error";
}

function mapTransportError(error) {
  const stableCodes = new Set([
    "configuration_error",
    "authentication_error",
    "permission_error",
    "request_rejected",
    "rate_limited",
    "server_error",
    "network_error",
    "tls_error",
    "timeout",
    "cancelled",
    "response_too_large",
    "protocol_error",
    "content_rejected",
    "unknown_error",
  ]);
  if (error && stableCodes.has(error.code)) {
    return error.code;
  }
  const code = error && error.code;
  if (["ETIMEDOUT", "ERR_SOCKET_TIMEOUT", "ESOCKETTIMEDOUT"].includes(code)) {
    return "timeout";
  }
  if (
    typeof code === "string" &&
    (code.startsWith("ERR_TLS") ||
      code.startsWith("CERT_") ||
      code.includes("SSL") ||
      [
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "DEPTH_ZERO_SELF_SIGNED_CERT",
        "SELF_SIGNED_CERT_IN_CHAIN",
        "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        "CERT_UNTRUSTED",
      ].includes(code))
  ) {
    return "tls_error";
  }
  if (
    [
      "ECONNABORTED",
      "ECONNREFUSED",
      "ECONNRESET",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ENOTFOUND",
      "EAI_AGAIN",
      "EPIPE",
    ].includes(code)
  ) {
    return "network_error";
  }
  return "unknown_error";
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    freezeDeep(child);
  }
  return Object.freeze(value);
}

function normalizeTaskTerms(taskTerms) {
  if (!Array.isArray(taskTerms)) return [];
  return taskTerms.map((term) => ({
    sourceTerm: term && term.sourceTerm,
    preferredTarget: term && term.preferredTarget,
  }));
}

function normalizeReferenceTranslationIds(referenceTranslationIds) {
  if (!Array.isArray(referenceTranslationIds)) return null;
  return referenceTranslationIds.map((id) => (typeof id === "string" ? id : ""));
}

function normalizeCurrentInputs(inputs) {
  const targetLanguage = normalizeTargetLanguage(inputs && inputs.targetLanguage);
  return freezeDeep({
    sourceText:
      inputs && typeof inputs.sourceText === "string" ? inputs.sourceText : "",
    targetLanguage: targetLanguage || { ...DEFAULTS.targetLanguage },
    serviceConfigurationId:
      inputs && typeof inputs.serviceConfigurationId === "string"
        ? inputs.serviceConfigurationId
        : null,
    domainProfileId:
      inputs && typeof inputs.domainProfileId === "string"
        ? inputs.domainProfileId
        : null,
    qualityMode:
      inputs && inputs.qualityMode === "precision" ? "precision" : "standard",
    thinkingEnabled: Boolean(inputs && inputs.thinkingEnabled),
    additionalRequirements:
      inputs && typeof inputs.additionalRequirements === "string"
        ? inputs.additionalRequirements
        : "",
    taskTerms: normalizeTaskTerms(inputs && inputs.taskTerms),
    referenceTranslationIds: normalizeReferenceTranslationIds(
      inputs && inputs.referenceTranslationIds,
    ),
    parallelAcceleration: Boolean(inputs && inputs.parallelAcceleration),
    parallelConcurrency:
      inputs && Number.isInteger(inputs.parallelConcurrency)
        ? inputs.parallelConcurrency
        : 3,
  });
}

function inputsFingerprint(inputs) {
  return JSON.stringify([
    inputs.sourceText,
    inputs.targetLanguage,
    inputs.serviceConfigurationId,
    inputs.domainProfileId,
    inputs.qualityMode,
    inputs.thinkingEnabled,
    inputs.additionalRequirements,
    inputs.taskTerms,
    inputs.referenceTranslationIds,
    inputs.parallelAcceleration,
    inputs.parallelConcurrency,
  ]);
}

function referencePreviewFingerprint(inputs) {
  return inputsFingerprint({ ...inputs, referenceTranslationIds: null });
}

function parallelSummaryFor(inputs, plan) {
  if (!inputs.parallelAcceleration) return null;
  const applied = plan.mode === "segmented";
  return freezeDeep({
    requested: true,
    applied,
    concurrency: inputs.parallelConcurrency,
    segmentCount: applied ? plan.segments.length : 1,
    fallbackReason: plan.fallbackReason,
  });
}

function precisionCallPlanFor(inputs, plan) {
  const translationCalls =
    inputs.parallelAcceleration && plan && plan.mode === "segmented"
      ? plan.segments.length
      : 1;
  return freezeDeep({
    analysisCalls: 1,
    translationCalls,
    reviewCalls: 2,
    maximumRevisionCalls: 1,
    maximumCallCount: translationCalls + 4,
    segmentCount: translationCalls,
  });
}

function fullDocumentSegment(sourceText) {
  const normalizedSourceText = String(sourceText).replace(/\r\n/gu, "\n");
  const sourceEnd = countCodePoints(normalizedSourceText);
  return freezeDeep({
    id: `document-0-0-${sourceEnd}`,
    ordinal: 0,
    sourceStart: 0,
    sourceEnd,
    sourceContextBefore: "",
    ownedSource: normalizedSourceText,
    sourceContextAfter: "",
  });
}

function precisionSegmentsFor(sourceText, plan, parallel) {
  return parallel && parallel.applied
    ? [...plan.segments]
    : [fullDocumentSegment(sourceText)];
}

function baseTaskData(input) {
  return {
    taskId: input.taskId,
    targetLanguage: input.targetLanguage,
    domainProfile: input.domainProfile,
    matchedTerms: input.matchedTerms,
    referenceTranslations: input.referenceTranslations,
    additionalRequirements: input.additionalRequirements,
    protectedItems: input.protectedItems,
  };
}

function segmentTranslationInput(fullDocumentInput, segment) {
  const protectedItems = extractProtectedItems(segment.ownedSource, segment.id).map(
    (item, index) => ({
      ...item,
      id: `${segment.id}-protected-${index + 1}`,
      sourceRange: {
        start: item.sourceRange.start + segment.sourceStart,
        end: item.sourceRange.end + segment.sourceStart,
      },
    }),
  );
  const {
    sourceText: _sourceText,
    protectedItems: _documentProtectedItems,
    ...baseInput
  } = fullDocumentInput;
  return {
    ...baseInput,
    protectedItems,
    mode: "segment",
    segment: {
      id: segment.id,
      ordinal: segment.ordinal,
      sourceStart: segment.sourceStart,
      sourceEnd: segment.sourceEnd,
      sourceContextBefore: segment.sourceContextBefore,
      ownedSource: segment.ownedSource,
      sourceContextAfter: segment.sourceContextAfter,
    },
  };
}

function partialSegmentResultsFromError(error) {
  const byId = new Map();
  const completed = Array.isArray(error && error.segmentResults)
    ? error.segmentResults
    : [];
  for (const result of completed) byId.set(result.id, result);
  const partials = [
    ...(Array.isArray(error && error.partialSegmentResults)
      ? error.partialSegmentResults
      : []),
    ...(error && error.partialSegmentResult ? [error.partialSegmentResult] : []),
  ];
  for (const result of partials) {
    if (!byId.has(result.id)) byId.set(result.id, result);
  }
  return [...byId.values()];
}

function outputLimitError(partialTranslation) {
  return Object.assign(new Error(errorMessage("response_too_large")), {
    code: "response_too_large",
    partialTranslation,
  });
}

function transportResponseError(response) {
  const code = mapHttpError(response.status);
  const requestId = response.headers && response.headers["x-request-id"];
  return Object.assign(new Error(errorMessage(code)), {
    code,
    httpStatus: response.status,
    ...(typeof requestId === "string" ? { requestId } : {}),
  });
}

function createRuyiRuntime({
  plainStorage,
  cryptoStorage,
  transport,
  servicePreset = DEEPSEEK_FLASH_PRESET,
  tokenFactory = () => randomBytes(24).toString("hex"),
  configurationIdFactory = () => `service-${randomBytes(12).toString("hex")}`,
  terminologyIdFactory = () => `terminology-${randomBytes(12).toString("hex")}`,
  now = () => new Date(),
  hostActions = {},
}) {
  const pendingConfirmations = new Map();
  const pendingReferencePreviews = new Map();
  const approvedReferenceSelections = new Map();
  const pendingCsvImports = new Map();
  const preparingTaskIds = new Set();
  const cancelledPreparingTaskIds = new Set();
  const currentTranslationListeners = new Set();
  const serviceOperations = new Map();
  let activeTask = null;
  let currentCopyCandidate = null;
  let currentTranslation = null;
  let currentTranslationRevision = 0;

  function publishCurrentTranslation(next) {
    currentTranslationRevision += 1;
    if (next === null) {
      currentTranslation = null;
    } else {
      const inputs = normalizeCurrentInputs(next.inputs);
      const task = next.task ? freezeDeep({ ...next.task }) : null;
      currentTranslation = freezeDeep({
        revision: currentTranslationRevision,
        phase: next.phase,
        inputs,
        task,
        partialTranslation: next.partialTranslation || "",
        result: next.result ? freezeDeep(next.result) : null,
        parallelProgress: next.parallelProgress
          ? freezeDeep({ ...next.parallelProgress })
          : null,
        stale: Boolean(
          next.stale ||
            (task &&
            inputsFingerprint(inputs) !==
            inputsFingerprint({
                sourceText: task.sourceText,
                targetLanguage: task.targetLanguage,
                serviceConfigurationId: task.serviceConfigurationId,
                domainProfileId: task.domainProfileId,
                qualityMode: task.qualityMode,
                thinkingEnabled: task.thinkingEnabled,
                additionalRequirements: task.additionalRequirements,
                taskTerms: task.taskTerms,
                referenceTranslationIds: task.referenceTranslationIds,
                parallelAcceleration: task.parallelAcceleration,
                parallelConcurrency: task.parallelConcurrency,
              })),
        ),
      });
    }
    for (const listener of currentTranslationListeners) {
      try {
        listener(currentTranslation);
      } catch {
        // A renderer observer must not break task state.
      }
    }
    return currentTranslation;
  }

  function updateCurrentTranslationInputs(inputs) {
    const normalizedInputs = normalizeCurrentInputs(inputs);
    return publishCurrentTranslation(
      currentTranslation
        ? { ...currentTranslation, inputs: normalizedInputs }
        : {
            phase: "editing",
            inputs: normalizedInputs,
            task: null,
            partialTranslation: "",
            result: null,
            parallelProgress: null,
          },
    );
  }

  function getCurrentTranslation() {
    return currentTranslation;
  }

  function subscribeCurrentTranslation(listener) {
    if (typeof listener !== "function") return () => undefined;
    currentTranslationListeners.add(listener);
    return () => currentTranslationListeners.delete(listener);
  }

  function cancelAllCurrentWork() {
    pendingConfirmations.clear();
    pendingReferencePreviews.clear();
    approvedReferenceSelections.clear();
    for (const taskId of preparingTaskIds) {
      cancelledPreparingTaskIds.add(taskId);
    }
    if (activeTask) {
      activeTask.controller.abort();
    }
  }

  function beginCurrentTask(request, targetLanguage) {
    const settings = readSettings();
    const terminologyState = readTerminologyState();
    const serviceConfigurationId =
      typeof request.serviceConfigurationId === "string"
        ? request.serviceConfigurationId
        : settings.currentServiceConfigurationId;
    const selectedConfiguration = findConfiguration(settings, serviceConfigurationId);
    const inputs = normalizeCurrentInputs({
      sourceText: request.sourceText,
      targetLanguage,
      serviceConfigurationId,
      domainProfileId:
        request.domainProfileId === null
          ? null
          : typeof request.domainProfileId === "string"
            ? request.domainProfileId
            : terminologyState.currentDomainProfileId,
      qualityMode: request.qualityMode === "precision" ? "precision" : "standard",
      thinkingEnabled:
        request.thinkingEnabled === undefined
          ? Boolean(selectedConfiguration && selectedConfiguration.thinkingEnabled)
          : Boolean(request.thinkingEnabled),
      additionalRequirements:
        typeof request.additionalRequirements === "string"
          ? request.additionalRequirements
          : settings.defaults &&
              typeof settings.defaults.additionalRequirements === "string"
            ? settings.defaults.additionalRequirements
            : "",
      taskTerms: request.taskTerms,
      referenceTranslationIds: request.referenceTranslationIds,
      parallelAcceleration: request.parallelAcceleration,
      parallelConcurrency: request.parallelConcurrency,
    });
    const approvedReferenceContinuation = approvedReferenceSelections.get(request.taskId);
    const continuation =
      Boolean(
        request.confirmationToken ||
          request.referencePreviewToken ||
          (approvedReferenceContinuation &&
            approvedReferenceContinuation.inputsFingerprint ===
              referencePreviewFingerprint(inputs) &&
            JSON.stringify(approvedReferenceContinuation.selectedIds) ===
              JSON.stringify(inputs.referenceTranslationIds)),
      ) &&
      currentTranslation &&
      currentTranslation.task &&
      currentTranslation.task.taskId === request.taskId;
    if (!continuation) {
      cancelAllCurrentWork();
      currentCopyCandidate = null;
    }
    const task = continuation
      ? request.referencePreviewToken
        ? freezeDeep({ taskId: request.taskId, ...inputs })
        : currentTranslation.task
      : freezeDeep({ taskId: request.taskId, ...inputs });
    publishCurrentTranslation({
      phase: "preparing",
      inputs,
      task,
      partialTranslation: continuation
        ? currentTranslation.partialTranslation
        : "",
      result: null,
      parallelProgress: continuation
        ? currentTranslation.parallelProgress
        : null,
    });
    return { inputs, task, continuation };
  }

  function updateCurrentTask(taskId, patch) {
    if (
      !currentTranslation ||
      !currentTranslation.task ||
      currentTranslation.task.taskId !== taskId
    ) {
      return currentTranslation;
    }
    return publishCurrentTranslation({ ...currentTranslation, ...patch });
  }

  function storeCurrentResult(taskId, result, phase, partialTranslation = "") {
    return updateCurrentTask(taskId, {
      phase,
      result: freezeDeep(result),
      partialTranslation,
    });
  }

  function readSettings() {
    const existing = plainStorage.getItem(SETTINGS_KEY);
    if (existing && existing.version === 1) {
      return existing;
    }

    const initial = createInitialSettings(servicePreset);
    plainStorage.setItem(SETTINGS_KEY, initial);
    return initial;
  }

  function createInitialTerminologyState() {
    return {
      version: 1,
      termbases: [],
      domainProfiles: [],
      referenceTranslations: [],
      currentDomainProfileId: null,
    };
  }

  function readTerminologyState() {
    const existing = cryptoStorage.getItem(TERMINOLOGY_KEY);
    if (
      existing &&
      existing.version === 1 &&
      Array.isArray(existing.termbases) &&
      Array.isArray(existing.domainProfiles)
    ) {
      return {
        ...existing,
        referenceTranslations: Array.isArray(existing.referenceTranslations)
          ? existing.referenceTranslations
          : [],
      };
    }
    return createInitialTerminologyState();
  }

  function writeTerminologyState(state) {
    try {
      cryptoStorage.setItem(TERMINOLOGY_KEY, state);
    } catch {
      throw Object.assign(
        new Error("uTools 加密存储不可用，术语库、行业配置和参考译例未保存。"),
        { code: "terminology_validation_error" },
      );
    }
  }

  function terminologyStateView(state) {
    return freezeDeep({
      termbases: state.termbases.map((termbase) => ({
        ...termbase,
        entries: termbase.entries.map((entry) => ({ ...entry })),
      })),
      domainProfiles: state.domainProfiles.map((domainProfile) => ({
        ...domainProfile,
        termbaseIds: [...domainProfile.termbaseIds],
        preserveRules: [...domainProfile.preserveRules],
      })),
      referenceTranslations: state.referenceTranslations.map((reference) => ({
        ...reference,
      })),
      currentDomainProfileId:
        typeof state.currentDomainProfileId === "string"
          ? state.currentDomainProfileId
          : null,
    });
  }

  async function getTerminologyState() {
    return terminologyStateView(readTerminologyState());
  }

  function markTerminologyChanged() {
    pendingConfirmations.clear();
    pendingReferencePreviews.clear();
    approvedReferenceSelections.clear();
    pendingCsvImports.clear();
    if (currentTranslation && currentTranslation.task) {
      publishCurrentTranslation({ ...currentTranslation, stale: true });
    }
  }

  async function saveTermbase(input) {
    const state = readTerminologyState();
    const existingIndex =
      input && typeof input.id === "string"
        ? state.termbases.findIndex((termbase) => termbase.id === input.id)
        : -1;
    const normalized = validateTermbase(input, {
      termbases: state.termbases,
      idFactory: terminologyIdFactory,
      entryIdFactory: terminologyIdFactory,
    });
    if (existingIndex >= 0) {
      state.termbases.splice(existingIndex, 1, normalized);
    } else {
      state.termbases.push(normalized);
    }
    writeTerminologyState(state);
    markTerminologyChanged();
    return terminologyStateView(state);
  }

  async function deleteTermbase(termbaseId) {
    const state = readTerminologyState();
    const index = state.termbases.findIndex((termbase) => termbase.id === termbaseId);
    if (index < 0) {
      throw Object.assign(new Error("要删除的术语库不存在。"), {
        code: "terminology_validation_error",
        field: "termbaseId",
      });
    }
    state.termbases.splice(index, 1);
    state.domainProfiles = state.domainProfiles.map((domainProfile) => ({
      ...domainProfile,
      termbaseIds: domainProfile.termbaseIds.filter((id) => id !== termbaseId),
    }));
    writeTerminologyState(state);
    markTerminologyChanged();
    return terminologyStateView(state);
  }

  async function saveDomainProfile(input) {
    const state = readTerminologyState();
    const existingIndex =
      input && typeof input.id === "string"
        ? state.domainProfiles.findIndex((profile) => profile.id === input.id)
        : -1;
    const normalized = validateDomainProfile(input, {
      domainProfiles: state.domainProfiles,
      termbases: state.termbases,
      idFactory: terminologyIdFactory,
    });
    if (existingIndex >= 0) {
      state.domainProfiles.splice(existingIndex, 1, normalized);
    } else {
      state.domainProfiles.push(normalized);
    }
    writeTerminologyState(state);
    markTerminologyChanged();
    return terminologyStateView(state);
  }

  async function deleteDomainProfile(domainProfileId) {
    const state = readTerminologyState();
    const index = state.domainProfiles.findIndex(
      (domainProfile) => domainProfile.id === domainProfileId,
    );
    if (index < 0) {
      throw Object.assign(new Error("要删除的行业配置不存在。"), {
        code: "terminology_validation_error",
        field: "domainProfileId",
      });
    }
    state.domainProfiles.splice(index, 1);
    state.referenceTranslations = state.referenceTranslations.filter(
      (reference) => reference.domainProfileId !== domainProfileId,
    );
    if (state.currentDomainProfileId === domainProfileId) {
      state.currentDomainProfileId = null;
    }
    writeTerminologyState(state);
    markTerminologyChanged();
    if (currentTranslation) {
      updateCurrentTranslationInputs({
        ...currentTranslation.inputs,
        domainProfileId:
          currentTranslation.inputs.domainProfileId === domainProfileId
            ? null
            : currentTranslation.inputs.domainProfileId,
      });
    }
    return terminologyStateView(state);
  }

  async function setCurrentDomainProfile(domainProfileId) {
    const state = readTerminologyState();
    if (
      domainProfileId !== null &&
      !state.domainProfiles.some((domainProfile) => domainProfile.id === domainProfileId)
    ) {
      throw Object.assign(new Error("要使用的行业配置不存在。"), {
        code: "terminology_validation_error",
        field: "domainProfileId",
      });
    }
    state.currentDomainProfileId = domainProfileId;
    writeTerminologyState(state);
    pendingConfirmations.clear();
    pendingReferencePreviews.clear();
    approvedReferenceSelections.clear();
    if (currentTranslation) {
      updateCurrentTranslationInputs({
        ...currentTranslation.inputs,
        domainProfileId,
      });
    }
    return terminologyStateView(state);
  }

  async function saveReferenceTranslation(input) {
    const state = readTerminologyState();
    const existingIndex =
      input && typeof input.id === "string"
        ? state.referenceTranslations.findIndex((reference) => reference.id === input.id)
        : -1;
    const normalized = validateReferenceTranslation(input, {
      domainProfiles: state.domainProfiles,
      idFactory: terminologyIdFactory,
    });
    if (existingIndex >= 0) {
      state.referenceTranslations.splice(existingIndex, 1, normalized);
    } else {
      state.referenceTranslations.push(normalized);
    }
    writeTerminologyState(state);
    markTerminologyChanged();
    return terminologyStateView(state);
  }

  async function deleteReferenceTranslation(referenceTranslationId) {
    const state = readTerminologyState();
    const index = state.referenceTranslations.findIndex(
      (reference) => reference.id === referenceTranslationId,
    );
    if (index < 0) {
      throw Object.assign(new Error("要删除的参考译例不存在。"), {
        code: "reference_validation_error",
        field: "referenceTranslationId",
      });
    }
    state.referenceTranslations.splice(index, 1);
    writeTerminologyState(state);
    markTerminologyChanged();
    return terminologyStateView(state);
  }

  async function previewTermbaseCsv({ termbaseId, bytes, mapping = {} }) {
    const state = readTerminologyState();
    const termbase = state.termbases.find((candidate) => candidate.id === termbaseId);
    if (!termbase) {
      throw Object.assign(new Error("要导入的术语库不存在。"), {
        code: "terminology_validation_error",
        field: "termbaseId",
      });
    }
    const inspected = inspectTermbaseCsv({
      bytes,
      mapping,
      existingEntries: termbase.entries,
      entryIdFactory: terminologyIdFactory,
    });
    const previewToken = inspected.canImport ? tokenFactory() : null;
    if (previewToken) {
      pendingCsvImports.set(previewToken, {
        termbaseId,
        termbaseFingerprint: JSON.stringify(termbase),
        entries: inspected.entries,
      });
    }
    return freezeDeep({
      previewToken,
      columns: [...inspected.columns],
      requiredFields: ["sourceTerm", "preferredTarget", "sourceLanguage", "targetLanguage"],
      optionalFields: [
        "allowedVariants",
        "forbiddenTargets",
        "meaning",
        "strictness",
        "caseSensitive",
        "aliases",
        "priority",
      ],
      fieldMapping: { ...inspected.fieldMapping },
      issues: inspected.issues.map((item) => ({ ...item })),
      rowCount: inspected.entries.length,
      canImport: inspected.canImport,
    });
  }

  function discardTermbaseCsvPreview(previewToken) {
    pendingCsvImports.delete(previewToken);
  }

  async function commitTermbaseCsv(previewToken) {
    const pending = pendingCsvImports.get(previewToken);
    pendingCsvImports.delete(previewToken);
    if (!pending) {
      throw Object.assign(new Error("CSV 导入预览已失效，请重新预览。"), {
        code: "terminology_validation_error",
        field: "previewToken",
      });
    }
    const currentState = readTerminologyState();
    const currentTermbase = currentState.termbases.find(
      (termbase) => termbase.id === pending.termbaseId,
    );
    if (!currentTermbase || JSON.stringify(currentTermbase) !== pending.termbaseFingerprint) {
      throw Object.assign(new Error("术语库已发生变化，请重新预览 CSV。"), {
        code: "terminology_validation_error",
        field: "previewToken",
      });
    }
    const nextState = JSON.parse(JSON.stringify(currentState));
    const index = nextState.termbases.findIndex(
      (termbase) => termbase.id === pending.termbaseId,
    );
    nextState.termbases[index] = validateTermbase(
      {
        ...nextState.termbases[index],
        entries: [...nextState.termbases[index].entries, ...pending.entries],
      },
      {
        termbases: nextState.termbases,
        idFactory: terminologyIdFactory,
        entryIdFactory: terminologyIdFactory,
      },
    );
    writeTerminologyState(nextState);
    markTerminologyChanged();
    return terminologyStateView(nextState);
  }

  async function exportTermbaseCsv(termbaseId) {
    const state = readTerminologyState();
    const termbase = state.termbases.find((candidate) => candidate.id === termbaseId);
    if (!termbase) {
      throw Object.assign(new Error("要导出的术语库不存在。"), {
        code: "terminology_validation_error",
        field: "termbaseId",
      });
    }
    return serializeTermbaseCsv(termbase);
  }

  function prepareTerminologyInput(request, targetLanguage, submittedInputs) {
    const terminologyState = readTerminologyState();
    const selectedDomainProfile = submittedInputs.domainProfileId
      ? terminologyState.domainProfiles.find(
          (domainProfile) => domainProfile.id === submittedInputs.domainProfileId,
        )
      : null;
    if (submittedInputs.domainProfileId && !selectedDomainProfile) {
      throw Object.assign(new Error("选择的行业配置不存在。"), {
        code: "terminology_validation_error",
        field: "domainProfileId",
      });
    }
    const terminologyResolution = resolveTerminology({
      sourceText: request.sourceText,
      targetLanguage,
      taskTerms: submittedInputs.taskTerms,
      termbases: terminologyState.termbases,
      domainProfile: selectedDomainProfile,
    });
    const referenceCandidates = selectReferenceTranslations({
      sourceText: request.sourceText,
      targetLanguage,
      domainProfileId: submittedInputs.domainProfileId,
      referenceTranslations: terminologyState.referenceTranslations,
    });
    let referenceTranslations = [];
    let referencePreviewRequired = false;
    if (request.referencePreviewToken) {
      const pending = pendingReferencePreviews.get(request.referencePreviewToken);
      pendingReferencePreviews.delete(request.referencePreviewToken);
      if (
        !pending ||
        pending.taskId !== request.taskId ||
        pending.sourceText !== request.sourceText ||
        pending.inputsFingerprint !== referencePreviewFingerprint(submittedInputs)
      ) {
        throw Object.assign(new Error("参考译例预览已失效，请重新预览。"), {
          code: "reference_validation_error",
          field: "referencePreviewToken",
        });
      }
      referenceTranslations = resolveReferenceSelection({
        selectedIds: submittedInputs.referenceTranslationIds,
        candidates: pending.candidates,
      });
      approvedReferenceSelections.set(request.taskId, {
        inputsFingerprint: referencePreviewFingerprint(submittedInputs),
        selectedIds: [...submittedInputs.referenceTranslationIds],
      });
    } else if (submittedInputs.referenceTranslationIds !== null) {
      const approved = approvedReferenceSelections.get(request.taskId);
      const approvedSelection =
        approved &&
        approved.inputsFingerprint === referencePreviewFingerprint(submittedInputs) &&
        JSON.stringify(approved.selectedIds) ===
          JSON.stringify(submittedInputs.referenceTranslationIds);
      if (approvedSelection) {
        referenceTranslations = resolveReferenceSelection({
          selectedIds: submittedInputs.referenceTranslationIds,
          candidates: referenceCandidates,
        });
      } else if (referenceCandidates.length > 0) {
        referencePreviewRequired = true;
      } else {
        referenceTranslations = resolveReferenceSelection({
          selectedIds: submittedInputs.referenceTranslationIds,
          candidates: referenceCandidates,
        });
      }
    } else if (referenceCandidates.length > 0) {
      referencePreviewRequired = true;
    }
    const domainProfile = selectedDomainProfile
      ? {
          id: selectedDomainProfile.id,
          version: selectedDomainProfile.version,
          name: selectedDomainProfile.name,
          field: selectedDomainProfile.field,
          documentType: selectedDomainProfile.documentType,
          audience: selectedDomainProfile.audience,
          style: selectedDomainProfile.style,
          preserveRules: [...selectedDomainProfile.preserveRules],
        }
      : null;
    const normalizedSourceText = request.sourceText.replace(/\r\n/gu, "\n");
    const input = {
      schemaVersion: "translation-input.v1",
      taskId: request.taskId,
      targetLanguage,
      domainProfile,
      matchedTerms: terminologyResolution.matchedTerms,
      referenceTranslations,
      additionalRequirements: submittedInputs.additionalRequirements,
      protectedItems: extractProtectedItems(normalizedSourceText),
      qualityMode: submittedInputs.qualityMode,
      mode: "full_document",
      analysis: null,
      sourceText: normalizedSourceText,
    };
    validateTranslationInputBudget({ input });
    return {
      input,
      terminologyResolution,
      referenceCandidates,
      referencePreviewRequired,
    };
  }

  function configurationsIn(settings) {
    return Array.isArray(settings.serviceConfigurations)
      ? settings.serviceConfigurations
      : [];
  }

  function findConfiguration(settings, configurationId) {
    return configurationsIn(settings).find(
      (candidate) => candidate.id === configurationId,
    );
  }

  function apiKeyFor(configurationId) {
    return cryptoStorage.getItem(`${API_KEY_PREFIX}${configurationId}`);
  }

  function defaultsView(settings) {
    return {
      targetLanguage: {
        ...(settings.defaults && settings.defaults.targetLanguage
          ? settings.defaults.targetLanguage
          : DEFAULTS.targetLanguage),
      },
      qualityMode: "standard",
      additionalRequirements:
        settings.defaults &&
        typeof settings.defaults.additionalRequirements === "string"
          ? settings.defaults.additionalRequirements
          : "",
    };
  }

  function serviceConfigurationsState(settings) {
    return freezeDeep({
      currentServiceConfigurationId:
        typeof settings.currentServiceConfigurationId === "string"
          ? settings.currentServiceConfigurationId
          : null,
      serviceConfigurations: configurationsIn(settings).map((configuration) =>
        serviceConfigurationView(configuration, apiKeyFor(configuration.id)),
      ),
    });
  }

  async function getServiceConfigurations() {
    return serviceConfigurationsState(readSettings());
  }

  async function getServiceConfiguration(configurationId) {
    const settings = readSettings();
    const resolvedConfigurationId =
      typeof configurationId === "string"
        ? configurationId
        : settings.currentServiceConfigurationId;
    const configuration = findConfiguration(settings, resolvedConfigurationId);

    return {
      serviceConfiguration: configuration
        ? serviceConfigurationView(configuration, apiKeyFor(configuration.id))
        : null,
      defaults: defaultsView(settings),
    };
  }

  function credentialValue(credentialForm) {
    const apiKeyInput =
      credentialForm &&
      credentialForm.elements &&
      typeof credentialForm.elements.namedItem === "function"
        ? credentialForm.elements.namedItem("apiKey")
        : null;
    return apiKeyInput && apiKeyInput.value;
  }

  async function saveServiceApiKey(configurationId, credentialForm) {
    const apiKey = credentialValue(credentialForm);
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      throw new Error("API Key 不能为空。");
    }

    const settings = readSettings();
    const configuration = findConfiguration(settings, configurationId);
    if (!configuration) {
      throw new Error("没有可保存密钥的服务配置。");
    }
    if (configuration.authentication !== "bearer") {
      throw configurationError("authentication", "不鉴权配置不保存 API Key。");
    }
    normalizeServiceUrl(configuration.translationUrl, "translationUrl", apiKey.trim());
    normalizeServiceUrl(configuration.modelListUrl, "modelListUrl", apiKey.trim());
    cryptoStorage.setItem(
      `${API_KEY_PREFIX}${configuration.id}`,
      apiKey.trim(),
    );
    return serviceConfigurationsState(settings);
  }

  async function saveApiKey(credentialForm) {
    const settings = readSettings();
    await saveServiceApiKey(settings.currentServiceConfigurationId, credentialForm);
    return getServiceConfiguration();
  }

  async function deleteServiceApiKey(configurationId) {
    const settings = readSettings();
    if (!findConfiguration(settings, configurationId)) {
      throw configurationError(null, "服务配置不存在。");
    }
    cryptoStorage.removeItem(`${API_KEY_PREFIX}${configurationId}`);
    return serviceConfigurationsState(settings);
  }

  async function clearServicePerformanceData(configurationId) {
    const settings = readSettings();
    const configuration = findConfiguration(settings, configurationId);
    if (!configuration) {
      throw configurationError(null, "服务配置不存在。");
    }
    configuration.performanceSamples = [];
    plainStorage.setItem(SETTINGS_KEY, settings);
    return serviceConfigurationsState(settings);
  }

  async function setServiceThinkingMode(configurationId, enabled) {
    const settings = readSettings();
    const configuration = findConfiguration(settings, configurationId);
    if (!configuration) throw configurationError(null, "服务配置不存在。");
    if (configuration.type !== "deepseek-official") {
      throw configurationError(
        "thinkingEnabled",
        "思考模式只适用于 DeepSeek 官方配置。",
      );
    }
    assertConfigurationCanBeEdited(configurationId);
    configuration.thinkingEnabled = Boolean(enabled);
    plainStorage.setItem(SETTINGS_KEY, settings);
    markCurrentTranslationForConfigurationChange(configurationId);
    return serviceConfigurationsState(settings);
  }

  function getParallelAccelerationAdvice(sourceText, configurationId) {
    const settings = readSettings();
    const configuration = findConfiguration(
      settings,
      typeof configurationId === "string"
        ? configurationId
        : settings.currentServiceConfigurationId,
    );
    const summary = configuration
      ? serviceConfigurationView(configuration, apiKeyFor(configuration.id))
          .performanceSummary
      : null;
    return parallelAccelerationAdvice({
      sourceCodePoints:
        typeof sourceText === "string"
          ? inspectSourceText(sourceText).normalizedCodePointCount
          : 0,
      performanceSummary: summary,
    });
  }

  function getTranslationCallPlan({
    sourceText = "",
    qualityMode = "standard",
    parallelAcceleration = false,
    parallelConcurrency = 3,
  } = {}) {
    const plan = parallelAcceleration ? createTranslationPlan(sourceText) : null;
    const translationCalls =
      parallelAcceleration && plan && plan.mode === "segmented"
        ? plan.segments.length
        : 1;
    if (qualityMode !== "precision") {
      return freezeDeep({
        qualityMode: "standard",
        translationCalls,
        maximumCallCount: translationCalls,
        segmentCount: translationCalls,
      });
    }
    return freezeDeep({
      qualityMode: "precision",
      ...precisionCallPlanFor(
        {
          parallelAcceleration,
          parallelConcurrency,
        },
        plan,
      ),
    });
  }

  function recordPerformanceSample(configurationId, sample) {
    const settings = readSettings();
    const configuration = findConfiguration(settings, configurationId);
    if (!configuration) return;
    const samples = Array.isArray(configuration.performanceSamples)
      ? configuration.performanceSamples
      : [];
    samples.push({
      firstOutputMilliseconds: sample.firstOutputMilliseconds,
      completionMilliseconds: sample.completionMilliseconds,
      outputCodePoints: sample.outputCodePoints,
      averageOutputCodePointsPerSecond: sample.averageOutputCodePointsPerSecond,
      mode: sample.mode,
      segmentCount: sample.segmentCount,
    });
    configuration.performanceSamples = samples.slice(-10);
    plainStorage.setItem(SETTINGS_KEY, settings);
  }

  function cancelServiceOperationsForConfiguration(configurationId) {
    for (const operation of serviceOperations.values()) {
      if (operation.configurationId === configurationId) {
        operation.controller.abort();
      }
    }
  }

  function invalidateConfirmationsForConfiguration(configurationId) {
    for (const [token, pending] of pendingConfirmations) {
      if (pending.configurationId === configurationId) {
        pendingConfirmations.delete(token);
      }
    }
  }

  function markCurrentTranslationForConfigurationChange(configurationId) {
    if (
      currentTranslation &&
      currentTranslation.task &&
      currentTranslation.task.serviceConfigurationId === configurationId
    ) {
      publishCurrentTranslation({ ...currentTranslation, stale: true });
    }
  }

  function assertConfigurationCanBeEdited(configurationId) {
    const currentTaskUsesConfiguration =
      currentTranslation &&
      currentTranslation.task &&
      currentTranslation.task.serviceConfigurationId === configurationId &&
      [
        "preparing",
        "awaiting_confirmation",
        "analyzing",
        "translating",
        "reviewing",
        "revising",
      ].includes(
        currentTranslation.phase,
      );
    const pendingConfirmationUsesConfiguration = [...pendingConfirmations.values()].some(
      (pending) => pending.configurationId === configurationId,
    );
    if (
      (activeTask && activeTask.configurationId === configurationId) ||
      currentTaskUsesConfiguration ||
      pendingConfirmationUsesConfiguration
    ) {
      throw configurationError(
        null,
        "当前翻译正在使用这项配置，请先取消翻译。",
        "translation_active",
      );
    }
  }

  async function saveServiceConfiguration(input, credentialForm) {
    const settings = readSettings();
    const configurations = configurationsIn(settings);
    const existing =
      input && typeof input.id === "string"
        ? findConfiguration(settings, input.id)
        : null;
    if (input && typeof input.id === "string" && !existing) {
      throw configurationError(null, "要编辑的服务配置不存在。");
    }
    if (existing) assertConfigurationCanBeEdited(existing.id);
    const previousTranslationUrl = existing && existing.translationUrl;
    const credential = credentialValue(credentialForm);
    const replacementApiKey =
      typeof credential === "string" && credential.trim().length > 0
        ? credential.trim()
        : null;
    const normalized = validateServiceConfiguration(input, {
      existing,
      configurations,
      apiKey: replacementApiKey || (existing ? apiKeyFor(existing.id) : null),
      idFactory: configurationIdFactory,
    });

    if (existing) {
      const index = configurations.findIndex((candidate) => candidate.id === existing.id);
      configurations.splice(index, 1, normalized);
      cancelServiceOperationsForConfiguration(existing.id);
      if (previousTranslationUrl !== normalized.translationUrl) {
        invalidateConfirmationsForConfiguration(existing.id);
      }
      if (normalized.authentication === "none") {
        cryptoStorage.removeItem(`${API_KEY_PREFIX}${normalized.id}`);
      }
      markCurrentTranslationForConfigurationChange(existing.id);
    } else {
      configurations.push(normalized);
      settings.currentServiceConfigurationId = normalized.id;
      if (currentTranslation) {
        updateCurrentTranslationInputs({
          ...currentTranslation.inputs,
          serviceConfigurationId: normalized.id,
        });
      }
    }
    settings.serviceConfigurations = configurations;
    if (normalized.authentication === "bearer" && replacementApiKey) {
      cryptoStorage.setItem(`${API_KEY_PREFIX}${normalized.id}`, replacementApiKey);
    }
    plainStorage.setItem(SETTINGS_KEY, settings);
    return serviceConfigurationsState(settings);
  }

  async function duplicateServiceConfiguration(configurationId) {
    const settings = readSettings();
    const configurations = configurationsIn(settings);
    const source = findConfiguration(settings, configurationId);
    if (!source) throw configurationError(null, "要复制的服务配置不存在。");
    const copy = validateServiceConfiguration(
      {
        ...source,
        id: null,
        name: uniqueCopyName(source.name, configurations),
      },
      {
        configurations,
        idFactory: configurationIdFactory,
      },
    );
    copy.cachedModels = [];
    copy.modelsFetchedAt = null;
    copy.performanceSamples = [];
    copy.thinkingEnabled = false;
    delete copy.confirmedTranslationUrl;
    delete copy.confirmedPrecisionTranslationUrl;
    configurations.push(copy);
    settings.currentServiceConfigurationId = copy.id;
    plainStorage.setItem(SETTINGS_KEY, settings);
    if (currentTranslation) {
      updateCurrentTranslationInputs({
        ...currentTranslation.inputs,
        serviceConfigurationId: copy.id,
      });
    }
    return serviceConfigurationsState(settings);
  }

  async function moveServiceConfiguration(configurationId, direction) {
    const settings = readSettings();
    const configurations = configurationsIn(settings);
    const index = configurations.findIndex((candidate) => candidate.id === configurationId);
    if (index < 0) throw configurationError(null, "要排序的服务配置不存在。");
    const targetIndex = direction === "up" ? index - 1 : direction === "down" ? index + 1 : -1;
    if (targetIndex >= 0 && targetIndex < configurations.length) {
      const [configuration] = configurations.splice(index, 1);
      configurations.splice(targetIndex, 0, configuration);
      plainStorage.setItem(SETTINGS_KEY, settings);
    }
    return serviceConfigurationsState(settings);
  }

  async function setCurrentServiceConfiguration(configurationId) {
    const settings = readSettings();
    if (!findConfiguration(settings, configurationId)) {
      throw configurationError(null, "要使用的服务配置不存在。");
    }
    settings.currentServiceConfigurationId = configurationId;
    plainStorage.setItem(SETTINGS_KEY, settings);
    if (currentTranslation) {
      updateCurrentTranslationInputs({
        ...currentTranslation.inputs,
        serviceConfigurationId: configurationId,
      });
    }
    return serviceConfigurationsState(settings);
  }

  async function deleteServiceConfiguration(configurationId, confirmCurrent = false) {
    const settings = readSettings();
    const configurations = configurationsIn(settings);
    const index = configurations.findIndex((candidate) => candidate.id === configurationId);
    if (index < 0) throw configurationError(null, "要删除的服务配置不存在。");
    assertConfigurationCanBeEdited(configurationId);
    if (settings.currentServiceConfigurationId === configurationId && !confirmCurrent) {
      throw configurationError(
        null,
        "删除当前服务配置前需要确认。",
        "confirmation_required",
      );
    }
    cancelServiceOperationsForConfiguration(configurationId);
    invalidateConfirmationsForConfiguration(configurationId);
    cryptoStorage.removeItem(`${API_KEY_PREFIX}${configurationId}`);
    configurations.splice(index, 1);
    if (configurations.length === 0) {
      settings.serviceConfigurations = [];
      settings.currentServiceConfigurationId = null;
    } else {
      settings.serviceConfigurations = configurations;
      if (settings.currentServiceConfigurationId === configurationId) {
        settings.currentServiceConfigurationId = configurations[0].id;
      }
    }
    plainStorage.setItem(SETTINGS_KEY, settings);
    if (currentTranslation) {
      updateCurrentTranslationInputs({
        ...currentTranslation.inputs,
        serviceConfigurationId: settings.currentServiceConfigurationId,
      });
    }
    return serviceConfigurationsState(settings);
  }

  function beginServiceOperation(operationId, configurationId) {
    if (typeof operationId !== "string" || operationId.length === 0) {
      throw configurationError(null, "服务操作 ID 无效。");
    }
    if (serviceOperations.has(operationId)) {
      throw configurationError(null, "同一服务操作已经开始。");
    }
    const controller = new AbortController();
    const operation = { operationId, configurationId, controller };
    serviceOperations.set(operationId, operation);
    return operation;
  }

  function finishServiceOperation(operation) {
    if (serviceOperations.get(operation.operationId) === operation) {
      serviceOperations.delete(operation.operationId);
    }
  }

  function cancelServiceOperation(operationId) {
    const operation = serviceOperations.get(operationId);
    if (operation) operation.controller.abort();
  }

  function serviceOperationFailure(error, response) {
    const code = response ? mapHttpError(response.status) : mapTransportError(error);
    const requestId =
      response && response.headers && response.headers["x-request-id"];
    return freezeDeep({
      status: "failed",
      error: {
        code,
        message: safeTransportErrorMessage(error, code),
        ...(response ? { httpStatus: response.status } : {}),
        ...(typeof requestId === "string" ? { requestId } : {}),
      },
    });
  }

  function serviceRequestContext(configurationId, urlField) {
    const settings = readSettings();
    const configuration = findConfiguration(settings, configurationId);
    if (!configuration) {
      throw configurationError(null, "服务配置不存在。");
    }
    const apiKey = apiKeyFor(configuration.id);
    if (
      configuration.authentication === "bearer" &&
      (typeof apiKey !== "string" || apiKey.length === 0)
    ) {
      throw configurationError(null, "Bearer 配置缺少 API Key。");
    }
    const url = normalizeServiceUrl(configuration[urlField], urlField, apiKey);
    const headers = {};
    if (configuration.authentication === "bearer") {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    return { settings, configuration: { ...configuration }, apiKey, url, headers };
  }

  async function testServiceConnection({ operationId, configurationId }) {
    let context;
    let operation;
    try {
      context = serviceRequestContext(configurationId, "translationUrl");
      operation = beginServiceOperation(operationId, configurationId);
      const input = {
        schemaVersion: "translation-input.v1",
        taskId: "connection-test",
        targetLanguage: {
          kind: "preset",
          id: "zh-CN",
          modelLabel: "Simplified Chinese",
        },
        domainProfile: null,
        matchedTerms: [],
        referenceTranslations: [],
        additionalRequirements: "",
        protectedItems: [],
        qualityMode: "standard",
        mode: "full_document",
        analysis: null,
        sourceText: CONNECTION_TEST_SOURCE_TEXT,
      };
      let sawData = false;
      const protocolOperation = createTranslationProtocolOperation({
        configuration: context.configuration,
        input,
      });
      const response = await transport.request({
        url: context.url,
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...context.headers,
        },
        body: protocolOperation.body,
        signal: operation.controller.signal,
        maxResponseBytes: CONNECTION_TEST_MAX_RESPONSE_BYTES,
        noDataTimeoutMilliseconds: CONNECTION_TEST_NO_DATA_TIMEOUT_MILLISECONDS,
        totalTimeoutMilliseconds: CONNECTION_TEST_TOTAL_TIMEOUT_MILLISECONDS,
        onData(chunk) {
          if (!operation.controller.signal.aborted) {
            sawData = true;
            protocolOperation.push(chunk);
          }
        },
      });
      if (operation.controller.signal.aborted) {
        throw Object.assign(new Error("请求已取消。"), { code: "cancelled" });
      }
      if (response.status < 200 || response.status >= 300) {
        return serviceOperationFailure(null, response);
      }
      protocolOperation.finish(response.body, sawData);
      return freezeDeep({ status: "completed" });
    } catch (error) {
      return serviceOperationFailure(error);
    } finally {
      if (operation) finishServiceOperation(operation);
    }
  }

  async function fetchServiceModels({ operationId, configurationId }) {
    let context;
    let operation;
    try {
      context = serviceRequestContext(configurationId, "modelListUrl");
      operation = beginServiceOperation(operationId, configurationId);
      const response = await transport.request({
        url: context.url,
        method: "GET",
        headers: {
          Accept: "application/json",
          ...context.headers,
        },
        body: "",
        signal: operation.controller.signal,
        maxResponseBytes: MODEL_LIST_MAX_RESPONSE_BYTES,
        noDataTimeoutMilliseconds: MODEL_LIST_TOTAL_TIMEOUT_MILLISECONDS,
        totalTimeoutMilliseconds: MODEL_LIST_TOTAL_TIMEOUT_MILLISECONDS,
      });
      if (operation.controller.signal.aborted) {
        throw Object.assign(new Error("请求已取消。"), { code: "cancelled" });
      }
      if (response.status < 200 || response.status >= 300) {
        return serviceOperationFailure(null, response);
      }
      const models = parseModelIds(response.body);
      const latestSettings = readSettings();
      const latestConfiguration = findConfiguration(latestSettings, configurationId);
      if (!latestConfiguration) {
        throw Object.assign(new Error("配置已删除。"), { code: "cancelled" });
      }
      const fetchedAt = now().toISOString();
      latestConfiguration.cachedModels = models;
      latestConfiguration.modelsFetchedAt = fetchedAt;
      plainStorage.setItem(SETTINGS_KEY, latestSettings);
      return freezeDeep({
        status: "completed",
        models: [...models],
        fetchedAt,
        currentModelPresent: models.includes(latestConfiguration.model),
      });
    } catch (error) {
      return serviceOperationFailure(error);
    } finally {
      if (operation) finishServiceOperation(operation);
    }
  }

  async function startPrecisionTranslation(request, onProgress = () => undefined) {
    if (
      !request ||
      typeof request.sourceText !== "string" ||
      request.sourceText.trim().length === 0
    ) {
      return {
        status: "validation_error",
        reason: "invalid_source_text",
        sourceRetained: true,
      };
    }
    const sourceInspection = inspectSourceText(request.sourceText);
    if (!sourceInspection.valid) {
      return {
        status: "validation_error",
        reason: "source_text_too_long",
        sourceRetained: true,
      };
    }
    const targetLanguage = normalizeTargetLanguage(request.targetLanguage);
    if (!targetLanguage) {
      return {
        status: "validation_error",
        reason: "invalid_target_language",
        sourceRetained: true,
      };
    }
    if (
      request.parallelAcceleration &&
      request.parallelConcurrency !== undefined &&
      (!Number.isInteger(request.parallelConcurrency) ||
        request.parallelConcurrency < 1 ||
        request.parallelConcurrency > 6)
    ) {
      return {
        status: "validation_error",
        reason: "invalid_parallel_configuration",
        field: "parallelConcurrency",
        message: "并发数必须是 1 至 6 的整数。",
        sourceRetained: true,
      };
    }
    if (
      request.referenceTranslationIds !== undefined &&
      request.referenceTranslationIds !== null &&
      !Array.isArray(request.referenceTranslationIds)
    ) {
      return {
        status: "validation_error",
        reason: "invalid_reference_selection",
        field: "referenceTranslationIds",
        message: "参考译例选择必须是数组。",
        sourceRetained: true,
      };
    }
    if (
      Array.isArray(request.referenceTranslationIds) &&
      request.referenceTranslationIds.length > 3
    ) {
      return {
        status: "validation_error",
        reason: "input_budget_exceeded",
        field: "referenceTranslationIds",
        message: "参考译例最多选择 3 条，不能截断多余条目。",
        sourceRetained: true,
      };
    }
    if (request.taskTerms !== undefined && !Array.isArray(request.taskTerms)) {
      return {
        status: "validation_error",
        reason: "invalid_terminology",
        field: "taskTerms",
        message: "本次术语必须是数组。",
        sourceRetained: true,
      };
    }

    const precisionRequest = { ...request, qualityMode: "precision" };
    const { inputs: submittedInputs } = beginCurrentTask(
      precisionRequest,
      targetLanguage,
    );
    let terminologyPreparation;
    try {
      terminologyPreparation = prepareTerminologyInput(
        precisionRequest,
        targetLanguage,
        submittedInputs,
      );
    } catch (error) {
      const result = {
        status: "validation_error",
        reason:
          error && error.code === "terminology_limit_exceeded"
            ? "terminology_limit_exceeded"
            : error && error.code === "input_budget_exceeded"
              ? "input_budget_exceeded"
              : error && error.code === "reference_validation_error"
                ? "invalid_reference_selection"
                : "invalid_terminology",
        ...(error && error.field ? { field: error.field } : {}),
        message:
          error && typeof error.message === "string"
            ? error.message
            : "术语配置无效。",
        sourceRetained: true,
      };
      storeCurrentResult(request.taskId, result, "failed");
      return result;
    }
    if (terminologyPreparation.terminologyResolution.conflicts.length > 0) {
      const result = {
        status: "validation_error",
        reason: "terminology_conflict",
        sourceRetained: true,
        terminologyConflicts: terminologyPreparation.terminologyResolution.conflicts,
      };
      storeCurrentResult(request.taskId, result, "failed");
      return result;
    }
    if (terminologyPreparation.referencePreviewRequired) {
      const previewToken = tokenFactory();
      pendingReferencePreviews.set(previewToken, {
        taskId: request.taskId,
        sourceText: request.sourceText,
        inputsFingerprint: referencePreviewFingerprint(submittedInputs),
        candidates: terminologyPreparation.referenceCandidates,
      });
      const result = freezeDeep({
        status: "reference_confirmation_required",
        sourceRetained: true,
        previewToken,
        referenceTranslations: terminologyPreparation.referenceCandidates.map(
          (reference) => ({ ...reference }),
        ),
      });
      storeCurrentResult(request.taskId, result, "awaiting_confirmation");
      return result;
    }

    const { input, terminologyResolution } = terminologyPreparation;
    const translationPlan = submittedInputs.parallelAcceleration
      ? createTranslationPlan(request.sourceText)
      : null;
    const parallel = translationPlan
      ? parallelSummaryFor(submittedInputs, translationPlan)
      : null;
    const callPlan = precisionCallPlanFor(submittedInputs, translationPlan);
    const precisionSegments = precisionSegmentsFor(
      request.sourceText,
      translationPlan,
      parallel,
    );

    preparingTaskIds.add(request.taskId);
    let state;
    try {
      state = await getServiceConfiguration(submittedInputs.serviceConfigurationId);
    } finally {
      preparingTaskIds.delete(request.taskId);
    }
    if (cancelledPreparingTaskIds.delete(request.taskId)) {
      const result = {
        status: "failed",
        taskId: request.taskId,
        sourceRetained: true,
        precision: { complete: false, failedStage: "preparing", callPlan },
        error: { code: "cancelled", message: errorMessage("cancelled") },
      };
      storeCurrentResult(request.taskId, result, "failed");
      return result;
    }
    if (!state.serviceConfiguration) {
      const result = {
        status: "configuration_required",
        reason: "missing_configuration",
        sourceRetained: true,
        serviceConfiguration: null,
      };
      storeCurrentResult(request.taskId, result, "needs_configuration");
      return result;
    }
    if (
      state.serviceConfiguration.authentication === "bearer" &&
      !state.serviceConfiguration.hasApiKey
    ) {
      const result = {
        status: "configuration_required",
        reason: "missing_api_key",
        sourceRetained: true,
        serviceConfiguration: state.serviceConfiguration,
      };
      storeCurrentResult(request.taskId, result, "needs_configuration");
      return result;
    }

    const settings = readSettings();
    const configuration = findConfiguration(
      settings,
      submittedInputs.serviceConfigurationId,
    );
    let normalizedTranslationUrl;
    try {
      normalizedTranslationUrl = normalizeServiceUrl(
        configuration.translationUrl,
        "translationUrl",
        apiKeyFor(configuration.id),
      );
    } catch {
      const result = {
        status: "failed",
        taskId: request.taskId,
        sourceRetained: true,
        precision: { complete: false, failedStage: "preparing", callPlan },
        error: {
          code: "configuration_error",
          message: errorMessage("configuration_error"),
        },
      };
      storeCurrentResult(request.taskId, result, "failed");
      return result;
    }

    if (
      configuration.confirmedTranslationUrl !== normalizedTranslationUrl ||
      configuration.confirmedPrecisionTranslationUrl !== normalizedTranslationUrl
    ) {
      const pending = request.confirmationToken
        ? pendingConfirmations.get(request.confirmationToken)
        : undefined;
      if (request.confirmationToken) {
        pendingConfirmations.delete(request.confirmationToken);
        if (
          !sameConfirmationRequest(
            pending,
            precisionRequest,
            targetLanguage,
            configuration,
            normalizedTranslationUrl,
            submittedInputs,
          )
        ) {
          const result = {
            status: "validation_error",
            reason: "invalid_confirmation",
            sourceRetained: true,
          };
          storeCurrentResult(request.taskId, result, "failed");
          return result;
        }
        configuration.confirmedTranslationUrl = normalizedTranslationUrl;
        configuration.confirmedPrecisionTranslationUrl = normalizedTranslationUrl;
        plainStorage.setItem(SETTINGS_KEY, settings);
      } else {
        const confirmationToken = tokenFactory();
        pendingConfirmations.set(confirmationToken, {
          taskId: request.taskId,
          sourceText: request.sourceText,
          targetLanguage,
          configurationId: configuration.id,
          normalizedTranslationUrl,
          inputsFingerprint: inputsFingerprint(submittedInputs),
        });
        const result = {
          status: "confirmation_required",
          sourceRetained: true,
          confirmationToken,
          preview: {
            serviceName: configuration.name,
            normalizedTranslationUrl,
            protocol:
              configuration.protocol === "responses"
                ? "Responses"
                : "Chat Completions",
            model: configuration.model,
            dataSent: [
              "源文本",
              "目标语言",
              ...(input.domainProfile ? ["行业配置"] : []),
              "命中的术语",
              ...(input.referenceTranslations.length > 0 ? ["参考译例"] : []),
              "附加翻译要求",
              "分析、审校与必要的定向修订资料",
            ],
            qualityMode: "precision",
            callCount: callPlan.maximumCallCount,
            precisionCallPlan: callPlan,
            ...(parallel ? { parallel } : {}),
          },
        };
        storeCurrentResult(request.taskId, result, "awaiting_confirmation");
        return result;
      }
    }

    if (activeTask) activeTask.controller.abort();
    const controller = new AbortController();
    const task = {
      taskId: request.taskId,
      configurationId: configuration.id,
      controller,
    };
    activeTask = task;
    currentCopyCandidate = null;
    const apiKey = apiKeyFor(configuration.id);
    const thinkingEnabled =
      configuration.type === "deepseek-official" && submittedInputs.thinkingEnabled;
    const startedAt = now().getTime();
    let firstOutputAt = null;
    let taskTimedOut = false;
    const taskTimeout = setTimeout(() => {
      if (activeTask !== task) return;
      taskTimedOut = true;
      controller.abort();
    }, TRANSLATION_TOTAL_TIMEOUT_MILLISECONDS);

    function emitProgress(event) {
      try {
        onProgress(event);
      } catch {
        // Presentation observers cannot break a precision task.
      }
    }
    function emitStage(stage) {
      emitProgress({ type: "precision_stage", taskId: request.taskId, stage, callPlan });
      updateCurrentTask(request.taskId, { phase: stage });
    }
    function noteFirstOutput(value) {
      if (firstOutputAt === null && typeof value === "string" && value.length > 0) {
        firstOutputAt = now().getTime();
      }
    }
    async function sendOperation(operation, signal, countAsTranslation = false) {
      if (activeTask !== task || signal.aborted || controller.signal.aborted) {
        throw Object.assign(new Error("请求已取消。"), { code: "cancelled" });
      }
      let sawData = false;
      const response = await transport.request({
        url: normalizedTranslationUrl,
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...(configuration.authentication === "bearer"
            ? { Authorization: `Bearer ${apiKey}` }
            : {}),
        },
        body: operation.body,
        signal,
        onData(chunk) {
          if (activeTask !== task || signal.aborted || controller.signal.aborted) return;
          sawData = true;
          operation.push(chunk);
        },
      });
      if (activeTask !== task || signal.aborted || controller.signal.aborted) {
        throw Object.assign(new Error("请求已取消。"), { code: "cancelled" });
      }
      if (response.status < 200 || response.status >= 300) {
        throw transportResponseError(response);
      }
      const output = operation.finish(response.body, sawData);
      if (countAsTranslation) noteFirstOutput(output);
      return output;
    }
    function createTranslationOperation(operationInput, onTextDelta) {
      validatePromptContract("translationInput", operationInput);
      const operation = createTranslationProtocolOperation({
        configuration,
        input: operationInput,
        thinkingEnabled,
        onTextDelta,
      });
      validateTranslationInputBudget({
        input: operationInput,
        serializedBody: operation.body,
      });
      return operation;
    }
    async function runStructured({ input: operationInput, inputContract, outputContract, prompt }) {
      validatePromptContract(inputContract, operationInput);
      const operation = createProtocolOperation({
        configuration,
        input: operationInput,
        systemPrompt: prompt,
        stream: false,
        thinkingEnabled,
      });
      validateTranslationInputBudget({
        input: operationInput,
        serializedBody: operation.body,
      });
      const output = await sendOperation(operation, controller.signal, false);
      return parseStructuredOutput(output, outputContract, { input: operationInput });
    }
    function precisionMetadata(patch = {}) {
      return freezeDeep({
        complete: false,
        callPlan,
        reviewIssues: [],
        revisedSegmentIds: [],
        unresolvedIssueIds: [],
        ...patch,
      });
    }
    function reviewRisk(issue, index) {
      return {
        id: `precision-review-${index + 1}`,
        code: `precision.${issue.reviewRole}.${issue.type}`,
        category: issue.type === "terminology" || issue.type === "terminology_form"
          ? "terminology"
          : "other",
        severity: issue.severity,
        certainty: "heuristic",
        message: issue.suggestion || "精译审校发现需要人工复核的问题。",
      };
    }
    function combinedQuality(translation, extraRisks = []) {
      const quality = inspectTranslationQuality({
        sourceText: request.sourceText,
        translation,
        streamCompleted: true,
      });
      const terminologyRisks = inspectTerminologyQuality({
        translation,
        matchedTerms: terminologyResolution.qualityTerms,
      });
      const risks = [...quality.risks, ...terminologyRisks, ...extraRisks];
      return freezeDeep({
        risks,
        pasteBlocked:
          quality.pasteBlocked ||
          risks.some(
            (risk) => risk.certainty === "deterministic" && risk.severity === "critical",
          ),
      });
    }
    function completeWith(translation, precision, extraRisks = [], segmentMergeRisks = []) {
      const quality = combinedQuality(translation, [...segmentMergeRisks, ...extraRisks]);
      currentCopyCandidate = {
        taskId: request.taskId,
        sourceText: request.sourceText,
        translation,
        pasteBlocked: quality.pasteBlocked,
      };
      const completedAt = now().getTime();
      const completionMilliseconds = Math.max(1, completedAt - startedAt);
      const outputCodePoints = countCodePoints(translation);
      recordPerformanceSample(configuration.id, {
        firstOutputMilliseconds: Math.max(
          0,
          (firstOutputAt === null ? completedAt : firstOutputAt) - startedAt,
        ),
        completionMilliseconds,
        outputCodePoints,
        averageOutputCodePointsPerSecond:
          outputCodePoints / (completionMilliseconds / 1_000),
        mode: parallel && parallel.applied ? "precision_parallel" : "precision",
        segmentCount: callPlan.translationCalls,
      });
      emitProgress({
        type: "finished",
        taskId: request.taskId,
        status: "completed",
      });
      const result = freezeDeep({
        status: "completed",
        taskId: request.taskId,
        translation,
        quality,
        precision,
        ...(parallel ? { parallel } : {}),
      });
      storeCurrentResult(request.taskId, result, "completed", translation);
      return result;
    }
    function failStage(
      stage,
      error,
      partialTranslation = "",
      quality = null,
      precisionPatch = {},
    ) {
      const code = taskTimedOut
        ? "timeout"
        : activeTask !== task || controller.signal.aborted
          ? "cancelled"
          : mapTransportError(error) === "unknown_error" && error && error.code === "protocol_error"
            ? "protocol_error"
            : mapTransportError(error);
      emitProgress({
        type: "finished",
        taskId: request.taskId,
        status: code === "cancelled" ? "cancelled" : "failed",
      });
      const result = freezeDeep({
        status: "failed",
        taskId: request.taskId,
        sourceRetained: true,
        ...(partialTranslation ? { partialTranslation } : {}),
        ...(quality ? { quality } : {}),
        ...(parallel ? { parallel } : {}),
        precision: precisionMetadata({ ...precisionPatch, failedStage: stage }),
        error: {
          code,
          message: safeTransportErrorMessage(error, code),
          ...(error && Number.isInteger(error.httpStatus)
            ? { httpStatus: error.httpStatus }
            : {}),
          ...(error && typeof error.requestId === "string"
            ? { requestId: error.requestId }
            : {}),
        },
      });
      if (partialTranslation && quality) {
        currentCopyCandidate = {
          taskId: request.taskId,
          sourceText: request.sourceText,
          translation: partialTranslation,
          pasteBlocked: quality.pasteBlocked,
        };
      }
      storeCurrentResult(request.taskId, result, "failed", partialTranslation);
      return result;
    }

    emitProgress({ type: "started", taskId: request.taskId });
    emitProgress({ type: "precision_plan", taskId: request.taskId, callPlan });
    if (parallel) {
      emitProgress({ type: "parallel_plan", taskId: request.taskId, parallel });
    }

    let analysis;
    const analysisProtectedItems = precisionSegments.flatMap(
      (segment) => segmentTranslationInput(input, segment).protectedItems,
    );
    const analysisBase = {
      ...baseTaskData(input),
      protectedItems: analysisProtectedItems,
    };
    const analysisInput = {
      ...analysisBase,
      schemaVersion: "analysis-input.v1",
      sourceText: input.sourceText,
      segments: precisionSegments.map((segment) => ({
        id: segment.id,
        ordinal: segment.ordinal,
        sourceStart: segment.sourceStart,
        sourceEnd: segment.sourceEnd,
      })),
    };
    try {
      emitStage("analyzing");
      analysis = await runStructured({
        input: analysisInput,
        inputContract: "analysisInput",
        outputContract: "analysisOutput",
        prompt: ANALYSIS_SYSTEM_PROMPT,
      });
    } catch (error) {
      clearTimeout(taskTimeout);
      const result = failStage("analysis", error);
      if (activeTask === task) activeTask = null;
      return result;
    }

    let initialTranslation = "";
    let translatedSegments = [];
    let segmentMergeRisks = [];
    let fullDocumentOperation = null;
    const segmentOperations = new Map();
    try {
      emitStage("translating");
      if (parallel && parallel.applied) {
        const output = createOutputAccumulator();
        const completedByOrdinal = new Map();
        let nextPublishedOrdinal = 0;
        const segmentResults = await runSegmentPool({
          segments: precisionSegments,
          concurrency: parallel.concurrency,
          signal: controller.signal,
          async translate(segment, { signal }) {
            const operationInput = segmentTranslationInput(
              { ...input, qualityMode: "precision", analysis },
              segment,
            );
            const operation = createTranslationOperation(operationInput, noteFirstOutput);
            segmentOperations.set(segment.id, operation);
            try {
              const translation = await sendOperation(operation, signal, true);
              return {
                id: segment.id,
                ordinal: segment.ordinal,
                sourceStart: segment.sourceStart,
                sourceEnd: segment.sourceEnd,
                translation,
              };
            } catch (error) {
              const partial = operation.partialTranslation();
              if (partial) {
                error.partialSegmentResult = {
                  id: segment.id,
                  ordinal: segment.ordinal,
                  sourceStart: segment.sourceStart,
                  sourceEnd: segment.sourceEnd,
                  translation: partial,
                };
              }
              throw error;
            }
          },
          onSegmentStarted(_segment, progress) {
            emitProgress({
              type: "segment_progress",
              taskId: request.taskId,
              completed: progress.completed,
              total: progress.total,
              inFlight: progress.inFlight,
              concurrency: parallel.concurrency,
            });
          },
          onSegmentCompleted(result, progress) {
            completedByOrdinal.set(result.ordinal, result.translation);
            while (completedByOrdinal.has(nextPublishedOrdinal)) {
              const delta = completedByOrdinal.get(nextPublishedOrdinal);
              if (!output.append(delta)) {
                throw outputLimitError(output.text());
              }
              emitProgress({ type: "text_delta", taskId: request.taskId, delta });
              nextPublishedOrdinal += 1;
            }
            updateCurrentTask(request.taskId, {
              phase: "translating",
              partialTranslation: output.text(),
              parallelProgress: {
                ...progress,
                concurrency: parallel.concurrency,
                fallbackReason: parallel.fallbackReason,
              },
            });
          },
        });
        const merged = mergeSegmentTranslations(precisionSegments, segmentResults);
        if (countCodePoints(merged.translation) > OUTPUT_CODE_POINT_LIMIT) {
          throw outputLimitError(
            Array.from(merged.translation).slice(0, OUTPUT_CODE_POINT_LIMIT).join(""),
          );
        }
        initialTranslation = merged.translation;
        segmentMergeRisks = [...merged.risks];
        const byId = new Map(segmentResults.map((result) => [result.id, result.translation]));
        translatedSegments = precisionSegments.map((segment) => ({
          ...segment,
          translation: byId.get(segment.id),
        }));
      } else {
        const operationInput = {
          ...input,
          qualityMode: "precision",
          analysis,
        };
        fullDocumentOperation = createTranslationOperation(operationInput, (delta) => {
          if (activeTask !== task || controller.signal.aborted) return;
          noteFirstOutput(delta);
          emitProgress({ type: "text_delta", taskId: request.taskId, delta });
          const currentPartial =
            currentTranslation && currentTranslation.task.taskId === request.taskId
              ? currentTranslation.partialTranslation
              : "";
          updateCurrentTask(request.taskId, {
            phase: "translating",
            partialTranslation: currentPartial + delta,
          });
        });
        initialTranslation = await sendOperation(
          fullDocumentOperation,
          controller.signal,
          true,
        );
        translatedSegments = [
          { ...precisionSegments[0], translation: initialTranslation },
        ];
      }
    } catch (error) {
      let partialTranslation = "";
      if (parallel && parallel.applied) {
        const partialMerge = mergeSegmentTranslations(
          precisionSegments,
          partialSegmentResultsFromError(error),
        );
        partialTranslation =
          error && typeof error.partialTranslation === "string"
            ? error.partialTranslation
            : partialMerge.translation;
      } else if (fullDocumentOperation) {
        partialTranslation = fullDocumentOperation.partialTranslation();
      }
      const quality = partialTranslation
        ? inspectTranslationQuality({
            sourceText: request.sourceText,
            translation: partialTranslation,
            streamCompleted: false,
          })
        : null;
      clearTimeout(taskTimeout);
      const result = failStage("translation", error, partialTranslation, quality);
      if (activeTask === task) activeTask = null;
      return result;
    }

    const reviewSegments = translatedSegments.map((segment) => ({
      id: segment.id,
      ordinal: segment.ordinal,
      sourceStart: segment.sourceStart,
      sourceEnd: segment.sourceEnd,
      source: segment.ownedSource,
      translation: segment.translation,
    }));
    const accuracyInput = {
      ...analysisBase,
      schemaVersion: "accuracy-review-input.v1",
      analysis,
      segments: reviewSegments,
    };
    const languageInput = {
      schemaVersion: "language-review-input.v1",
      taskId: input.taskId,
      targetLanguage: input.targetLanguage,
      domainProfile: input.domainProfile,
      matchedTerms: input.matchedTerms,
      targetExamples: input.referenceTranslations.map((reference) => ({
        id: reference.id,
        targetLanguage: reference.targetLanguage,
        domainProfileId: reference.domainProfileId,
        translation: reference.translation,
      })),
      additionalRequirements: input.additionalRequirements,
      translations: reviewSegments.map(({ source: _source, ...segment }) => segment),
    };
    emitStage("reviewing");
    const reviewResults = await Promise.allSettled([
      runStructured({
        input: accuracyInput,
        inputContract: "accuracyReviewInput",
        outputContract: "accuracyReviewOutput",
        prompt: ACCURACY_REVIEW_SYSTEM_PROMPT,
      }),
      runStructured({
        input: languageInput,
        inputContract: "languageReviewInput",
        outputContract: "languageReviewOutput",
        prompt: LANGUAGE_REVIEW_SYSTEM_PROMPT,
      }),
    ]);
    if (reviewResults.some((result) => result.status === "rejected")) {
      const failedIndex = reviewResults.findIndex((result) => result.status === "rejected");
      const failedStage = failedIndex === 0 ? "accuracy_review" : "language_review";
      const retainedReviewIssues = [
        ...(reviewResults[0].status === "fulfilled"
          ? reviewResults[0].value.issues.map((issue) => ({
              reviewRole: "accuracy",
              ...issue,
              termId: null,
            }))
          : []),
        ...(reviewResults[1].status === "fulfilled"
          ? reviewResults[1].value.issues.map((issue) => ({
              reviewRole: "language",
              ...issue,
              sourceRange: null,
            }))
          : []),
      ];
      const failedReview = reviewResults[failedIndex];
      if (taskTimedOut || controller.signal.aborted || activeTask !== task) {
        const quality = combinedQuality(initialTranslation, [
          ...segmentMergeRisks,
          ...retainedReviewIssues.map(reviewRisk),
        ]);
        clearTimeout(taskTimeout);
        const result = failStage(
          failedStage,
          failedReview.reason,
          initialTranslation,
          quality,
          { analysis, reviewIssues: retainedReviewIssues },
        );
        if (activeTask === task) activeTask = null;
        return result;
      }
      const precision = precisionMetadata({
        analysis,
        failedStage,
        reviewIssues: retainedReviewIssues,
      });
      const incompleteRisk = {
        id: "precision-incomplete-review",
        code: "precision.review_incomplete",
        category: "other",
        severity: "major",
        certainty: "heuristic",
        message: "精译审校未完成，当前保留初译，请人工复核。",
      };
      clearTimeout(taskTimeout);
      if (activeTask === task) activeTask = null;
      return completeWith(
        initialTranslation,
        precision,
        [
          incompleteRisk,
          ...retainedReviewIssues.map(reviewRisk),
        ],
        segmentMergeRisks,
      );
    }

    const accuracyOutput = reviewResults[0].value;
    const languageOutput = reviewResults[1].value;
    const reviewIssues = [
      ...accuracyOutput.issues.map((issue) => ({
        reviewRole: "accuracy",
        ...issue,
        termId: null,
      })),
      ...languageOutput.issues.map((issue) => ({
        reviewRole: "language",
        ...issue,
        sourceRange: null,
      })),
    ];
    if (new Set(reviewIssues.map((issue) => issue.id)).size !== reviewIssues.length) {
      const precision = precisionMetadata({ analysis, failedStage: "reviews" });
      const risk = {
        id: "precision-duplicate-review-id",
        code: "precision.review_id_conflict",
        category: "other",
        severity: "major",
        certainty: "heuristic",
        message: "两个审校结果使用了重复的问题 ID，精译未继续修订。",
      };
      clearTimeout(taskTimeout);
      if (activeTask === task) activeTask = null;
      return completeWith(initialTranslation, precision, [risk], segmentMergeRisks);
    }
    if (reviewIssues.length === 0) {
      const precision = precisionMetadata({
        complete: true,
        analysis,
      });
      clearTimeout(taskTimeout);
      if (activeTask === task) activeTask = null;
      return completeWith(initialTranslation, precision, [], segmentMergeRisks);
    }

    const riskyIds = new Set(reviewIssues.map((issue) => issue.segmentId));
    const riskySegments = translatedSegments
      .filter((segment) => riskyIds.has(segment.id))
      .map((segment) => {
        const index = translatedSegments.findIndex((candidate) => candidate.id === segment.id);
        const previous = translatedSegments[index - 1];
        const next = translatedSegments[index + 1];
        return {
          id: segment.id,
          ordinal: segment.ordinal,
          sourceStart: segment.sourceStart,
          sourceEnd: segment.sourceEnd,
          sourceContextBefore: segment.sourceContextBefore,
          source: segment.ownedSource,
          sourceContextAfter: segment.sourceContextAfter,
          targetContextBefore: previous
            ? Array.from(previous.translation).slice(-2_000).join("")
            : "",
          currentTranslation: segment.translation,
          targetContextAfter: next
            ? Array.from(next.translation).slice(0, 2_000).join("")
            : "",
        };
      });
    const revisionInput = {
      ...analysisBase,
      protectedItems: analysisBase.protectedItems.filter((item) =>
        riskyIds.has(item.segmentId),
      ),
      schemaVersion: "revision-input.v1",
      analysis,
      segments: riskySegments,
      issues: reviewIssues,
    };
    let revisionOutput;
    try {
      emitStage("revising");
      revisionOutput = await runStructured({
        input: revisionInput,
        inputContract: "revisionInput",
        outputContract: "revisionOutput",
        prompt: REVISION_SYSTEM_PROMPT,
      });
    } catch (error) {
      if (taskTimedOut || controller.signal.aborted || activeTask !== task) {
        const quality = combinedQuality(initialTranslation, [
          ...segmentMergeRisks,
          ...reviewIssues.map(reviewRisk),
        ]);
        clearTimeout(taskTimeout);
        const result = failStage(
          "revision",
          error,
          initialTranslation,
          quality,
          {
            analysis,
            reviewIssues,
            unresolvedIssueIds: reviewIssues.map((issue) => issue.id),
          },
        );
        if (activeTask === task) activeTask = null;
        return result;
      }
      const precision = precisionMetadata({
        analysis,
        failedStage: "revision",
        reviewIssues,
        unresolvedIssueIds: reviewIssues.map((issue) => issue.id),
      });
      const risks = reviewIssues.map(reviewRisk);
      clearTimeout(taskTimeout);
      if (activeTask === task) activeTask = null;
      return completeWith(initialTranslation, precision, risks, segmentMergeRisks);
    }

    const replacements = new Map(
      revisionOutput.revisions.map((revision) => [revision.segmentId, revision.replacement]),
    );
    const finalTranslation = translatedSegments
      .map((segment) =>
        replacements.has(segment.id) ? replacements.get(segment.id) : segment.translation,
      )
      .join("");
    if (countCodePoints(finalTranslation) > OUTPUT_CODE_POINT_LIMIT) {
      const precision = precisionMetadata({
        analysis,
        failedStage: "revision",
        reviewIssues,
        unresolvedIssueIds: reviewIssues.map((issue) => issue.id),
      });
      const risks = [
        ...reviewIssues.map(reviewRisk),
        {
          id: "precision-revision-output-limit",
          code: "precision.revision_output_too_large",
          category: "output_contract",
          severity: "major",
          certainty: "deterministic",
          message: "修订结果超过输出长度限制，已保留初译。",
        },
      ];
      clearTimeout(taskTimeout);
      if (activeTask === task) activeTask = null;
      return completeWith(initialTranslation, precision, risks, segmentMergeRisks);
    }
    const unresolvedSet = new Set(revisionOutput.unresolvedIssueIds);
    const unresolvedIssues = reviewIssues.filter((issue) => unresolvedSet.has(issue.id));
    const precision = precisionMetadata({
      complete: true,
      analysis,
      reviewIssues,
      revisedSegmentIds: revisionOutput.revisions.map((revision) => revision.segmentId),
      unresolvedIssueIds: revisionOutput.unresolvedIssueIds,
    });
    clearTimeout(taskTimeout);
    if (activeTask === task) activeTask = null;
    return completeWith(
      finalTranslation,
      precision,
      unresolvedIssues.map(reviewRisk),
      segmentMergeRisks,
    );
  }

  async function startStandardTranslation(request, onProgress = () => undefined) {
    request = { ...request, qualityMode: "standard", thinkingEnabled: false };
    if (
      !request ||
      typeof request.sourceText !== "string" ||
      request.sourceText.trim().length === 0
    ) {
      return {
        status: "validation_error",
        reason: "invalid_source_text",
        sourceRetained: true,
      };
    }

    const sourceInspection = inspectSourceText(request.sourceText);
    if (!sourceInspection.valid) {
      return {
        status: "validation_error",
        reason: "source_text_too_long",
        sourceRetained: true,
      };
    }

    const targetLanguage = normalizeTargetLanguage(request.targetLanguage);
    if (!targetLanguage) {
      return {
        status: "validation_error",
        reason: "invalid_target_language",
        sourceRetained: true,
      };
    }

    if (
      request.parallelAcceleration &&
      request.parallelConcurrency !== undefined &&
      (!Number.isInteger(request.parallelConcurrency) ||
        request.parallelConcurrency < 1 ||
        request.parallelConcurrency > 6)
    ) {
      return {
        status: "validation_error",
        reason: "invalid_parallel_configuration",
        field: "parallelConcurrency",
        message: "并发数必须是 1 至 6 的整数。",
        sourceRetained: true,
      };
    }

    if (
      request.referenceTranslationIds !== undefined &&
      request.referenceTranslationIds !== null &&
      !Array.isArray(request.referenceTranslationIds)
    ) {
      return {
        status: "validation_error",
        reason: "invalid_reference_selection",
        field: "referenceTranslationIds",
        message: "参考译例选择必须是数组。",
        sourceRetained: true,
      };
    }
    if (
      Array.isArray(request.referenceTranslationIds) &&
      request.referenceTranslationIds.length > 3
    ) {
      return {
        status: "validation_error",
        reason: "input_budget_exceeded",
        field: "referenceTranslationIds",
        message: "参考译例最多选择 3 条，不能截断多余条目。",
        sourceRetained: true,
      };
    }

    if (request.taskTerms !== undefined && !Array.isArray(request.taskTerms)) {
      return {
        status: "validation_error",
        reason: "invalid_terminology",
        field: "taskTerms",
        message: "本次术语必须是数组。",
        sourceRetained: true,
      };
    }

    const { inputs: submittedInputs } = beginCurrentTask(request, targetLanguage);

    let terminologyPreparation;
    try {
      terminologyPreparation = prepareTerminologyInput(
        request,
        targetLanguage,
        submittedInputs,
      );
    } catch (error) {
      const result = {
        status: "validation_error",
        reason:
          error && error.code === "terminology_limit_exceeded"
            ? "terminology_limit_exceeded"
            : error && error.code === "input_budget_exceeded"
              ? "input_budget_exceeded"
              : error && error.code === "reference_validation_error"
                ? "invalid_reference_selection"
                : "invalid_terminology",
        ...(error && error.field ? { field: error.field } : {}),
        message:
          error && typeof error.message === "string"
            ? error.message
            : "术语配置无效。",
        sourceRetained: true,
      };
      storeCurrentResult(request.taskId, result, "failed");
      return result;
    }
    if (terminologyPreparation.terminologyResolution.conflicts.length > 0) {
      const result = {
        status: "validation_error",
        reason: "terminology_conflict",
        sourceRetained: true,
        terminologyConflicts: terminologyPreparation.terminologyResolution.conflicts,
      };
      storeCurrentResult(request.taskId, result, "failed");
      return result;
    }
    if (terminologyPreparation.referencePreviewRequired) {
      const previewToken = tokenFactory();
      pendingReferencePreviews.set(previewToken, {
        taskId: request.taskId,
        sourceText: request.sourceText,
        inputsFingerprint: referencePreviewFingerprint(submittedInputs),
        candidates: terminologyPreparation.referenceCandidates,
      });
      const result = freezeDeep({
        status: "reference_confirmation_required",
        sourceRetained: true,
        previewToken,
        referenceTranslations: terminologyPreparation.referenceCandidates.map(
          (reference) => ({ ...reference }),
        ),
      });
      storeCurrentResult(request.taskId, result, "awaiting_confirmation");
      return result;
    }
    const { input, terminologyResolution } = terminologyPreparation;
    const translationPlan = submittedInputs.parallelAcceleration
      ? createTranslationPlan(request.sourceText)
      : null;
    const parallel = translationPlan
      ? parallelSummaryFor(submittedInputs, translationPlan)
      : null;

    preparingTaskIds.add(request.taskId);
    let state;
    try {
      state = await getServiceConfiguration(submittedInputs.serviceConfigurationId);
    } finally {
      preparingTaskIds.delete(request.taskId);
    }

    if (cancelledPreparingTaskIds.delete(request.taskId)) {
      const result = {
        status: "failed",
        taskId: request.taskId,
        sourceRetained: true,
        error: { code: "cancelled", message: errorMessage("cancelled") },
      };
      storeCurrentResult(request.taskId, result, "failed");
      return result;
    }

    if (!state.serviceConfiguration) {
      const result = {
        status: "configuration_required",
        reason: "missing_configuration",
        sourceRetained: true,
        serviceConfiguration: null,
      };
      storeCurrentResult(request.taskId, result, "needs_configuration");
      return result;
    }

    if (
      state.serviceConfiguration.authentication === "bearer" &&
      !state.serviceConfiguration.hasApiKey
    ) {
      const result = {
        status: "configuration_required",
        reason: "missing_api_key",
        sourceRetained: true,
        serviceConfiguration: state.serviceConfiguration,
      };
      storeCurrentResult(request.taskId, result, "needs_configuration");
      return result;
    }

    const settings = readSettings();
    const configuration = findConfiguration(
      settings,
      submittedInputs.serviceConfigurationId,
    );
    let normalizedTranslationUrl;
    try {
      normalizedTranslationUrl = normalizeServiceUrl(
        configuration.translationUrl,
        "translationUrl",
        apiKeyFor(configuration.id),
      );
    } catch {
      const result = {
        status: "failed",
        taskId: request.taskId,
        sourceRetained: true,
        error: {
          code: "configuration_error",
          message: errorMessage("configuration_error"),
        },
      };
      storeCurrentResult(request.taskId, result, "failed");
      return result;
    }

    if (configuration.confirmedTranslationUrl !== normalizedTranslationUrl) {
      const pending = request.confirmationToken
        ? pendingConfirmations.get(request.confirmationToken)
        : undefined;

      if (request.confirmationToken) {
        pendingConfirmations.delete(request.confirmationToken);
        if (
          !sameConfirmationRequest(
            pending,
            request,
            targetLanguage,
            configuration,
            normalizedTranslationUrl,
            submittedInputs,
          )
        ) {
          const result = {
            status: "validation_error",
            reason: "invalid_confirmation",
            sourceRetained: true,
          };
          storeCurrentResult(request.taskId, result, "failed");
          return result;
        }

        configuration.confirmedTranslationUrl = normalizedTranslationUrl;
        plainStorage.setItem(SETTINGS_KEY, settings);
      } else {
        const confirmationToken = tokenFactory();
        pendingConfirmations.set(confirmationToken, {
          taskId: request.taskId,
          sourceText: request.sourceText,
          targetLanguage,
          configurationId: configuration.id,
          normalizedTranslationUrl,
          inputsFingerprint: inputsFingerprint(submittedInputs),
        });

        const result = {
          status: "confirmation_required",
          sourceRetained: true,
          confirmationToken,
          preview: {
            serviceName: configuration.name,
            normalizedTranslationUrl,
            protocol:
              configuration.protocol === "responses"
                ? "Responses"
                : "Chat Completions",
            model: configuration.model,
            dataSent: [
              "源文本",
              "目标语言",
              ...(input.domainProfile ? ["行业配置"] : []),
              "命中的术语",
              ...(input.referenceTranslations.length > 0 ? ["参考译例"] : []),
              "附加翻译要求",
            ],
            callCount: parallel && parallel.applied ? parallel.segmentCount : 1,
            ...(parallel ? { parallel } : {}),
          },
        };
        storeCurrentResult(
          request.taskId,
          result,
          "awaiting_confirmation",
        );
        return result;
      }
    }

    const apiKey = apiKeyFor(configuration.id);
    if (activeTask) {
      activeTask.controller.abort();
    }
    const controller = new AbortController();
    const task = {
      taskId: request.taskId,
      configurationId: configuration.id,
      controller,
    };
    activeTask = task;
    currentCopyCandidate = null;
    function emitProgress(event) {
      try {
        onProgress(event);
      } catch {
        // Progress observers are presentation concerns and must not break a request.
      }
    }

    const startedAt = now().getTime();
    let firstOutputAt = null;
    let fullDocumentOperation = null;
    let segmentOperations = null;
    let segmentMergeRisks = [];
    let taskTimedOut = false;
    let taskTimeout = null;
    function noteFirstOutput(delta) {
      if (firstOutputAt === null && typeof delta === "string" && delta.length > 0) {
        firstOutputAt = now().getTime();
      }
    }
    function createOperation(operationInput, onTextDelta) {
      validatePromptContract("translationInput", operationInput);
      const operation = createTranslationProtocolOperation({
        configuration,
        input: operationInput,
        onTextDelta,
      });
      validateTranslationInputBudget({
        input: operationInput,
        serializedBody: operation.body,
      });
      return operation;
    }
    async function sendOperation(operation, signal) {
      if (activeTask !== task || signal.aborted || controller.signal.aborted) {
        throw Object.assign(new Error("请求已取消。"), { code: "cancelled" });
      }
      let sawData = false;
      const response = await transport.request({
        url: normalizedTranslationUrl,
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...(configuration.authentication === "bearer"
            ? { Authorization: `Bearer ${apiKey}` }
            : {}),
        },
        body: operation.body,
        signal,
        onData(chunk) {
          if (activeTask !== task || signal.aborted || controller.signal.aborted) {
            return;
          }
          sawData = true;
          operation.push(chunk);
        },
      });
      if (activeTask !== task || signal.aborted || controller.signal.aborted) {
        throw Object.assign(new Error("请求已取消。"), { code: "cancelled" });
      }
      if (response.status < 200 || response.status >= 300) {
        throw transportResponseError(response);
      }
      const translation = operation.finish(response.body, sawData);
      noteFirstOutput(translation);
      return translation;
    }

    try {
      if (parallel && parallel.applied) {
        segmentOperations = new Map(
          translationPlan.segments.map((segment) => [
            segment.id,
            createOperation(segmentTranslationInput(input, segment), noteFirstOutput),
          ]),
        );
      } else {
        fullDocumentOperation = createOperation(input, (delta) => {
          if (activeTask !== task || controller.signal.aborted) return;
          noteFirstOutput(delta);
          emitProgress({ type: "text_delta", taskId: request.taskId, delta });
          const currentPartial =
            currentTranslation && currentTranslation.task.taskId === request.taskId
              ? currentTranslation.partialTranslation
              : "";
          updateCurrentTask(request.taskId, {
            phase: "translating",
            partialTranslation: currentPartial + delta,
          });
        });
      }
    } catch (error) {
      if (activeTask === task) activeTask = null;
      if (
        error &&
        [
          "input_budget_exceeded",
          "terminology_limit_exceeded",
          "terminology_validation_error",
        ].includes(error.code)
      ) {
        const result = {
          status: "validation_error",
          reason:
            error.code === "terminology_validation_error"
              ? "invalid_terminology"
              : error.code,
          ...(error.field ? { field: error.field } : {}),
          message: error.message,
          sourceRetained: true,
        };
        storeCurrentResult(request.taskId, result, "failed");
        return result;
      }
      const code = mapTransportError(error) === "protocol_error"
        ? "protocol_error"
        : "configuration_error";
      const result = {
        status: "failed",
        taskId: request.taskId,
        sourceRetained: true,
        ...(parallel ? { parallel } : {}),
        error: {
          code,
          message:
            code === "protocol_error"
              ? "翻译任务不符合提示词契约。"
              : errorMessage("configuration_error"),
        },
      };
      storeCurrentResult(request.taskId, result, "failed");
      return result;
    }

    taskTimeout = setTimeout(() => {
      if (activeTask !== task) return;
      taskTimedOut = true;
      controller.abort();
    }, TRANSLATION_TOTAL_TIMEOUT_MILLISECONDS);
    emitProgress({ type: "started", taskId: request.taskId });
    if (parallel) {
      emitProgress({ type: "parallel_plan", taskId: request.taskId, parallel });
    }
    const initialParallelProgress = parallel
      ? {
          completed: 0,
          total: parallel.segmentCount,
          inFlight: 0,
          concurrency: parallel.concurrency,
          fallbackReason: parallel.fallbackReason,
        }
      : null;
    updateCurrentTask(request.taskId, {
      phase: "translating",
      parallelProgress: initialParallelProgress,
    });

    try {
      let translation;
      if (parallel && parallel.applied) {
        const output = createOutputAccumulator();
        const completedByOrdinal = new Map();
        let nextPublishedOrdinal = 0;
        const segmentResults = await runSegmentPool({
          segments: translationPlan.segments,
          concurrency: parallel.concurrency,
          signal: controller.signal,
          async translate(segment, { signal }) {
            const operation = segmentOperations.get(segment.id);
            try {
              const segmentTranslation = await sendOperation(operation, signal);
              return {
                id: segment.id,
                ordinal: segment.ordinal,
                sourceStart: segment.sourceStart,
                sourceEnd: segment.sourceEnd,
                translation: segmentTranslation,
              };
            } catch (error) {
              const partial = operation.partialTranslation();
              if (partial) {
                error.partialSegmentResult = {
                  id: segment.id,
                  ordinal: segment.ordinal,
                  sourceStart: segment.sourceStart,
                  sourceEnd: segment.sourceEnd,
                  translation: partial,
                };
              }
              throw error;
            }
          },
          onSegmentStarted(_segment, progress) {
            const parallelProgress = {
              ...progress,
              concurrency: parallel.concurrency,
              fallbackReason: parallel.fallbackReason,
            };
            emitProgress({
              type: "segment_progress",
              taskId: request.taskId,
              completed: progress.completed,
              total: progress.total,
              inFlight: progress.inFlight,
              concurrency: parallel.concurrency,
            });
            updateCurrentTask(request.taskId, { parallelProgress });
          },
          onSegmentCompleted(result, progress) {
            completedByOrdinal.set(result.ordinal, result.translation);
            while (completedByOrdinal.has(nextPublishedOrdinal)) {
              const delta = completedByOrdinal.get(nextPublishedOrdinal);
              if (!output.append(delta)) {
                throw Object.assign(new Error(errorMessage("response_too_large")), {
                  code: "response_too_large",
                  partialTranslation: output.text(),
                });
              }
              emitProgress({ type: "text_delta", taskId: request.taskId, delta });
              nextPublishedOrdinal += 1;
            }
            const parallelProgress = {
              ...progress,
              concurrency: parallel.concurrency,
              fallbackReason: parallel.fallbackReason,
            };
            emitProgress({
              type: "segment_progress",
              taskId: request.taskId,
              completed: progress.completed,
              total: progress.total,
              inFlight: progress.inFlight,
              concurrency: parallel.concurrency,
            });
            updateCurrentTask(request.taskId, {
              partialTranslation: output.text(),
              parallelProgress,
            });
          },
        });
        const merged = mergeSegmentTranslations(translationPlan.segments, segmentResults);
        translation = merged.translation;
        segmentMergeRisks = [...merged.risks];
      } else {
        translation = await sendOperation(fullDocumentOperation, controller.signal);
      }

      const quality = inspectTranslationQuality({
        sourceText: request.sourceText,
        translation,
        streamCompleted: true,
      });
      const terminologyRisks = inspectTerminologyQuality({
        translation,
        matchedTerms: terminologyResolution.qualityTerms,
      });
      const allRisks = [...quality.risks, ...terminologyRisks, ...segmentMergeRisks];
      const combinedQuality = freezeDeep({
        risks: allRisks,
        pasteBlocked:
          quality.pasteBlocked ||
          allRisks.some(
            (risk) => risk.certainty === "deterministic" && risk.severity === "critical",
          ),
      });
      currentCopyCandidate = {
        taskId: request.taskId,
        sourceText: request.sourceText,
        translation,
        pasteBlocked: combinedQuality.pasteBlocked,
      };
      const completedAt = now().getTime();
      const completionMilliseconds = Math.max(1, completedAt - startedAt);
      const outputCodePoints = countCodePoints(translation);
      recordPerformanceSample(configuration.id, {
        firstOutputMilliseconds: Math.max(
          0,
          (firstOutputAt === null ? completedAt : firstOutputAt) - startedAt,
        ),
        completionMilliseconds,
        outputCodePoints,
        averageOutputCodePointsPerSecond:
          outputCodePoints / (completionMilliseconds / 1_000),
        mode: parallel && parallel.applied ? "parallel" : "full_document",
        segmentCount: parallel && parallel.applied ? parallel.segmentCount : 1,
      });
      if (parallel) {
        updateCurrentTask(request.taskId, {
          parallelProgress: {
            completed: parallel.segmentCount,
            total: parallel.segmentCount,
            inFlight: 0,
            concurrency: parallel.concurrency,
            fallbackReason: parallel.fallbackReason,
          },
        });
      }
      emitProgress({
        type: "finished",
        taskId: request.taskId,
        status: "completed",
      });
      const result = freezeDeep({
        status: "completed",
        taskId: request.taskId,
        translation,
        quality: combinedQuality,
        ...(parallel ? { parallel } : {}),
      });
      storeCurrentResult(request.taskId, result, "completed", translation);
      return result;
    } catch (error) {
      const code =
        taskTimedOut
          ? "timeout"
          : activeTask !== task || controller.signal.aborted
          ? "cancelled"
          : mapTransportError(error);
      let partialTranslation = "";
      let incompleteSegmentRisks = [];
      if (parallel && parallel.applied) {
        const partialMerge = mergeSegmentTranslations(
          translationPlan.segments,
          partialSegmentResultsFromError(error),
        );
        partialTranslation =
          error && typeof error.partialTranslation === "string"
            ? error.partialTranslation
            : partialMerge.translation;
        incompleteSegmentRisks = [...partialMerge.risks];
      } else {
        partialTranslation =
          error && typeof error.partialTranslation === "string"
            ? error.partialTranslation
            : fullDocumentOperation
              ? fullDocumentOperation.partialTranslation()
              : "";
      }
      const baseQuality =
        configuration.stream || (parallel && parallel.applied)
          ? inspectTranslationQuality({
              sourceText: request.sourceText,
              translation: partialTranslation,
              streamCompleted: false,
            })
          : null;
      const quality = baseQuality
        ? freezeDeep({
            risks: [...baseQuality.risks, ...incompleteSegmentRisks],
            pasteBlocked:
              baseQuality.pasteBlocked || incompleteSegmentRisks.length > 0,
          })
        : null;
      if (
        quality &&
        partialTranslation &&
        currentTranslation &&
        currentTranslation.task &&
        currentTranslation.task.taskId === request.taskId
      ) {
        currentCopyCandidate = {
          taskId: request.taskId,
          sourceText: request.sourceText,
          translation: partialTranslation,
          pasteBlocked: quality.pasteBlocked,
        };
      }
      if (parallel) {
        const completed = Array.isArray(error && error.segmentResults)
          ? error.segmentResults.length
          : 0;
        updateCurrentTask(request.taskId, {
          parallelProgress: {
            completed,
            total: parallel.segmentCount,
            inFlight: 0,
            concurrency: parallel.concurrency,
            fallbackReason: parallel.fallbackReason,
          },
        });
      }
      emitProgress({
        type: "finished",
        taskId: request.taskId,
        status: code === "cancelled" ? "cancelled" : "failed",
      });
      const result = freezeDeep({
        status: "failed",
        taskId: request.taskId,
        sourceRetained: true,
        ...(partialTranslation ? { partialTranslation } : {}),
        ...(quality ? { quality } : {}),
        ...(parallel ? { parallel } : {}),
        error: {
          code,
          message: safeTransportErrorMessage(error, code),
          ...(error && Number.isInteger(error.httpStatus)
            ? { httpStatus: error.httpStatus }
            : {}),
          ...(error && typeof error.requestId === "string"
            ? { requestId: error.requestId }
            : {}),
        },
      });
      storeCurrentResult(
        request.taskId,
        result,
        "failed",
        partialTranslation,
      );
      return result;
    } finally {
      if (taskTimeout !== null) clearTimeout(taskTimeout);
      if (activeTask === task) activeTask = null;
    }
  }

  async function startTranslation(request, onProgress = () => undefined) {
    return request && request.qualityMode === "precision"
      ? startPrecisionTranslation(request, onProgress)
      : startStandardTranslation(request, onProgress);
  }

  function cancelTranslation(taskId) {
    let cancelledPendingConfirmation = false;
    for (const [token, pending] of pendingConfirmations) {
      if (pending.taskId === taskId) {
        pendingConfirmations.delete(token);
        cancelledPendingConfirmation = true;
      }
    }
    for (const [token, pending] of pendingReferencePreviews) {
      if (pending.taskId === taskId) {
        pendingReferencePreviews.delete(token);
        cancelledPendingConfirmation = true;
      }
    }
    if (approvedReferenceSelections.delete(taskId)) {
      cancelledPendingConfirmation = true;
    }
    if (preparingTaskIds.has(taskId)) {
      cancelledPreparingTaskIds.add(taskId);
    }
    if (activeTask && activeTask.taskId === taskId) {
      activeTask.controller.abort();
    } else if (
      cancelledPendingConfirmation &&
      currentTranslation &&
      currentTranslation.task &&
      currentTranslation.task.taskId === taskId
    ) {
      publishCurrentTranslation({
        phase: "editing",
        inputs: currentTranslation.inputs,
        task: null,
        partialTranslation: "",
        result: null,
      });
    }
  }

  function clearCurrentTranslation() {
    cancelAllCurrentWork();
    currentCopyCandidate = null;
    publishCurrentTranslation(null);
  }

  function copyTranslation(taskId, confirmRisks = false) {
    if (
      !currentCopyCandidate ||
      currentCopyCandidate.taskId !== taskId ||
      !currentTranslation ||
      !currentTranslation.task ||
      currentTranslation.task.taskId !== taskId
    ) {
      return { status: "unavailable" };
    }
    if (currentCopyCandidate.pasteBlocked && !confirmRisks) {
      return { status: "confirmation_required" };
    }
    if (typeof hostActions.copyText !== "function") {
      return { status: "unavailable" };
    }
    try {
      return hostActions.copyText(currentCopyCandidate.translation)
        ? { status: "copied" }
        : { status: "unavailable" };
    } catch {
      return { status: "unavailable" };
    }
  }

  function pasteTranslation(taskId, currentSourceText) {
    if (!currentCopyCandidate || currentCopyCandidate.taskId !== taskId) {
      return { status: "unavailable" };
    }
    if (
      currentCopyCandidate.pasteBlocked ||
      currentCopyCandidate.sourceText !== currentSourceText ||
      !currentTranslation ||
      currentTranslation.stale ||
      !currentTranslation.task ||
      currentTranslation.task.taskId !== taskId
    ) {
      return { status: "blocked" };
    }
    if (typeof hostActions.pasteText !== "function") {
      return { status: "unavailable" };
    }
    try {
      return hostActions.pasteText(currentCopyCandidate.translation)
        ? { status: "pasted" }
        : { status: "unavailable" };
    } catch {
      return { status: "unavailable" };
    }
  }

  return Object.freeze({
    getTerminologyState,
    saveTermbase,
    deleteTermbase,
    saveDomainProfile,
    deleteDomainProfile,
    setCurrentDomainProfile,
    saveReferenceTranslation,
    deleteReferenceTranslation,
    previewTermbaseCsv,
    discardTermbaseCsvPreview,
    commitTermbaseCsv,
    exportTermbaseCsv,
    getServiceConfiguration,
    getServiceConfigurations,
    saveServiceConfiguration,
    duplicateServiceConfiguration,
    moveServiceConfiguration,
    setCurrentServiceConfiguration,
    deleteServiceConfiguration,
    saveServiceApiKey,
    deleteServiceApiKey,
    clearServicePerformanceData,
    setServiceThinkingMode,
    getParallelAccelerationAdvice,
    getTranslationCallPlan,
    testServiceConnection,
    fetchServiceModels,
    cancelServiceOperation,
    saveApiKey,
    startTranslation,
    startStandardTranslation,
    cancelTranslation,
    copyTranslation,
    pasteTranslation,
    getCurrentTranslation,
    updateCurrentTranslationInputs,
    subscribeCurrentTranslation,
    clearCurrentTranslation,
  });
}

module.exports = {
  createRuyiRuntime,
};
