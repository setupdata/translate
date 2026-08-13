import { createHash } from "node:crypto";

import {
  createRequestFingerprint,
  hashCanonicalValue,
  summarizeEvaluationCases,
} from "./evaluation-v1.mjs";

export const EVALUATION_EVIDENCE_MANIFEST_VERSION = "evaluation-evidence-manifest.v1";
export const EVALUATION_EVIDENCE_RECORD_VERSION = "evaluation-evidence-record.v1";
export const VERIFIED_EVALUATION_EVIDENCE_VERSION = "verified-evaluation-evidence.v1";

const MANIFEST_KEYS = new Set([
  "schemaVersion",
  "evidenceId",
  "candidateVersion",
  "datasetVersion",
  "commitSha",
  "reportSha256",
  "casesSha256",
  "buildInputSha256",
  "caseCount",
  "artifacts",
  "attachments",
]);
const ARTIFACT_KEYS = new Set([
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
const ARTIFACT_REFERENCE_KEYS = new Set(["path", "sha256", "recordCount", "sectionHash"]);
const ATTACHMENT_KEYS = new Set([
  "attachmentId",
  "path",
  "sha256",
  "byteLength",
  "kind",
]);
const ATTACHMENT_KINDS = new Set([
  "automatic-log",
  "model-output",
  "paired-observation",
  "human-annotation",
  "revision-comparison",
  "concurrency-measurement",
  "performance-measurement",
  "platform-evidence",
  "upxs-package",
]);
const RECORD_KEYS = new Set([
  "schemaVersion",
  "evidenceType",
  "recordId",
  "candidateVersion",
  "datasetVersion",
  "recordedAt",
  "subjectId",
  "commitSha",
  "attachmentId",
  "payload",
]);
const AUTOMATIC_PAYLOAD_KEYS = new Set(["checkId", "status", "commitSha", "command", "resultHash"]);
const MODEL_PAYLOAD_KEYS = new Set([
  "caseId",
  "serviceConditionId",
  "requestFingerprint",
  "fingerprintCondition",
  "qualityMode",
  "segmentationMode",
  "thinkingMode",
  "status",
  "outputHash",
]);
const PAIRED_PAYLOAD_KEYS = new Set([
  "factor",
  "value",
  "caseId",
  "serviceConditionId",
  "requestFingerprint",
  "fingerprintCondition",
  "rejectionInputHash",
  "controlledConditionHash",
]);
const HUMAN_PAYLOAD_KEYS = new Set([
  "caseId",
  "reviewerId",
  "blindOrderId",
  "role",
  "overallLabel",
  "qualityMode",
  "modelOutputHash",
  "domainQualified",
  "critical",
  "major",
  "minor",
  "unflaggedCritical",
  "strictTermUndetected",
  "preferredApplicable",
  "preferredMatched",
  "forbiddenTotal",
  "forbiddenDetected",
  "basicSevereFailures",
  "resolved",
]);
const REVISION_PAYLOAD_KEYS = new Set([
  "caseId",
  "segmentId",
  "initialIssues",
  "resolvedIssues",
  "introducedIssues",
  "introducedCritical",
  "harmed",
]);
const CONCURRENCY_PAYLOAD_KEYS = new Set([
  "caseId",
  "serviceConditionId",
  "benchmarkKind",
  "concurrency",
  "periodId",
  "sampleIndex",
  "requestFingerprint",
  "fingerprintCondition",
  "criticalCount",
  "undetectedStructuralDamage",
  "weightedPoints",
  "missingSegments",
  "duplicateSegments",
  "outOfOrderSegments",
  "completionMs",
  "tokens",
]);
const PERFORMANCE_PAYLOAD_KEYS = new Set([
  "conditionId",
  "requestFingerprint",
  "fingerprintCondition",
  "sampleIndex",
  "periodId",
  "firstCodePointMs",
  "completionMs",
  "inputTokens",
  "outputTokens",
  "reasoningTokens",
  "callCount",
  "cancelled",
  "timedOut",
  "revisionTriggered",
  "feeAmount",
  "feeCurrency",
]);
const PLATFORM_PAYLOAD_KEYS = new Set([
  "platform",
  "acceptanceRecordId",
  "checkId",
  "status",
  "packageSha256",
  "packageAttachmentId",
  "buildInputSha256",
  "signatureVerificationMethod",
  "utoolsVersion",
  "osVersion",
  "testerId",
  "observedAt",
  "evidenceHash",
]);
const PLATFORM_CHECK_IDS = new Set([
  "upxsInstallation",
  "entryAndShortcut",
  "backgroundAndNotification",
  "copyPaste",
  "themeAndAccessibility",
  "httpsAndLoopbackHttp",
  "processRestartNoSensitiveResidue",
]);
const AUTOMATIC_BOOLEAN_CHECKS = new Map([
  ["tests", "testsPassed"],
  ["schema", "schemaPassed"],
  ["protocol", "protocolPassed"],
  ["entry", "entryPassed"],
  ["authentication", "authenticationPassed"],
  ["cancellation", "cancellationPassed"],
  ["runtime-isolation", "runtimeIsolationPassed"],
  ["reset-storage", "resetStoragePassed"],
]);
const PAIRED_FACTOR_VALUES = new Map([
  ["quality-mode", ["standard", "precision"]],
  ["terminology", ["none", "applicable", "inapplicable"]],
  ["reference-translations", ["0", "3", "4-rejected"]],
  ["domain-selection", ["selected", "none"]],
  ["segmentation", ["full-document", "segmented"]],
  ["thinking-mode", ["disabled", "enabled"]],
  ["protocol", ["chat-completions", "responses"]],
]);
const ARTIFACT_TYPES = new Map([
  ["automaticChecks", "automatic-check"],
  ["modelResults", "model-result"],
  ["pairedComparisons", "paired-comparison"],
  ["humanReviews", "human-review"],
  ["revision", "revision"],
  ["concurrency", "concurrency"],
  ["performance", "performance"],
  ["platformWindows", "platform"],
  ["platformMacOS", "platform"],
  ["platformLinux", "platform"],
]);
const ARTIFACT_ATTACHMENT_KINDS = new Map([
  ["automaticChecks", "automatic-log"],
  ["modelResults", "model-output"],
  ["pairedComparisons", "paired-observation"],
  ["humanReviews", "human-annotation"],
  ["revision", "revision-comparison"],
  ["concurrency", "concurrency-measurement"],
  ["performance", "performance-measurement"],
  ["platformWindows", "platform-evidence"],
  ["platformMacOS", "platform-evidence"],
  ["platformLinux", "platform-evidence"],
]);
const SENSITIVE_EVIDENCE_FIELD = /^(?:(?:x|x-goog)[_-])?(?:source|sourceText|translation|translatedText|rawResponse|prompt|api[_-]?key|access[_-]?token|token|authorization|headers?|credentials?|password|passphrase|private[_-]?key|client[_-]?secret|secret|terms?|termbase|referenceTranslations?)$/iu;

function evidenceError(path, message) {
  const error = new Error(`${path}: ${message}`);
  error.code = "evaluation_evidence_error";
  error.path = path;
  return error;
}

function assertRecord(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw evidenceError(path, "必须是 JSON 对象。");
  }
}

function assertExactKeys(value, allowed, path) {
  assertRecord(value, path);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw evidenceError(path, `含未知字段：${unknown.join("、")}。`);
  const missing = [...allowed].filter((key) => !Object.hasOwn(value, key));
  if (missing.length > 0) throw evidenceError(path, `缺少字段：${missing.join("、")}。`);
}

function assertText(value, path, maximum = 2_000) {
  if (typeof value !== "string" || value.length === 0 || Array.from(value).length > maximum) {
    throw evidenceError(path, `必须是 1 至 ${maximum} 个 Unicode 码点的字符串。`);
  }
}

function assertSha256(value, path) {
  if (typeof value !== "string" || !/^[a-f\d]{64}$/u.test(value)) {
    throw evidenceError(path, "必须是 64 位小写 SHA-256 十六进制值。");
  }
}

function assertInteger(value, path, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw evidenceError(path, `必须是大于等于 ${minimum} 的安全整数。`);
  }
}

function assertNumber(value, path, minimum = 0) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw evidenceError(path, `必须是大于等于 ${minimum} 的有限数值。`);
  }
}

function assertBoolean(value, path) {
  if (typeof value !== "boolean") throw evidenceError(path, "必须是布尔值。");
}

function assertEnum(value, allowed, path) {
  if (!allowed.has(value)) throw evidenceError(path, `不支持 ${String(value)}。`);
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

function nearlyEqual(left, right) {
  return Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 16;
}

function assertSafeRelativePath(value, path) {
  assertText(value, path, 500);
  if (
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value) ||
    value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw evidenceError(path, "必须是证据清单目录内的规范化相对路径。");
  }
}

