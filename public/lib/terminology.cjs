const HYPHEN = /[\u2010-\u2015\u2212\uFE63\uFF0D]/gu;
const WORD_CHARACTER = /^[\p{L}\p{N}_]$/u;
const CJK_CHARACTER = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;
const ORIGIN_RANK = Object.freeze({ task: 0, domain: 1, general: 2 });

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function codePointLength(value) {
  return Array.from(value).length;
}

function terminologyError(code, field, message) {
  const error = new Error(message);
  error.code = code;
  if (field) error.field = field;
  return error;
}

function requiredText(value, field, label, maximum) {
  const normalized = typeof value === "string" ? value.trim() : "";
  const length = codePointLength(normalized);
  if (length < 1 || length > maximum) {
    throw terminologyError(
      "terminology_validation_error",
      field,
      `${label}必须为 1 至 ${maximum.toLocaleString("en-US")} 个 Unicode 码点。`,
    );
  }
  return normalized;
}

function optionalText(value, field, label, maximum) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || codePointLength(value) > maximum) {
    throw terminologyError(
      "terminology_validation_error",
      field,
      `${label}不能超过 ${maximum.toLocaleString("en-US")} 个 Unicode 码点。`,
    );
  }
  return value;
}

function stringList(value, field, label, maximumItems, maximumLength) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw terminologyError(
      "terminology_validation_error",
      field,
      `${label}最多 ${maximumItems} 项。`,
    );
  }
  return value.map((item, index) =>
    requiredText(item, `${field}[${index}]`, `${label}中的每一项`, maximumLength),
  );
}

function uniqueName(name, collection, existingId, label) {
  const key = name.toLocaleLowerCase("und");
  if (
    collection.some(
      (item) => item.id !== existingId && item.name.toLocaleLowerCase("und") === key,
    )
  ) {
    throw terminologyError(
      "terminology_validation_error",
      "name",
      `${label}名称必须唯一。`,
    );
  }
}

function normalizeEntry(input, { entryIdFactory }) {
  if (!input || typeof input !== "object") {
    throw terminologyError("terminology_validation_error", "entries", "术语条目无效。");
  }
  const id =
    typeof input.id === "string" && input.id.length > 0
      ? input.id
      : typeof entryIdFactory === "function"
        ? entryIdFactory()
        : null;
  if (typeof id !== "string" || id.length === 0) {
    throw terminologyError("terminology_validation_error", "entries.id", "无法生成术语 ID。");
  }
  if (input.strictness !== "preferred" && input.strictness !== "exact") {
    throw terminologyError(
      "terminology_validation_error",
      "strictness",
      "术语严格程度必须是 preferred 或 exact。",
    );
  }
  if (!Number.isSafeInteger(input.priority)) {
    throw terminologyError(
      "terminology_validation_error",
      "priority",
      "术语优先级必须是安全整数。",
    );
  }
  return {
    id,
    sourceTerm: requiredText(input.sourceTerm, "sourceTerm", "源术语", 200),
    preferredTarget: requiredText(
      input.preferredTarget,
      "preferredTarget",
      "首选译法",
      200,
    ),
    sourceLanguage: requiredText(
      input.sourceLanguage,
      "sourceLanguage",
      "源语言",
      200,
    ),
    targetLanguage: requiredText(
      input.targetLanguage,
      "targetLanguage",
      "目标语言",
      200,
    ),
    allowedVariants: stringList(
      input.allowedVariants,
      "allowedVariants",
      "允许变体",
      20,
      200,
    ),
    forbiddenTargets: stringList(
      input.forbiddenTargets,
      "forbiddenTargets",
      "禁止译法",
      20,
      200,
    ),
    meaning: optionalText(input.meaning, "meaning", "含义或适用语境", 1_000),
    strictness: input.strictness,
    caseSensitive: Boolean(input.caseSensitive),
    aliases: stringList(input.aliases, "aliases", "别名", 20, 200),
    priority: input.priority,
  };
}

