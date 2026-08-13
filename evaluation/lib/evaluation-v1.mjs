import { createHash } from "node:crypto";

export const EVALUATION_CASE_SCHEMA_VERSION = "evaluation-case.v1";
export const EVALUATION_REPORT_SCHEMA_VERSION = "evaluation-report.v1";
export const EVALUATION_VERSION = "ruyi-evaluation-v1";

const CASE_KEYS = new Set([
  "schemaVersion",
  "caseId",
  "sourceLanguage",
  "targetLanguage",
  "evaluationDomain",
  "domainProfileId",
  "documentType",
  "source",
  "references",
  "segments",
  "terms",
  "protectedItems",
  "referenceTranslationIds",
  "expectedIssues",
  "specialtyTags",
  "privacyClass",
  "notes",
]);
const SEGMENT_KEYS = new Set(["id", "ordinal", "sourceStart", "sourceEnd"]);
const TERM_KEYS = new Set([
  "id",
  "sourceLanguage",
  "targetLanguage",
  "source",
  "preferredTarget",
  "allowedVariants",
  "forbiddenTargets",
  "aliases",
  "meaning",
  "strictness",
  "caseSensitive",
  "priority",
  "origin",
  "applies",
]);
const PROTECTED_ITEM_KEYS = new Set([
  "id",
  "segmentId",
  "type",
  "value",
  "sourceStart",
  "sourceEnd",
]);
const EXPECTED_ISSUE_KEYS = new Set([
  "id",
  "segmentId",
  "category",
  "severity",
  "sourceStart",
  "sourceEnd",
  "notes",
]);
const EVALUATION_DOMAINS = new Set(["general", "software", "academic", "energy", "legal"]);
const SPECIALTY_TAGS = new Set([
  "terminology",
  "structure",
  "injection",
  "crossSegment",
  "boundary",
]);
const ISSUE_CATEGORIES = new Set([
  "accuracy",
  "terminology",
  "fluency",
  "style",
  "consistency",
  "structure",
  "injection",
  "protocol",
]);
const ISSUE_SEVERITIES = new Set(["critical", "major", "minor"]);
const PRIVACY_CLASSES = new Set(["synthetic", "public-licensed", "authorized-private"]);
const LANGUAGE_CODES = new Map([
  ["English", "en"],
  ["Simplified Chinese", "zh-CN"],
  ["Japanese", "ja"],
  ["Korean", "ko"],
  ["French", "fr"],
  ["German", "de"],
  ["Spanish", "es"],
]);
const EVALUATION_DIRECTIONS = new Map([
  ["en>zh-CN", { collection: "core", key: "enZh" }],
  ["zh-CN>en", { collection: "core", key: "zhEn" }],
  ["ja>zh-CN", { collection: "basic", key: "jaZh" }],
  ["ko>zh-CN", { collection: "basic", key: "koZh" }],
  ["fr>zh-CN", { collection: "basic", key: "frZh" }],
  ["de>zh-CN", { collection: "basic", key: "deZh" }],
  ["es>zh-CN", { collection: "basic", key: "esZh" }],
]);
const FINGERPRINT_KEYS = new Set([
  "providerType",
  "serviceConfigurationId",
  "normalizedTranslationUrl",
  "adapterBuildVersion",
  "protocol",
  "model",
  "reportedModelVersion",
  "promptVersion",
  "schemaVersion",
  "evaluationVersion",
  "qualityMode",
  "thinkingMode",
  "requestParameters",
  "normalizedTargetLanguage",
  "termbaseVersion",
  "domainProfileVersion",
  "referenceTranslationIds",
  "sourceCaseId",
  "segmentationMode",
  "chunkingVersion",
  "concurrency",
  "canonicalRequestBodyHash",
]);
const TARGET_LANGUAGE_KEYS = new Set(["kind", "id", "modelLabel"]);
const SECRET_FIELD = /^(?:(?:x|x-goog)[_-])?(?:api[_-]?key|access[_-]?token|token|authorization|headers?|credentials?|password|passphrase|private[_-]?key|client[_-]?secret|secret)$/iu;
const SECRET_URL_PARAMETER = /(?:api[_-]?key|access[_-]?token|token|secret|authorization)/iu;
const SECRET_VALUE = /(?:^|[^A-Za-z0-9])(?:sk|key|token|secret)[-_][A-Za-z0-9_-]{8,}(?=$|[^A-Za-z0-9])/iu;
const REPORT_KEYS = new Set([
  "schemaVersion",
  "reportId",
  "evaluationVersion",
  "candidateVersion",
  "baselineVersion",
  "evaluationDate",
  "changeSummary",
  "datasetVersion",
  "dataset",
  "serviceConditions",
  "pairedComparisons",
  "sampleCounts",
  "automaticChecks",
  "humanReview",
  "revision",
  "concurrency",
  "performance",
  "platforms",
  "decisions",
  "notes",
]);
const DIRECTION_KEYS = new Set(["documents", "segments", "longDocuments", "domains"]);
const DOMAIN_COUNT_KEYS = new Set(["general", "software", "academic", "energy", "legal"]);
const BASIC_DIRECTION_KEYS = new Set(["documents", "segments"]);
const DATASET_KEYS = new Set(["frozen", "core", "basic", "specialty", "privacyClasses"]);
const CORE_KEYS = new Set(["enZh", "zhEn"]);
const BASIC_KEYS = new Set(["jaZh", "koZh", "frZh", "deZh", "esZh"]);
const SPECIALTY_KEYS = new Set([
  "terminology",
  "structure",
  "injection",
  "crossSegment",
  "boundaryFixtures",
]);
const SERVICE_CONDITION_KEYS = new Set([
  "conditionId",
  "kind",
  "serviceConfigurationId",
  "normalizedTranslationUrl",
  "adapterBuildVersion",
  "model",
  "reportedModelVersion",
  "protocol",
  "promptVersion",
  "schemaVersion",
  "reportVersion",
]);
const PAIRED_COMPARISON_KEYS = new Set([
  "factor",
  "values",
  "serviceConditionIds",
  "sampleCount",
  "controlledConditionHash",
]);
const PAIRED_FACTORS = new Map([
  ["quality-mode", ["standard", "precision"]],
  ["terminology", ["none", "applicable", "inapplicable"]],
  ["reference-translations", ["0", "3", "4-rejected"]],
  ["domain-selection", ["selected", "none"]],
  ["segmentation", ["full-document", "segmented"]],
  ["thinking-mode", ["disabled", "enabled"]],
  ["protocol", ["chat-completions", "responses"]],
]);
const SAMPLE_COUNT_KEYS = new Set([
  "standard",
  "precision",
  "fullDocument",
  "segmented",
  "thinkingEnabled",
  "thinkingDisabled",
]);
const DETECTION_KEYS = new Set(["total", "detected"]);
const REDIRECT_KEYS = new Set(["total", "blocked"]);
const AUTOMATIC_CHECK_KEYS = new Set([
  "testsPassed",
  "schemaPassed",
  "protocolPassed",
  "entryPassed",
  "authenticationPassed",
  "cancellationPassed",
  "injection",
  "protectedContent",
  "chunkIntegrity",
  "crossOriginRedirect",
  "runtimeIsolationPassed",
  "resetStoragePassed",
]);
const HUMAN_REVIEW_KEYS = new Set([
  "reviewerCount",
  "domainReviewerCount",
  "agreementRate",
  "cohenKappa",
  "unresolvedSamples",
  "unflaggedCritical",
  "standardCritical",
  "precisionCritical",
  "standardWeightedPoints",
  "precisionWeightedPoints",
  "precisionCiUpperRelativeDifference",
  "strictTermUndetected",
  "preferredApplicable",
  "preferredMatched",
  "forbiddenTotal",
  "forbiddenDetected",
  "basicSevereFailures",
]);
const REVISION_KEYS = new Set([
  "introducedCritical",
  "revisedSegments",
  "harmedSegments",
  "resolvedIssues",
  "introducedIssues",
]);
const CONCURRENCY_KEYS = new Set([
  "localSimulationSamples",
  "realBenchmarkSamples",
  "criticalIncrease",
  "undetectedStructuralDamage",
  "fullWeightedPoints",
  "concurrency3WeightedPoints",
  "fullP50Ms",
  "concurrency3P50Ms",
  "fullTokens",
  "concurrency3Tokens",
  "missingSegments",
  "duplicateSegments",
  "outOfOrderSegments",
  "periodCount",
]);
const LOCAL_CONCURRENCY_SAMPLE_KEYS = new Set(["concurrency1", "concurrency3", "concurrency6"]);
const REAL_CONCURRENCY_SAMPLE_KEYS = new Set([
  "fullDocument",
  "concurrency2",
  "concurrency3",
  "concurrency4",
]);
const PERFORMANCE_KEYS = new Set(["conditionCount", "summaries"]);
const PERFORMANCE_SUMMARY_KEYS = new Set([
  "conditionId",
  "serviceConditionId",
  "requestFingerprint",
  "sampleCount",
  "periodCount",
  "firstCodePointP50Ms",
  "firstCodePointP95Ms",
  "completionP50Ms",
  "completionP95Ms",
  "inputTokens",
  "outputTokens",
  "reasoningTokens",
  "callCount",
  "cancellationRate",
  "timeoutRate",
  "revisionTriggerRate",
  "feeAmount",
  "feeCurrency",
]);
const PLATFORM_KEYS = new Set(["windows", "macOS", "linux"]);
const PLATFORM_RECORD_KEYS = new Set(["status", "recordId", "checks"]);
const PLATFORM_CHECK_KEYS = new Set([
  "upxsInstallation",
  "entryAndShortcut",
  "backgroundAndNotification",
  "copyPaste",
  "themeAndAccessibility",
  "httpsAndLoopbackHttp",
  "processRestartNoSensitiveResidue",
]);
const EVIDENCE_STATUSES = new Set(["pass", "fail", "pending"]);
const DECISION_KEYS = new Set(["reasonCodes", "decision"]);
const VERIFIED_EVIDENCE_KEYS = new Set([
  "schemaVersion",
  "evidenceId",
  "candidateVersion",
  "datasetVersion",
  "commitSha",
  "reportSha256",
  "casesSha256",
  "buildInputSha256",
  "caseCount",
  "artifactSha256",
  "attachmentSha256",
]);
const VERIFIED_ARTIFACT_KEYS = new Set([
  "automaticChecks",
  "modelResults",
  "pairedComparisons",
  "humanReviews",
  "revision",
  "concurrency",
  "performance",
  "platformWindows",
  "platformMacOS",
  "platformLinux",
]);