function assertNoSensitiveFields(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_EVIDENCE_FIELD.test(key)) {
      throw evidenceError(`${path}.${key}`, `${key} 等用户内容或密钥字段不得进入评测证据。`);
    }
    assertNoSensitiveFields(child, `${path}.${key}`);
  }
}

function byteLengthOf(source) {
  if (typeof source === "string") return Buffer.byteLength(source);
  if (source instanceof Uint8Array) return source.byteLength;
  return -1;
}

function validateAttachmentManifest(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    throw evidenceError("evidenceManifest.attachments", "必须至少包含一个原始证据附件。");
  }
  const byId = new Map();
  const paths = new Set();
  const hashes = new Set();
  attachments.forEach((attachment, index) => {
    const path = `evidenceManifest.attachments[${index}]`;
    assertExactKeys(attachment, ATTACHMENT_KEYS, path);
    assertText(attachment.attachmentId, `${path}.attachmentId`, 500);
    if (byId.has(attachment.attachmentId)) {
      throw evidenceError(`${path}.attachmentId`, "附件 ID 必须唯一。");
    }
    assertSafeRelativePath(attachment.path, `${path}.path`);
    if (paths.has(attachment.path)) throw evidenceError(`${path}.path`, "附件路径必须唯一。");
    assertSha256(attachment.sha256, `${path}.sha256`);
    if (hashes.has(attachment.sha256)) {
      throw evidenceError(`${path}.sha256`, "除共享 UPXS 包外，每个原始证据附件的内容哈希必须唯一。");
    }
    assertInteger(attachment.byteLength, `${path}.byteLength`, 1);
    assertEnum(attachment.kind, ATTACHMENT_KINDS, `${path}.kind`);
    byId.set(attachment.attachmentId, attachment);
    paths.add(attachment.path);
    hashes.add(attachment.sha256);
  });
  return byId;
}

function verifyAttachmentSources(manifest, attachmentSources) {
  assertRecord(attachmentSources, "attachmentSources");
  const byId = validateAttachmentManifest(manifest.attachments);
  for (const attachment of byId.values()) {
    const source = attachmentSources[attachment.path];
    const actualByteLength = byteLengthOf(source);
    if (actualByteLength < 0) throw evidenceError(attachment.path, "原始证据附件不存在。");
    if (actualByteLength !== attachment.byteLength) {
      throw evidenceError(attachment.path, "原始证据附件字节数与清单不一致。");
    }
    if (sha256(source) !== attachment.sha256) {
      throw evidenceError(attachment.path, "原始证据附件 SHA-256 与清单不一致。");
    }
  }
  return byId;
}

function validateFingerprintPayload(payload, path) {
  assertRecord(payload.fingerprintCondition, `${path}.fingerprintCondition`);
  const fingerprint = createRequestFingerprint(payload.fingerprintCondition);
  if (fingerprint !== payload.requestFingerprint) {
    throw evidenceError(`${path}.requestFingerprint`, "无法由 fingerprintCondition 重新计算得到。" );
  }
}

function validateEvidencePayload(type, payload, path) {
  if (type === "automatic-check") {
    assertExactKeys(payload, AUTOMATIC_PAYLOAD_KEYS, path);
    assertText(payload.checkId, `${path}.checkId`, 200);
    assertEnum(payload.status, new Set(["pass", "fail"]), `${path}.status`);
    if (typeof payload.commitSha !== "string" || !/^[a-f\d]{40}$/u.test(payload.commitSha)) {
      throw evidenceError(`${path}.commitSha`, "必须是完整的 40 位 Git commit SHA。");
    }
    assertText(payload.command, `${path}.command`, 500);
    assertSha256(payload.resultHash, `${path}.resultHash`);
    return;
  }
  if (type === "model-result") {
    assertExactKeys(payload, MODEL_PAYLOAD_KEYS, path);
    assertText(payload.caseId, `${path}.caseId`, 200);
    assertText(payload.serviceConditionId, `${path}.serviceConditionId`, 200);
    assertSha256(payload.requestFingerprint, `${path}.requestFingerprint`);
    validateFingerprintPayload(payload, path);
    assertEnum(payload.qualityMode, new Set(["standard", "precision"]), `${path}.qualityMode`);
    assertEnum(
      payload.segmentationMode,
      new Set(["full-document", "segmented"]),
      `${path}.segmentationMode`,
    );
    assertBoolean(payload.thinkingMode, `${path}.thinkingMode`);
    assertEnum(payload.status, new Set(["completed", "failed"]), `${path}.status`);
    assertSha256(payload.outputHash, `${path}.outputHash`);
    return;
  }
  if (type === "paired-comparison") {
    assertExactKeys(payload, PAIRED_PAYLOAD_KEYS, path);
    assertEnum(payload.factor, new Set(PAIRED_FACTOR_VALUES.keys()), `${path}.factor`);
    assertEnum(payload.value, new Set(PAIRED_FACTOR_VALUES.get(payload.factor)), `${path}.value`);
    for (const field of ["caseId", "serviceConditionId"]) {
      assertText(payload[field], `${path}.${field}`, 200);
    }
    if (payload.value === "4-rejected") {
      if (payload.requestFingerprint !== null || payload.fingerprintCondition !== null) {
        throw evidenceError(path, "被本地拒绝的第 4 条参考译例不能伪造请求指纹。" );
      }
      assertSha256(payload.rejectionInputHash, `${path}.rejectionInputHash`);
    } else {
      assertSha256(payload.requestFingerprint, `${path}.requestFingerprint`);
      validateFingerprintPayload(payload, path);
      if (payload.rejectionInputHash !== null) {
        throw evidenceError(`${path}.rejectionInputHash`, "已发请求的配对记录不得填写拒绝输入哈希。" );
      }
    }
    assertSha256(payload.controlledConditionHash, `${path}.controlledConditionHash`);
    return;
  }
  if (type === "human-review") {
    assertExactKeys(payload, HUMAN_PAYLOAD_KEYS, path);
    for (const field of ["caseId", "reviewerId", "blindOrderId"]) {
      assertText(payload[field], `${path}.${field}`, 200);
    }
    assertEnum(payload.role, new Set(["reviewer", "adjudication"]), `${path}.role`);
    assertEnum(
      payload.overallLabel,
      new Set(["pass", "minor", "major", "critical"]),
      `${path}.overallLabel`,
    );
    assertEnum(payload.qualityMode, new Set(["standard", "precision"]), `${path}.qualityMode`);
    assertSha256(payload.modelOutputHash, `${path}.modelOutputHash`);
    assertBoolean(payload.domainQualified, `${path}.domainQualified`);
    for (const field of [
      "critical",
      "major",
      "minor",
      "unflaggedCritical",
      "strictTermUndetected",
      "preferredApplicable",
      "preferredMatched",
      "forbiddenTotal",
      "forbiddenDetected",
      "basicSevereFailures",
    ]) {
      assertInteger(payload[field], `${path}.${field}`);
    }
    if (payload.preferredMatched > payload.preferredApplicable) {
      throw evidenceError(`${path}.preferredMatched`, "不能大于 preferredApplicable。" );
    }
    if (payload.forbiddenDetected > payload.forbiddenTotal) {
      throw evidenceError(`${path}.forbiddenDetected`, "不能大于 forbiddenTotal。" );
    }
    assertBoolean(payload.resolved, `${path}.resolved`);
    return;
  }
  if (type === "revision") {
    assertExactKeys(payload, REVISION_PAYLOAD_KEYS, path);
    for (const field of ["caseId", "segmentId"]) assertText(payload[field], `${path}.${field}`, 200);
    for (const field of ["initialIssues", "resolvedIssues", "introducedIssues", "introducedCritical"]) {
      assertInteger(payload[field], `${path}.${field}`);
    }
    assertBoolean(payload.harmed, `${path}.harmed`);
    return;
  }
  if (type === "concurrency") {
    assertExactKeys(payload, CONCURRENCY_PAYLOAD_KEYS, path);
    assertText(payload.caseId, `${path}.caseId`, 200);
    assertText(payload.serviceConditionId, `${path}.serviceConditionId`, 200);
    assertEnum(payload.benchmarkKind, new Set(["local-simulation", "real-service"]), `${path}.benchmarkKind`);
    assertInteger(payload.concurrency, `${path}.concurrency`, 1);
    assertText(payload.periodId, `${path}.periodId`, 200);
    assertInteger(payload.sampleIndex, `${path}.sampleIndex`);
    assertSha256(payload.requestFingerprint, `${path}.requestFingerprint`);
    validateFingerprintPayload(payload, path);
    for (const field of [
      "criticalCount",
      "undetectedStructuralDamage",
      "missingSegments",
      "duplicateSegments",
      "outOfOrderSegments",
    ]) {
      assertInteger(payload[field], `${path}.${field}`);
    }
    for (const field of ["weightedPoints", "completionMs", "tokens"]) {
      assertNumber(payload[field], `${path}.${field}`);
    }
    return;
  }
  if (type === "performance") {
    assertExactKeys(payload, PERFORMANCE_PAYLOAD_KEYS, path);
    for (const field of ["conditionId", "periodId", "feeCurrency"]) {
      assertText(payload[field], `${path}.${field}`, 200);
    }
    assertSha256(payload.requestFingerprint, `${path}.requestFingerprint`);
    validateFingerprintPayload(payload, path);
    for (const field of ["sampleIndex", "callCount"]) assertInteger(payload[field], `${path}.${field}`);
    for (const field of [
      "firstCodePointMs",
      "completionMs",
      "inputTokens",
      "outputTokens",
      "reasoningTokens",
      "feeAmount",
    ]) {
      assertNumber(payload[field], `${path}.${field}`);
    }
    assertBoolean(payload.cancelled, `${path}.cancelled`);
    assertBoolean(payload.timedOut, `${path}.timedOut`);
    assertBoolean(payload.revisionTriggered, `${path}.revisionTriggered`);
    return;
  }
  if (type === "platform") {
    assertExactKeys(payload, PLATFORM_PAYLOAD_KEYS, path);
    assertEnum(payload.platform, new Set(["windows", "macOS", "linux"]), `${path}.platform`);
    assertText(payload.acceptanceRecordId, `${path}.acceptanceRecordId`, 200);
    assertEnum(payload.checkId, PLATFORM_CHECK_IDS, `${path}.checkId`);
    assertEnum(payload.status, new Set(["pass", "fail"]), `${path}.status`);
    assertSha256(payload.packageSha256, `${path}.packageSha256`);
    assertText(payload.packageAttachmentId, `${path}.packageAttachmentId`, 500);
    assertSha256(payload.buildInputSha256, `${path}.buildInputSha256`);
    assertEnum(
      payload.signatureVerificationMethod,
      new Set(["utools-installed-package"]),
      `${path}.signatureVerificationMethod`,
    );
    for (const field of ["utoolsVersion", "osVersion", "testerId"]) {
      assertText(payload[field], `${path}.${field}`, 200);
    }
    if (
      typeof payload.observedAt !== "string" ||
      Number.isNaN(Date.parse(payload.observedAt))
    ) {
      throw evidenceError(`${path}.observedAt`, "必须是可解析的 ISO 时间。");
    }
    assertSha256(payload.evidenceHash, `${path}.evidenceHash`);
    return;
  }
  throw evidenceError(`${path}.evidenceType`, `不支持 ${type}。`);
}

