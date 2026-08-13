const {
  DEEPSEEK_FLASH_PRESET,
  validateServiceConfiguration,
} = require("./service-configurations.cjs");
const {
  validateDomainProfile,
  validateTermbase,
} = require("./terminology.cjs");
const { validateReferenceTranslation } = require("./reference-translations.cjs");

const SETTINGS_VERSION = 2;
const TERMINOLOGY_VERSION = 2;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;
const UNSAFE_TEXT_CONTROL_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;
const CONFIGURATION_KEYS = new Set([
  "id",
  "name",
  "type",
  "protocol",
  "translationUrl",
  "modelListUrl",
  "authentication",
  "model",
  "stream",
  "cachedModels",
  "modelsFetchedAt",
  "performanceSamples",
  "thinkingEnabled",
  "confirmedTranslationUrl",
  "confirmedPrecisionTranslationUrl",
]);
const PERFORMANCE_SAMPLE_KEYS = new Set([
  "firstOutputMilliseconds",
  "completionMilliseconds",
  "outputCodePoints",
  "averageOutputCodePointsPerSecond",
  "mode",
  "segmentCount",
]);
const PERFORMANCE_MODES = new Set([
  "standard",
  "full_document",
  "parallel",
  "precision",
  "precision_parallel",
]);
const SETTINGS_KEYS = new Set([
  "version",
  "currentServiceConfigurationId",
  "serviceConfigurations",
  "defaults",
  "apiKeyConfigurationIds",
]);

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function codePointLength(value) {
  return Array.from(value).length;
}

function cloneInitialSettings(initialSettings) {
  return {
    ...initialSettings,
    version: SETTINGS_VERSION,
    serviceConfigurations: Array.isArray(initialSettings.serviceConfigurations)
      ? initialSettings.serviceConfigurations.map((configuration) => ({
          ...configuration,
          cachedModels: Array.isArray(configuration.cachedModels)
            ? [...configuration.cachedModels]
            : [],
          performanceSamples: Array.isArray(configuration.performanceSamples)
            ? configuration.performanceSamples.map((sample) => ({ ...sample }))
            : [],
        }))
      : [],
    defaults: {
      ...(initialSettings.defaults || {}),
      targetLanguage: {
        ...(initialSettings.defaults && initialSettings.defaults.targetLanguage
          ? initialSettings.defaults.targetLanguage
          : {}),
      },
    },
    apiKeyConfigurationIds: Array.isArray(initialSettings.apiKeyConfigurationIds)
      ? [...initialSettings.apiKeyConfigurationIds]
      : [],
  };
}

function storageIssue(code, message) {
  return Object.freeze({ code, message });
}

function validDisplayString(value, maximum) {
  return (
    typeof value === "string" &&
    codePointLength(value.trim()) >= 1 &&
    codePointLength(value.trim()) <= maximum &&
    !CONTROL_CHARACTER.test(value)
  );
}

function hasOnlyKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.has(key));
}

