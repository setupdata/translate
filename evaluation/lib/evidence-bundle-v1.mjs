import { createHash } from "node:crypto";

import { hashCanonicalValue } from "./evaluation-v1.mjs";
import {
  EVALUATION_EVIDENCE_MANIFEST_VERSION,
  createEvaluationEvidenceSectionHashes,
  verifyEvaluationEvidence,
} from "./evidence-v1.mjs";

export const EVALUATION_EVIDENCE_ATTACHMENTS_VERSION =
  "evaluation-evidence-attachments.v1";

export const EVALUATION_EVIDENCE_ARTIFACT_NAMES = Object.freeze([
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

function bundleError(path, message) {
  return new Error(`${path}: ${message}`);
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function assertText(value, path) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 500) {
    throw bundleError(path, "必须是非空文本。");
  }
}

function assertSafeRelativePath(value, path) {
  assertText(value, path);
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized !== value ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw bundleError(path, "必须是规范化的安全相对路径。");
  }
}

function countJsonlRecords(source, path) {
  if (typeof source !== "string") throw bundleError(path, "证据记录文件不存在。");
  const lines = source.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  for (let index = 0; index < lines.length; index += 1) {
    try {
      JSON.parse(lines[index]);
    } catch {
      throw bundleError(`${path}:${index + 1}`, "不是有效 JSON。");
    }
  }
  return lines.length;
}

function normalizeAttachmentDefinitions(definition, attachmentSources) {
  if (
    typeof definition !== "object" ||
    definition === null ||
    Array.isArray(definition) ||
    definition.schemaVersion !== EVALUATION_EVIDENCE_ATTACHMENTS_VERSION ||
    !Array.isArray(definition.attachments) ||
    Object.keys(definition).some(
      (key) => key !== "schemaVersion" && key !== "attachments",
    )
  ) {
    throw bundleError("attachments.json", "附件索引格式无效。");
  }
  const attachmentIds = new Set();
  const attachmentPaths = new Set();
  return definition.attachments.map((entry, index) => {
    const path = `attachments.json.attachments[${index}]`;
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join(",") !== "attachmentId,kind,path"
    ) {
      throw bundleError(path, "只允许 attachmentId、path 和 kind。");
    }
    assertText(entry.attachmentId, `${path}.attachmentId`);
    assertSafeRelativePath(entry.path, `${path}.path`);
    if (!entry.path.startsWith("attachments/")) {
      throw bundleError(`${path}.path`, "必须位于 attachments/ 目录。");
    }
    if (!ATTACHMENT_KINDS.has(entry.kind)) {
      throw bundleError(`${path}.kind`, "附件类型无效。");
    }
    if (attachmentIds.has(entry.attachmentId)) {
      throw bundleError(`${path}.attachmentId`, "附件 ID 重复。");
    }
    if (attachmentPaths.has(entry.path)) {
      throw bundleError(`${path}.path`, "附件路径重复。");
    }
    const source = attachmentSources[entry.path];
    if (!(source instanceof Uint8Array)) {
      throw bundleError(entry.path, "附件文件不存在。");
    }
    attachmentIds.add(entry.attachmentId);
    attachmentPaths.add(entry.path);
    return Object.freeze({
      attachmentId: entry.attachmentId,
      path: entry.path,
      sha256: sha256(source),
      byteLength: source.byteLength,
      kind: entry.kind,
    });
  });
}

export function createEvaluationEvidenceBundle({
  evidenceId,
  commitSha,
  buildInputSha256,
  report,
  cases,
  casesSource,
  artifactSources,
  attachmentDefinition,
  attachmentSources,
}) {
  assertText(evidenceId, "evidenceId");
  if (typeof commitSha !== "string" || !/^[a-f\d]{40}$/u.test(commitSha)) {
    throw bundleError("commitSha", "必须是完整的 40 位 Git commit SHA。");
  }
  if (typeof buildInputSha256 !== "string" || !/^[a-f\d]{64}$/u.test(buildInputSha256)) {
    throw bundleError("buildInputSha256", "必须是 64 位 SHA-256。");
  }
  if (typeof casesSource !== "string" || !Array.isArray(cases) || cases.length === 0) {
    throw bundleError("cases", "必须提供已解析的非空用例文件。");
  }
  if (typeof report !== "object" || report === null || Array.isArray(report)) {
    throw bundleError("report", "必须是评测报告对象。");
  }
  if (typeof artifactSources !== "object" || artifactSources === null) {
    throw bundleError("artifactSources", "必须是证据记录文件映射。");
  }
  if (typeof attachmentSources !== "object" || attachmentSources === null) {
    throw bundleError("attachmentSources", "必须是附件文件映射。");
  }

  const sectionHashes = createEvaluationEvidenceSectionHashes(report);
  const artifacts = {};
  for (const artifactName of EVALUATION_EVIDENCE_ARTIFACT_NAMES) {
    const path = `artifacts/${artifactName}.jsonl`;
    const source = artifactSources[path];
    artifacts[artifactName] = Object.freeze({
      path,
      sha256: sha256(source ?? ""),
      recordCount: countJsonlRecords(source, path),
      sectionHash: sectionHashes[artifactName],
    });
  }
  const attachments = normalizeAttachmentDefinitions(
    attachmentDefinition,
    attachmentSources,
  );
  const manifest = Object.freeze({
    schemaVersion: EVALUATION_EVIDENCE_MANIFEST_VERSION,
    evidenceId,
    candidateVersion: report.candidateVersion,
    datasetVersion: report.datasetVersion,
    commitSha,
    reportSha256: hashCanonicalValue(report),
    casesSha256: sha256(casesSource),
    buildInputSha256,
    caseCount: cases.length,
    artifacts: Object.freeze(artifacts),
    attachments: Object.freeze(attachments),
  });
  const verifiedEvidence = verifyEvaluationEvidence({
    manifest,
    report,
    cases,
    casesSource,
    artifactSources,
    attachmentSources,
  });
  return Object.freeze({ manifest, verifiedEvidence });
}
