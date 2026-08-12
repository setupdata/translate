const SETTINGS_KEY = "ruyi.settings.v1";
const API_KEY_PREFIX = "ruyi.secret.api-key.";
const TERMINOLOGY_KEY = "ruyi.secret.terminology.v1";
const { randomBytes } = require("crypto");
const { inspectSourceText } = require("./text-limits.cjs");
const {
  extractProtectedItems,
  inspectTranslationQuality,
} = require("./quality-checks.cjs");
const {
  createTranslationProtocolOperation,
} = require("./translation-protocol.cjs");
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

const CONNECTION_TEST_SOURCE_TEXT = "Connection test";
const CONNECTION_TEST_MAX_RESPONSE_BYTES = 1024 * 1024;
const CONNECTION_TEST_NO_DATA_TIMEOUT_MILLISECONDS = 30_000;
const CONNECTION_TEST_TOTAL_TIMEOUT_MILLISECONDS = 120_000;
const MODEL_LIST_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MODEL_LIST_TOTAL_TIMEOUT_MILLISECONDS = 30_000;

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
    qualityMode: "standard",
    additionalRequirements:
      inputs && typeof inputs.additionalRequirements === "string"
        ? inputs.additionalRequirements
        : "",
    taskTerms: normalizeTaskTerms(inputs && inputs.taskTerms),
  });
}