function validateTermbase(
  input,
  { termbases = [], idFactory, entryIdFactory = idFactory } = {},
) {
  if (!input || typeof input !== "object") {
    throw terminologyError("terminology_validation_error", null, "术语库无效。");
  }
  const id =
    typeof input.id === "string" && input.id.length > 0
      ? input.id
      : typeof idFactory === "function"
        ? idFactory()
        : null;
  if (typeof id !== "string" || id.length === 0) {
    throw terminologyError("terminology_validation_error", "id", "无法生成术语库 ID。");
  }
  const name = requiredText(input.name, "name", "术语库名称", 100);
  uniqueName(name, termbases, id, "术语库");
  if (!Array.isArray(input.entries)) {
    throw terminologyError("terminology_validation_error", "entries", "术语条目必须是数组。");
  }
  const entries = input.entries.map((item) => normalizeEntry(item, { entryIdFactory }));
  const entryIds = new Set();
  for (const item of entries) {
    if (entryIds.has(item.id)) {
      throw terminologyError(
        "terminology_validation_error",
        "entries.id",
        "同一术语库中的术语 ID 不能重复。",
      );
    }
    entryIds.add(item.id);
  }
  return freezeDeep({ id, name, enabled: Boolean(input.enabled), entries });
}

function normalizeProfileField(value, field, label) {
  return optionalText(value, field, label, 500);
}

function validateDomainProfile(
  input,
  { domainProfiles = [], termbases = [], idFactory } = {},
) {
  if (!input || typeof input !== "object") {
    throw terminologyError("terminology_validation_error", null, "行业配置无效。");
  }
  const id =
    typeof input.id === "string" && input.id.length > 0
      ? input.id
      : typeof idFactory === "function"
        ? idFactory()
        : null;
  if (typeof id !== "string" || id.length === 0) {
    throw terminologyError("terminology_validation_error", "id", "无法生成行业配置 ID。");
  }
  const name = requiredText(input.name, "name", "行业配置名称", 100);
  uniqueName(name, domainProfiles, id, "行业配置");
  const termbaseIds = stringList(
    input.termbaseIds,
    "termbaseIds",
    "关联术语库",
    Math.max(termbases.length, 1_000),
    200,
  );
  const availableTermbaseIds = new Set(termbases.map((termbase) => termbase.id));
  if (termbaseIds.some((termbaseId) => !availableTermbaseIds.has(termbaseId))) {
    throw terminologyError(
      "terminology_validation_error",
      "termbaseIds",
      "关联的术语库不存在。",
    );
  }
  const preserveRules = stringList(
    input.preserveRules,
    "preserveRules",
    "保留规则",
    20,
    500,
  );
  return freezeDeep({
    id,
    version: typeof input.version === "string" && input.version.length > 0 ? input.version : "1",
    name,
    field: normalizeProfileField(input.field, "field", "行业字段"),
    documentType: normalizeProfileField(
      input.documentType,
      "documentType",
      "文档类型",
    ),
    audience: normalizeProfileField(input.audience, "audience", "目标读者"),
    style: normalizeProfileField(input.style, "style", "文体和语气"),
    termbaseIds,
    preserveRules,
  });
}

function normalizeMatchText(value, caseSensitive) {
  const normalized = value.normalize("NFC").replace(HYPHEN, "-");
  return Array.from(caseSensitive ? normalized : normalized.toLocaleLowerCase("und"));
}

function needsBoundary(character) {
  return Boolean(character && WORD_CHARACTER.test(character) && !CJK_CHARACTER.test(character));
}

function hasValidBoundaries(source, pattern, start) {
  const previous = source[start - 1];
  const next = source[start + pattern.length];
  if (needsBoundary(pattern[0]) && needsBoundary(previous)) return false;
  if (
    needsBoundary(pattern[pattern.length - 1]) &&
    next &&
    needsBoundary(next)
  ) {
    return false;
  }
  return true;
}