function parseEvidenceRecords(
  source,
  { artifactName, expectedType, candidateVersion, datasetVersion, commitSha },
) {
  if (typeof source !== "string") throw evidenceError(artifactName, "证据文件必须是 UTF-8 文本。");
  const records = [];
  const recordIds = new Set();
  const subjectIds = new Set();
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    if (line.trim().length === 0) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw evidenceError(`${artifactName}:${index + 1}`, "不是完整的单个 JSON 对象。");
    }
    const path = `${artifactName}:${index + 1}`;
    assertExactKeys(record, RECORD_KEYS, path);
    if (record.schemaVersion !== EVALUATION_EVIDENCE_RECORD_VERSION) {
      throw evidenceError(`${path}.schemaVersion`, `必须是 ${EVALUATION_EVIDENCE_RECORD_VERSION}。`);
    }
    if (record.evidenceType !== expectedType) {
      throw evidenceError(`${path}.evidenceType`, `必须是 ${expectedType}。`);
    }
    for (const field of ["recordId", "candidateVersion", "datasetVersion", "subjectId", "attachmentId"]) {
      assertText(record[field], `${path}.${field}`, 500);
    }
    if (record.candidateVersion !== candidateVersion || record.datasetVersion !== datasetVersion) {
      throw evidenceError(path, "候选版本或数据集版本与证据清单不一致。");
    }
    if (record.commitSha !== commitSha) {
      throw evidenceError(`${path}.commitSha`, "没有绑定到证据清单中的候选 Git commit。");
    }
    if (recordIds.has(record.recordId)) throw evidenceError(`${path}.recordId`, "在文件内必须唯一。");
    recordIds.add(record.recordId);
    if (subjectIds.has(record.subjectId)) throw evidenceError(`${path}.subjectId`, "在文件内必须唯一。");
    subjectIds.add(record.subjectId);
    if (
      typeof record.recordedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(record.recordedAt) ||
      Number.isNaN(Date.parse(record.recordedAt))
    ) {
      throw evidenceError(`${path}.recordedAt`, "必须是 UTC ISO 时间。");
    }
    assertRecord(record.payload, `${path}.payload`);
    assertNoSensitiveFields(record.payload, `${path}.payload`);
    validateEvidencePayload(expectedType, record.payload, `${path}.payload`);
    records.push(record);
  }
  return records;
}

function conditionMatchesService(condition, service) {
  return (
    condition.providerType === service.kind &&
    condition.serviceConfigurationId === service.serviceConfigurationId &&
    condition.normalizedTranslationUrl === service.normalizedTranslationUrl &&
    condition.adapterBuildVersion === service.adapterBuildVersion &&
    condition.protocol === service.protocol &&
    condition.model === service.model &&
    condition.reportedModelVersion === service.reportedModelVersion &&
    condition.promptVersion === service.promptVersion &&
    condition.schemaVersion === service.schemaVersion
  );
}

function assertConditionMatchesKnownService(condition, serviceConditionsById, path) {
  if (![...serviceConditionsById.values()].some((service) => conditionMatchesService(condition, service))) {
    throw evidenceError(path, "请求指纹条件不属于报告中的服务、端点、模型和协议。" );
  }
}

export function createControlledConditionHash(condition, factor) {
  const controlled = structuredClone(condition);
  delete controlled.canonicalRequestBodyHash;
  delete controlled.sourceCaseId;
  const removable = new Map([
    ["quality-mode", ["qualityMode"]],
    ["terminology", ["termbaseVersion"]],
    ["reference-translations", ["referenceTranslationIds"]],
    ["domain-selection", ["domainProfileVersion"]],
    ["segmentation", ["segmentationMode", "chunkingVersion", "concurrency"]],
    ["thinking-mode", ["thinkingMode"]],
    ["protocol", ["protocol", "normalizedTranslationUrl"]],
  ]);
  for (const field of removable.get(factor) ?? []) delete controlled[field];
  return hashCanonicalValue(controlled);
}

function assertPairedFactorValue(payload, path) {
  const condition = payload.fingerprintCondition;
  if (payload.factor === "quality-mode" && condition.qualityMode !== payload.value) {
    throw evidenceError(`${path}.value`, "与请求质量模式不一致。" );
  }
  if (
    payload.factor === "thinking-mode" &&
    condition.thinkingMode !== (payload.value === "enabled")
  ) {
    throw evidenceError(`${path}.value`, "与请求思考模式不一致。" );
  }
  if (payload.factor === "protocol" && condition.protocol !== payload.value) {
    throw evidenceError(`${path}.value`, "与请求协议不一致。" );
  }
  if (payload.factor === "segmentation" && condition.segmentationMode !== payload.value) {
    throw evidenceError(`${path}.value`, "与请求分段模式不一致。" );
  }
  if (payload.factor === "reference-translations") {
    const expected = Number(payload.value);
    if (Number.isFinite(expected) && condition.referenceTranslationIds.length !== expected) {
      throw evidenceError(`${path}.value`, "与请求参考译例数量不一致。" );
    }
  }
  if (payload.factor === "domain-selection") {
    const selected = condition.domainProfileVersion !== "none";
    if (selected !== (payload.value === "selected")) {
      throw evidenceError(`${path}.value`, "与请求行业配置状态不一致。" );
    }
  }
  if (payload.factor === "terminology") {
    const version = condition.termbaseVersion;
    const matches =
      (payload.value === "none" && version === "none") ||
      (payload.value === "applicable" && version.startsWith("applicable:")) ||
      (payload.value === "inapplicable" && version.startsWith("inapplicable:"));
    if (!matches) throw evidenceError(`${path}.value`, "与请求术语条件不一致。" );
  }
}