function inputsFingerprint(inputs) {
  return JSON.stringify([
    inputs.sourceText,
    inputs.targetLanguage,
    inputs.serviceConfigurationId,
    inputs.domainProfileId,
    inputs.qualityMode,
    inputs.additionalRequirements,
    inputs.taskTerms,
  ]);
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
                additionalRequirements: task.additionalRequirements,
                taskTerms: task.taskTerms,
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
    const inputs = normalizeCurrentInputs({
      sourceText: request.sourceText,
      targetLanguage,
      serviceConfigurationId:
        typeof request.serviceConfigurationId === "string"
          ? request.serviceConfigurationId
          : settings.currentServiceConfigurationId,
      domainProfileId:
        request.domainProfileId === null
          ? null
          : typeof request.domainProfileId === "string"
            ? request.domainProfileId
            : terminologyState.currentDomainProfileId,
      qualityMode: "standard",
      additionalRequirements:
        typeof request.additionalRequirements === "string"
          ? request.additionalRequirements
          : settings.defaults &&
              typeof settings.defaults.additionalRequirements === "string"
            ? settings.defaults.additionalRequirements
            : "",
      taskTerms: request.taskTerms,
    });
    const continuation =
      Boolean(request.confirmationToken) &&
      currentTranslation &&
      currentTranslation.task &&
      currentTranslation.task.taskId === request.taskId;
    if (!continuation) {
      cancelAllCurrentWork();
      currentCopyCandidate = null;
    }
    const task = continuation
      ? currentTranslation.task
      : freezeDeep({ taskId: request.taskId, ...inputs });
    publishCurrentTranslation({
      phase: "preparing",
      inputs,
      task,
      partialTranslation: continuation
        ? currentTranslation.partialTranslation
        : "",
      result: null,
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
      return existing;
    }
    return createInitialTerminologyState();
  }

  function writeTerminologyState(state) {
    try {
      cryptoStorage.setItem(TERMINOLOGY_KEY, state);
    } catch {
      throw Object.assign(
        new Error("uTools 加密存储不可用，术语库和行业配置未保存。"),
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
    if (state.currentDomainProfileId === domainProfileId) {
      state.currentDomainProfileId = null;
    }
    writeTerminologyState(state);
    pendingConfirmations.clear();
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
    if (currentTranslation) {
      updateCurrentTranslationInputs({
        ...currentTranslation.inputs,
        domainProfileId,
      });
    }
    return terminologyStateView(state);
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
    const input = {
      schemaVersion: "translation-input.v1",
      taskId: request.taskId,
      targetLanguage,
      domainProfile,
      matchedTerms: terminologyResolution.matchedTerms,
      referenceTranslations: [],
      additionalRequirements: submittedInputs.additionalRequirements,
      protectedItems: extractProtectedItems(request.sourceText),
      qualityMode: "standard",
      mode: "full_document",
      analysis: null,
      sourceText: request.sourceText,
    };
    validateTranslationInputBudget({ input });
    return { input, terminologyResolution };
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
      ["preparing", "awaiting_confirmation", "translating"].includes(
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
    delete copy.confirmedTranslationUrl;
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

  async function startStandardTranslation(request, onProgress = () => undefined) {
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
    const { input, terminologyResolution } = terminologyPreparation;

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
              "参考译例",
              "附加翻译要求",
            ],
            callCount: 1,
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
    let protocolOperation;
    try {
      protocolOperation = createTranslationProtocolOperation({
        configuration,
        input,
        onTextDelta(delta) {
          if (activeTask !== task || controller.signal.aborted) {
            return;
          }
          emitProgress({ type: "text_delta", taskId: request.taskId, delta });
          const currentPartial =
            currentTranslation && currentTranslation.task.taskId === request.taskId
              ? currentTranslation.partialTranslation
              : "";
          updateCurrentTask(request.taskId, {
            phase: "translating",
            partialTranslation: currentPartial + delta,
          });
        },
      });
      validateTranslationInputBudget({
        input,
        serializedBody: protocolOperation.body,
      });
    } catch (error) {
      if (activeTask === task) {
        activeTask = null;
      }
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
    emitProgress({ type: "started", taskId: request.taskId });
    updateCurrentTask(request.taskId, { phase: "translating" });

    try {
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
        body: protocolOperation.body,
        signal: controller.signal,
        onData(chunk) {
          if (activeTask !== task || controller.signal.aborted) {
            return;
          }
          sawData = true;
          protocolOperation.push(chunk);
        },
      });

      if (activeTask !== task || controller.signal.aborted) {
        throw Object.assign(new Error("请求已取消。"), { code: "cancelled" });
      }

      if (response.status !== 200) {
        const code = mapHttpError(response.status);
        const requestId = response.headers && response.headers["x-request-id"];
        emitProgress({
          type: "finished",
          taskId: request.taskId,
          status: "failed",
        });
        const result = {
          status: "failed",
          taskId: request.taskId,
          sourceRetained: true,
          error: {
            code,
            message: errorMessage(code),
            httpStatus: response.status,
            ...(typeof requestId === "string" ? { requestId } : {}),
          },
        };
        storeCurrentResult(request.taskId, result, "failed");
        return result;
      }

      const translation = protocolOperation.finish(response.body, sawData);
      const quality = inspectTranslationQuality({
        sourceText: request.sourceText,
        translation,
        streamCompleted: true,
      });
      const terminologyRisks = inspectTerminologyQuality({
        translation,
        matchedTerms: terminologyResolution.qualityTerms,
      });
      const terminologyPasteBlocked = terminologyRisks.some(
        (risk) => risk.certainty === "deterministic" && risk.severity === "critical",
      );
      const combinedQuality = freezeDeep({
        risks: [...quality.risks, ...terminologyRisks],
        pasteBlocked: quality.pasteBlocked || terminologyPasteBlocked,
      });
      currentCopyCandidate = {
        taskId: request.taskId,
        sourceText: request.sourceText,
        translation,
        pasteBlocked: combinedQuality.pasteBlocked,
      };
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
      });
      storeCurrentResult(
        request.taskId,
        result,
        "completed",
        translation,
      );
      return result;
    } catch (error) {
      const code =
        activeTask !== task || controller.signal.aborted
          ? "cancelled"
          : mapTransportError(error);
      const partialTranslation =
        error && typeof error.partialTranslation === "string"
          ? error.partialTranslation
          : protocolOperation.partialTranslation();
      const quality =
        configuration.stream
          ? inspectTranslationQuality({
              sourceText: request.sourceText,
              translation: partialTranslation || "",
              streamCompleted: false,
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
        error: {
          code,
          message: safeTransportErrorMessage(error, code),
        },
      });
      storeCurrentResult(
        request.taskId,
        result,
        "failed",
        partialTranslation || "",
      );
      return result;
    } finally {
      if (activeTask === task) {
        activeTask = null;
      }
    }
  }

  function cancelTranslation(taskId) {
    let cancelledPendingConfirmation = false;
    for (const [token, pending] of pendingConfirmations) {
      if (pending.taskId === taskId) {
        pendingConfirmations.delete(token);
        cancelledPendingConfirmation = true;
      }
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
    getServiceConfiguration,
    getServiceConfigurations,
    saveServiceConfiguration,
    duplicateServiceConfiguration,
    moveServiceConfiguration,
    setCurrentServiceConfiguration,
    deleteServiceConfiguration,
    saveServiceApiKey,
    deleteServiceApiKey,
    testServiceConnection,
    fetchServiceModels,
    cancelServiceOperation,
    saveApiKey,
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