function matchSpans(sourceText, surface, caseSensitive) {
  const source = normalizeMatchText(sourceText, caseSensitive);
  const pattern = normalizeMatchText(surface, caseSensitive);
  if (pattern.length === 0 || pattern.length > source.length) return [];
  const spans = [];
  for (let start = 0; start <= source.length - pattern.length; start += 1) {
    let matches = true;
    for (let index = 0; index < pattern.length; index += 1) {
      if (source[start + index] !== pattern[index]) {
        matches = false;
        break;
      }
    }
    if (matches && hasValidBoundaries(source, pattern, start)) {
      spans.push({ start, end: start + pattern.length });
    }
  }
  return spans;
}

function languageMatches(entryLanguage, targetLanguage) {
  const key = entryLanguage.toLocaleLowerCase("und");
  const presetAliases = {
    "zh-CN": ["简体中文", "Chinese", "Simplified Chinese"],
    "zh-TW": ["繁体中文", "Traditional Chinese"],
    en: ["英语", "English"],
    ja: ["日语", "Japanese"],
    ko: ["韩语", "Korean"],
    fr: ["法语", "French"],
    de: ["德语", "German"],
    es: ["西班牙语", "Spanish"],
  };
  return [
    targetLanguage.id,
    targetLanguage.modelLabel,
    ...(presetAliases[targetLanguage.id] || []),
  ]
    .filter((value) => typeof value === "string")
    .some((value) => value.toLocaleLowerCase("und") === key);
}

function languageScript(language) {
  const key = language.trim().toLocaleLowerCase("und");
  if (["ja", "ja-jp", "japanese", "日语", "日本語"].includes(key)) return "japanese";
  if (["ko", "ko-kr", "korean", "韩语", "한국어"].includes(key)) return "korean";
  if (
    [
      "zh",
      "zh-cn",
      "zh-tw",
      "chinese",
      "simplified chinese",
      "traditional chinese",
      "中文",
      "简体中文",
      "繁体中文",
    ].includes(key)
  ) {
    return "chinese";
  }
  if (["ar", "arabic", "阿拉伯语"].includes(key)) return "arabic";
  if (["ru", "russian", "俄语"].includes(key)) return "cyrillic";
  if (
    [
      "en",
      "english",
      "英语",
      "fr",
      "french",
      "法语",
      "de",
      "german",
      "德语",
      "es",
      "spanish",
      "西班牙语",
    ].includes(key)
  ) {
    return "latin";
  }
  return null;
}

function detectedSourceScript(sourceText) {
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(sourceText)) return "japanese";
  if (/\p{Script=Hangul}/u.test(sourceText)) return "korean";
  if (/\p{Script=Arabic}/u.test(sourceText)) return "arabic";
  if (/\p{Script=Cyrillic}/u.test(sourceText)) return "cyrillic";
  if (/\p{Script=Han}/u.test(sourceText)) return "chinese";
  if (/\p{Script=Latin}/u.test(sourceText)) return "latin";
  return null;
}

function sourceLanguageMatches(entryLanguage, sourceText, sourceTerm, spans) {
  const expected = languageScript(entryLanguage);
  const actual = detectedSourceScript(sourceText);
  const termScript = detectedSourceScript(sourceTerm);
  if (!expected || (!actual && !termScript)) return true;
  if (spans.some((span) => span.alias)) return true;
  if (expected === actual || expected === termScript) return true;
  return expected === "japanese" && actual === "chinese" && termScript === "chinese";
}