function averagePairwiseKappa(groups, reviewerIds) {
  if (groups.length === 0 || reviewerIds.length < 2) return 0;
  const labels = ["pass", "minor", "major", "critical"];
  const kappas = [];
  for (let leftIndex = 0; leftIndex < reviewerIds.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < reviewerIds.length; rightIndex += 1) {
      const leftId = reviewerIds[leftIndex];
      const rightId = reviewerIds[rightIndex];
      const pairs = groups
        .map((group) => [group.get(leftId), group.get(rightId)])
        .filter(([left, right]) => left !== undefined && right !== undefined);
      if (pairs.length === 0) continue;
      const observed = pairs.filter(([left, right]) => left === right).length / pairs.length;
      const expected = labels.reduce((sum, label) => {
        const leftRate = pairs.filter(([left]) => left === label).length / pairs.length;
        const rightRate = pairs.filter(([, right]) => right === label).length / pairs.length;
        return sum + leftRate * rightRate;
      }, 0);
      kappas.push(expected === 1 ? 1 : (observed - expected) / (1 - expected));
    }
  }
  return kappas.length === 0 ? 0 : kappas.reduce((sum, value) => sum + value, 0) / kappas.length;
}

function validateRecordAttachments(artifactName, records, attachmentsById, usedAttachmentIds) {
  const expectedKind = ARTIFACT_ATTACHMENT_KINDS.get(artifactName);
  for (const [index, record] of records.entries()) {
    const path = `${artifactName}:${index + 1}`;
    const attachment = attachmentsById.get(record.attachmentId);
    if (!attachment) throw evidenceError(`${path}.attachmentId`, "引用的原始证据附件不存在。");
    if (attachment.kind !== expectedKind) {
      throw evidenceError(`${path}.attachmentId`, `附件类型必须是 ${expectedKind}。`);
    }
    if (usedAttachmentIds.has(record.attachmentId)) {
      throw evidenceError(`${path}.attachmentId`, "每条证据记录必须绑定独立的原始附件。");
    }
    usedAttachmentIds.add(record.attachmentId);
    if (record.evidenceType === "automatic-check" && record.payload.resultHash !== attachment.sha256) {
      throw evidenceError(`${path}.payload.resultHash`, "必须等于原始检查输出附件的 SHA-256。");
    }
    if (record.evidenceType === "model-result" && record.payload.outputHash !== attachment.sha256) {
      throw evidenceError(`${path}.payload.outputHash`, "必须等于原始模型输出附件的 SHA-256。");
    }
    if (
      record.evidenceType === "paired-comparison" &&
      record.payload.value === "4-rejected" &&
      record.payload.rejectionInputHash !== attachment.sha256
    ) {
      throw evidenceError(`${path}.payload.rejectionInputHash`, "必须等于本地拒绝证据附件的 SHA-256。");
    }
    if (record.evidenceType === "platform" && record.payload.evidenceHash !== attachment.sha256) {
      throw evidenceError(`${path}.payload.evidenceHash`, "必须等于平台验收附件的 SHA-256。");
    }
  }
}