function validationError(path, message) {
  const error = new Error(`${path}: ${message}`);
  error.code = "evaluation_validation_error";
  error.path = path;
  return error;
}

function assertRecord(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError(path, "必须是 JSON 对象。");
  }
}

function assertExactKeys(value, allowed, path) {
  assertRecord(value, path);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw validationError(path, `含未知字段：${unknown.join("、")}。`);
  }
  const missing = [...allowed].filter((key) => !Object.hasOwn(value, key));
  if (missing.length > 0) {
    throw validationError(path, `缺少字段：${missing.join("、")}。`);
  }
}

function assertText(value, path, { allowEmpty = false, maximum = 10_000 } = {}) {
  if (typeof value !== "string") throw validationError(path, "必须是字符串。");
  const length = Array.from(value).length;
  if ((!allowEmpty && length === 0) || length > maximum) {
    throw validationError(path, `必须包含 ${allowEmpty ? "0" : "1"} 至 ${maximum} 个 Unicode 码点。`);
  }
  return value;
}

function assertStringArray(value, path, maximumItems = 100) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw validationError(path, `必须是至多 ${maximumItems} 项的字符串数组。`);
  }
  const seen = new Set();
  value.forEach((item, index) => {
    assertText(item, `${path}[${index}]`, { maximum: 2_000 });
    if (seen.has(item)) throw validationError(path, "每一项必须唯一。");
    seen.add(item);
  });
}

function assertSafeInteger(value, path, { minimum = Number.MIN_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw validationError(path, `必须是大于等于 ${minimum} 的安全整数。`);
  }
}

function assertFiniteNumber(value, path, { minimum = -Infinity, maximum = Infinity } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw validationError(path, `必须是 ${minimum} 至 ${maximum} 之间的有限数值。`);
  }
}

function assertBoolean(value, path) {
  if (typeof value !== "boolean") throw validationError(path, "必须是布尔值。");
}

function assertUniqueId(id, seen, path, label) {
  assertText(id, path, { maximum: 200 });
  if (seen.has(id)) throw validationError(path, `${label} ID 必须唯一。`);
  seen.add(id);
}

function validateSegments(segments, sourceLength) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw validationError("segments", "必须至少包含一个分段。");
  }
  const ids = new Set();
  let previousEnd = 0;
  segments.forEach((segment, index) => {
    const path = `segments[${index}]`;
    assertExactKeys(segment, SEGMENT_KEYS, path);
    assertUniqueId(segment.id, ids, `${path}.id`, "segment");
    if (segment.ordinal !== index) {
      throw validationError(`${path}.ordinal`, "必须从 0 开始并按数组顺序连续递增。");
    }
    assertSafeInteger(segment.sourceStart, `${path}.sourceStart`, { minimum: 0 });
    assertSafeInteger(segment.sourceEnd, `${path}.sourceEnd`, { minimum: 1 });
    if (
      segment.sourceStart >= segment.sourceEnd ||
      segment.sourceEnd > sourceLength ||
      segment.sourceStart !== previousEnd
    ) {
      throw validationError(path, "源码点范围必须有效，并按顺序连续完整覆盖原文。");
    }
    previousEnd = segment.sourceEnd;
  });
  if (previousEnd !== sourceLength) {
    throw validationError("segments", "源码点范围必须按顺序连续完整覆盖原文。");
  }
  return ids;
}

function validateTerms(terms) {
  if (!Array.isArray(terms) || terms.length > 100) {
    throw validationError("terms", "必须是至多 100 项的数组。");
  }
  const ids = new Set();
  terms.forEach((term, index) => {
    const path = `terms[${index}]`;
    assertExactKeys(term, TERM_KEYS, path);
    assertUniqueId(term.id, ids, `${path}.id`, "term");
    for (const field of ["sourceLanguage", "targetLanguage", "source", "preferredTarget", "origin"]) {
      assertText(term[field], `${path}.${field}`, { maximum: 200 });
    }
    for (const field of ["allowedVariants", "forbiddenTargets", "aliases"]) {
      assertStringArray(term[field], `${path}.${field}`, 20);
    }
    if (term.meaning !== null) assertText(term.meaning, `${path}.meaning`, { maximum: 1_000 });
    if (term.strictness !== "preferred" && term.strictness !== "exact") {
      throw validationError(`${path}.strictness`, "必须是 preferred 或 exact。");
    }
    if (typeof term.caseSensitive !== "boolean" || typeof term.applies !== "boolean") {
      throw validationError(path, "caseSensitive 和 applies 必须是布尔值。");
    }
    assertSafeInteger(term.priority, `${path}.priority`);
  });
}

function validateProtectedItems(items, sourceCodePoints, segmentById) {
  if (!Array.isArray(items) || items.length > 1_000) {
    throw validationError("protectedItems", "必须是至多 1,000 项的数组。");
  }
  const ids = new Set();
  items.forEach((item, index) => {
    const path = `protectedItems[${index}]`;
    assertExactKeys(item, PROTECTED_ITEM_KEYS, path);
    assertUniqueId(item.id, ids, `${path}.id`, "protected item");
    assertText(item.segmentId, `${path}.segmentId`, { maximum: 200 });
    assertText(item.type, `${path}.type`, { maximum: 100 });
    assertText(item.value, `${path}.value`, { maximum: 10_000 });
    assertSafeInteger(item.sourceStart, `${path}.sourceStart`, { minimum: 0 });
    assertSafeInteger(item.sourceEnd, `${path}.sourceEnd`, { minimum: 1 });
    const segment = segmentById.get(item.segmentId);
    if (
      !segment ||
      item.sourceStart < segment.sourceStart ||
      item.sourceEnd > segment.sourceEnd ||
      item.sourceStart >= item.sourceEnd
    ) {
      throw validationError(path, "必须引用存在的分段，且源码点范围须落在该分段内。");
    }
    if (sourceCodePoints.slice(item.sourceStart, item.sourceEnd).join("") !== item.value) {
      throw validationError(path, "value 必须与源码点范围内的原文完全一致。");
    }
  });
}