function candidateFromEntry(termbase, term, origin, sourceText) {
  const spans = new Map();
  for (const [surfaceIndex, surface] of [term.sourceTerm, ...term.aliases].entries()) {
    for (const span of matchSpans(sourceText, surface, term.caseSensitive)) {
      const key = `${span.start}:${span.end}`;
      if (!spans.has(key)) {
        spans.set(key, {
          ...span,
          surface,
          alias: surfaceIndex > 0,
          length: span.end - span.start,
        });
      }
    }
  }
  if (spans.size === 0) return null;
  return {
    id: `${termbase.id}:${term.id}`,
    source: term.sourceTerm,
    preferredTarget: term.preferredTarget,
    sourceLanguage: term.sourceLanguage,
    targetLanguage: term.targetLanguage,
    allowedVariants: [...term.allowedVariants],
    forbiddenTargets: [...term.forbiddenTargets],
    aliases: [...term.aliases],
    meaning: term.meaning,
    strictness: term.strictness,
    caseSensitive: term.caseSensitive,
    priority: term.priority,
    origin,
    _sourceLength: Math.max(...[...spans.values()].map((span) => span.length)),
    _spans: [...spans.values()],
  };
}

function candidateFromTaskTerm(term, index, sourceText, targetLanguage) {
  if (!term || typeof term !== "object") {
    throw terminologyError("terminology_validation_error", "taskTerms", "本次术语无效。");
  }
  const sourceTerm = requiredText(
    term.sourceTerm,
    `taskTerms[${index}].sourceTerm`,
    "本次术语的源术语",
    200,
  );
  const preferredTarget = requiredText(
    term.preferredTarget,
    `taskTerms[${index}].preferredTarget`,
    "本次术语的目标译法",
    200,
  );
  const spans = matchSpans(sourceText, sourceTerm, false);
  if (spans.length === 0) return null;
  return {
    id: `task:${index}`,
    source: sourceTerm,
    preferredTarget,
    sourceLanguage: "auto",
    targetLanguage: targetLanguage.modelLabel,
    allowedVariants: [],
    forbiddenTargets: [],
    aliases: [],
    meaning: null,
    strictness: "exact",
    caseSensitive: false,
    priority: 0,
    origin: "task",
    _sourceLength: codePointLength(sourceTerm),
    _spans: spans,
  };
}

function compareCandidates(left, right) {
  return (
    ORIGIN_RANK[left.origin] - ORIGIN_RANK[right.origin] ||
    right.priority - left.priority ||
    right._sourceLength - left._sourceLength ||
    left.id.localeCompare(right.id)
  );
}

