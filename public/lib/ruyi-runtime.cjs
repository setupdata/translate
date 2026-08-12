const SETTINGS_KEY = "ruyi.settings.v1";
const API_KEY_PREFIX = "ruyi.secret.api-key.";
const { randomBytes } = require("crypto");
const { TRANSLATION_SYSTEM_PROMPT } = require("./prompts.cjs");

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

function parseChatCompletionsStream(body) {
  let translation = "";
  let completed = false;

  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith(":")) {
      continue;
    }
    if (!line.startsWith("data:")) {
      throw new Error("流式响应包含无法识别的内容。");
    }

    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      completed = true;
      continue;
    }

    const event = JSON.parse(data);
    if (!Array.isArray(event.choices)) {
      throw new Error("流式响应缺少 choices。");
    }
    for (const choice of event.choices) {
      const content = choice && choice.delta && choice.delta.content;
      if (content === null || content === undefined) {
        continue;
      }
      if (typeof content !== "string") {
        throw new Error("流式响应包含非文本内容。");
      }
      translation += content;
    }
  }

  if (!completed) {
    throw new Error("流式响应没有完成标记。");
  }
  return translation;
}

function createRuyiRuntime({
  plainStorage,
  cryptoStorage,
  transport,
  servicePreset = DEEPSEEK_FLASH_PRESET,
  tokenFactory = () => randomBytes(24).toString("hex"),
}) {
  const pendingConfirmations = new Map();

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

  async function startStandardTranslation(request) {
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

    const targetLanguage = normalizeTargetLanguage(request.targetLanguage);
    if (!targetLanguage) {
      return {
        status: "validation_error",
        reason: "invalid_target_language",
        sourceRetained: true,
      };
    }

    const state = await getServiceConfiguration();

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
    const normalizedTranslationUrl = new URL(
      configuration.translationUrl,
    ).toString();

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
    const response = await transport.request({
      url: normalizedTranslationUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });

    if (response.status !== 200) {
      return {
        status: "failed",
        taskId: request.taskId,
        sourceRetained: true,
        error: { code: "request_rejected", message: "模型服务拒绝了请求。" },
      };
    }

    return {
      status: "completed",
      taskId: request.taskId,
      translation: parseChatCompletionsStream(response.body),
    };
  }

  function cancelTranslation(taskId) {
    for (const [token, pending] of pendingConfirmations) {
      if (pending.taskId === taskId) {
        pendingConfirmations.delete(token);
      }
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
