const HYPHEN = /[\u2010-\u2015\u2212\uFE63\uFF0D]/gu;
const WORDS = /[\p{L}\p{N}]+/gu;

function codePointLength(value) {
  return Array.from(value).length;
}

function referenceError(field, message) {
  const error = new Error(message);
  error.code = "reference_validation_error";
  error.field = field;
  return error;
}

function requiredText(value, field, label, maximum) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length === 0) {
    throw referenceError(field, `${label}不能为空。`);
  }
  if (codePointLength(normalized) > maximum) {
    throw referenceError(field, `${label}不能超过 ${maximum.toLocaleString("en-US")} 个 Unicode 码点。`);
  }
  return normalized;
}

function validateReferenceTranslation(
  input,
  { domainProfiles = [], idFactory } = {},
) {
  if (!input || typeof input !== "object") {
    throw referenceError("referenceTranslation", "参考译例无效。");
  }
  const id =
    typeof input.id === "string" && input.id.length > 0
      ? input.id
      : typeof idFactory === "function"
        ? idFactory()
        : null;
  if (!id) throw referenceError("id", "无法生成参考译例 ID。");
  const domainProfileId = requiredText(
    input.domainProfileId,
    "domainProfileId",
    "关联的行业配置",
    200,
  );
  if (!domainProfiles.some((profile) => profile.id === domainProfileId)) {
    throw referenceError("domainProfileId", "关联的行业配置不存在。");
  }
  return Object.freeze({
    id,
    sourceLanguage: requiredText(input.sourceLanguage, "sourceLanguage", "源语言", 200),
    targetLanguage: requiredText(input.targetLanguage, "targetLanguage", "目标语言", 200),
    domainProfileId,
    source: requiredText(input.source, "source", "参考源文本", 2_000),
    translation: requiredText(input.translation, "translation", "参考译文", 2_000),
  });
}

function targetLanguageMatches(entryLanguage, targetLanguage) {
  const aliases = {
    "zh-CN": ["简体中文", "Chinese", "Simplified Chinese"],
    "zh-TW": ["繁体中文", "Traditional Chinese"],
    en: ["英语", "English"],
    ja: ["日语", "Japanese"],
    ko: ["韩语", "Korean"],
    fr: ["法语", "French"],
    de: ["德语", "German"],
    es: ["西班牙语", "Spanish"],
  };
  const key = entryLanguage.toLocaleLowerCase("und");
  return [targetLanguage.id, targetLanguage.modelLabel, ...(aliases[targetLanguage.id] || [])]
    .filter((value) => typeof value === "string")
    .some((value) => value.toLocaleLowerCase("und") === key);
}

function languageScript(language) {
  const normalized = language.toLocaleLowerCase("und");
  if (/^(?:zh|chinese|simplified chinese|traditional chinese|简体中文|繁体中文)$/u.test(normalized)) {
    return "han";
  }
  if (/^(?:ja|japanese|日语)$/u.test(normalized)) return "japanese";
  if (/^(?:ko|korean|韩语)$/u.test(normalized)) return "korean";
  if (
    /^(?:en|english|英语|fr|french|法语|de|german|德语|es|spanish|西班牙语)$/u.test(
      normalized,
    )
  ) {
    return "latin";
  }
  return null;
}

function sourceScript(sourceText) {
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(sourceText)) return "japanese";
  if (/\p{Script=Hangul}/u.test(sourceText)) return "korean";
  if (/\p{Script=Han}/u.test(sourceText)) return "han";
  if (/\p{Script=Latin}/u.test(sourceText)) return "latin";
  return null;
}

function sourceLanguageMatches(entryLanguage, sourceText) {
  const expected = languageScript(entryLanguage);
  const actual = sourceScript(sourceText);
  if (!expected || !actual) return true;
  if (expected === "japanese" && actual === "han") return true;
  return expected === actual;
}

function normalizedWords(value) {
  return (
    value
      .normalize("NFC")
      .replace(HYPHEN, "-")
      .toLocaleLowerCase("und")
      .match(WORDS) || []
  );
}

function bigrams(value) {
  const characters = Array.from(
    value
      .normalize("NFC")
      .replace(HYPHEN, "-")
      .toLocaleLowerCase("und")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim(),
  );
  if (characters.length < 2) return new Set(characters);
  const result = new Set();
  for (let index = 0; index < characters.length - 1; index += 1) {
    result.add(`${characters[index]}${characters[index + 1]}`);
  }
  return result;
}

function adjacentWordPairs(words) {
  if (words.length < 2) return new Set(words);
  const result = new Set();
  for (let index = 0; index < words.length - 1; index += 1) {
    result.add(`${words[index]}\u0000${words[index + 1]}`);
  }
  return result;
}

function similarity(sourceText, referenceSource) {
  const leftWords = normalizedWords(sourceText);
  const rightWords = normalizedWords(referenceSource);
  const leftSet = new Set(leftWords);
  const rightSet = new Set(rightWords);
  const commonWords = [...leftSet].filter((word) => rightSet.has(word)).length;
  const unionWords = new Set([...leftSet, ...rightSet]).size || 1;
  const wordScore = commonWords / unionWords;
  const leftBigrams = bigrams(sourceText);
  const rightBigrams = bigrams(referenceSource);
  const commonBigrams = [...leftBigrams].filter((item) => rightBigrams.has(item)).length;
  const bigramScore =
    leftBigrams.size + rightBigrams.size === 0
      ? 0
      : (2 * commonBigrams) / (leftBigrams.size + rightBigrams.size);
  const leftPairs = adjacentWordPairs(leftWords);
  const rightPairs = adjacentWordPairs(rightWords);
  const commonPairs = [...leftPairs].filter((item) => rightPairs.has(item)).length;
  const phraseScore =
    leftPairs.size + rightPairs.size === 0
      ? 0
      : (2 * commonPairs) / (leftPairs.size + rightPairs.size);
  return wordScore * 0.45 + bigramScore * 0.25 + phraseScore * 0.3;
}

function selectReferenceTranslations({
  sourceText,
  targetLanguage,
  domainProfileId,
  referenceTranslations = [],
}) {
  if (!domainProfileId) return Object.freeze([]);
  const scored = referenceTranslations
    .filter(
      (reference) =>
        reference.domainProfileId === domainProfileId &&
        sourceLanguageMatches(reference.sourceLanguage, sourceText) &&
        targetLanguageMatches(reference.targetLanguage, targetLanguage),
    )
    .map((reference) => ({ reference, score: similarity(sourceText, reference.source) }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.reference.id.localeCompare(right.reference.id),
    )
    .slice(0, 3)
    .map(({ reference }) => Object.freeze({ ...reference }));
  return Object.freeze(scored);
}

function resolveReferenceSelection({ selectedIds, candidates = [] }) {
  if (!Array.isArray(selectedIds)) {
    throw referenceError("referenceTranslationIds", "参考译例选择必须是数组。");
  }
  if (selectedIds.length > 3) {
    throw referenceError("referenceTranslationIds", "参考译例最多选择 3 条，不能截断多余条目。");
  }
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw referenceError("referenceTranslationIds", "参考译例选择不能重复。");
  }
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return Object.freeze(
    selectedIds.map((id) => {
      const candidate = byId.get(id);
      if (!candidate) {
        throw referenceError(
          "referenceTranslationIds",
          "选择的参考译例不在本次预览中，请重新预览。",
        );
      }
      return Object.freeze({ ...candidate });
    }),
  );
}

module.exports = {
  resolveReferenceSelection,
  selectReferenceTranslations,
  validateReferenceTranslation,
};
