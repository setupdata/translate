const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const SECRET_QUERY_NAME = /(?:api[_-]?key|access[_-]?token|token|secret|authorization)/iu;
const ASCII_EDGE_WHITESPACE = /^[\u0009-\u000d\u0020]|[\u0009-\u000d\u0020]$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;

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
  cachedModels: [],
  modelsFetchedAt: null,
  performanceSamples: [],
});

function configurationError(field, message, code = "configuration_error") {
  const error = new Error(message);
  error.code = code;
  if (field) error.field = field;
  return error;
}

function codePointLength(value) {
  return Array.from(value).length;
}

function urlPartContainsApiKey(value, apiKey) {
  if (typeof apiKey !== "string" || apiKey.length === 0) return false;
  if (value.includes(apiKey) || value.includes(encodeURIComponent(apiKey))) return true;
  try {
    return decodeURIComponent(value).includes(apiKey);
  } catch {
    return false;
  }
}

function normalizeServiceUrl(rawValue, field, apiKey) {
  if (typeof rawValue !== "string" || rawValue.length === 0) {
    throw configurationError(field, "服务地址不能为空。");
  }
  if (codePointLength(rawValue) > 2_048) {
    throw configurationError(field, "服务地址不能超过 2,048 个 Unicode 码点。");
  }

  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw configurationError(field, "服务地址必须是完整的绝对 URL。");
  }
  if (parsed.username || parsed.password) {
    throw configurationError(field, "服务地址不能包含用户名或密码。");
  }
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname))
  ) {
    throw configurationError(
      field,
      "远程服务地址必须使用 HTTPS；HTTP 仅允许本机回环地址。",
    );
  }
  for (const [name, value] of parsed.searchParams) {
    if (
      SECRET_QUERY_NAME.test(name) ||
      (typeof apiKey === "string" && apiKey.length > 0 && value === apiKey)
    ) {
      throw configurationError(field, "服务地址不能包含 API Key 或其他密钥。");
    }
  }
  if (
    urlPartContainsApiKey(parsed.pathname, apiKey) ||
    urlPartContainsApiKey(parsed.hash, apiKey)
  ) {
    throw configurationError(field, "服务地址不能包含 API Key 或其他密钥。");
  }
  return parsed.toString();
}

function validateServiceConfiguration(
  input,
  { existing = null, configurations = [], apiKey = null, idFactory },
) {
  if (!input || typeof input !== "object") {
    throw configurationError(null, "服务配置无效。");
  }
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (codePointLength(name) < 1 || codePointLength(name) > 50) {
    throw configurationError("name", "配置名称必须为 1 至 50 个 Unicode 码点。");
  }
  const duplicateName = configurations.some(
    (candidate) =>
      candidate.id !== (existing && existing.id) &&
      String(candidate.name).localeCompare(name, undefined, { sensitivity: "accent" }) === 0,
  );
  if (duplicateName) {
    throw configurationError("name", "配置名称必须唯一。");
  }

  const type = input.type;
  if (type !== "deepseek-official" && type !== "custom") {
    throw configurationError("type", "服务类型无效。");
  }
  if (existing && existing.type === "deepseek-official" && type !== existing.type) {
    throw configurationError("type", "DeepSeek 官方配置不能改为自定义配置。");
  }
  const protocol = input.protocol;
  if (protocol !== "chat-completions" && protocol !== "responses") {
    throw configurationError("protocol", "服务协议无效。");
  }
  const authentication = input.authentication;
  if (authentication !== "bearer" && authentication !== "none") {
    throw configurationError("authentication", "鉴权方式无效。");
  }
  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (codePointLength(model) < 1 || codePointLength(model) > 200) {
    throw configurationError("model", "模型 ID 必须为 1 至 200 个 Unicode 码点。");
  }

  const translationUrl = normalizeServiceUrl(
    input.translationUrl,
    "translationUrl",
    apiKey,
  );
  const modelListUrl = normalizeServiceUrl(input.modelListUrl, "modelListUrl", apiKey);
  if (
    type === "deepseek-official" &&
    (protocol !== "chat-completions" ||
      authentication !== "bearer" ||
      translationUrl !== DEEPSEEK_FLASH_PRESET.translationUrl ||
      modelListUrl !== DEEPSEEK_FLASH_PRESET.modelListUrl)
  ) {
    throw configurationError(
      null,
      "DeepSeek 官方配置固定使用 Chat Completions 和官方服务地址。",
    );
  }

  const id = existing
    ? existing.id
    : typeof idFactory === "function"
      ? idFactory()
      : null;
  if (typeof id !== "string" || id.length === 0) {
    throw configurationError(null, "无法生成服务配置 ID。");
  }
  const modelListUnchanged = existing && existing.modelListUrl === modelListUrl;
  const translationUrlUnchanged = existing && existing.translationUrl === translationUrl;
  const performanceCompatible =
    translationUrlUnchanged &&
    existing.model === model &&
    existing.protocol === protocol &&
    Boolean(existing.stream) === Boolean(input.stream);
  return {
    id,
    name,
    type,
    protocol,
    translationUrl,
    modelListUrl,
    authentication,
    model,
    stream: Boolean(input.stream),
    cachedModels:
      modelListUnchanged && Array.isArray(existing.cachedModels)
        ? [...existing.cachedModels]
        : [],
    modelsFetchedAt:
      modelListUnchanged && typeof existing.modelsFetchedAt === "string"
        ? existing.modelsFetchedAt
        : null,
    performanceSamples:
      performanceCompatible && Array.isArray(existing.performanceSamples)
        ? existing.performanceSamples.map((sample) => ({ ...sample }))
        : [],
    ...(translationUrlUnchanged && existing.confirmedTranslationUrl
      ? { confirmedTranslationUrl: existing.confirmedTranslationUrl }
      : {}),
  };
}