function validIdentifier(value) {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function validPerformanceSample(sample) {
  return (
    hasOnlyKeys(sample, PERFORMANCE_SAMPLE_KEYS) &&
    Number.isFinite(sample.firstOutputMilliseconds) &&
    sample.firstOutputMilliseconds >= 0 &&
    Number.isFinite(sample.completionMilliseconds) &&
    sample.completionMilliseconds > 0 &&
    Number.isFinite(sample.outputCodePoints) &&
    sample.outputCodePoints >= 0 &&
    Number.isFinite(sample.averageOutputCodePointsPerSecond) &&
    sample.averageOutputCodePointsPerSecond >= 0 &&
    PERFORMANCE_MODES.has(sample.mode) &&
    Number.isInteger(sample.segmentCount) &&
    sample.segmentCount >= 1 &&
    sample.segmentCount <= 10_000
  );
}

function validConfigurationMetadata(candidate, legacy) {
  if (!hasOnlyKeys(candidate, CONFIGURATION_KEYS) || !validIdentifier(candidate.id)) {
    return false;
  }
  if (
    !validDisplayString(candidate.name, 50) ||
    candidate.name !== candidate.name.trim() ||
    !validDisplayString(candidate.model, 200) ||
    candidate.model !== candidate.model.trim() ||
    typeof candidate.stream !== "boolean"
  ) {
    return false;
  }
  if (
    !Array.isArray(candidate.cachedModels) ||
    candidate.cachedModels.length > 5_000 ||
    !candidate.cachedModels.every(
      (model) => validDisplayString(model, 200) && model === model.trim(),
    )
  ) {
    return false;
  }
  if (
    candidate.modelsFetchedAt !== null &&
    !(
      typeof candidate.modelsFetchedAt === "string" &&
      candidate.modelsFetchedAt.length <= 100 &&
      !CONTROL_CHARACTER.test(candidate.modelsFetchedAt) &&
      Number.isFinite(Date.parse(candidate.modelsFetchedAt))
    )
  ) {
    return false;
  }
  if (
    !Array.isArray(candidate.performanceSamples) ||
    candidate.performanceSamples.length > 10 ||
    !candidate.performanceSamples.every(validPerformanceSample)
  ) {
    return false;
  }
  if (
    candidate.thinkingEnabled !== undefined &&
    typeof candidate.thinkingEnabled !== "boolean"
  ) {
    return false;
  }
  if (!legacy && typeof candidate.thinkingEnabled !== "boolean") return false;
  for (const field of ["confirmedTranslationUrl", "confirmedPrecisionTranslationUrl"]) {
    if (
      candidate[field] !== undefined &&
      candidate[field] !== null &&
      (typeof candidate[field] !== "string" || candidate[field] !== candidate.translationUrl)
    ) {
      return false;
    }
  }
  return true;
}

function uniqueProjectedId(candidate, index, usedIds) {
  const requested =
    candidate && typeof candidate.id === "string" && candidate.id.length > 0
      ? candidate.id
      : `migration-disabled-${index + 1}`;
  let id = requested;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${requested}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function disabledConfigurationProjection(
  candidate,
  index,
  usedIds,
  message,
  repairable = false,
) {
  const source = isRecord(candidate) ? candidate : {};
  const id = uniqueProjectedId(source, index, usedIds);
  const official = source.type === "deepseek-official";
  return {
    id,
    name: validDisplayString(source.name, 50)
      ? source.name.trim()
      : `需要重新编辑的服务配置 ${index + 1}`,
    type: official ? "deepseek-official" : "custom",
    protocol:
      official || (source.protocol !== "responses" && source.protocol !== "chat-completions")
        ? "chat-completions"
        : source.protocol,
    translationUrl: official ? DEEPSEEK_FLASH_PRESET.translationUrl : "",
    modelListUrl: official ? DEEPSEEK_FLASH_PRESET.modelListUrl : "",
    authentication:
      official || (source.authentication !== "none" && source.authentication !== "bearer")
        ? "bearer"
        : source.authentication,
    model: validDisplayString(source.model, 200) ? source.model.trim() : "",
    stream: Boolean(source.stream),
    cachedModels: [],
    modelsFetchedAt: null,
    performanceSamples: [],
    thinkingEnabled: false,
    disabled: true,
    migrationError: message,
    repairable,
  };
}

function normalizeDefaults(rawDefaults, initialDefaults, legacy) {
  const allowedDefaultKeys = new Set([
    "targetLanguage",
    "qualityMode",
    "additionalRequirements",
    "backgroundNotificationsEnabled",
  ]);
  const allowedLanguageKeys = new Set(["kind", "id", "displayName", "modelLabel"]);
  if (!hasOnlyKeys(rawDefaults, allowedDefaultKeys)) {
    return { valid: false, value: { ...initialDefaults, targetLanguage: { ...initialDefaults.targetLanguage } } };
  }
  const targetLanguage = rawDefaults.targetLanguage;
  const targetValid =
    hasOnlyKeys(targetLanguage, allowedLanguageKeys) &&
    targetLanguage.kind === "preset" &&
    validDisplayString(targetLanguage.id, 50) &&
    targetLanguage.id === targetLanguage.id.trim() &&
    validDisplayString(targetLanguage.displayName, 50) &&
    targetLanguage.displayName === targetLanguage.displayName.trim() &&
    validDisplayString(targetLanguage.modelLabel, 50) &&
    targetLanguage.modelLabel === targetLanguage.modelLabel.trim();
  const qualityValid =
    rawDefaults.qualityMode === "standard" || rawDefaults.qualityMode === "precision";
  const requirementsValid =
    typeof rawDefaults.additionalRequirements === "string" &&
    codePointLength(rawDefaults.additionalRequirements) <= 2_000 &&
    !UNSAFE_TEXT_CONTROL_CHARACTER.test(rawDefaults.additionalRequirements);
  const notificationsValid =
    rawDefaults.backgroundNotificationsEnabled === undefined
      ? legacy
      : typeof rawDefaults.backgroundNotificationsEnabled === "boolean";
  if (!targetValid || !qualityValid || !requirementsValid || !notificationsValid) {
    return { valid: false, value: { ...initialDefaults, targetLanguage: { ...initialDefaults.targetLanguage } } };
  }
  return {
    valid: true,
    value: {
      targetLanguage: {
        kind: "preset",
        id: targetLanguage.id,
        displayName: targetLanguage.displayName,
        modelLabel: targetLanguage.modelLabel,
      },
      qualityMode: rawDefaults.qualityMode,
      additionalRequirements: rawDefaults.additionalRequirements,
      backgroundNotificationsEnabled:
        rawDefaults.backgroundNotificationsEnabled !== false,
    },
  };
}

function validateConfigurationCandidate(candidate, configurations, initialSettings, legacy) {
  if (!validConfigurationMetadata(candidate, legacy)) {
    throw new Error("服务配置的持久化字段无效。");
  }
  const initialConfiguration = Array.isArray(initialSettings.serviceConfigurations)
    ? initialSettings.serviceConfigurations.find(
        (configuration) => configuration.id === candidate.id,
      )
    : null;
  const matchesInjectedOfficialPreset =
    candidate.type === "deepseek-official" &&
    initialConfiguration &&
    initialConfiguration.type === "deepseek-official" &&
    candidate.protocol === initialConfiguration.protocol &&
    candidate.translationUrl === initialConfiguration.translationUrl &&
    candidate.modelListUrl === initialConfiguration.modelListUrl &&
    candidate.authentication === initialConfiguration.authentication;
  let normalized;
  if (!matchesInjectedOfficialPreset) {
    normalized = validateServiceConfiguration(candidate, {
      existing: candidate,
      configurations,
      apiKey: null,
    });
  } else {
    const customCandidate = { ...candidate, type: "custom" };
    normalized = {
      ...validateServiceConfiguration(customCandidate, {
        existing: customCandidate,
        configurations,
        apiKey: null,
      }),
      type: "deepseek-official",
      thinkingEnabled: Boolean(candidate.thinkingEnabled),
    };
  }
  for (const field of ["id", "name", "model", "translationUrl", "modelListUrl"]) {
    if (normalized[field] !== candidate[field]) {
      throw new Error("服务配置包含未规范化的持久化字段。");
    }
  }
  return normalized;
}

function projectUnsupportedSettings(existing, initialSettings, code) {
  const initial = cloneInitialSettings(initialSettings);
  const rawConfigurations =
    isRecord(existing) && Array.isArray(existing.serviceConfigurations)
      ? existing.serviceConfigurations
      : [];
  const usedIds = new Set();
  const message =
    code === "unsupported_version"
      ? "设置数据版本较新，当前版本无法安全读取。原数据未被覆盖；相关配置已停用，请更新插件或恢复所有设置。"
      : "设置数据损坏，当前版本无法安全读取。原数据未被覆盖；相关配置已停用，请恢复所有设置。";
  const sourceIndexes = new Map();
  const serviceConfigurations = rawConfigurations.map((configuration, index) => {
    const projected = disabledConfigurationProjection(configuration, index, usedIds, message);
    return projected;
  });
  const issue = storageIssue(code, message);
  return {
    blocked: true,
    shouldWrite: false,
    rawSettings: existing,
    sourceIndexes,
    state: {
      ...initial,
      currentServiceConfigurationId:
        isRecord(existing) &&
        typeof existing.currentServiceConfigurationId === "string" &&
        serviceConfigurations.some(
          (configuration) => configuration.id === existing.currentServiceConfigurationId,
        )
          ? existing.currentServiceConfigurationId
          : serviceConfigurations[0]?.id || null,
      serviceConfigurations,
      storageIssue: issue,
    },
  };
}

function registeredApiKeyIds(existing, legacy) {
  if (legacy || existing.apiKeyConfigurationIds === undefined) {
    return {
      valid: true,
      shouldWrite: !legacy,
      value: existing.serviceConfigurations
        .filter(isRecord)
        .map((configuration) => configuration.id)
        .filter(validIdentifier),
    };
  }
  if (
    !Array.isArray(existing.apiKeyConfigurationIds) ||
    !existing.apiKeyConfigurationIds.every(validIdentifier) ||
    new Set(existing.apiKeyConfigurationIds).size !== existing.apiKeyConfigurationIds.length
  ) {
    return { valid: false, shouldWrite: false, value: [] };
  }
  return { valid: true, shouldWrite: false, value: [...existing.apiKeyConfigurationIds] };
}

function globallyBlockedSettings(existing, initial, code, message, apiKeyConfigurationIds = []) {
  const usedIds = new Set();
  const configurations = existing.serviceConfigurations.map((configuration, index) =>
    disabledConfigurationProjection(configuration, index, usedIds, message),
  );
  const issue = storageIssue(code, message);
  return {
    blocked: true,
    shouldWrite: false,
    rawSettings: existing,
    sourceIndexes: new Map(),
    state: {
      ...initial,
      currentServiceConfigurationId: configurations[0]?.id || null,
      serviceConfigurations: configurations,
      apiKeyConfigurationIds: [...apiKeyConfigurationIds],
      storageIssue: issue,
    },
  };
}

function migrateSettingsPayload(existing, initialSettings) {
  const initial = cloneInitialSettings(initialSettings);
  if (existing === undefined || existing === null) {
    return {
      blocked: false,
      shouldWrite: true,
      sourceIndexes: new Map(),
      state: initial,
    };
  }
  if (!isRecord(existing)) {
    return projectUnsupportedSettings(existing, initial, "data_corrupted");
  }
  if (existing.version !== 1 && existing.version !== SETTINGS_VERSION) {
    return projectUnsupportedSettings(existing, initial, "unsupported_version");
  }
  if (!hasOnlyKeys(existing, SETTINGS_KEYS)) {
    return projectUnsupportedSettings(existing, initial, "data_corrupted");
  }
  if (!Array.isArray(existing.serviceConfigurations)) {
    return projectUnsupportedSettings(existing, initial, "data_corrupted");
  }

  const legacy = existing.version === 1;
  const defaults = normalizeDefaults(existing.defaults, initial.defaults, legacy);
  const apiKeyIds = registeredApiKeyIds(existing, legacy);
  if (!defaults.valid || !apiKeyIds.valid) {
    return globallyBlockedSettings(
      existing,
      initial,
      "migration_failed",
      "默认设置或加密值引用无法安全迁移，原数据未被覆盖；相关配置已停用，请恢复所有设置。",
      apiKeyIds.value,
    );
  }
  const usedIds = new Set();
  const sourceIndexes = new Map();
  const normalizedConfigurations = [];
  let migrationFailed = false;
  const migrationMessage =
    "配置数据无法安全迁移，原数据未被覆盖；该配置已停用，请重新编辑。";

  for (const [index, candidate] of existing.serviceConfigurations.entries()) {
    try {
      if (!isRecord(candidate)) throw new Error("服务配置不是对象。");
      if (typeof candidate.id !== "string" || candidate.id.length === 0) {
        throw new Error("服务配置 ID 无效。");
      }
      if (usedIds.has(candidate.id)) throw new Error("服务配置 ID 重复。");
      const normalized = validateConfigurationCandidate(
        candidate,
        existing.serviceConfigurations.filter(isRecord),
        initial,
        legacy,
      );
      usedIds.add(normalized.id);
      normalizedConfigurations.push(normalized);
    } catch {
      migrationFailed = true;
      const projected = disabledConfigurationProjection(
        candidate,
        index,
        usedIds,
        migrationMessage,
        true,
      );
      sourceIndexes.set(projected.id, index);
      normalizedConfigurations.push(projected);
    }
  }

  const currentId =
    existing.currentServiceConfigurationId === null ||
    typeof existing.currentServiceConfigurationId === "string"
      ? existing.currentServiceConfigurationId
      : null;
  const currentIdValid =
    (normalizedConfigurations.length === 0 && currentId === null) ||
    (typeof currentId === "string" &&
      normalizedConfigurations.some((configuration) => configuration.id === currentId));
  if (!currentIdValid) {
    return globallyBlockedSettings(
      existing,
      initial,
      "migration_failed",
      "当前服务配置引用损坏，原数据未被覆盖；相关配置已停用，请恢复所有设置。",
      apiKeyIds.value,
    );
  }
  const state = {
    version: SETTINGS_VERSION,
    currentServiceConfigurationId: currentId,
    serviceConfigurations: normalizedConfigurations,
    defaults: defaults.value,
    apiKeyConfigurationIds: apiKeyIds.value,
  };
  if (migrationFailed) {
    state.storageIssue = storageIssue(
      "migration_failed",
      "部分设置或服务配置无法安全迁移，原数据未被覆盖；已停用受影响配置，请重新编辑或恢复所有设置。",
    );
    return {
      blocked: true,
      shouldWrite: false,
      rawSettings: existing,
      sourceIndexes,
      state,
    };
  }
  return {
    blocked: false,
    shouldWrite: legacy || apiKeyIds.shouldWrite,
    sourceIndexes,
    state,
  };
}

function repairSettingsConfiguration(rawSettings, sourceIndex, normalizedConfiguration) {
  if (
    !isRecord(rawSettings) ||
    !Array.isArray(rawSettings.serviceConfigurations) ||
    !Number.isInteger(sourceIndex) ||
    sourceIndex < 0 ||
    sourceIndex >= rawSettings.serviceConfigurations.length
  ) {
    throw new Error("无法定位需要重新编辑的旧配置。");
  }
  const serviceConfigurations = [...rawSettings.serviceConfigurations];
  serviceConfigurations[sourceIndex] = { ...normalizedConfiguration };
  const registeredIds = Array.isArray(rawSettings.apiKeyConfigurationIds)
    ? rawSettings.apiKeyConfigurationIds.filter(validIdentifier)
    : serviceConfigurations.filter(isRecord).map((configuration) => configuration.id).filter(validIdentifier);
  if (!registeredIds.includes(normalizedConfiguration.id)) {
    registeredIds.push(normalizedConfiguration.id);
  }
  return {
    ...rawSettings,
    serviceConfigurations,
    ...(rawSettings.version === SETTINGS_VERSION
      ? { apiKeyConfigurationIds: registeredIds }
      : {}),
  };
}

const TERMINOLOGY_STATE_KEYS = new Set([
  "version",
  "termbases",
  "domainProfiles",
  "referenceTranslations",
  "currentDomainProfileId",
]);
const TERMBASE_KEYS = new Set(["id", "name", "enabled", "entries"]);
const TERM_ENTRY_KEYS = new Set([
  "id",
  "sourceTerm",
  "preferredTarget",
  "sourceLanguage",
  "targetLanguage",
  "allowedVariants",
  "forbiddenTargets",
  "meaning",
  "strictness",
  "caseSensitive",
  "aliases",
  "priority",
]);
const DOMAIN_PROFILE_KEYS = new Set([
  "id",
  "version",
  "name",
  "field",
  "documentType",
  "audience",
  "style",
  "termbaseIds",
  "preserveRules",
]);
const REFERENCE_TRANSLATION_KEYS = new Set([
  "id",
  "sourceLanguage",
  "targetLanguage",
  "domainProfileId",
  "source",
  "translation",
]);

function normalizedTerminologyState(value, legacy) {
  if (
    !hasOnlyKeys(value, TERMINOLOGY_STATE_KEYS) ||
    !Array.isArray(value.termbases) ||
    !Array.isArray(value.domainProfiles) ||
    (!legacy && !Array.isArray(value.referenceTranslations)) ||
    (value.referenceTranslations !== undefined && !Array.isArray(value.referenceTranslations))
  ) {
    throw new Error("术语数据结构无效。");
  }
  const normalizedTermbases = [];
  const termbaseIds = new Set();
  for (const termbase of value.termbases) {
    if (
      !hasOnlyKeys(termbase, TERMBASE_KEYS) ||
      !Array.isArray(termbase.entries) ||
      !termbase.entries.every(
        (entry) => hasOnlyKeys(entry, TERM_ENTRY_KEYS) && validIdentifier(entry.id),
      ) ||
      !validIdentifier(termbase.id) ||
      termbaseIds.has(termbase.id)
    ) {
      throw new Error("术语库数据无效。");
    }
    termbaseIds.add(termbase.id);
    normalizedTermbases.push(
      validateTermbase(termbase, {
        termbases: normalizedTermbases,
        idFactory: () => null,
        entryIdFactory: () => null,
      }),
    );
  }

  const normalizedProfiles = [];
  const profileIds = new Set();
  for (const profile of value.domainProfiles) {
    if (
      !hasOnlyKeys(profile, DOMAIN_PROFILE_KEYS) ||
      !validIdentifier(profile.id) ||
      !validDisplayString(profile.version, 100) ||
      profile.version !== profile.version.trim() ||
      profileIds.has(profile.id)
    ) {
      throw new Error("行业配置数据无效。");
    }
    profileIds.add(profile.id);
    normalizedProfiles.push(
      validateDomainProfile(profile, {
        domainProfiles: normalizedProfiles,
        termbases: normalizedTermbases,
        idFactory: () => null,
      }),
    );
  }

  const normalizedReferences = [];
  const referenceIds = new Set();
  for (const reference of value.referenceTranslations || []) {
    if (
      !hasOnlyKeys(reference, REFERENCE_TRANSLATION_KEYS) ||
      !validIdentifier(reference.id) ||
      referenceIds.has(reference.id)
    ) {
      throw new Error("参考译例数据无效。");
    }
    referenceIds.add(reference.id);
    normalizedReferences.push(
      validateReferenceTranslation(reference, {
        domainProfiles: normalizedProfiles,
        idFactory: () => null,
      }),
    );
  }

  const currentDomainProfileId =
    value.currentDomainProfileId === undefined ? null : value.currentDomainProfileId;
  if (
    currentDomainProfileId !== null &&
    (!validIdentifier(currentDomainProfileId) || !profileIds.has(currentDomainProfileId))
  ) {
    throw new Error("当前行业配置引用无效。");
  }
  return {
    version: TERMINOLOGY_VERSION,
    termbases: normalizedTermbases.map((termbase) => ({
      ...termbase,
      entries: termbase.entries.map((entry) => ({ ...entry })),
    })),
    domainProfiles: normalizedProfiles.map((profile) => ({
      ...profile,
      termbaseIds: [...profile.termbaseIds],
      preserveRules: [...profile.preserveRules],
    })),
    referenceTranslations: normalizedReferences.map((reference) => ({ ...reference })),
    currentDomainProfileId,
  };
}

function migrateTerminologyPayload(existing, initialState) {
  const initial = { ...initialState, version: TERMINOLOGY_VERSION };
  if (existing === undefined || existing === null) {
    return { blocked: false, shouldWrite: false, state: initial };
  }
  if (!isRecord(existing)) {
    return {
      blocked: true,
      shouldWrite: false,
      state: {
        ...initial,
        storageIssue: storageIssue(
          "data_corrupted",
          "术语库、行业配置或参考译例数据损坏，原加密数据未被覆盖。请恢复所有设置后重新建立。",
        ),
      },
    };
  }
  if (existing.version !== 1 && existing.version !== TERMINOLOGY_VERSION) {
    return {
      blocked: true,
      shouldWrite: false,
      state: {
        ...initial,
        storageIssue: storageIssue(
          "unsupported_version",
          "术语数据版本较新，当前版本无法安全读取，原加密数据未被覆盖。",
        ),
      },
    };
  }
  const legacy = existing.version === 1;
  let normalized;
  try {
    normalized = normalizedTerminologyState(existing, legacy);
  } catch {
    return {
      blocked: true,
      shouldWrite: false,
      state: {
        ...initial,
        storageIssue: storageIssue(
          "data_corrupted",
          "术语库、行业配置或参考译例数据损坏，原加密数据未被覆盖。请恢复所有设置后重新建立。",
        ),
      },
    };
  }
  return {
    blocked: false,
    shouldWrite: legacy,
    state: normalized,
  };
}

module.exports = {
  SETTINGS_VERSION,
  TERMINOLOGY_VERSION,
  migrateSettingsPayload,
  migrateTerminologyPayload,
  repairSettingsConfiguration,
};