function validateExpectedIssues(issues, segmentById) {
  if (!Array.isArray(issues) || issues.length > 1_000) {
    throw validationError("expectedIssues", "必须是至多 1,000 项的数组。");
  }
  const ids = new Set();
  issues.forEach((issue, index) => {
    const path = `expectedIssues[${index}]`;
    assertExactKeys(issue, EXPECTED_ISSUE_KEYS, path);
    assertUniqueId(issue.id, ids, `${path}.id`, "expected issue");
    assertText(issue.segmentId, `${path}.segmentId`, { maximum: 200 });
    if (!ISSUE_CATEGORIES.has(issue.category)) {
      throw validationError(`${path}.category`, "不是已定义的错误类别。");
    }
    if (!ISSUE_SEVERITIES.has(issue.severity)) {
      throw validationError(`${path}.severity`, "必须是 critical、major 或 minor。");
    }
    assertSafeInteger(issue.sourceStart, `${path}.sourceStart`, { minimum: 0 });
    assertSafeInteger(issue.sourceEnd, `${path}.sourceEnd`, { minimum: 1 });
    const segment = segmentById.get(issue.segmentId);
    if (
      !segment ||
      issue.sourceStart < segment.sourceStart ||
      issue.sourceEnd > segment.sourceEnd ||
      issue.sourceStart >= issue.sourceEnd
    ) {
      throw validationError(path, "必须引用存在的分段，且源码点范围须落在该分段内。");
    }
    assertText(issue.notes, `${path}.notes`, { allowEmpty: true, maximum: 2_000 });
  });
}

export function validateEvaluationCase(value) {
  assertExactKeys(value, CASE_KEYS, "case");
  if (value.schemaVersion !== EVALUATION_CASE_SCHEMA_VERSION) {
    throw validationError("schemaVersion", `必须是 ${EVALUATION_CASE_SCHEMA_VERSION}。`);
  }
  assertText(value.caseId, "caseId", { maximum: 200 });
  assertText(value.sourceLanguage, "sourceLanguage", { maximum: 200 });
  assertText(value.targetLanguage, "targetLanguage", { maximum: 200 });
  if (!EVALUATION_DOMAINS.has(value.evaluationDomain)) {
    throw validationError("evaluationDomain", "必须是 general、software、academic、energy 或 legal。");
  }
  if (value.domainProfileId !== null) {
    assertText(value.domainProfileId, "domainProfileId", { maximum: 200 });
  }
  assertText(value.documentType, "documentType", { maximum: 200 });
  assertText(value.source, "source");
  if (value.source.includes("\r")) {
    throw validationError("source", "必须先把换行规范化为 LF，以免源码点范围产生歧义。");
  }
  assertStringArray(value.references, "references", 3);
  const sourceCodePoints = Array.from(value.source);
  const segmentIds = validateSegments(value.segments, sourceCodePoints.length);
  const segmentById = new Map(value.segments.map((segment) => [segment.id, segment]));
  validateTerms(value.terms);
  validateProtectedItems(value.protectedItems, sourceCodePoints, segmentById);
  assertStringArray(value.referenceTranslationIds, "referenceTranslationIds", 3);
  if (value.referenceTranslationIds.length !== value.references.length) {
    throw validationError("referenceTranslationIds", "参考译例文本与 ID 必须一一对应。");
  }
  validateExpectedIssues(value.expectedIssues, segmentById);
  assertStringArray(value.specialtyTags, "specialtyTags", SPECIALTY_TAGS.size);
  for (const tag of value.specialtyTags) {
    if (!SPECIALTY_TAGS.has(tag)) {
      throw validationError("specialtyTags", `不支持 ${tag}。`);
    }
  }
  if (!PRIVACY_CLASSES.has(value.privacyClass)) {
    throw validationError("privacyClass", "必须是 synthetic、public-licensed 或 authorized-private。");
  }
  assertText(value.notes, "notes", { allowEmpty: true, maximum: 2_000 });

  for (const item of value.protectedItems) {
    if (!segmentIds.has(item.segmentId)) {
      throw validationError("protectedItems", "所有分段引用都必须存在。");
    }
  }
  return value;
}

export function parseEvaluationCases(jsonl, { sourceName = "evaluation JSONL" } = {}) {
  if (typeof jsonl !== "string") throw validationError(sourceName, "必须是字符串。");
  const cases = [];
  const caseIds = new Set();
  const sourceFingerprints = new Set();
  for (const [index, line] of jsonl.split(/\r?\n/u).entries()) {
    if (line.trim().length === 0) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      throw validationError(`${sourceName}:${index + 1}`, "不是完整的单个 JSON 对象。");
    }
    try {
      validateEvaluationCase(value);
    } catch (error) {
      if (error?.code === "evaluation_validation_error") {
        error.message = `${sourceName}:${index + 1} ${error.message}`;
      }
      throw error;
    }
    if (caseIds.has(value.caseId)) {
      throw validationError(`${sourceName}:${index + 1}.caseId`, "case ID 必须在文件内唯一。");
    }
    const sourceFingerprint = hashCanonicalValue({
      sourceLanguage: value.sourceLanguage,
      targetLanguage: value.targetLanguage,
      source: value.source.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US"),
    });
    if (sourceFingerprints.has(sourceFingerprint)) {
      throw validationError(
        `${sourceName}:${index + 1}.source`,
        "同一语言方向不能用只改大小写或空白的重复原文凑评测数量。",
      );
    }
    caseIds.add(value.caseId);
    sourceFingerprints.add(sourceFingerprint);
    cases.push(value);
  }
  if (cases.length === 0) throw validationError(sourceName, "至少需要一条评测用例。");
  return cases;
}

export function summarizeEvaluationCases(cases) {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw validationError("cases", "至少需要一条已校验的评测用例。");
  }
  const emptyDomains = () => ({ general: 0, software: 0, academic: 0, energy: 0, legal: 0 });
  const summary = {
    core: {
      enZh: { documents: 0, segments: 0, longDocuments: 0, domains: emptyDomains() },
      zhEn: { documents: 0, segments: 0, longDocuments: 0, domains: emptyDomains() },
    },
    basic: {
      jaZh: { documents: 0, segments: 0 },
      koZh: { documents: 0, segments: 0 },
      frZh: { documents: 0, segments: 0 },
      deZh: { documents: 0, segments: 0 },
      esZh: { documents: 0, segments: 0 },
    },
    specialty: {
      terminology: 0,
      structure: 0,
      injection: 0,
      crossSegment: 0,
      boundaryFixtures: false,
    },
    privacyClasses: [],
  };
  const privacyClasses = new Set();
  for (const [index, item] of cases.entries()) {
    validateEvaluationCase(item);
    const sourceCode = LANGUAGE_CODES.get(item.sourceLanguage);
    const targetCode = LANGUAGE_CODES.get(item.targetLanguage);
    const direction = EVALUATION_DIRECTIONS.get(`${sourceCode}>${targetCode}`);
    if (!direction) {
      throw validationError(
        `cases[${index}]`,
        "语言方向不属于首轮中英核心集或日、韩、法、德、西到简体中文基本集。",
      );
    }
    const directionSummary = summary[direction.collection][direction.key];
    directionSummary.documents += 1;
    directionSummary.segments += item.segments.length;
    if (direction.collection === "core") {
      const length = Array.from(item.source).length;
      if (length >= 8_000 && length <= 10_000) directionSummary.longDocuments += 1;
      directionSummary.domains[item.evaluationDomain] += 1;
    }
    for (const tag of item.specialtyTags) {
      if (tag === "boundary") summary.specialty.boundaryFixtures = true;
      else summary.specialty[tag] += 1;
    }
    privacyClasses.add(item.privacyClass);
  }
  summary.privacyClasses = [...PRIVACY_CLASSES].filter((item) => privacyClasses.has(item));
  return summary;
}