function validateArtifactRecords(artifactName, records, report, cases, context) {
  const caseById = new Map(cases.map((item) => [item.caseId, item]));
  const serviceConditionsById = new Map(
    (report.serviceConditions ?? []).map((item) => [item.conditionId, item]),
  );
  const performanceById = new Map(
    (report.performance?.summaries ?? []).map((item) => [item.conditionId, item]),
  );
  const assertCase = (caseId, path) => {
    if (!caseById.has(caseId)) throw evidenceError(path, `不存在评测用例 ${caseId}。`);
  };
  if (artifactName === "automaticChecks") {
    const checkIds = new Set();
    for (const [index, record] of records.entries()) {
      if (record.payload.commitSha !== context.commitSha) {
        throw evidenceError(`${artifactName}:${index + 1}.payload.commitSha`, "与候选 Git commit 不一致。");
      }
      if (checkIds.has(record.payload.checkId)) {
        throw evidenceError(`${artifactName}:${index + 1}.payload.checkId`, "自动检查 ID 不得重复。" );
      }
      checkIds.add(record.payload.checkId);
    }
    const recordsByCheckId = new Map(records.map((record) => [record.payload.checkId, record]));
    for (const [checkId, reportField] of AUTOMATIC_BOOLEAN_CHECKS) {
      const record = recordsByCheckId.get(checkId);
      if (!record) throw evidenceError(artifactName, `缺少 ${checkId} 自动检查记录。`);
      const expectedStatus = report.automaticChecks?.[reportField] ? "pass" : "fail";
      if (record.payload.status !== expectedStatus) {
        throw evidenceError(`${artifactName}.${checkId}`, "与报告自动检查状态不一致。");
      }
    }
    for (const [prefix, reportField, resultField] of [
      ["injection:", "injection", "detected"],
      ["protected:", "protectedContent", "detected"],
      ["chunk:", "chunkIntegrity", "detected"],
      ["redirect:", "crossOriginRedirect", "blocked"],
    ]) {
      const matching = records.filter((record) => record.payload.checkId.startsWith(prefix));
      const expected = report.automaticChecks?.[reportField];
      if (matching.length !== expected.total) {
        throw evidenceError(artifactName, `${prefix} 夹具数量与报告不一致。`);
      }
      if (matching.filter((record) => record.payload.status === "pass").length !== expected[resultField]) {
        throw evidenceError(artifactName, `${prefix} 夹具通过数量与报告不一致。`);
      }
    }
    return;
  }
  if (artifactName === "modelResults") {
    const requests = new Set();
    const coveredServiceConditions = new Set();
    const counts = {
      standard: 0,
      precision: 0,
      fullDocument: 0,
      segmented: 0,
      thinkingEnabled: 0,
      thinkingDisabled: 0,
    };
    for (const [index, record] of records.entries()) {
      assertCase(record.payload.caseId, `${artifactName}:${index + 1}.payload.caseId`);
      if (record.payload.fingerprintCondition.sourceCaseId !== record.payload.caseId) {
        throw evidenceError(`${artifactName}:${index + 1}.payload.fingerprintCondition.sourceCaseId`, "与记录用例不一致。" );
      }
      const service = serviceConditionsById.get(record.payload.serviceConditionId);
      if (!service || !conditionMatchesService(record.payload.fingerprintCondition, service)) {
        throw evidenceError(
          `${artifactName}:${index + 1}.payload.serviceConditionId`,
          "请求条件与报告中的服务条件不一致。",
        );
      }
      coveredServiceConditions.add(record.payload.serviceConditionId);
      if (record.payload.fingerprintCondition.adapterBuildVersion !== context.commitSha) {
        throw evidenceError(
          `${artifactName}:${index + 1}.payload.fingerprintCondition.adapterBuildVersion`,
          "与候选 Git commit 不一致。",
        );
      }
      if (
        record.payload.qualityMode !== record.payload.fingerprintCondition.qualityMode ||
        record.payload.segmentationMode !== record.payload.fingerprintCondition.segmentationMode ||
        record.payload.thinkingMode !== record.payload.fingerprintCondition.thinkingMode
      ) {
        throw evidenceError(`${artifactName}:${index + 1}.payload`, "模式字段与请求指纹条件不一致。");
      }
      const requestKey = `${record.payload.caseId}\u0000${record.payload.requestFingerprint}`;
      if (requests.has(requestKey)) {
        throw evidenceError(`${artifactName}:${index + 1}.payload.requestFingerprint`, "同一用例和请求条件只能计入一次基线输出。");
      }
      requests.add(requestKey);
      if (record.payload.status !== "completed") {
        throw evidenceError(`${artifactName}:${index + 1}.payload.status`, "发布证据只计入已完成输出。");
      }
      counts[record.payload.qualityMode] += 1;
      counts[record.payload.segmentationMode === "full-document" ? "fullDocument" : "segmented"] += 1;
      counts[record.payload.thinkingMode ? "thinkingEnabled" : "thinkingDisabled"] += 1;
    }
    context.modelOutputs = new Set(records.map((record) => record.payload.outputHash));
    context.modelOutputByCaseMode = new Set(
      records.map((record) => `${record.payload.caseId}\u0000${record.payload.qualityMode}\u0000${record.payload.outputHash}`),
    );
    for (const [field, actual] of Object.entries(counts)) {
      if (actual !== report.sampleCounts?.[field]) {
        throw evidenceError(artifactName, `${field} 实际记录数与报告不一致。`);
      }
    }
    for (const conditionId of serviceConditionsById.keys()) {
      if (!coveredServiceConditions.has(conditionId)) {
        throw evidenceError(artifactName, `模型输出证据缺少服务条件 ${conditionId}。`);
      }
    }
    return;
  }
  if (artifactName === "pairedComparisons") {
    const comparisonByFactor = new Map(
      (report.pairedComparisons ?? []).map((comparison) => [comparison.factor, comparison]),
    );
    const groups = new Map();
    for (const [index, record] of records.entries()) {
      const payload = record.payload;
      const path = `${artifactName}:${index + 1}.payload`;
      assertCase(payload.caseId, `${path}.caseId`);
      const comparison = comparisonByFactor.get(payload.factor);
      if (!comparison) throw evidenceError(`${path}.factor`, "报告中没有对应配对条件。");
      if (!comparison.values.includes(payload.value)) {
        throw evidenceError(`${path}.value`, "不属于报告声明的配对值。");
      }
      if (!comparison.serviceConditionIds.includes(payload.serviceConditionId)) {
        throw evidenceError(`${path}.serviceConditionId`, "不属于报告声明的服务条件。");
      }
      if (!serviceConditionsById.has(payload.serviceConditionId)) {
        throw evidenceError(`${path}.serviceConditionId`, "服务条件不存在。");
      }
      if (payload.value !== "4-rejected") {
        if (payload.fingerprintCondition.sourceCaseId !== payload.caseId) {
          throw evidenceError(`${path}.fingerprintCondition.sourceCaseId`, "与配对用例不一致。" );
        }
        const service = serviceConditionsById.get(payload.serviceConditionId);
        if (!conditionMatchesService(payload.fingerprintCondition, service)) {
          throw evidenceError(`${path}.fingerprintCondition`, "与配对服务条件不一致。" );
        }
        if (payload.fingerprintCondition.adapterBuildVersion !== context.commitSha) {
          throw evidenceError(`${path}.fingerprintCondition.adapterBuildVersion`, "与候选 Git commit 不一致。");
        }
        assertPairedFactorValue(payload, path);
        if (createControlledConditionHash(payload.fingerprintCondition, payload.factor) !== payload.controlledConditionHash) {
          throw evidenceError(`${path}.controlledConditionHash`, "无法由该请求的其余受控条件重新计算得到。" );
        }
      }
      if (payload.controlledConditionHash !== comparison.controlledConditionHash) {
        throw evidenceError(`${path}.controlledConditionHash`, "与报告中的受控条件哈希不一致。");
      }
      const groupKey = `${payload.factor}\u0000${payload.caseId}`;
      const values = groups.get(groupKey) ?? new Set();
      if (values.has(payload.value)) throw evidenceError(path, "同一用例的配对值不得重复。");
      values.add(payload.value);
      groups.set(groupKey, values);
    }
    for (const comparison of report.pairedComparisons ?? []) {
      const factorGroups = [...groups.entries()].filter(([key]) => key.startsWith(`${comparison.factor}\u0000`));
      if (factorGroups.length < comparison.sampleCount) {
        throw evidenceError(artifactName, `${comparison.factor} 配对用例少于报告声明数量。`);
      }
      for (const [, values] of factorGroups) {
        if (values.size !== comparison.values.length) {
          throw evidenceError(artifactName, `${comparison.factor} 的同一用例没有覆盖全部配对值。`);
        }
      }
    }
    return;
  }
  if (artifactName === "humanReviews") {
    const reviewerLabelsByGroup = new Map();
    const reviewerIds = new Set();
    const domainReviewerIds = new Set();
    const adjudications = new Map();
    const totals = {
      standardCritical: 0,
      precisionCritical: 0,
      standardWeightedPoints: 0,
      precisionWeightedPoints: 0,
      unflaggedCritical: 0,
      strictTermUndetected: 0,
      preferredApplicable: 0,
      preferredMatched: 0,
      forbiddenTotal: 0,
      forbiddenDetected: 0,
      basicSevereFailures: 0,
    };
    for (const [index, record] of records.entries()) {
      const path = `${artifactName}:${index + 1}.payload`;
      assertCase(record.payload.caseId, `${path}.caseId`);
      const outputKey = `${record.payload.caseId}\u0000${record.payload.qualityMode}\u0000${record.payload.modelOutputHash}`;
      if (!context.modelOutputByCaseMode.has(outputKey)) {
        throw evidenceError(`${path}.modelOutputHash`, "没有绑定到该用例和质量模式的模型输出附件。" );
      }
      const key = `${record.payload.caseId}\u0000${record.payload.qualityMode}`;
      if (record.payload.role === "reviewer") {
        const labels = reviewerLabelsByGroup.get(key) ?? new Map();
        if (labels.has(record.payload.reviewerId)) {
          throw evidenceError(`${path}.reviewerId`, "同一输出的评审人不得重复。" );
        }
        labels.set(record.payload.reviewerId, record.payload.overallLabel);
        reviewerLabelsByGroup.set(key, labels);
        reviewerIds.add(record.payload.reviewerId);
        if (record.payload.domainQualified) domainReviewerIds.add(record.payload.reviewerId);
      } else {
        if (adjudications.has(key)) throw evidenceError(path, "同一输出只能有一条裁决记录。");
        adjudications.set(key, record.payload);
        const modePrefix = record.payload.qualityMode === "standard" ? "standard" : "precision";
        totals[`${modePrefix}Critical`] += record.payload.critical;
        totals[`${modePrefix}WeightedPoints`] +=
          record.payload.critical * 25 + record.payload.major * 5 + record.payload.minor;
        for (const field of [
          "unflaggedCritical",
          "strictTermUndetected",
          "preferredApplicable",
          "preferredMatched",
          "forbiddenTotal",
          "forbiddenDetected",
          "basicSevereFailures",
        ]) {
          totals[field] += record.payload[field];
        }
      }
    }
    if (report.humanReview.reviewerCount === 0) {
      if (records.length !== 0) throw evidenceError(artifactName, "未声明人工评审时不得附加评审记录。");
      if (
        report.humanReview.domainReviewerCount !== 0 ||
        report.humanReview.agreementRate !== 0 ||
        report.humanReview.cohenKappa !== 0 ||
        report.humanReview.unresolvedSamples !== 0 ||
        Object.values(totals).some((value) => value !== 0)
      ) {
        throw evidenceError(artifactName, "空人工评审分区不能声明评审人数、指标或问题计数。");
      }
      return;
    }
    const coreCases = cases.filter((item) => {
      const source = item.sourceLanguage;
      const target = item.targetLanguage;
      return (
        (source === "English" && target === "Simplified Chinese") ||
        (source === "Simplified Chinese" && target === "English")
      );
    });
    const reviewGroups = [];
    let unresolvedSamples = 0;
    for (const item of coreCases) {
      for (const mode of ["standard", "precision"]) {
        const key = `${item.caseId}\u0000${mode}`;
        const labels = reviewerLabelsByGroup.get(key) ?? new Map();
        if (labels.size !== report.humanReview.reviewerCount) {
          throw evidenceError(artifactName, `${item.caseId} ${mode} 缺少独立评审记录。` );
        }
        const adjudication = adjudications.get(key);
        if (!adjudication) throw evidenceError(artifactName, `${item.caseId} ${mode} 缺少裁决记录。`);
        if (!adjudication.resolved) unresolvedSamples += 1;
        if (
          (item.evaluationDomain === "energy" || item.evaluationDomain === "legal") &&
          records.filter(
            (record) =>
              record.payload.role === "reviewer" &&
              record.payload.caseId === item.caseId &&
              record.payload.qualityMode === mode &&
              record.payload.domainQualified,
          ).length < report.humanReview.domainReviewerCount
        ) {
          throw evidenceError(artifactName, `${item.caseId} ${mode} 缺少领域评审记录。` );
        }
        reviewGroups.push(labels);
      }
    }
    if (reviewerIds.size !== report.humanReview.reviewerCount) {
      throw evidenceError(artifactName, "实际独立评审人数与报告不一致。");
    }
    if (domainReviewerIds.size !== report.humanReview.domainReviewerCount) {
      throw evidenceError(artifactName, "实际领域评审人数与报告不一致。");
    }
    const agreementRate =
      reviewGroups.length === 0
        ? 0
        : reviewGroups.filter((labels) => new Set(labels.values()).size === 1).length /
          reviewGroups.length;
    const cohenKappa = averagePairwiseKappa(reviewGroups, [...reviewerIds].sort());
    if (!nearlyEqual(report.humanReview.agreementRate, agreementRate)) {
      throw evidenceError(artifactName, "agreementRate 不能由独立评审标签重算得到。");
    }
    if (!nearlyEqual(report.humanReview.cohenKappa, cohenKappa)) {
      throw evidenceError(artifactName, "cohenKappa 不能由独立评审标签重算得到。");
    }
    if (report.humanReview.unresolvedSamples !== unresolvedSamples) {
      throw evidenceError(artifactName, "unresolvedSamples 与裁决记录不一致。");
    }
    for (const [field, actual] of Object.entries(totals)) {
      if (report.humanReview[field] !== actual) {
        throw evidenceError(artifactName, `${field} 实际汇总与报告不一致。` );
      }
    }
    return;
  }
  if (artifactName === "revision") {
    const revisedSegments = new Set();
    const totals = {
      introducedCritical: 0,
      harmedSegments: 0,
      resolvedIssues: 0,
      introducedIssues: 0,
    };
    for (const [index, record] of records.entries()) {
      const path = `${artifactName}:${index + 1}.payload`;
      assertCase(record.payload.caseId, `${path}.caseId`);
      const item = caseById.get(record.payload.caseId);
      if (!item.segments.some((segment) => segment.id === record.payload.segmentId)) {
        throw evidenceError(`${path}.segmentId`, "不属于该评测用例。");
      }
      const key = `${record.payload.caseId}\u0000${record.payload.segmentId}`;
      if (revisedSegments.has(key)) throw evidenceError(path, "同一用例分段只能计入一次修订结果。");
      revisedSegments.add(key);
      totals.introducedCritical += record.payload.introducedCritical;
      totals.harmedSegments += record.payload.harmed ? 1 : 0;
      totals.resolvedIssues += record.payload.resolvedIssues;
      totals.introducedIssues += record.payload.introducedIssues;
    }
    if (records.length !== report.revision.revisedSegments) {
      throw evidenceError(artifactName, "修订段落记录数与报告不一致。" );
    }
    for (const [field, actual] of Object.entries(totals)) {
      if (report.revision[field] !== actual) {
        throw evidenceError(artifactName, `${field} 实际汇总与报告不一致。` );
      }
    }
    return;
  }
  if (artifactName === "concurrency") {
    const modeCounts = new Map();
    const samples = new Set();
    const realFull = [];
    const realThree = [];
    const totals = {
      undetectedStructuralDamage: 0,
      missingSegments: 0,
      duplicateSegments: 0,
      outOfOrderSegments: 0,
    };
    const periods = new Set();
    for (const [index, record] of records.entries()) {
      const path = `${artifactName}:${index + 1}.payload`;
      const payload = record.payload;
      assertCase(payload.caseId, `${path}.caseId`);
      if (payload.fingerprintCondition.sourceCaseId !== payload.caseId) {
        throw evidenceError(`${path}.fingerprintCondition.sourceCaseId`, "与并发用例不一致。" );
      }
      const service = serviceConditionsById.get(payload.serviceConditionId);
      if (!service || !conditionMatchesService(payload.fingerprintCondition, service)) {
        throw evidenceError(`${path}.serviceConditionId`, "并发请求与服务条件不一致。");
      }
      if (payload.fingerprintCondition.adapterBuildVersion !== context.commitSha) {
        throw evidenceError(`${path}.fingerprintCondition.adapterBuildVersion`, "与候选 Git commit 不一致。");
      }
      if (payload.fingerprintCondition.concurrency !== payload.concurrency) {
        throw evidenceError(`${path}.concurrency`, "与请求指纹条件不一致。" );
      }
      const allowed = payload.benchmarkKind === "local-simulation" ? new Set([1, 3, 6]) : new Set([1, 2, 3, 4]);
      if (!allowed.has(payload.concurrency)) {
        throw evidenceError(`${path}.concurrency`, "不属于该类基准规定的并发数。");
      }
      const evaluationCase = cases.find((item) => item.caseId === payload.caseId);
      const sourceLength = evaluationCase ? Array.from(evaluationCase.source).length : 0;
      if (payload.benchmarkKind === "real-service" && (sourceLength < 8_000 || sourceLength > 10_000)) {
        throw evidenceError(`${path}.caseId`, "真实性能并发基准必须使用 8,000 至 10,000 码点长文。" );
      }
      const expectedSegmentationMode = payload.concurrency === 1 ? "full-document" : "segmented";
      if (payload.fingerprintCondition.segmentationMode !== expectedSegmentationMode) {
        throw evidenceError(
          `${path}.fingerprintCondition.segmentationMode`,
          `并发 ${payload.concurrency} 必须使用 ${expectedSegmentationMode}。`,
        );
      }
      const modeKey = `${payload.benchmarkKind}:${payload.concurrency}`;
      const sampleKey = `${modeKey}\u0000${payload.periodId}\u0000${payload.caseId}\u0000${payload.sampleIndex}`;
      if (samples.has(sampleKey)) throw evidenceError(path, "并发样本的用例、时段和序号组合必须唯一。");
      samples.add(sampleKey);
      modeCounts.set(modeKey, (modeCounts.get(modeKey) ?? 0) + 1);
      totals.undetectedStructuralDamage += payload.undetectedStructuralDamage;
      totals.missingSegments += payload.missingSegments;
      totals.duplicateSegments += payload.duplicateSegments;
      totals.outOfOrderSegments += payload.outOfOrderSegments;
      if (payload.benchmarkKind === "real-service") periods.add(payload.periodId);
      if (payload.benchmarkKind === "real-service" && payload.concurrency === 1) realFull.push(payload);
      if (payload.benchmarkKind === "real-service" && payload.concurrency === 3) realThree.push(payload);
    }
    for (const expected of [
      "local-simulation:1",
      "local-simulation:3",
      "local-simulation:6",
      "real-service:1",
      "real-service:2",
      "real-service:3",
      "real-service:4",
    ]) {
      const expectedCount = expected.startsWith("local-simulation")
        ? report.concurrency?.localSimulationSamples[`concurrency${expected.split(":")[1]}`]
        : report.concurrency?.realBenchmarkSamples[
            expected.endsWith(":1") ? "fullDocument" : `concurrency${expected.split(":")[1]}`
          ];
      if ((modeCounts.get(expected) ?? 0) !== expectedCount) {
        throw evidenceError(artifactName, `${expected} 实际记录数与报告不一致。`);
      }
    }
    const fullCritical = realFull.reduce((sum, item) => sum + item.criticalCount, 0);
    const concurrencyCritical = realThree.reduce((sum, item) => sum + item.criticalCount, 0);
    const derived = {
      criticalIncrease: Math.max(0, concurrencyCritical - fullCritical),
      undetectedStructuralDamage: totals.undetectedStructuralDamage,
      fullWeightedPoints: realFull.reduce((sum, item) => sum + item.weightedPoints, 0),
      concurrency3WeightedPoints: realThree.reduce((sum, item) => sum + item.weightedPoints, 0),
      fullP50Ms: percentile(realFull.map((item) => item.completionMs), 0.5),
      concurrency3P50Ms: percentile(realThree.map((item) => item.completionMs), 0.5),
      fullTokens: realFull.reduce((sum, item) => sum + item.tokens, 0),
      concurrency3Tokens: realThree.reduce((sum, item) => sum + item.tokens, 0),
      missingSegments: totals.missingSegments,
      duplicateSegments: totals.duplicateSegments,
      outOfOrderSegments: totals.outOfOrderSegments,
      periodCount: periods.size,
    };
    for (const [field, actual] of Object.entries(derived)) {
      if (!nearlyEqual(report.concurrency[field], actual)) {
        throw evidenceError(artifactName, `${field} 实际汇总与报告不一致。` );
      }
    }
    return;
  }
  if (artifactName === "performance") {
    const recordsByCondition = new Map();
    const samples = new Set();
    const qualityModes = new Set();
    const segmentationModes = new Set();
    const thinkingModes = new Set();
    const protocols = new Set();
    for (const [index, record] of records.entries()) {
      const payload = record.payload;
      const path = `${artifactName}:${index + 1}.payload`;
      const summary = performanceById.get(payload.conditionId);
      if (!summary) throw evidenceError(`${path}.conditionId`, "报告中不存在该性能条件。");
      if (payload.requestFingerprint !== summary.requestFingerprint) {
        throw evidenceError(`${path}.requestFingerprint`, "与报告性能条件不一致。");
      }
      if (summary.serviceConditionId === undefined) {
        throw evidenceError(`${path}.conditionId`, "报告性能条件没有绑定服务条件 ID。");
      }
      assertConditionMatchesKnownService(
        payload.fingerprintCondition,
        serviceConditionsById,
        `${path}.fingerprintCondition`,
      );
      const service = serviceConditionsById.get(summary.serviceConditionId);
      if (!service || !conditionMatchesService(payload.fingerprintCondition, service)) {
        throw evidenceError(`${path}.fingerprintCondition`, "与报告性能汇总声明的服务条件不一致。");
      }
      if (payload.fingerprintCondition.adapterBuildVersion !== context.commitSha) {
        throw evidenceError(`${path}.fingerprintCondition.adapterBuildVersion`, "与候选 Git commit 不一致。");
      }
      const sampleKey = `${payload.conditionId}\u0000${payload.periodId}\u0000${payload.sampleIndex}`;
      if (samples.has(sampleKey)) throw evidenceError(path, "同一性能条件、时段和样本序号必须唯一。");
      samples.add(sampleKey);
      qualityModes.add(payload.fingerprintCondition.qualityMode);
      segmentationModes.add(payload.fingerprintCondition.segmentationMode);
      thinkingModes.add(payload.fingerprintCondition.thinkingMode);
      protocols.add(payload.fingerprintCondition.protocol);
      const related = recordsByCondition.get(payload.conditionId) ?? [];
      related.push(payload);
      recordsByCondition.set(payload.conditionId, related);
    }
    for (const summary of report.performance?.summaries ?? []) {
      const related = recordsByCondition.get(summary.conditionId) ?? [];
      const derived = {
        sampleCount: related.length,
        periodCount: new Set(related.map((item) => item.periodId)).size,
        firstCodePointP50Ms: percentile(related.map((item) => item.firstCodePointMs), 0.5),
        firstCodePointP95Ms: percentile(related.map((item) => item.firstCodePointMs), 0.95),
        completionP50Ms: percentile(related.map((item) => item.completionMs), 0.5),
        completionP95Ms: percentile(related.map((item) => item.completionMs), 0.95),
        inputTokens: related.reduce((sum, item) => sum + item.inputTokens, 0),
        outputTokens: related.reduce((sum, item) => sum + item.outputTokens, 0),
        reasoningTokens: related.reduce((sum, item) => sum + item.reasoningTokens, 0),
        callCount: related.reduce((sum, item) => sum + item.callCount, 0),
        cancellationRate: related.length === 0 ? 0 : related.filter((item) => item.cancelled).length / related.length,
        timeoutRate: related.length === 0 ? 0 : related.filter((item) => item.timedOut).length / related.length,
        revisionTriggerRate:
          related.length === 0 ? 0 : related.filter((item) => item.revisionTriggered).length / related.length,
        feeAmount: related.reduce((sum, item) => sum + item.feeAmount, 0),
      };
      for (const [field, actual] of Object.entries(derived)) {
        if (!nearlyEqual(summary[field], actual)) {
          throw evidenceError(artifactName, `${summary.conditionId}.${field} 实际汇总与报告不一致。` );
        }
      }
      if (related.some((item) => item.feeCurrency !== summary.feeCurrency)) {
        throw evidenceError(artifactName, `${summary.conditionId}.feeCurrency 与证据记录不一致。` );
      }
    }
    if ((report.performance?.conditionCount ?? 0) > 0) {
      for (const required of ["standard", "precision"]) {
        if (!qualityModes.has(required)) throw evidenceError(artifactName, `性能证据缺少 ${required} 条件。` );
      }
      for (const required of ["full-document", "segmented"]) {
        if (!segmentationModes.has(required)) throw evidenceError(artifactName, `性能证据缺少 ${required} 条件。` );
      }
      for (const required of [false, true]) {
        if (!thinkingModes.has(required)) throw evidenceError(artifactName, `性能证据缺少 thinking=${required} 条件。` );
      }
      for (const required of new Set((report.serviceConditions ?? []).map((item) => item.protocol))) {
        if (!protocols.has(required)) throw evidenceError(artifactName, `性能证据缺少 ${required} 协议条件。` );
      }
      for (const required of report.serviceConditions ?? []) {
        if (!(report.performance?.summaries ?? []).some((summary) => summary.serviceConditionId === required.conditionId)) {
          throw evidenceError(artifactName, `性能证据缺少服务条件 ${required.conditionId}。` );
        }
      }
    }
    return;
  }
  if (artifactName.startsWith("platform")) {
    const expectedPlatform =
      artifactName === "platformWindows" ? "windows" : artifactName === "platformMacOS" ? "macOS" : "linux";
    const checks = new Set();
    const packageHashes = new Set();
    for (const [index, record] of records.entries()) {
      const payload = record.payload;
      const path = `${artifactName}:${index + 1}.payload`;
      if (payload.platform !== expectedPlatform) throw evidenceError(`${path}.platform`, "平台不匹配。" );
      if (payload.acceptanceRecordId !== report.platforms?.[expectedPlatform]?.recordId) {
        throw evidenceError(`${path}.acceptanceRecordId`, "与报告平台验收记录编号不一致。" );
      }
      if (checks.has(payload.checkId)) throw evidenceError(`${path}.checkId`, "平台验收项不得重复。" );
      checks.add(payload.checkId);
      packageHashes.add(payload.packageSha256);
      const packageAttachment = context.attachmentsById.get(payload.packageAttachmentId);
      if (!packageAttachment || packageAttachment.kind !== "upxs-package") {
        throw evidenceError(`${path}.packageAttachmentId`, "必须引用实际 UPXS 包附件。");
      }
      if (packageAttachment.sha256 !== payload.packageSha256) {
        throw evidenceError(`${path}.packageSha256`, "与实际 UPXS 包附件 SHA-256 不一致。");
      }
      if (payload.buildInputSha256 !== context.buildInputSha256) {
        throw evidenceError(`${path}.buildInputSha256`, "与证据清单绑定的构建输入不一致。");
      }
      context.usedPackageAttachmentIds.add(payload.packageAttachmentId);
      const reportStatus = report.platforms?.[expectedPlatform]?.checks[payload.checkId];
      if (payload.status !== reportStatus) throw evidenceError(`${path}.status`, "与报告平台验收状态不一致。" );
    }
    if (checks.size !== PLATFORM_CHECK_IDS.size) throw evidenceError(artifactName, "没有覆盖全部平台验收项。" );
    if (packageHashes.size !== 1) throw evidenceError(artifactName, "平台验收必须绑定同一个 UPXS 包哈希。" );
    return { packageSha256: [...packageHashes][0] };
  }
}