function performanceSummary(configuration) {
  const samples = Array.isArray(configuration.performanceSamples)
    ? configuration.performanceSamples.filter(
        (sample) =>
          sample &&
          Number.isFinite(sample.firstOutputMilliseconds) &&
          sample.firstOutputMilliseconds >= 0 &&
          Number.isFinite(sample.completionMilliseconds) &&
          sample.completionMilliseconds > 0 &&
          Number.isFinite(sample.outputCodePoints) &&
          sample.outputCodePoints >= 0 &&
          Number.isFinite(sample.averageOutputCodePointsPerSecond) &&
          sample.averageOutputCodePointsPerSecond >= 0,
      )
    : [];
  if (samples.length === 0) return null;
  const average = (field) =>
    samples.reduce((total, sample) => total + sample[field], 0) / samples.length;
  return {
    sampleCount: samples.length,
    averageFirstOutputMilliseconds: Math.round(average("firstOutputMilliseconds")),
    averageCompletionMilliseconds: Math.round(average("completionMilliseconds")),
    averageOutputCodePointsPerSecond:
      Math.round(average("averageOutputCodePointsPerSecond") * 100) / 100,
  };
}

function serviceConfigurationView(configuration, apiKey) {
  const hasApiKey = typeof apiKey === "string" && apiKey.length > 0;
  return {
    id: configuration.id,
    name: configuration.name,
    type: configuration.type,
    protocol: configuration.protocol,
    translationUrl: configuration.translationUrl,
    modelListUrl: configuration.modelListUrl,
    authentication: configuration.authentication,
    model: configuration.model,
    stream: Boolean(configuration.stream),
    hasApiKey,
    maskedApiKey: hasApiKey ? `••••••••${apiKey.slice(-4)}` : null,
    cachedModels: Array.isArray(configuration.cachedModels)
      ? [...configuration.cachedModels]
      : [],
    modelsFetchedAt:
      typeof configuration.modelsFetchedAt === "string"
        ? configuration.modelsFetchedAt
        : null,
    performanceSummary: performanceSummary(configuration),
  };
}

function uniqueCopyName(sourceName, configurations) {
  const names = new Set(configurations.map((configuration) => configuration.name));
  const base = `${sourceName} 副本`;
  if (!names.has(base) && codePointLength(base) <= 50) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const suffix = ` 副本 ${index}`;
    const available = 50 - codePointLength(suffix);
    const candidate = `${Array.from(sourceName).slice(0, available).join("")}${suffix}`;
    if (!names.has(candidate)) return candidate;
  }
  throw configurationError("name", "无法生成唯一的配置名称。");
}

function parseModelIds(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    const error = configurationError(null, "模型列表响应不是有效 JSON。", "protocol_error");
    throw error;
  }
  if (!parsed || !Array.isArray(parsed.data)) {
    throw configurationError(null, "模型列表响应缺少 data 数组。", "protocol_error");
  }
  const models = [];
  const seen = new Set();
  let validCount = 0;
  for (const item of parsed.data) {
    const id = item && item.id;
    if (
      typeof id !== "string" ||
      codePointLength(id) < 1 ||
      codePointLength(id) > 200 ||
      ASCII_EDGE_WHITESPACE.test(id) ||
      CONTROL_CHARACTER.test(id)
    ) {
      continue;
    }
    validCount += 1;
    if (validCount > 5_000) {
      throw configurationError(
        null,
        "模型列表中的有效 ID 超过 5,000 项。",
        "response_too_large",
      );
    }
    if (!seen.has(id)) {
      seen.add(id);
      models.push(id);
    }
  }
  return models;
}

module.exports = {
  DEEPSEEK_FLASH_PRESET,
  configurationError,
  normalizeServiceUrl,
  parseModelIds,
  serviceConfigurationView,
  uniqueCopyName,
  validateServiceConfiguration,
};