function conflictsFor(candidates) {
  const bySpan = new Map();
  for (const candidate of candidates) {
    for (const span of candidate._spans) {
      const key = `${span.start}:${span.end}`;
      if (!bySpan.has(key)) bySpan.set(key, []);
      bySpan.get(key).push(candidate);
    }
  }
  const conflicts = [];
  const seen = new Set();
  for (const [spanKey, candidatesAtSpan] of bySpan) {
    const bestOrigin = Math.min(
      ...candidatesAtSpan.map((candidate) => ORIGIN_RANK[candidate.origin]),
    );
    const sameOrigin = candidatesAtSpan.filter(
      (candidate) => ORIGIN_RANK[candidate.origin] === bestOrigin,
    );
    const bestPriority = Math.max(...sameOrigin.map((candidate) => candidate.priority));
    const samePriority = sameOrigin.filter(
      (candidate) => candidate.priority === bestPriority,
    );
    const candidatesWithSpan = samePriority.map((candidate) => ({
      candidate,
      span: candidate._spans.find((span) => `${span.start}:${span.end}` === spanKey),
    }));
    const bestLength = Math.max(...candidatesWithSpan.map(({ span }) => span.length));
    const exact = candidatesWithSpan
      .filter(
        ({ candidate, span }) =>
          span.length === bestLength && candidate.strictness === "exact",
      )
      .map(({ candidate }) => candidate);
    const targets = new Set(exact.map((candidate) => candidate.preferredTarget));
    if (targets.size < 2) continue;
    const choices = exact
      .map((candidate) => ({
        termId: candidate.id,
        preferredTarget: candidate.preferredTarget,
        origin: candidate.origin,
      }))
      .filter(
        (choice, index, all) =>
          all.findIndex(
            (candidate) => candidate.preferredTarget === choice.preferredTarget,
          ) === index,
      );
    const source =
      exact[0]._spans.find((span) => `${span.start}:${span.end}` === spanKey)?.surface ??
      exact[0].source;
    const key = `${source}\u0000${choices
      .map((choice) => choice.preferredTarget)
      .sort()
      .join("\u0000")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    conflicts.push({ source, choices });
  }
  return conflicts;
}

function publicMatchedTerm(candidate) {
  const { _sourceLength, _spans, ...term } = candidate;
  return term;
}

function effectiveQualityTerms(candidates) {
  const matches = candidates
    .flatMap((candidate) =>
      candidate._spans.map((span) => ({ candidate, span })),
    )
    .sort(
      (left, right) =>
        ORIGIN_RANK[left.candidate.origin] - ORIGIN_RANK[right.candidate.origin] ||
        right.candidate.priority - left.candidate.priority ||
        right.span.length - left.span.length ||
        left.span.start - right.span.start ||
        left.candidate.id.localeCompare(right.candidate.id),
    );
  const accepted = [];
  const occurrences = new Map();
  for (const match of matches) {
    if (
      accepted.some(
        (acceptedMatch) =>
          match.span.start < acceptedMatch.span.end &&
          acceptedMatch.span.start < match.span.end,
      )
    ) {
      continue;
    }
    accepted.push(match);
    occurrences.set(
      match.candidate.id,
      (occurrences.get(match.candidate.id) || 0) + 1,
    );
  }
  return candidates
    .filter((candidate) => occurrences.has(candidate.id))
    .map((candidate) => ({
      ...publicMatchedTerm(candidate),
      requiredOccurrences: occurrences.get(candidate.id),
    }));
}

function resolveTerminology({
  sourceText,
  targetLanguage,
  taskTerms = [],
  termbases = [],
  domainProfile = null,
}) {
  const candidates = [];
  for (let index = 0; index < taskTerms.length; index += 1) {
    const candidate = candidateFromTaskTerm(
      taskTerms[index],
      index,
      sourceText,
      targetLanguage,
    );
    if (candidate) candidates.push(candidate);
  }
  const domainTermbaseIds = new Set(
    domainProfile && Array.isArray(domainProfile.termbaseIds)
      ? domainProfile.termbaseIds
      : [],
  );
  for (const termbase of termbases) {
    const origin = domainTermbaseIds.has(termbase.id)
      ? "domain"
      : termbase.enabled
        ? "general"
        : null;
    if (!origin || !Array.isArray(termbase.entries)) continue;
    for (const term of termbase.entries) {
      if (!languageMatches(term.targetLanguage, targetLanguage)) continue;
      const candidate = candidateFromEntry(termbase, term, origin, sourceText);
      if (
        candidate &&
        sourceLanguageMatches(
          term.sourceLanguage,
          sourceText,
          term.sourceTerm,
          candidate._spans,
        )
      ) {
        candidates.push(candidate);
      }
    }
  }
  if (candidates.length > 100) {
    throw terminologyError(
      "terminology_limit_exceeded",
      "matchedTerms",
      `当前源文本命中术语为 ${candidates.length} 条，超过 100 条上限。请缩小启用的术语库范围。`,
    );
  }
  candidates.sort(compareCandidates);
  return freezeDeep({
    matchedTerms: candidates.map(publicMatchedTerm),
    qualityTerms: effectiveQualityTerms(candidates),
    conflicts: conflictsFor(candidates),
  });
}

function validateTranslationInputBudget({ input, serializedBody }) {
  const additionalRequirements =
    typeof input.additionalRequirements === "string" ? input.additionalRequirements : "";
  if (codePointLength(additionalRequirements) > 2_000) {
    throw terminologyError(
      "input_budget_exceeded",
      "additionalRequirements",
      "附加翻译要求不能超过 2,000 个 Unicode 码点。",
    );
  }
  if (input.domainProfile) {
    for (const [field, label] of [
      ["field", "行业字段"],
      ["documentType", "文档类型"],
      ["audience", "目标读者"],
      ["style", "文体和语气"],
    ]) {
      const value = input.domainProfile[field];
      if (typeof value === "string" && codePointLength(value) > 500) {
        throw terminologyError(
          "input_budget_exceeded",
          `domainProfile.${field}`,
          `${label}不能超过 500 个 Unicode 码点。`,
        );
      }
    }
    const preserveRules = Array.isArray(input.domainProfile.preserveRules)
      ? input.domainProfile.preserveRules
      : [];
    if (preserveRules.length > 20) {
      throw terminologyError(
        "input_budget_exceeded",
        "domainProfile.preserveRules",
        "行业配置的保留规则最多 20 条。",
      );
    }
    for (const rule of preserveRules) {
      if (codePointLength(rule) > 500) {
        throw terminologyError(
          "input_budget_exceeded",
          "domainProfile.preserveRules",
          "每条保留规则不能超过 500 个 Unicode 码点。",
        );
      }
    }
  }
  const dynamicInput = { ...input };
  delete dynamicInput.sourceText;
  if (codePointLength(JSON.stringify(dynamicInput)) > 32_000) {
    throw terminologyError(
      "input_budget_exceeded",
      "dynamicPromptData",
      "除源文本外的动态提示数据不能超过 32,000 个 Unicode 码点。",
    );
  }
  if (
    typeof serializedBody === "string" &&
    Buffer.byteLength(serializedBody, "utf8") > 256 * 1024
  ) {
    throw terminologyError(
      "input_budget_exceeded",
      "requestBody",
      "序列化请求体不能超过 256 KiB。",
    );
  }
  return true;
}

function includesText(text, value, caseSensitive = true) {
  if (caseSensitive) return text.includes(value);
  return text.toLocaleLowerCase("und").includes(value.toLocaleLowerCase("und"));
}

function countTextOccurrences(text, value, caseSensitive = true) {
  const haystack = caseSensitive ? text : text.toLocaleLowerCase("und");
  const needle = caseSensitive ? value : value.toLocaleLowerCase("und");
  let count = 0;
  let offset = 0;
  while (needle.length > 0) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) break;
    count += 1;
    offset = index + needle.length;
  }
  return count;
}

function inspectTerminologyQuality({ translation, matchedTerms }) {
  const risks = [];
  let index = 0;
  for (const term of matchedTerms || []) {
    const acceptedTargets =
      term.strictness === "exact"
        ? [term.preferredTarget]
        : [term.preferredTarget, ...(term.allowedVariants || [])];
    const accepted =
      term.strictness === "exact"
        ? countTextOccurrences(
            translation,
            term.preferredTarget,
            Boolean(term.caseSensitive),
          ) >= Math.max(1, term.requiredOccurrences || 1)
        : acceptedTargets.some((target) =>
            includesText(translation, target, Boolean(term.caseSensitive)),
          );
    if (!accepted) {
      risks.push({
        id: `terminology-${index++}`,
        code:
          term.strictness === "exact"
            ? "terminology.exact_missing"
            : "terminology.preferred_unused",
        category: "terminology",
        severity: term.strictness === "exact" ? "critical" : "minor",
        certainty: term.strictness === "exact" ? "deterministic" : "heuristic",
        message:
          term.strictness === "exact"
            ? `严格术语“${term.source}”未使用指定译法。`
            : `推荐术语“${term.source}”可能未使用首选译法，请结合语境复核。`,
      });
    }
    for (const forbiddenTarget of term.forbiddenTargets || []) {
      if (!includesText(translation, forbiddenTarget, false)) continue;
      risks.push({
        id: `terminology-${index++}`,
        code: "terminology.forbidden_target",
        category: "terminology",
        severity: "critical",
        certainty: "deterministic",
        message: `译文出现术语“${term.source}”的禁止译法。`,
      });
    }
  }
  return freezeDeep(risks);
}

module.exports = {
  inspectTerminologyQuality,
  resolveTerminology,
  terminologyError,
  validateDomainProfile,
  validateTermbase,
  validateTranslationInputBudget,
};