export function createEvaluationEvidenceSectionHashes(report) {
  assertRecord(report, "report");
  return Object.freeze({
    automaticChecks: hashCanonicalValue(report.automaticChecks),
    modelResults: hashCanonicalValue({
      sampleCounts: report.sampleCounts,
      serviceConditions: report.serviceConditions ?? null,
    }),
    pairedComparisons: hashCanonicalValue({
      pairedComparisons: report.pairedComparisons,
      serviceConditions: report.serviceConditions ?? null,
    }),
    humanReviews: hashCanonicalValue({
      humanReview: report.humanReview,
      datasetVersion: report.datasetVersion,
    }),
    revision: hashCanonicalValue({ revision: report.revision, humanReview: report.humanReview }),
    concurrency: hashCanonicalValue({
      concurrency: report.concurrency,
      serviceConditions: report.serviceConditions ?? null,
    }),
    performance: hashCanonicalValue({
      performance: report.performance,
      serviceConditions: report.serviceConditions ?? null,
    }),
    platformWindows: hashCanonicalValue(report.platforms?.windows ?? null),
    platformMacOS: hashCanonicalValue(report.platforms?.macOS ?? null),
    platformLinux: hashCanonicalValue(report.platforms?.linux ?? null),
  });
}

function requiredRecordCounts(report) {
  const automaticChecks = report.automaticChecks;
  const automaticCount = automaticChecks
    ? 8 +
      automaticChecks.injection.total +
      automaticChecks.protectedContent.total +
      automaticChecks.chunkIntegrity.total +
      automaticChecks.crossOriginRedirect.total
    : 0;
  const sampleCounts = report.sampleCounts ?? {};
  const pairedComparisons = report.pairedComparisons ?? [];
  const coreDocuments = report.dataset
    ? report.dataset.core.enZh.documents + report.dataset.core.zhEn.documents
    : 0;
  const concurrency = report.concurrency;
  const concurrencyCount = concurrency
    ? Object.values(concurrency.localSimulationSamples).reduce((sum, value) => sum + value, 0) +
      Object.values(concurrency.realBenchmarkSamples).reduce((sum, value) => sum + value, 0)
    : 0;
  return {
    automaticChecks: automaticCount,
    modelResults: (sampleCounts.standard ?? 0) + (sampleCounts.precision ?? 0),
    pairedComparisons: pairedComparisons.reduce(
      (sum, comparison) => sum + comparison.sampleCount * comparison.values.length,
      0,
    ),
    humanReviews:
      coreDocuments *
      ((report.humanReview?.reviewerCount ?? 0) === 0
        ? 0
        : (report.humanReview.reviewerCount + 1) * 2),
    revision: report.revision?.revisedSegments ?? 0,
    concurrency: concurrencyCount,
    performance:
      report.performance?.summaries.reduce((sum, summary) => sum + summary.sampleCount, 0) ?? 0,
    platformWindows: 7,
    platformMacOS: 7,
    platformLinux: 7,
  };
}

