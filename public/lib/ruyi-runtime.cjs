const SETTINGS_KEY = "ruyi.settings.v1";
const API_KEY_PREFIX = "ruyi.secret.api-key.";
const { randomBytes } = require("crypto");
const { createChatSseParser } = require("./chat-sse-parser.cjs");
const { TRANSLATION_SYSTEM_PROMPT } = require("./prompts.cjs");
const { inspectSourceText } = require("./text-limits.cjs");

const DEEPSEEK_FLASH_PRESET = Object.freeze({
  id: "deepseek-flash",
  name: "DeepSeek Flash",
  type: "deepseek-official",
  protocol: "chat-completions",
  translationUrl: "https://api.deepseek.com/chat/completions",
  modelListUrl: "https://api.deepseek.com/models",
  authentication: "bearer",
  model: "deepseek-v4-flash",
  stream: true,
});

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
  return {
    version: 1,
    currentServiceConfigurationId: servicePreset.id,
    serviceConfigurations: [{ ...servicePreset }],
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
) {
  return (
    pending &&
    pending.taskId === request.taskId &&
    pending.sourceText === request.sourceText &&
    JSON.stringify(pending.targetLanguage) === JSON.stringify(targetLanguage) &&
    pending.configurationId === configuration.id &&
    pending.normalizedTranslationUrl === normalizedUrl
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

function createRuyiRuntime({
  plainStorage,
  cryptoStorage,
  transport,
  servicePreset = DEEPSEEK_FLASH_PRESET,
  tokenFactory = () => randomBytes(24).toString("hex"),
}) {
  const pendingConfirmations = new Map();
  const preparingTaskIds = new Set();
  const cancelledPreparingTaskIds = new Set();
  let activeTask = null;

  function readSettings() {
    const existing = plainStorage.getItem(SETTINGS_KEY);
    if (existing && existing.version === 1) {
      return existing;
    }

    const initial = createInitialSettings(servicePreset);
    plainStorage.setItem(SETTINGS_KEY, initial);
    return initial;
  }

  async function getServiceConfiguration() {
    const settings = readSettings();
    const configurations = Array.isArray(settings.serviceConfigurations)
      ? settings.serviceConfigurations
      : [];
    const configuration = configurations.find(
      (candidate) => candidate.id === settings.currentServiceConfigurationId,
    );

    if (!configuration) {
      return {
        serviceConfiguration: null,
        defaults: {
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
        },
      };
    }

    const apiKey = cryptoStorage.getItem(`${API_KEY_PREFIX}${configuration.id}`);
    const hasApiKey = typeof apiKey === "string" && apiKey.length > 0;

    return {
      serviceConfiguration: {
        id: configuration.id,
        name: configuration.name,
        type: configuration.type,
        protocol: configuration.protocol,
        translationUrl: configuration.translationUrl,
        modelListUrl: configuration.modelListUrl,
        authentication: configuration.authentication,
        model: configuration.model,
        stream: configuration.stream,
        hasApiKey,
        maskedApiKey: hasApiKey ? `••••••••${apiKey.slice(-4)}` : null,
      },
      defaults: {
        targetLanguage: { ...settings.defaults.targetLanguage },
        qualityMode: settings.defaults.qualityMode,
        additionalRequirements: settings.defaults.additionalRequirements,
      },
    };
  }

  async function saveApiKey(credentialForm) {
    const apiKeyInput =
      credentialForm &&
      credentialForm.elements &&
      typeof credentialForm.elements.namedItem === "function"
        ? credentialForm.elements.namedItem("apiKey")
        : null;
    const apiKey = apiKeyInput && apiKeyInput.value;
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      throw new Error("API Key 不能为空。");
    }

    const settings = readSettings();
    const configurations = Array.isArray(settings.serviceConfigurations)
      ? settings.serviceConfigurations
      : [];
    const configuration = configurations.find(
      (candidate) => candidate.id === settings.currentServiceConfigurationId,
    );
    if (!configuration) {
      throw new Error("没有可保存密钥的服务配置。");
    }
    cryptoStorage.setItem(
      `${API_KEY_PREFIX}${configuration.id}`,
      apiKey.trim(),
    );
    return getServiceConfiguration();
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

    preparingTaskIds.add(request.taskId);
    let state;
    try {
      state = await getServiceConfiguration();
    } finally {
      preparingTaskIds.delete(request.taskId);
    }

    if (cancelledPreparingTaskIds.delete(request.taskId)) {
      return {
        status: "failed",
        taskId: request.taskId,
        sourceRetained: true,
        error: { code: "cancelled", message: errorMessage("cancelled") },
      };
    }

    if (!state.serviceConfiguration) {
      return {
        status: "configuration_required",
        reason: "missing_configuration",
        sourceRetained: true,
        serviceConfiguration: null,
      };
    }

    if (!state.serviceConfiguration.hasApiKey) {
      return {
        status: "configuration_required",
        reason: "missing_api_key",
        sourceRetained: true,
        serviceConfiguration: state.serviceConfiguration,
      };
    }

    const settings = readSettings();
    const configuration = settings.serviceConfigurations.find(
      (candidate) => candidate.id === settings.currentServiceConfigurationId,
    );
    let normalizedTranslationUrl;
    try {
      const parsedTranslationUrl = new URL(configuration.translationUrl);
      const apiKey = cryptoStorage.getItem(`${API_KEY_PREFIX}${configuration.id}`);
      const urlContainsApiKey =
        typeof apiKey === "string" &&
        apiKey.length > 0 &&
        (parsedTranslationUrl.username === apiKey ||
          parsedTranslationUrl.password === apiKey ||
          [...parsedTranslationUrl.searchParams.values()].some(
            (value) => value === apiKey,
          ));
      if (
        parsedTranslationUrl.username ||
        parsedTranslationUrl.password ||
        urlContainsApiKey
      ) {
        throw new Error("服务地址包含凭据。");
      }
      normalizedTranslationUrl = parsedTranslationUrl.toString();
    } catch {
      return {
        status: "failed",
        taskId: request.taskId,
        sourceRetained: true,
        error: {
          code: "configuration_error",
          message: errorMessage("configuration_error"),
        },
      };
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
          )
        ) {
          return {
            status: "validation_error",
            reason: "invalid_confirmation",
            sourceRetained: true,
          };
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
        });

        return {
          status: "confirmation_required",
          sourceRetained: true,
          confirmationToken,
          preview: {
            serviceName: configuration.name,
            normalizedTranslationUrl,
            protocol: "Chat Completions",
            model: configuration.model,
            dataSent: [
              "源文本",
              "目标语言",
              "命中的术语",
              "参考译例",
              "附加翻译要求",
            ],
            callCount: 1,
          },
        };
      }
    }

    const apiKey = cryptoStorage.getItem(`${API_KEY_PREFIX}${configuration.id}`);
    const input = {
      schemaVersion: "translation-input.v1",
      taskId: request.taskId,
      targetLanguage,
      domainProfile: null,
      matchedTerms: [],
      referenceTranslations: [],
      additionalRequirements: settings.defaults.additionalRequirements,
      protectedItems: [],
      qualityMode: "standard",
      mode: "full_document",
      analysis: null,
      sourceText: request.sourceText,
    };
    const body = JSON.stringify({
      model: configuration.model,
      messages: [
        { role: "system", content: TRANSLATION_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(input) },
      ],
      stream: configuration.stream,
      thinking: { type: "disabled" },
    });
    if (activeTask) {
      activeTask.controller.abort();
    }
    const controller = new AbortController();
    const task = { taskId: request.taskId, controller };
    activeTask = task;
    function emitProgress(event) {
      try {
        onProgress(event);
      } catch {
        // Progress observers are presentation concerns and must not break a request.
      }
    }
    const parser = createChatSseParser({
      onTextDelta(delta) {
        if (activeTask !== task || controller.signal.aborted) {
          return;
        }
        emitProgress({ type: "text_delta", taskId: request.taskId, delta });
      },
    });
    emitProgress({ type: "started", taskId: request.taskId });

    try {
      let sawData = false;
      const response = await transport.request({
        url: normalizedTranslationUrl,
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${apiKey}`,
        },
        body,
        signal: controller.signal,
        onData(chunk) {
          if (activeTask !== task || controller.signal.aborted) {
            return;
          }
          sawData = true;
          parser.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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
        return {
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
      }

      if (!sawData && response.body) {
        parser.push(Buffer.from(response.body));
      }
      parser.end();
      const translation = parser.translation();
      emitProgress({
        type: "finished",
        taskId: request.taskId,
        status: "completed",
      });
      return { status: "completed", taskId: request.taskId, translation };
    } catch (error) {
      const code =
        activeTask !== task || controller.signal.aborted
          ? "cancelled"
          : mapTransportError(error);
      const partialTranslation =
        error && typeof error.partialTranslation === "string"
          ? error.partialTranslation
          : parser.translation();
      emitProgress({
        type: "finished",
        taskId: request.taskId,
        status: code === "cancelled" ? "cancelled" : "failed",
      });
      return {
        status: "failed",
        taskId: request.taskId,
        sourceRetained: true,
        ...(partialTranslation ? { partialTranslation } : {}),
        error: {
          code,
          message:
            error && typeof error.safeMessage === "string"
              ? error.safeMessage
              : errorMessage(code),
        },
      };
    } finally {
      if (activeTask === task) {
        activeTask = null;
      }
    }
  }

  function cancelTranslation(taskId) {
    for (const [token, pending] of pendingConfirmations) {
      if (pending.taskId === taskId) {
        pendingConfirmations.delete(token);
      }
    }
    if (preparingTaskIds.has(taskId)) {
      cancelledPreparingTaskIds.add(taskId);
    }
    if (activeTask && activeTask.taskId === taskId) {
      activeTask.controller.abort();
    }
  }

  return Object.freeze({
    getServiceConfiguration,
    saveApiKey,
    startStandardTranslation,
    cancelTranslation,
  });
}

module.exports = {
  createRuyiRuntime,
};