function assertJsonValue(value, path) {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (SECRET_VALUE.test(value)) {
      throw validationError(path, "疑似包含 API Key 或其他密钥值，不得进入评测指纹。");
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw validationError(path, "数值必须有限。");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`));
    return;
  }
  assertRecord(value, path);
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) {
      throw validationError(`${path}.${key}`, `${key} 等密钥或请求头字段不得进入评测指纹。`);
    }
    assertJsonValue(child, `${path}.${key}`);
  }
}

function assertNormalizedTranslationUrl(value) {
  assertText(value, "normalizedTranslationUrl", { maximum: 2_000 });
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw validationError("normalizedTranslationUrl", "必须是完整 URL。");
  }
  if (parsed.username || parsed.password) {
    throw validationError("normalizedTranslationUrl", "不得包含用户名或密码。");
  }
  for (const [name, parameterValue] of parsed.searchParams) {
    if (SECRET_URL_PARAMETER.test(name)) {
      throw validationError("normalizedTranslationUrl", "URL 查询参数不得包含 API Key 或其他密钥。");
    }
    if (SECRET_VALUE.test(parameterValue)) {
      throw validationError("normalizedTranslationUrl", "URL 查询参数值不得包含 API Key 或其他密钥。");
    }
  }
  let decodedPathname;
  try {
    decodedPathname = decodeURIComponent(parsed.pathname);
  } catch {
    throw validationError("normalizedTranslationUrl", "URL 路径包含无效的百分号编码。");
  }
  if (parsed.hash || SECRET_VALUE.test(decodedPathname)) {
    throw validationError("normalizedTranslationUrl", "URL 路径或片段不得包含密钥。");
  }
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]).has(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw validationError("normalizedTranslationUrl", "远程地址必须使用 HTTPS，HTTP 只允许本地回环地址。");
  }
  if (parsed.toString() !== value) {
    throw validationError("normalizedTranslationUrl", "必须先完成 URL 规范化。");
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function hashCanonicalValue(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function createRequestFingerprint(condition) {
  assertExactKeys(condition, FINGERPRINT_KEYS, "condition");
  if (!new Set(["deepseek-official", "custom"]).has(condition.providerType)) {
    throw validationError("providerType", "必须是 deepseek-official 或 custom。");
  }
  for (const field of [
    "serviceConfigurationId",
    "adapterBuildVersion",
    "model",
    "reportedModelVersion",
    "promptVersion",
    "schemaVersion",
    "termbaseVersion",
    "domainProfileVersion",
    "sourceCaseId",
    "chunkingVersion",
  ]) {
    assertText(condition[field], field, { maximum: 500 });
  }
  assertNormalizedTranslationUrl(condition.normalizedTranslationUrl);
  if (condition.protocol !== "chat-completions" && condition.protocol !== "responses") {
    throw validationError("protocol", "必须是 chat-completions 或 responses。");
  }
  if (condition.evaluationVersion !== EVALUATION_VERSION) {
    throw validationError("evaluationVersion", `必须是 ${EVALUATION_VERSION}。`);
  }
  if (condition.qualityMode !== "standard" && condition.qualityMode !== "precision") {
    throw validationError("qualityMode", "必须是 standard 或 precision。");
  }
  if (typeof condition.thinkingMode !== "boolean") {
    throw validationError("thinkingMode", "必须是布尔值。");
  }
  assertRecord(condition.requestParameters, "requestParameters");
  assertJsonValue(condition.requestParameters, "requestParameters");
  assertExactKeys(condition.normalizedTargetLanguage, TARGET_LANGUAGE_KEYS, "normalizedTargetLanguage");
  for (const field of ["kind", "id", "modelLabel"]) {
    assertText(condition.normalizedTargetLanguage[field], `normalizedTargetLanguage.${field}`, {
      maximum: 200,
    });
  }
  assertStringArray(condition.referenceTranslationIds, "referenceTranslationIds", 3);
  if (
    condition.segmentationMode !== "full-document" &&
    condition.segmentationMode !== "segmented"
  ) {
    throw validationError("segmentationMode", "必须是 full-document 或 segmented。");
  }
  assertSafeInteger(condition.concurrency, "concurrency", { minimum: 1 });
  if (condition.concurrency > 6) {
    throw validationError("concurrency", "不能超过 6。");
  }
  if (
    typeof condition.canonicalRequestBodyHash !== "string" ||
    !/^[a-f\d]{64}$/u.test(condition.canonicalRequestBodyHash)
  ) {
    throw validationError("canonicalRequestBodyHash", "必须是 64 位小写 SHA-256 十六进制值。");
  }

  return hashCanonicalValue(condition);
}

function releaseReason(code, message, status = "pending") {
  return Object.freeze({ code, message, status });
}

function validateReportEnvelope(report) {
  assertExactKeys(report, REPORT_KEYS, "report");
  if (report.schemaVersion !== EVALUATION_REPORT_SCHEMA_VERSION) {
    throw validationError("schemaVersion", `必须是 ${EVALUATION_REPORT_SCHEMA_VERSION}。`);
  }
  if (report.reportId !== "baseline-v1") {
    throw validationError("reportId", "首轮发布报告必须是 baseline-v1。");
  }
  if (report.evaluationVersion !== EVALUATION_VERSION) {
    throw validationError("evaluationVersion", `必须是 ${EVALUATION_VERSION}。`);
  }
  assertText(report.candidateVersion, "candidateVersion", { maximum: 100 });
  if (report.baselineVersion !== null) {
    assertText(report.baselineVersion, "baselineVersion", { maximum: 100 });
    if (report.baselineVersion !== "baseline-v1") {
      throw validationError("baselineVersion", "首轮基线版本必须是 baseline-v1。");
    }
  }
  if (typeof report.evaluationDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(report.evaluationDate)) {
    throw validationError("evaluationDate", "必须是 YYYY-MM-DD 日期。");
  }
  assertText(report.changeSummary, "changeSummary", { maximum: 2_000 });
  if (report.datasetVersion !== null) {
    assertText(report.datasetVersion, "datasetVersion", { maximum: 200 });
  }
  if (!Array.isArray(report.serviceConditions)) {
    throw validationError("serviceConditions", "必须是数组。");
  }
  validateDecisions(report.decisions);
  assertText(report.notes, "notes", { allowEmpty: true, maximum: 5_000 });
}

function validateDecisions(decisions) {
  if (!Array.isArray(decisions) || decisions.length > 100) {
    throw validationError("decisions", "必须是至多 100 项的数组。");
  }
  const coveredCodes = new Set();
  decisions.forEach((entry, index) => {
    const path = `decisions[${index}]`;
    assertExactKeys(entry, DECISION_KEYS, path);
    assertStringArray(entry.reasonCodes, `${path}.reasonCodes`, 100);
    if (entry.reasonCodes.length === 0) {
      throw validationError(`${path}.reasonCodes`, "至少需要一个门槛原因或发布结论代码。");
    }
    for (const code of entry.reasonCodes) {
      if (coveredCodes.has(code)) {
        throw validationError(`${path}.reasonCodes`, `重复覆盖 ${code}。`);
      }
      coveredCodes.add(code);
    }
    assertText(entry.decision, `${path}.decision`, { maximum: 2_000 });
  });
}

function validateDataset(dataset) {
  assertExactKeys(dataset, DATASET_KEYS, "dataset");
  assertBoolean(dataset.frozen, "dataset.frozen");
  assertExactKeys(dataset.core, CORE_KEYS, "dataset.core");
  for (const direction of CORE_KEYS) {
    const evidence = dataset.core[direction];
    const path = `dataset.core.${direction}`;
    assertExactKeys(evidence, DIRECTION_KEYS, path);
    for (const field of ["documents", "segments", "longDocuments"]) {
      assertSafeInteger(evidence[field], `${path}.${field}`, { minimum: 0 });
    }
    assertExactKeys(evidence.domains, DOMAIN_COUNT_KEYS, `${path}.domains`);
    for (const domain of DOMAIN_COUNT_KEYS) {
      assertSafeInteger(evidence.domains[domain], `${path}.domains.${domain}`, { minimum: 0 });
    }
  }
  assertExactKeys(dataset.basic, BASIC_KEYS, "dataset.basic");
  for (const direction of BASIC_KEYS) {
    const evidence = dataset.basic[direction];
    const path = `dataset.basic.${direction}`;
    assertExactKeys(evidence, BASIC_DIRECTION_KEYS, path);
    for (const field of BASIC_DIRECTION_KEYS) {
      assertSafeInteger(evidence[field], `${path}.${field}`, { minimum: 0 });
    }
  }
  assertExactKeys(dataset.specialty, SPECIALTY_KEYS, "dataset.specialty");
  for (const field of ["terminology", "structure", "injection", "crossSegment"]) {
    assertSafeInteger(dataset.specialty[field], `dataset.specialty.${field}`, { minimum: 0 });
  }
  assertBoolean(dataset.specialty.boundaryFixtures, "dataset.specialty.boundaryFixtures");
  assertStringArray(dataset.privacyClasses, "dataset.privacyClasses", 3);
    for (const privacyClass of dataset.privacyClasses) {
    if (!PRIVACY_CLASSES.has(privacyClass)) {
      throw validationError("dataset.privacyClasses", `不支持 ${privacyClass}。`);
    }
  }
}

function validateServiceConditions(conditions) {
  const ids = new Set();
  conditions.forEach((condition, index) => {
    const path = `serviceConditions[${index}]`;
    assertExactKeys(condition, SERVICE_CONDITION_KEYS, path);
    if (condition.kind !== "deepseek-official" && condition.kind !== "custom") {
      throw validationError(`${path}.kind`, "必须是 deepseek-official 或 custom。");
    }
    for (const field of [
      "conditionId",
      "serviceConfigurationId",
      "adapterBuildVersion",
      "model",
      "reportedModelVersion",
      "promptVersion",
      "schemaVersion",
      "reportVersion",
    ]) {
      assertText(condition[field], `${path}.${field}`, { maximum: 500 });
    }
    if (!/^[a-f\d]{40}$/u.test(condition.adapterBuildVersion)) {
      throw validationError(`${path}.adapterBuildVersion`, "必须是完整的 40 位 Git commit SHA。");
    }
    if (ids.has(condition.conditionId)) {
      throw validationError(`${path}.conditionId`, "必须唯一。");
    }
    ids.add(condition.conditionId);
    assertNormalizedTranslationUrl(condition.normalizedTranslationUrl);
    if (condition.protocol !== "chat-completions" && condition.protocol !== "responses") {
      throw validationError(`${path}.protocol`, "必须是 chat-completions 或 responses。");
    }
    if (condition.reportVersion !== EVALUATION_REPORT_SCHEMA_VERSION) {
      throw validationError(`${path}.reportVersion`, `必须是 ${EVALUATION_REPORT_SCHEMA_VERSION}。`);
    }
  });
  return new Map(conditions.map((condition) => [condition.conditionId, condition]));
}

function validateSampleCounts(sampleCounts) {
  assertExactKeys(sampleCounts, SAMPLE_COUNT_KEYS, "sampleCounts");
  for (const field of SAMPLE_COUNT_KEYS) {
    assertSafeInteger(sampleCounts[field], `sampleCounts.${field}`, { minimum: 0 });
  }
}

function validatePairedComparisons(comparisons, serviceConditionsById) {
  if (!Array.isArray(comparisons) || comparisons.length > PAIRED_FACTORS.size) {
    throw validationError("pairedComparisons", `必须是至多 ${PAIRED_FACTORS.size} 项的数组。`);
  }
  const factors = new Set();
  comparisons.forEach((comparison, index) => {
    const path = `pairedComparisons[${index}]`;
    assertExactKeys(comparison, PAIRED_COMPARISON_KEYS, path);
    if (!PAIRED_FACTORS.has(comparison.factor)) {
      throw validationError(`${path}.factor`, "不是已定义的配对因素。");
    }
    if (factors.has(comparison.factor)) {
      throw validationError(`${path}.factor`, "每类配对因素只能记录一次。");
    }
    factors.add(comparison.factor);
    assertStringArray(comparison.values, `${path}.values`, 4);
    assertStringArray(comparison.serviceConditionIds, `${path}.serviceConditionIds`, 2);
    if (
      JSON.stringify(comparison.values) !==
      JSON.stringify(PAIRED_FACTORS.get(comparison.factor))
    ) {
      throw validationError(`${path}.values`, "没有覆盖该配对因素规定的全部条件。");
    }
    const serviceConditions = comparison.serviceConditionIds.map((conditionId) => {
      const condition = serviceConditionsById.get(conditionId);
      if (!condition) {
        throw validationError(`${path}.serviceConditionIds`, `不存在服务条件 ${conditionId}。`);
      }
      return condition;
    });
    if (comparison.factor === "protocol") {
      if (serviceConditions.length !== 2) {
        throw validationError(`${path}.serviceConditionIds`, "协议配对必须引用两个服务条件。");
      }
      const [left, right] = serviceConditions;
      const leftUrl = new URL(left.normalizedTranslationUrl);
      const rightUrl = new URL(right.normalizedTranslationUrl);
      const sameServiceAndModel =
        left.kind === right.kind &&
        left.serviceConfigurationId === right.serviceConfigurationId &&
        leftUrl.origin === rightUrl.origin &&
        left.adapterBuildVersion === right.adapterBuildVersion &&
        left.model === right.model &&
        left.reportedModelVersion === right.reportedModelVersion &&
        left.promptVersion === right.promptVersion &&
        left.schemaVersion === right.schemaVersion &&
        left.reportVersion === right.reportVersion;
      if (
        !sameServiceAndModel ||
        new Set(serviceConditions.map((condition) => condition.protocol)).size !== 2
      ) {
        throw validationError(
          `${path}.serviceConditionIds`,
          "协议配对必须使用同一服务、主机、模型和版本的 Chat Completions 与 Responses 条件。",
        );
      }
    } else if (serviceConditions.length !== 1) {
      throw validationError(`${path}.serviceConditionIds`, "该配对因素必须固定在一个服务条件内。");
    }
    if (
      comparison.factor === "thinking-mode" &&
      serviceConditionsById.get(comparison.serviceConditionIds[0])?.kind !== "deepseek-official"
    ) {
      throw validationError(
        `${path}.serviceConditionIds`,
        "思考模式配对必须使用 DeepSeek 官方服务条件。",
      );
    }
    assertSafeInteger(comparison.sampleCount, `${path}.sampleCount`, { minimum: 0 });
    if (
      typeof comparison.controlledConditionHash !== "string" ||
      !/^[a-f\d]{64}$/u.test(comparison.controlledConditionHash)
    ) {
      throw validationError(
        `${path}.controlledConditionHash`,
        "必须是其余受控条件的 64 位小写 SHA-256 十六进制值。",
      );
    }
  });
  return factors;
}

function validateDetection(value, path, resultField = "detected") {
  assertExactKeys(value, resultField === "blocked" ? REDIRECT_KEYS : DETECTION_KEYS, path);
  assertSafeInteger(value.total, `${path}.total`, { minimum: 0 });
  assertSafeInteger(value[resultField], `${path}.${resultField}`, { minimum: 0 });
  if (value[resultField] > value.total) {
    throw validationError(path, `${resultField} 不能大于 total。`);
  }
}

function validateAutomaticChecks(checks) {
  assertExactKeys(checks, AUTOMATIC_CHECK_KEYS, "automaticChecks");
  for (const field of [
    "testsPassed",
    "schemaPassed",
    "protocolPassed",
    "entryPassed",
    "authenticationPassed",
    "cancellationPassed",
    "runtimeIsolationPassed",
    "resetStoragePassed",
  ]) {
    assertBoolean(checks[field], `automaticChecks.${field}`);
  }
  validateDetection(checks.injection, "automaticChecks.injection");
  validateDetection(checks.protectedContent, "automaticChecks.protectedContent");
  validateDetection(checks.chunkIntegrity, "automaticChecks.chunkIntegrity");
  validateDetection(checks.crossOriginRedirect, "automaticChecks.crossOriginRedirect", "blocked");
}

function validateHumanReview(review) {
  assertExactKeys(review, HUMAN_REVIEW_KEYS, "humanReview");
  for (const field of [
    "reviewerCount",
    "domainReviewerCount",
    "unresolvedSamples",
    "unflaggedCritical",
    "standardCritical",
    "precisionCritical",
    "strictTermUndetected",
    "preferredApplicable",
    "preferredMatched",
    "forbiddenTotal",
    "forbiddenDetected",
    "basicSevereFailures",
  ]) {
    assertSafeInteger(review[field], `humanReview.${field}`, { minimum: 0 });
  }
  for (const field of ["agreementRate"]) {
    assertFiniteNumber(review[field], `humanReview.${field}`, { minimum: 0, maximum: 1 });
  }
  assertFiniteNumber(review.cohenKappa, "humanReview.cohenKappa", { minimum: -1, maximum: 1 });
  for (const field of [
    "standardWeightedPoints",
    "precisionWeightedPoints",
    "precisionCiUpperRelativeDifference",
  ]) {
    assertFiniteNumber(review[field], `humanReview.${field}`, {
      minimum: field === "precisionCiUpperRelativeDifference" ? -Infinity : 0,
    });
  }
  if (review.preferredMatched > review.preferredApplicable) {
    throw validationError("humanReview.preferredMatched", "不能大于 preferredApplicable。");
  }
  if (review.forbiddenDetected > review.forbiddenTotal) {
    throw validationError("humanReview.forbiddenDetected", "不能大于 forbiddenTotal。");
  }
}

function validateRevision(revision) {
  assertExactKeys(revision, REVISION_KEYS, "revision");
  for (const field of REVISION_KEYS) {
    assertSafeInteger(revision[field], `revision.${field}`, { minimum: 0 });
  }
  if (revision.harmedSegments > revision.revisedSegments) {
    throw validationError("revision.harmedSegments", "不能大于 revisedSegments。");
  }
}

function validateConcurrency(concurrency) {
  assertExactKeys(concurrency, CONCURRENCY_KEYS, "concurrency");
  assertExactKeys(
    concurrency.localSimulationSamples,
    LOCAL_CONCURRENCY_SAMPLE_KEYS,
    "concurrency.localSimulationSamples",
  );
  assertExactKeys(
    concurrency.realBenchmarkSamples,
    REAL_CONCURRENCY_SAMPLE_KEYS,
    "concurrency.realBenchmarkSamples",
  );
  for (const field of LOCAL_CONCURRENCY_SAMPLE_KEYS) {
    assertSafeInteger(
      concurrency.localSimulationSamples[field],
      `concurrency.localSimulationSamples.${field}`,
      { minimum: 0 },
    );
  }
  for (const field of REAL_CONCURRENCY_SAMPLE_KEYS) {
    assertSafeInteger(
      concurrency.realBenchmarkSamples[field],
      `concurrency.realBenchmarkSamples.${field}`,
      { minimum: 0 },
    );
  }
  for (const field of [
    "criticalIncrease",
    "undetectedStructuralDamage",
    "missingSegments",
    "duplicateSegments",
    "outOfOrderSegments",
    "periodCount",
  ]) {
    assertSafeInteger(concurrency[field], `concurrency.${field}`, { minimum: 0 });
  }
  for (const field of [
    "fullWeightedPoints",
    "concurrency3WeightedPoints",
    "fullP50Ms",
    "concurrency3P50Ms",
    "fullTokens",
    "concurrency3Tokens",
  ]) {
    assertFiniteNumber(concurrency[field], `concurrency.${field}`, { minimum: 0 });
  }
}

function validatePerformance(performance) {
  assertExactKeys(performance, PERFORMANCE_KEYS, "performance");
  assertSafeInteger(performance.conditionCount, "performance.conditionCount", { minimum: 0 });
  if (!Array.isArray(performance.summaries)) {
    throw validationError("performance.summaries", "必须是数组。");
  }
  if (performance.summaries.length !== performance.conditionCount) {
    throw validationError("performance", "conditionCount 必须等于 summaries 数量。");
  }
  const ids = new Set();
  performance.summaries.forEach((summary, index) => {
    const path = `performance.summaries[${index}]`;
    assertExactKeys(summary, PERFORMANCE_SUMMARY_KEYS, path);
    assertText(summary.conditionId, `${path}.conditionId`, { maximum: 200 });
    assertText(summary.serviceConditionId, `${path}.serviceConditionId`, { maximum: 200 });
    if (ids.has(summary.conditionId)) throw validationError(`${path}.conditionId`, "必须唯一。");
    ids.add(summary.conditionId);
    if (typeof summary.requestFingerprint !== "string" || !/^[a-f\d]{64}$/u.test(summary.requestFingerprint)) {
      throw validationError(`${path}.requestFingerprint`, "必须是 64 位小写 SHA-256 十六进制值。");
    }
    for (const field of ["sampleCount", "periodCount", "callCount"]) {
      assertSafeInteger(summary[field], `${path}.${field}`, { minimum: 0 });
    }
    for (const field of [
      "firstCodePointP50Ms",
      "firstCodePointP95Ms",
      "completionP50Ms",
      "completionP95Ms",
      "inputTokens",
      "outputTokens",
      "reasoningTokens",
      "feeAmount",
    ]) {
      assertFiniteNumber(summary[field], `${path}.${field}`, { minimum: 0 });
    }
    for (const field of ["cancellationRate", "timeoutRate", "revisionTriggerRate"]) {
      assertFiniteNumber(summary[field], `${path}.${field}`, { minimum: 0, maximum: 1 });
    }
    assertText(summary.feeCurrency, `${path}.feeCurrency`, { maximum: 20 });
  });
}

function validatePlatforms(platforms) {
  assertExactKeys(platforms, PLATFORM_KEYS, "platforms");
  for (const platform of PLATFORM_KEYS) {
    const record = platforms[platform];
    const path = `platforms.${platform}`;
    assertExactKeys(record, PLATFORM_RECORD_KEYS, path);
    if (!EVIDENCE_STATUSES.has(record.status)) {
      throw validationError(`${path}.status`, "必须是 pass、fail 或 pending。");
    }
    if (record.recordId !== null) assertText(record.recordId, `${path}.recordId`, { maximum: 200 });
    assertExactKeys(record.checks, PLATFORM_CHECK_KEYS, `${path}.checks`);
    for (const check of PLATFORM_CHECK_KEYS) {
      if (!EVIDENCE_STATUSES.has(record.checks[check])) {
        throw validationError(`${path}.checks.${check}`, "必须是 pass、fail 或 pending。");
      }
    }
    const derivedStatus = [...PLATFORM_CHECK_KEYS].some((check) => record.checks[check] === "fail")
      ? "fail"
      : [...PLATFORM_CHECK_KEYS].some((check) => record.checks[check] === "pending")
        ? "pending"
        : "pass";
    if (record.status !== derivedStatus) {
      throw validationError(`${path}.status`, `必须与各验收项汇总状态 ${derivedStatus} 一致。`);
    }
    if (record.status !== "pending" && record.recordId === null) {
      throw validationError(`${path}.recordId`, "通过或失败的实机验收必须有记录编号。");
    }
  }
}

function validateVerifiedEvidence(evidence, report) {
  assertExactKeys(evidence, VERIFIED_EVIDENCE_KEYS, "verifiedEvidence");
  if (evidence.schemaVersion !== "verified-evaluation-evidence.v1") {
    throw validationError(
      "verifiedEvidence.schemaVersion",
      "必须是 verified-evaluation-evidence.v1。",
    );
  }
  for (const field of ["evidenceId", "candidateVersion", "datasetVersion"]) {
    assertText(evidence[field], `verifiedEvidence.${field}`, { maximum: 500 });
  }
  if (typeof evidence.commitSha !== "string" || !/^[a-f\d]{40}$/u.test(evidence.commitSha)) {
    throw validationError("verifiedEvidence.commitSha", "必须是完整的 40 位 Git commit SHA。");
  }
  if (
    evidence.candidateVersion !== report.candidateVersion ||
    evidence.datasetVersion !== report.datasetVersion
  ) {
    throw validationError("verifiedEvidence", "候选版本或数据集版本与报告不一致。");
  }
  for (const field of ["reportSha256", "casesSha256", "buildInputSha256"]) {
    if (typeof evidence[field] !== "string" || !/^[a-f\d]{64}$/u.test(evidence[field])) {
      throw validationError(`verifiedEvidence.${field}`, "必须是 64 位小写 SHA-256 十六进制值。");
    }
  }
  if (evidence.reportSha256 !== hashCanonicalValue(report)) {
    throw validationError("verifiedEvidence.reportSha256", "与当前报告不一致。");
  }
  assertSafeInteger(evidence.caseCount, "verifiedEvidence.caseCount", { minimum: 1 });
  assertExactKeys(evidence.artifactSha256, VERIFIED_ARTIFACT_KEYS, "verifiedEvidence.artifactSha256");
  for (const artifact of VERIFIED_ARTIFACT_KEYS) {
    if (
      typeof evidence.artifactSha256[artifact] !== "string" ||
      !/^[a-f\d]{64}$/u.test(evidence.artifactSha256[artifact])
    ) {
      throw validationError(
        `verifiedEvidence.artifactSha256.${artifact}`,
        "必须是 64 位小写 SHA-256 十六进制值。",
      );
    }
  }
  assertRecord(evidence.attachmentSha256, "verifiedEvidence.attachmentSha256");
  if (Object.keys(evidence.attachmentSha256).length === 0) {
    throw validationError("verifiedEvidence.attachmentSha256", "必须包含原始证据附件哈希。");
  }
  for (const [attachmentId, digest] of Object.entries(evidence.attachmentSha256)) {
    assertText(attachmentId, "verifiedEvidence.attachmentSha256 attachmentId", { maximum: 500 });
    if (typeof digest !== "string" || !/^[a-f\d]{64}$/u.test(digest)) {
      throw validationError(
        `verifiedEvidence.attachmentSha256.${attachmentId}`,
        "必须是 64 位小写 SHA-256 十六进制值。",
      );
    }
  }
}

function addPending(reasons, condition, code, message) {
  if (condition) reasons.push(releaseReason(code, message));
}

function addFailure(reasons, condition, code, message) {
  if (condition) reasons.push(releaseReason(code, message, "fail"));
}

function evaluateReleaseGateInternal(report, verifiedEvidence) {
  validateReportEnvelope(report);
  const reasons = [];
  let coreDocumentCount = 0;
  let longDocumentCount = 0;
  if (verifiedEvidence === null) {
    reasons.push(
      releaseReason(
        "evidence.missing",
        "尚未校验实际用例、模型输出、人工标注、性能和三平台证据文件。",
      ),
    );
  } else {
    validateVerifiedEvidence(verifiedEvidence, report);
  }
  if (report.baselineVersion === null) {
    reasons.push(releaseReason("baseline.version.missing", "尚未填写基线版本。"));
  }
  if (report.datasetVersion === null) {
    reasons.push(releaseReason("dataset.version.missing", "尚未冻结数据集版本。"));
  }
  if (report.dataset === null) {
    reasons.push(releaseReason("dataset.missing", "尚未提供完整质量集、基本功能集和专项集证据。"));
  } else {
    validateDataset(report.dataset);
    coreDocumentCount = [...CORE_KEYS].reduce(
      (sum, direction) => sum + report.dataset.core[direction].documents,
      0,
    );
    longDocumentCount = [...CORE_KEYS].reduce(
      (sum, direction) => sum + report.dataset.core[direction].longDocuments,
      0,
    );
    addPending(reasons, !report.dataset.frozen, "dataset.not_frozen", "数据集尚未冻结。" );
    for (const direction of CORE_KEYS) {
      const evidence = report.dataset.core[direction];
      addPending(reasons, evidence.documents < 100, `dataset.core.${direction}.documents`, "核心集文本少于 100 篇。" );
      addPending(reasons, evidence.segments < 500, `dataset.core.${direction}.segments`, "核心集段落少于 500 个。" );
      addPending(reasons, evidence.longDocuments < 10, `dataset.core.${direction}.long_documents`, "8,000 至 10,000 码点长文少于 10 篇。" );
      for (const domain of DOMAIN_COUNT_KEYS) {
        addPending(reasons, evidence.domains[domain] < 15, `dataset.core.${direction}.${domain}`, "领域文本少于 15 篇。" );
      }
    }
    for (const direction of BASIC_KEYS) {
      const evidence = report.dataset.basic[direction];
      addPending(reasons, evidence.documents < 30 || evidence.segments < 100, `dataset.basic.${direction}`, "基本功能集少于 30 篇或 100 段。" );
    }
    const specialty = report.dataset.specialty;
    addPending(reasons, specialty.terminology < 100, "dataset.specialty.terminology", "术语专项少于 100 个。" );
    addPending(reasons, specialty.structure < 100, "dataset.specialty.structure", "结构专项少于 100 个。" );
    addPending(reasons, specialty.injection < 100, "dataset.specialty.injection", "注入专项少于 100 个。" );
    addPending(reasons, specialty.crossSegment < 40, "dataset.specialty.cross_segment", "跨段专项少于 40 个。" );
    addPending(reasons, !specialty.boundaryFixtures, "dataset.specialty.boundary", "边界和协议夹具尚未齐全。" );
    addPending(reasons, report.dataset.privacyClasses.length === 0, "dataset.privacy_classes.missing", "语料尚未按隐私类别标记。" );
  }
  const serviceConditionsById = validateServiceConditions(report.serviceConditions);
  if (
    !report.serviceConditions.some((condition) => condition.kind === "deepseek-official") ||
    !report.serviceConditions.some((condition) => condition.kind === "custom")
  ) {
    reasons.push(releaseReason("services.missing", "尚未记录默认 DeepSeek 和自定义服务条件。"));
  }
  if (report.pairedComparisons === null) {
    reasons.push(
      releaseReason("comparisons.missing", "尚未记录质量、术语、参考译例、行业、分段、思考和协议配对条件。"),
    );
  } else {
    const factors = validatePairedComparisons(report.pairedComparisons, serviceConditionsById);
    for (const factor of PAIRED_FACTORS.keys()) {
      addPending(
        reasons,
        !factors.has(factor),
        `comparisons.${factor === "protocol" ? "protocol" : factor}.missing`,
        `缺少 ${factor} 配对条件。`,
      );
    }
    for (const comparison of report.pairedComparisons) {
      const minimumSamples =
        comparison.factor === "quality-mode"
          ? coreDocumentCount
          : comparison.factor === "terminology"
            ? report.dataset?.specialty.terminology ?? 1
            : comparison.factor === "segmentation"
              ? longDocumentCount
              : 1;
      addPending(
        reasons,
        comparison.sampleCount < minimumSamples,
        `comparisons.${comparison.factor}.samples`,
        `${comparison.factor} 配对样本少于 ${minimumSamples} 个。`,
      );
    }
  }
  if (report.sampleCounts === null) {
    reasons.push(releaseReason("samples.missing", "尚未记录标准、精译、全文、分段和思考模式样本数。"));
  } else {
    validateSampleCounts(report.sampleCounts);
    const minimums = {
      standard: coreDocumentCount,
      precision: coreDocumentCount,
      fullDocument: longDocumentCount,
      segmented: longDocumentCount,
      thinkingEnabled: 1,
      thinkingDisabled: 1,
    };
    for (const field of SAMPLE_COUNT_KEYS) {
      addPending(
        reasons,
        report.sampleCounts[field] < minimums[field],
        `samples.${field}.missing`,
        `${field} 实际样本少于 ${minimums[field]} 个。`,
      );
    }
  }
  if (report.automaticChecks === null) {
    reasons.push(releaseReason("automation.missing", "尚未汇总自动契约和安全检查。"));
  } else {
    validateAutomaticChecks(report.automaticChecks);
    for (const field of [
      "testsPassed",
      "schemaPassed",
      "protocolPassed",
      "entryPassed",
      "authenticationPassed",
      "cancellationPassed",
      "runtimeIsolationPassed",
      "resetStoragePassed",
    ]) {
      addFailure(reasons, !report.automaticChecks[field], `automation.${field}.failed`, `${field} 未通过。`);
    }
    addPending(reasons, report.automaticChecks.injection.total < 100, "automation.injection.insufficient", "注入夹具少于 100 个。" );
    addFailure(reasons, report.automaticChecks.injection.detected !== report.automaticChecks.injection.total, "automation.injection.failed", "并非所有注入夹具都被阻止。" );
    addPending(reasons, report.automaticChecks.protectedContent.total < 100, "automation.protected.insufficient", "保护项夹具少于 100 个。" );
    addFailure(reasons, report.automaticChecks.protectedContent.detected !== report.automaticChecks.protectedContent.total, "automation.protected.failed", "并非所有已知保护项破坏都被发现。" );
    addPending(reasons, report.automaticChecks.chunkIntegrity.total === 0, "automation.chunk.insufficient", "没有分块完整性夹具。" );
    addFailure(reasons, report.automaticChecks.chunkIntegrity.detected !== report.automaticChecks.chunkIntegrity.total, "automation.chunk.failed", "分块缺失、重复或错序没有全部发现。" );
    addPending(reasons, report.automaticChecks.crossOriginRedirect.total === 0, "automation.redirect.insufficient", "没有跨域重定向夹具。" );
    addFailure(reasons, report.automaticChecks.crossOriginRedirect.blocked !== report.automaticChecks.crossOriginRedirect.total, "automation.redirect.failed", "跨域重定向没有全部在发送敏感数据前停止。" );
  }
  if (report.humanReview === null) {
    reasons.push(releaseReason("human_review.missing", "尚未完成双人盲评和一致率统计。"));
  } else {
    validateHumanReview(report.humanReview);
    const review = report.humanReview;
    addPending(reasons, review.reviewerCount < 2, "human_review.reviewers", "核心集至少需要两名独立评审。" );
    addPending(reasons, review.domainReviewerCount < 1, "human_review.domain_reviewer", "高风险领域至少需要一名领域评审。" );
    addPending(reasons, review.unresolvedSamples > 0, "human_review.unresolved", "仍有未裁决样本，不能进入发布结论。" );
    addFailure(reasons, review.unflaggedCritical > 0, "quality.unflagged_critical", "存在应用完全未提示的 critical 错误。" );
    addFailure(reasons, review.precisionCritical > review.standardCritical, "quality.precision_critical", "精译 critical 数高于标准模式。" );
    const precisionReduction =
      review.standardWeightedPoints === 0
        ? review.precisionWeightedPoints === 0
          ? Infinity
          : -Infinity
        : (review.standardWeightedPoints - review.precisionWeightedPoints) /
          review.standardWeightedPoints;
    addFailure(reasons, precisionReduction < 0.05, "quality.precision_reduction", "精译加权错误点估计没有比标准模式低至少 5%。" );
    addFailure(reasons, review.precisionCiUpperRelativeDifference > 0.02, "quality.precision_ci", "95% 置信区间上界显示精译可能比标准差 2% 以上。" );
    addFailure(reasons, review.strictTermUndetected > 0, "quality.strict_terms", "存在未发现的严格术语违反。" );
    addPending(reasons, review.preferredApplicable === 0, "quality.preferred_terms.missing", "没有推荐术语适用样本。" );
    addFailure(reasons, review.preferredApplicable > 0 && review.preferredMatched / review.preferredApplicable < 0.95, "quality.preferred_terms", "推荐术语命中率低于 95%。" );
    addPending(reasons, review.forbiddenTotal === 0, "quality.forbidden_terms.missing", "没有禁止译法样本。" );
    addFailure(reasons, review.forbiddenDetected !== review.forbiddenTotal, "quality.forbidden_terms", "禁止译法没有全部发现。" );
    addFailure(reasons, review.basicSevereFailures > 0, "quality.basic_set", "基本功能集存在严重目标语言、协议或结构错误。" );
  }
  if (report.revision === null) {
    reasons.push(releaseReason("revision.missing", "尚未记录精译修订伤害和解决效果。"));
  } else {
    validateRevision(report.revision);
    const revision = report.revision;
    addPending(reasons, revision.revisedSegments === 0, "revision.samples.missing", "没有被修订段落可供评测。" );
    addFailure(reasons, revision.introducedCritical > 0, "revision.critical", "修订引入了 critical 错误。" );
    addFailure(reasons, revision.revisedSegments > 0 && revision.harmedSegments / revision.revisedSegments > 0.05, "revision.harm_rate", "修订伤害率超过 5%。" );
    addFailure(reasons, revision.introducedIssues > 0 && revision.resolvedIssues / revision.introducedIssues < 3, "revision.solve_harm_ratio", "解决伤害比低于 3。" );
  }
  if (report.concurrency === null) {
    reasons.push(releaseReason("concurrency.missing", "尚未完成长文本并发配对评测。"));
  } else {
    validateConcurrency(report.concurrency);
    const concurrency = report.concurrency;
    for (const field of LOCAL_CONCURRENCY_SAMPLE_KEYS) {
      addPending(
        reasons,
        concurrency.localSimulationSamples[field] === 0,
        `concurrency.local.${field}.missing`,
        `本地模拟服务缺少 ${field} 样本。`,
      );
    }
    for (const field of REAL_CONCURRENCY_SAMPLE_KEYS) {
      addPending(
        reasons,
        concurrency.realBenchmarkSamples[field] === 0,
        `concurrency.real.${field}.missing`,
        `真实服务性能缺少 ${field} 样本。`,
      );
    }
    addPending(reasons, concurrency.periodCount < 3, "concurrency.periods", "真实性能至少要在三个时段重复采样。" );
    addFailure(reasons, concurrency.criticalIncrease > 0, "concurrency.critical", "并发增加了 critical 错误。" );
    addFailure(reasons, concurrency.undetectedStructuralDamage > 0, "concurrency.structure", "并发存在未发现的结构破坏。" );
    addFailure(reasons, concurrency.fullWeightedPoints === 0 ? concurrency.concurrency3WeightedPoints > 0 : concurrency.concurrency3WeightedPoints / concurrency.fullWeightedPoints > 1.05, "concurrency.quality", "并发加权错误点比全文高 5% 以上。" );
    addFailure(reasons, concurrency.fullP50Ms <= 0 || (concurrency.fullP50Ms - concurrency.concurrency3P50Ms) / concurrency.fullP50Ms < 0.2, "concurrency.speed", "默认并发 3 的 P50 没有比全文缩短至少 20%。" );
    addFailure(reasons, concurrency.fullTokens <= 0 || concurrency.concurrency3Tokens / concurrency.fullTokens > 1.35, "concurrency.tokens", "并发 token 超过全文的 1.35 倍。" );
    addFailure(reasons, concurrency.missingSegments > 0 || concurrency.duplicateSegments > 0 || concurrency.outOfOrderSegments > 0, "concurrency.integrity", "并发存在缺块、重复块或错序。" );
  }
  if (report.performance === null) {
    reasons.push(releaseReason("performance.missing", "尚未记录 P50、P95、token、调用和费用。"));
  } else {
    validatePerformance(report.performance);
    for (const summary of report.performance.summaries) {
      if (!serviceConditionsById.has(summary.serviceConditionId)) {
        throw validationError(
          `performance.${summary.conditionId}.serviceConditionId`,
          `不存在服务条件 ${summary.serviceConditionId}。`,
        );
      }
    }
    addPending(reasons, report.performance.conditionCount === 0, "performance.conditions.missing", "没有性能条件汇总。" );
    for (const summary of report.performance.summaries) {
      addPending(reasons, summary.sampleCount === 0, `performance.${summary.conditionId}.samples`, "性能条件没有样本。" );
      addPending(reasons, summary.periodCount < 3, `performance.${summary.conditionId}.periods`, "性能条件少于三个采样时段。" );
    }
  }
  if (report.platforms === null) {
    reasons.push(releaseReason("platforms.missing", "尚未完成 Windows、macOS 和 Linux 实机验收。"));
  } else {
    validatePlatforms(report.platforms);
    for (const platform of PLATFORM_KEYS) {
      const record = report.platforms[platform];
      addPending(
        reasons,
        record.recordId === null,
        `platforms.${platform}.record.pending`,
        `${platform} 实机验收尚无记录编号。`,
      );
      for (const check of PLATFORM_CHECK_KEYS) {
        addPending(
          reasons,
          record.checks[check] === "pending",
          `platforms.${platform}.${check}.pending`,
          `${platform} 的 ${check} 验收尚未完成。`,
        );
        addFailure(
          reasons,
          record.checks[check] === "fail",
          `platforms.${platform}.${check}.failed`,
          `${platform} 的 ${check} 验收失败。`,
        );
      }
    }
  }
  const decisionCodes = new Set(report.decisions.flatMap((decision) => decision.reasonCodes));
  if (reasons.length === 0) {
    addPending(
      reasons,
      !decisionCodes.has("release.conclusion"),
      "decisions.conclusion.missing",
      "报告尚未保存发布门槛结论。",
    );
  } else {
    const uncovered = reasons
      .map((reason) => reason.code)
      .filter((code) => !decisionCodes.has(code));
    addPending(
      reasons,
      uncovered.length > 0,
      "decisions.unaddressed",
      `仍有未记录处理决定的门槛项目：${uncovered.join("、")}。`,
    );
  }
  const status = reasons.some((reason) => reason.status === "fail")
    ? "fail"
    : reasons.length > 0
      ? "pending"
      : "pass";
  return Object.freeze({
    status,
    canPublish: status === "pass",
    reasons: Object.freeze(reasons),
  });
}

export function evaluateReleaseGate(report) {
  return evaluateReleaseGateInternal(report, null);
}

export async function evaluateReleaseGateWithEvidence(report, evidenceInput) {
  const { verifyEvaluationEvidence } = await import("./evidence-v1.mjs");
  const verifiedEvidence = verifyEvaluationEvidence({ report, ...evidenceInput });
  return evaluateReleaseGateInternal(report, verifiedEvidence);
}