function comparableDatasetSummary(dataset) {
  if (!dataset) return null;
  const { frozen: _frozen, ...summary } = dataset;
  return summary;
}

export function listEvaluationEvidenceArtifactPaths(manifest) {
  assertExactKeys(manifest, MANIFEST_KEYS, "evidenceManifest");
  assertExactKeys(manifest.artifacts, ARTIFACT_KEYS, "evidenceManifest.artifacts");
  const paths = [];
  const seen = new Set();
  for (const artifactName of ARTIFACT_KEYS) {
    const reference = manifest.artifacts[artifactName];
    const path = `evidenceManifest.artifacts.${artifactName}`;
    assertExactKeys(reference, ARTIFACT_REFERENCE_KEYS, path);
    assertSafeRelativePath(reference.path, `${path}.path`);
    if (seen.has(reference.path)) throw evidenceError(`${path}.path`, "每类证据必须使用独立文件。");
    seen.add(reference.path);
    paths.push(reference.path);
  }
  return Object.freeze(paths);
}

export function listEvaluationEvidenceAttachmentPaths(manifest) {
  assertExactKeys(manifest, MANIFEST_KEYS, "evidenceManifest");
  const attachmentsById = validateAttachmentManifest(manifest.attachments);
  const artifactPaths = new Set(listEvaluationEvidenceArtifactPaths(manifest));
  const paths = [];
  for (const attachment of attachmentsById.values()) {
    if (artifactPaths.has(attachment.path)) {
      throw evidenceError("evidenceManifest.attachments", "原始附件不能与证据记录文件共用路径。");
    }
    paths.push(attachment.path);
  }
  return Object.freeze(paths);
}

export function verifyEvaluationEvidence({
  manifest,
  report,
  cases,
  casesSource,
  artifactSources,
  attachmentSources,
}) {
  const artifactPaths = listEvaluationEvidenceArtifactPaths(manifest);
  const attachmentPaths = listEvaluationEvidenceAttachmentPaths(manifest);
  if (manifest.schemaVersion !== EVALUATION_EVIDENCE_MANIFEST_VERSION) {
    throw evidenceError(
      "evidenceManifest.schemaVersion",
      `必须是 ${EVALUATION_EVIDENCE_MANIFEST_VERSION}。`,
    );
  }
  for (const field of ["evidenceId", "candidateVersion", "datasetVersion"]) {
    assertText(manifest[field], `evidenceManifest.${field}`, 500);
  }
  if (typeof manifest.commitSha !== "string" || !/^[a-f\d]{40}$/u.test(manifest.commitSha)) {
    throw evidenceError("evidenceManifest.commitSha", "必须是完整的 40 位 Git commit SHA。");
  }
  if (
    manifest.candidateVersion !== report.candidateVersion ||
    manifest.datasetVersion !== report.datasetVersion
  ) {
    throw evidenceError("evidenceManifest", "候选版本或数据集版本与报告不一致。");
  }
  assertSha256(manifest.reportSha256, "evidenceManifest.reportSha256");
  assertSha256(manifest.casesSha256, "evidenceManifest.casesSha256");
  assertSha256(manifest.buildInputSha256, "evidenceManifest.buildInputSha256");
  if (manifest.reportSha256 !== hashCanonicalValue(report)) {
    throw evidenceError("evidenceManifest.reportSha256", "与当前报告的 SHA-256 不一致。");
  }
  if (typeof casesSource !== "string" || manifest.casesSha256 !== sha256(casesSource)) {
    throw evidenceError("evidenceManifest.casesSha256", "与当前用例文件的 SHA-256 不一致。");
  }
  if (!Number.isSafeInteger(manifest.caseCount) || manifest.caseCount < 1) {
    throw evidenceError("evidenceManifest.caseCount", "必须是大于 0 的安全整数。");
  }
  if (!Array.isArray(cases) || cases.length !== manifest.caseCount) {
    throw evidenceError("evidenceManifest.caseCount", "与实际用例数量不一致。");
  }
  const actualDataset = summarizeEvaluationCases(cases);
  if (
    hashCanonicalValue(actualDataset) !==
    hashCanonicalValue(comparableDatasetSummary(report.dataset))
  ) {
    throw evidenceError("report.dataset", "数据集计数与实际用例不一致。");
  }
  if (!report.dataset?.frozen) {
    throw evidenceError("report.dataset.frozen", "只有已冻结数据集才能生成完整证据清单。");
  }
  assertRecord(artifactSources, "artifactSources");
  const attachmentsById = verifyAttachmentSources(manifest, attachmentSources);
  const packageAttachments = [...attachmentsById.values()].filter(
    (attachment) => attachment.kind === "upxs-package",
  );
  if (
    packageAttachments.length !== 1 ||
    !packageAttachments[0].path.endsWith(`/ruyi-translate-${manifest.candidateVersion}.upxs`)
  ) {
    throw evidenceError(
      "evidenceManifest.attachments",
      "必须绑定唯一一个按候选版本命名的 UPXS 候选包附件。",
    );
  }
  const sectionHashes = createEvaluationEvidenceSectionHashes(report);
  const minimumCounts = requiredRecordCounts(report);
  const verifiedArtifacts = {};
  const verifiedAttachments = {};
  const platformPackageHashes = new Set();
  const usedAttachmentIds = new Set();
  const context = {
    commitSha: manifest.commitSha,
    buildInputSha256: manifest.buildInputSha256,
    attachmentsById,
    usedPackageAttachmentIds: new Set(),
    modelOutputs: new Set(),
    modelOutputByCaseMode: new Set(),
  };
  for (const artifactName of ARTIFACT_KEYS) {
    const reference = manifest.artifacts[artifactName];
    const path = `evidenceManifest.artifacts.${artifactName}`;
    assertSha256(reference.sha256, `${path}.sha256`);
    assertSha256(reference.sectionHash, `${path}.sectionHash`);
    if (!Number.isSafeInteger(reference.recordCount) || reference.recordCount < 0) {
      throw evidenceError(`${path}.recordCount`, "必须是大于等于 0 的安全整数。");
    }
    const source = artifactSources[reference.path];
    if (typeof source !== "string") throw evidenceError(reference.path, "证据文件不存在。");
    if (sha256(source) !== reference.sha256) {
      throw evidenceError(`${path}.sha256`, "与证据文件的 SHA-256 不一致。");
    }
    if (reference.sectionHash !== sectionHashes[artifactName]) {
      throw evidenceError(`${path}.sectionHash`, "没有绑定到当前报告对应分区。");
    }
    const records = parseEvidenceRecords(source, {
      artifactName,
      expectedType: ARTIFACT_TYPES.get(artifactName),
      candidateVersion: manifest.candidateVersion,
      datasetVersion: manifest.datasetVersion,
      commitSha: manifest.commitSha,
    });
    validateRecordAttachments(artifactName, records, attachmentsById, usedAttachmentIds);
    if (records.length !== reference.recordCount) {
      throw evidenceError(`${path}.recordCount`, "与证据文件实际记录数不一致。");
    }
    if (records.length !== minimumCounts[artifactName]) {
      throw evidenceError(
        `${path}.recordCount`,
        `必须恰好包含报告所声明样本需要的 ${minimumCounts[artifactName]} 条记录。`,
      );
    }
    const artifactMetadata = validateArtifactRecords(artifactName, records, report, cases, context);
    if (artifactMetadata?.packageSha256) platformPackageHashes.add(artifactMetadata.packageSha256);
    verifiedArtifacts[artifactName] = reference.sha256;
  }
  if (artifactPaths.length !== ARTIFACT_KEYS.size) {
    throw evidenceError("evidenceManifest.artifacts", "证据文件数量不完整。");
  }
  if (platformPackageHashes.size !== 1) {
    throw evidenceError("evidenceManifest.artifacts", "三平台验收没有绑定到同一个 UPXS 包。");
  }
  for (const attachment of attachmentsById.values()) {
    const used =
      attachment.kind === "upxs-package"
        ? context.usedPackageAttachmentIds.has(attachment.attachmentId)
        : usedAttachmentIds.has(attachment.attachmentId);
    if (!used) {
      throw evidenceError(
        `evidenceManifest.attachments.${attachment.attachmentId}`,
        "清单含未被证据记录引用的附件。",
      );
    }
    verifiedAttachments[attachment.attachmentId] = attachment.sha256;
  }
  if (attachmentPaths.length !== attachmentsById.size) {
    throw evidenceError("evidenceManifest.attachments", "原始证据附件数量不完整。");
  }
  return Object.freeze({
    schemaVersion: VERIFIED_EVALUATION_EVIDENCE_VERSION,
    evidenceId: manifest.evidenceId,
    candidateVersion: manifest.candidateVersion,
    datasetVersion: manifest.datasetVersion,
    commitSha: manifest.commitSha,
    reportSha256: manifest.reportSha256,
    casesSha256: manifest.casesSha256,
    buildInputSha256: manifest.buildInputSha256,
    caseCount: manifest.caseCount,
    artifactSha256: Object.freeze(verifiedArtifacts),
    attachmentSha256: Object.freeze(verifiedAttachments),
  });
}
