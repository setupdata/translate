// @vitest-environment node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createRequestFingerprint,
  hashCanonicalValue,
  parseEvaluationCases,
  summarizeEvaluationCases,
} from "./lib/evaluation-v1.mjs";
import {
  createEvaluationEvidenceSectionHashes,
  verifyEvaluationEvidence,
} from "./lib/evidence-v1.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const gitRevision = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: projectRoot,
  encoding: "utf8",
});
if (gitRevision.status !== 0 || !/^[a-f\d]{40}$/u.test(gitRevision.stdout.trim())) {
  throw new Error("测试无法确认当前 Git commit。");
}
const candidateCommitSha = gitRevision.stdout.trim();

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function evidenceRecords(evidenceType, count, payload = {}, idPrefix = evidenceType) {
  const attachments = [];
  const source = Array.from({ length: count }, (_, index) => {
    const attachmentId = `${idPrefix}-attachment-${index}`;
    const attachmentPath = `attachments/${attachmentId}.txt`;
    const attachmentSource = Buffer.from(`raw evidence for ${idPrefix} ${index}\n`, "utf8");
    const attachmentSha256 = sha256(attachmentSource);
    attachments.push({
      attachmentId,
      path: attachmentPath,
      sha256: attachmentSha256,
      byteLength: attachmentSource.byteLength,
      kind:
        evidenceType === "automatic-check"
          ? "automatic-log"
          : evidenceType === "model-result"
            ? "model-output"
            : evidenceType === "paired-comparison"
              ? "paired-observation"
              : evidenceType === "human-review"
                ? "human-annotation"
                : evidenceType === "revision"
                  ? "revision-comparison"
                  : evidenceType === "concurrency"
                    ? "concurrency-measurement"
                    : evidenceType === "performance"
                      ? "performance-measurement"
                      : "platform-evidence",
      source: attachmentSource,
    });
    return JSON.stringify({
      schemaVersion: "evaluation-evidence-record.v1",
      evidenceType,
      recordId: `${idPrefix}-${index}`,
      candidateVersion: "0.1.0",
      datasetVersion: "dataset-v1",
      recordedAt: "2026-08-13T12:00:00.000Z",
      subjectId: `${idPrefix}-subject-${index}`,
      commitSha: candidateCommitSha,
      attachmentId,
      payload: typeof payload === "function" ? payload(index, attachmentSha256) : payload,
    });
  }).join("\n");
  return { source, attachments };
}

const platformCheckIds = [
  "upxsInstallation",
  "entryAndShortcut",
  "backgroundAndNotification",
  "copyPaste",
  "themeAndAccessibility",
  "httpsAndLoopbackHttp",
  "processRestartNoSensitiveResidue",
];
const automaticCheckIds = [
  "tests",
  "schema",
  "protocol",
  "entry",
  "authentication",
  "cancellation",
  "runtime-isolation",
  "reset-storage",
];

function automaticPayload(index, attachmentSha256) {
  return {
    checkId: automaticCheckIds[index],
    status: "pass",
    commitSha: candidateCommitSha,
    command: "npm test",
    resultHash: attachmentSha256,
  };
}

function platformPayload(platform, index, evidenceSha256, packageSha256) {
  return {
    platform,
    acceptanceRecordId:
      platform === "windows"
        ? "windows-record"
        : platform === "macOS"
          ? "macos-record"
          : "linux-record",
    checkId: platformCheckIds[index],
    status: "pass",
    packageSha256,
    packageAttachmentId: "signed-upxs",
    buildInputSha256: "e".repeat(64),
    signatureVerificationMethod: "utools-installed-package",
    utoolsVersion: "7.3.0",
    osVersion: `${platform}-test-version`,
    testerId: `${platform}-tester`,
    observedAt: "2026-08-13T12:00:00.000Z",
    evidenceHash: evidenceSha256,
  };
}

function fingerprintCondition(caseId = "energy-en-zh-0001") {
  return {
    providerType: "custom",
    serviceConfigurationId: "custom-1",
    normalizedTranslationUrl: "https://api.example.test/v1/chat/completions",
    adapterBuildVersion: candidateCommitSha,
    protocol: "chat-completions",
    model: "model-v1",
    reportedModelVersion: "2026-08-13",
    promptVersion: "ruyi-prompts-v1",
    schemaVersion: "ruyi-translate-v1",
    evaluationVersion: "ruyi-evaluation-v1",
    qualityMode: "standard",
    thinkingMode: false,
    requestParameters: { temperature: 0 },
    normalizedTargetLanguage: {
      kind: "preset",
      id: "zh-CN",
      modelLabel: "Simplified Chinese",
    },
    termbaseVersion: "none",
    domainProfileVersion: "none",
    referenceTranslationIds: [],
    sourceCaseId: caseId,
    segmentationMode: "full-document",
    chunkingVersion: "ruyi-segmentation-v1",
    concurrency: 1,
    canonicalRequestBodyHash: "d".repeat(64),
  };
}

function modelPayload(_index, attachmentSha256) {
  const condition = fingerprintCondition();
  return {
    caseId: condition.sourceCaseId,
    serviceConditionId: "custom-chat",
    requestFingerprint: createRequestFingerprint(condition),
    fingerprintCondition: condition,
    qualityMode: "standard",
    segmentationMode: "full-document",
    thinkingMode: false,
    status: "completed",
    outputHash: attachmentSha256,
  };
}

function platformRecord(recordId) {
  return {
    status: "pass",
    recordId,
    checks: {
      upxsInstallation: "pass",
      entryAndShortcut: "pass",
      backgroundAndNotification: "pass",
      copyPaste: "pass",
      themeAndAccessibility: "pass",
      httpsAndLoopbackHttp: "pass",
      processRestartNoSensitiveResidue: "pass",
    },
  };
}

function reportFor(cases) {
  return {
    schemaVersion: "evaluation-report.v1",
    reportId: "baseline-v1",
    evaluationVersion: "ruyi-evaluation-v1",
    candidateVersion: "0.1.0",
    baselineVersion: "baseline-v1",
    evaluationDate: "2026-08-13",
    changeSummary: "Evidence verifier test fixture.",
    datasetVersion: "dataset-v1",
    dataset: { frozen: true, ...summarizeEvaluationCases(cases) },
    serviceConditions: [],
    sampleCounts: {
      standard: 0,
      precision: 0,
      fullDocument: 0,
      segmented: 0,
      thinkingEnabled: 0,
      thinkingDisabled: 0,
    },
    automaticChecks: {
      testsPassed: true,
      schemaPassed: true,
      protocolPassed: true,
      entryPassed: true,
      authenticationPassed: true,
      cancellationPassed: true,
      injection: { total: 0, detected: 0 },
      protectedContent: { total: 0, detected: 0 },
      chunkIntegrity: { total: 0, detected: 0 },
      crossOriginRedirect: { total: 0, blocked: 0 },
      runtimeIsolationPassed: true,
      resetStoragePassed: true,
    },
    pairedComparisons: [],
    humanReview: {
      reviewerCount: 0,
      domainReviewerCount: 0,
      agreementRate: 0,
      cohenKappa: 0,
      unresolvedSamples: 0,
      unflaggedCritical: 0,
      standardCritical: 0,
      precisionCritical: 0,
      standardWeightedPoints: 0,
      precisionWeightedPoints: 0,
      precisionCiUpperRelativeDifference: 0,
      strictTermUndetected: 0,
      preferredApplicable: 0,
      preferredMatched: 0,
      forbiddenTotal: 0,
      forbiddenDetected: 0,
      basicSevereFailures: 0,
    },
    revision: {
      introducedCritical: 0,
      revisedSegments: 0,
      harmedSegments: 0,
      resolvedIssues: 0,
      introducedIssues: 0,
    },
    concurrency: {
      localSimulationSamples: { concurrency1: 0, concurrency3: 0, concurrency6: 0 },
      realBenchmarkSamples: {
        fullDocument: 0,
        concurrency2: 0,
        concurrency3: 0,
        concurrency4: 0,
      },
      criticalIncrease: 0,
      undetectedStructuralDamage: 0,
      fullWeightedPoints: 0,
      concurrency3WeightedPoints: 0,
      fullP50Ms: 0,
      concurrency3P50Ms: 0,
      fullTokens: 0,
      concurrency3Tokens: 0,
      missingSegments: 0,
      duplicateSegments: 0,
      outOfOrderSegments: 0,
      periodCount: 0,
    },
    performance: { conditionCount: 0, summaries: [] },
    platforms: {
      windows: platformRecord("windows-record"),
      macOS: platformRecord("macos-record"),
      linux: platformRecord("linux-record"),
    },
    decisions: [
      {
        reasonCodes: [
          "dataset.core.enZh.documents",
          "dataset.core.enZh.segments",
          "dataset.core.enZh.long_documents",
          "dataset.core.enZh.general",
          "dataset.core.enZh.software",
          "dataset.core.enZh.academic",
          "dataset.core.enZh.energy",
          "dataset.core.enZh.legal",
          "dataset.core.zhEn.documents",
          "dataset.core.zhEn.segments",
          "dataset.core.zhEn.long_documents",
          "dataset.core.zhEn.general",
          "dataset.core.zhEn.software",
          "dataset.core.zhEn.academic",
          "dataset.core.zhEn.energy",
          "dataset.core.zhEn.legal",
          "dataset.basic.jaZh",
          "dataset.basic.koZh",
          "dataset.basic.frZh",
          "dataset.basic.deZh",
          "dataset.basic.esZh",
          "dataset.specialty.terminology",
          "dataset.specialty.structure",
          "dataset.specialty.injection",
          "dataset.specialty.cross_segment",
          "dataset.specialty.boundary",
          "services.missing",
          "samples.standard.missing",
          "samples.precision.missing",
          "samples.fullDocument.missing",
          "samples.segmented.missing",
          "samples.thinkingEnabled.missing",
          "samples.thinkingDisabled.missing",
          "automation.injection.insufficient",
          "automation.protected.insufficient",
          "automation.chunk.insufficient",
          "automation.redirect.insufficient",
          "human_review.reviewers",
          "human_review.domain_reviewer",
          "human_review.preferred_terms.missing",
          "quality.forbidden_terms.missing",
          "revision.samples.missing",
          "concurrency.local.concurrency1.missing",
          "concurrency.local.concurrency3.missing",
          "concurrency.local.concurrency6.missing",
          "concurrency.real.fullDocument.missing",
          "concurrency.real.concurrency2.missing",
          "concurrency.real.concurrency3.missing",
          "concurrency.real.concurrency4.missing",
          "concurrency.periods",
          "concurrency.speed",
          "concurrency.tokens",
          "performance.conditions.missing",
        ],
        decision: "该夹具只验证证据绑定，质量门槛继续保持 pending。",
      },
    ],
    notes: "Synthetic verifier fixture.",
  };
}

function evidenceFixture(report, casesSource, cases) {
  const sectionHashes = createEvaluationEvidenceSectionHashes(report);
  const modelResultCount = report.sampleCounts.standard + report.sampleCounts.precision;
  const packageSource = Buffer.from("signed UPXS fixture bytes\n", "utf8");
  const packageSha256 = sha256(packageSource);
  const definitions = {
    automaticChecks: ["automatic-check", 8, automaticPayload],
    modelResults: ["model-result", modelResultCount, modelPayload],
    pairedComparisons: ["paired-comparison", 0],
    humanReviews: ["human-review", 0],
    revision: ["revision", 0],
    concurrency: ["concurrency", 0],
    performance: ["performance", 0],
    platformWindows: [
      "platform",
      7,
      (index, evidenceSha256) => platformPayload("windows", index, evidenceSha256, packageSha256),
    ],
    platformMacOS: [
      "platform",
      7,
      (index, evidenceSha256) => platformPayload("macOS", index, evidenceSha256, packageSha256),
    ],
    platformLinux: [
      "platform",
      7,
      (index, evidenceSha256) => platformPayload("linux", index, evidenceSha256, packageSha256),
    ],
  };
  const artifactSources = {};
  const attachmentSources = { "attachments/ruyi-translate-0.1.0.upxs": packageSource };
  const attachments = [
    {
      attachmentId: "signed-upxs",
      path: "attachments/ruyi-translate-0.1.0.upxs",
      sha256: packageSha256,
      byteLength: packageSource.byteLength,
      kind: "upxs-package",
    },
  ];
  const artifacts = {};
  for (const [name, [type, count, payload]] of Object.entries(definitions)) {
    const path = `${name}.jsonl`;
    const generated = evidenceRecords(type, count, payload, name);
    const source = generated.source;
    artifactSources[path] = source;
    for (const attachment of generated.attachments) {
      attachmentSources[attachment.path] = attachment.source;
      attachments.push({
        attachmentId: attachment.attachmentId,
        path: attachment.path,
        sha256: attachment.sha256,
        byteLength: attachment.byteLength,
        kind: attachment.kind,
      });
    }
    artifacts[name] = {
      path,
      sha256: sha256(source),
      recordCount: count,
      sectionHash: sectionHashes[name],
    };
  }
  return {
    manifest: {
      schemaVersion: "evaluation-evidence-manifest.v1",
      evidenceId: "evidence-v1-test",
      candidateVersion: report.candidateVersion,
      datasetVersion: report.datasetVersion,
      commitSha: candidateCommitSha,
      reportSha256: hashCanonicalValue(report),
      casesSha256: sha256(casesSource),
      buildInputSha256: "e".repeat(64),
      caseCount: cases.length,
      artifacts,
      attachments,
    },
    artifactSources,
    attachmentSources,
  };
}

async function writeGeneratorInput(inputDirectory, fixture) {
  await mkdir(resolve(inputDirectory, "artifacts"), { recursive: true });
  await writeFile(
    resolve(inputDirectory, "attachments.json"),
    JSON.stringify({
      schemaVersion: "evaluation-evidence-attachments.v1",
      attachments: fixture.manifest.attachments.map(({ attachmentId, path, kind }) => ({
        attachmentId,
        path,
        kind,
      })),
    }),
    "utf8",
  );
  for (const [artifactPath, source] of Object.entries(fixture.artifactSources)) {
    await writeFile(resolve(inputDirectory, "artifacts", artifactPath), source, "utf8");
  }
  for (const [attachmentPath, source] of Object.entries(fixture.attachmentSources)) {
    const absolutePath = resolve(inputDirectory, attachmentPath);
    await mkdir(resolve(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, source);
  }
}

function runEvidenceGenerator({
  casesPath,
  reportPath,
  inputDirectory,
  outputDirectory,
  allowAuthorizedPrivate = false,
}) {
  return spawnSync(
    process.execPath,
    [
      resolve(projectRoot, "scripts/generate-evaluation-evidence.mjs"),
      "--cases",
      casesPath,
      "--report",
      reportPath,
      "--input",
      inputDirectory,
      "--out",
      outputDirectory,
      "--evidence-id",
      "generated-evidence-v1-test",
      "--build-input-sha256",
      "e".repeat(64),
      ...(allowAuthorizedPrivate ? ["--allow-authorized-private"] : []),
    ],
    { cwd: projectRoot, encoding: "utf8" },
  );
}

describe("evaluation evidence manifest", () => {
  it("binds the report to actual cases and hashed audit records", async () => {
    const casesSource = await readFile(
      resolve(projectRoot, "evaluation/cases/synthetic-smoke.jsonl"),
      "utf8",
    );
    const cases = parseEvaluationCases(casesSource);
    const report = reportFor(cases);
    const fixture = evidenceFixture(report, casesSource, cases);

    expect(
      verifyEvaluationEvidence({
        report,
        cases,
        casesSource,
        ...fixture,
      }),
    ).toMatchObject({
      schemaVersion: "verified-evaluation-evidence.v1",
      evidenceId: "evidence-v1-test",
      candidateVersion: "0.1.0",
      datasetVersion: "dataset-v1",
      caseCount: 1,
    });

    const changedArtifactSources = {
      ...fixture.artifactSources,
      "platformWindows.jsonl": `${fixture.artifactSources["platformWindows.jsonl"]}\n{}`,
    };
    expect(() =>
      verifyEvaluationEvidence({
        report,
        cases,
        casesSource,
        manifest: fixture.manifest,
        artifactSources: changedArtifactSources,
        attachmentSources: fixture.attachmentSources,
      }),
    ).toThrow(/SHA-256/u);

    const tamperedAttachment = Buffer.from(
      fixture.attachmentSources["attachments/platformWindows-attachment-0.txt"],
    );
    tamperedAttachment[0] ^= 1;
    const changedAttachmentSources = {
      ...fixture.attachmentSources,
      "attachments/platformWindows-attachment-0.txt": tamperedAttachment,
    };
    expect(() =>
      verifyEvaluationEvidence({
        report,
        cases,
        casesSource,
        manifest: fixture.manifest,
        artifactSources: fixture.artifactSources,
        attachmentSources: changedAttachmentSources,
      }),
    ).toThrow(/原始证据附件.*SHA-256/u);

    const mismatchedReport = structuredClone(report);
    mismatchedReport.dataset.core.enZh.documents = 2;
    const mismatchedFixture = evidenceFixture(mismatchedReport, casesSource, cases);
    expect(() =>
      verifyEvaluationEvidence({
        report: mismatchedReport,
        cases,
        casesSource,
        ...mismatchedFixture,
      }),
    ).toThrow(/数据集计数.*实际用例/u);
  });

  it("rejects raw user content in evidence records", async () => {
    const casesSource = await readFile(
      resolve(projectRoot, "evaluation/cases/synthetic-smoke.jsonl"),
      "utf8",
    );
    const cases = parseEvaluationCases(casesSource);
    const report = reportFor(cases);
    const fixture = evidenceFixture(report, casesSource, cases);
    const unsafeSource = evidenceRecords("automatic-check", 8, {
      sourceText: "must not enter audit records",
    }).source;
    fixture.artifactSources["automaticChecks.jsonl"] = unsafeSource;
    fixture.manifest.artifacts.automaticChecks.sha256 = sha256(unsafeSource);

    expect(() =>
      verifyEvaluationEvidence({
        report,
        cases,
        casesSource,
        ...fixture,
      }),
    ).toThrow(/sourceText.*不得进入评测证据/u);
  });

  it("recomputes request fingerprints and binds them to a declared service condition", async () => {
    const casesSource = await readFile(
      resolve(projectRoot, "evaluation/cases/synthetic-smoke.jsonl"),
      "utf8",
    );
    const cases = parseEvaluationCases(casesSource);
    const report = reportFor(cases);
    report.serviceConditions = [
      {
        conditionId: "custom-chat",
        kind: "custom",
        serviceConfigurationId: "custom-1",
        normalizedTranslationUrl: "https://api.example.test/v1/chat/completions",
        adapterBuildVersion: candidateCommitSha,
        model: "model-v1",
        reportedModelVersion: "2026-08-13",
        protocol: "chat-completions",
        promptVersion: "ruyi-prompts-v1",
        schemaVersion: "ruyi-translate-v1",
        reportVersion: "evaluation-report.v1",
      },
    ];
    report.sampleCounts.standard = 1;
    report.sampleCounts.fullDocument = 1;
    report.sampleCounts.thinkingDisabled = 1;
    const fixture = evidenceFixture(report, casesSource, cases);

    expect(() =>
      verifyEvaluationEvidence({ report, cases, casesSource, ...fixture }),
    ).not.toThrow();

    const record = JSON.parse(fixture.artifactSources["modelResults.jsonl"]);
    record.payload.fingerprintCondition.model = "different-model";
    const changedSource = JSON.stringify(record);
    fixture.artifactSources["modelResults.jsonl"] = changedSource;
    fixture.manifest.artifacts.modelResults.sha256 = sha256(changedSource);

    expect(() =>
      verifyEvaluationEvidence({ report, cases, casesSource, ...fixture }),
    ).toThrow(/重新计算/u);
  });

  it("rejects duplicate model samples and mode labels that disagree with the request", async () => {
    const casesSource = await readFile(
      resolve(projectRoot, "evaluation/cases/synthetic-smoke.jsonl"),
      "utf8",
    );
    const cases = parseEvaluationCases(casesSource);
    const report = reportFor(cases);
    report.serviceConditions = [
      {
        conditionId: "custom-chat",
        kind: "custom",
        serviceConfigurationId: "custom-1",
        normalizedTranslationUrl: "https://api.example.test/v1/chat/completions",
        adapterBuildVersion: candidateCommitSha,
        model: "model-v1",
        reportedModelVersion: "2026-08-13",
        protocol: "chat-completions",
        promptVersion: "ruyi-prompts-v1",
        schemaVersion: "ruyi-translate-v1",
        reportVersion: "evaluation-report.v1",
      },
    ];
    report.sampleCounts.standard = 1;
    report.sampleCounts.fullDocument = 1;
    report.sampleCounts.thinkingDisabled = 1;
    const mismatch = evidenceFixture(report, casesSource, cases);
    const mismatchRecord = JSON.parse(mismatch.artifactSources["modelResults.jsonl"]);
    mismatchRecord.payload.qualityMode = "precision";
    const mismatchSource = JSON.stringify(mismatchRecord);
    mismatch.artifactSources["modelResults.jsonl"] = mismatchSource;
    mismatch.manifest.artifacts.modelResults.sha256 = sha256(mismatchSource);
    expect(() =>
      verifyEvaluationEvidence({ report, cases, casesSource, ...mismatch }),
    ).toThrow(/模式字段.*请求指纹/u);

    report.sampleCounts.standard = 2;
    report.sampleCounts.fullDocument = 2;
    report.sampleCounts.thinkingDisabled = 2;
    const duplicate = evidenceFixture(report, casesSource, cases);
    expect(() =>
      verifyEvaluationEvidence({ report, cases, casesSource, ...duplicate }),
    ).toThrow(/同一用例和请求条件只能计入一次/u);
  });

  it("lets the strict CLI consume verified evidence instead of trusting report declarations", async () => {
    const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "ruyi-evidence-"));
    const casesSource = await readFile(
      resolve(projectRoot, "evaluation/cases/synthetic-smoke.jsonl"),
      "utf8",
    );
    const cases = parseEvaluationCases(casesSource);
    const report = reportFor(cases);
    const fixture = evidenceFixture(report, casesSource, cases);
    const casesPath = resolve(temporaryDirectory, "cases.jsonl");
    const reportPath = resolve(temporaryDirectory, "report.json");
    const manifestPath = resolve(temporaryDirectory, "manifest.json");

    await writeFile(casesPath, casesSource, "utf8");
    await writeFile(reportPath, JSON.stringify(report), "utf8");
    await writeFile(manifestPath, JSON.stringify(fixture.manifest), "utf8");
    for (const [artifactPath, source] of Object.entries(fixture.artifactSources)) {
      const absolutePath = resolve(temporaryDirectory, artifactPath);
      await mkdir(resolve(absolutePath, ".."), { recursive: true });
      await writeFile(absolutePath, source, "utf8");
    }
    for (const [attachmentPath, source] of Object.entries(fixture.attachmentSources)) {
      const absolutePath = resolve(temporaryDirectory, attachmentPath);
      await mkdir(resolve(absolutePath, ".."), { recursive: true });
      await writeFile(absolutePath, source);
    }

    try {
      const result = spawnSync(
        process.execPath,
        [
          resolve(projectRoot, "scripts/check-evaluation.mjs"),
          "--cases",
          casesPath,
          "--report",
          reportPath,
          "--evidence",
          manifestPath,
        ],
        { cwd: projectRoot, encoding: "utf8" },
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("baseline-v1：");
      expect(result.stdout).toContain("不可发布");
      expect(result.stdout).not.toContain("evidence.missing");
      expect(`${result.stdout}${result.stderr}`).not.toContain("{plantId}");
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("generates a verified evidence bundle from controlled records and attachments", async () => {
    const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "ruyi-evidence-generator-"));
    const inputDirectory = resolve(temporaryDirectory, "input");
    const outputDirectory = resolve(temporaryDirectory, "output");
    const casesSource = await readFile(
      resolve(projectRoot, "evaluation/cases/synthetic-smoke.jsonl"),
      "utf8",
    );
    const cases = parseEvaluationCases(casesSource);
    const report = reportFor(cases);
    const fixture = evidenceFixture(report, casesSource, cases);
    const casesPath = resolve(temporaryDirectory, "cases.jsonl");
    const reportPath = resolve(temporaryDirectory, "report.json");

    await writeFile(casesPath, casesSource, "utf8");
    await writeFile(reportPath, JSON.stringify(report), "utf8");
    await writeGeneratorInput(inputDirectory, fixture);

    try {
      const generation = runEvidenceGenerator({
        casesPath,
        reportPath,
        inputDirectory,
        outputDirectory,
      });
      expect(generation.status, `${generation.stdout}\n${generation.stderr}`).toBe(0);
      expect(generation.stdout).toContain("证据包已生成并通过完整性校验");

      const manifestPath = resolve(outputDirectory, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      expect(manifest).toMatchObject({
        schemaVersion: "evaluation-evidence-manifest.v1",
        evidenceId: "generated-evidence-v1-test",
        candidateVersion: "0.1.0",
        datasetVersion: "dataset-v1",
        commitSha: candidateCommitSha,
        buildInputSha256: "e".repeat(64),
        caseCount: 1,
      });
      expect(manifest.artifacts.automaticChecks.path).toBe("artifacts/automaticChecks.jsonl");
      expect(manifest.attachments).toHaveLength(fixture.manifest.attachments.length);

      const validation = spawnSync(
        process.execPath,
        [
          resolve(projectRoot, "scripts/check-evaluation.mjs"),
          "--cases",
          casesPath,
          "--report",
          reportPath,
          "--evidence",
          manifestPath,
        ],
        { cwd: projectRoot, encoding: "utf8" },
      );
      expect(validation.status, `${validation.stdout}\n${validation.stderr}`).toBe(0);
      expect(validation.stdout).toContain("不可发布");
      expect(validation.stdout).not.toContain("evidence.missing");
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("keeps authorized-private cases out of repository paths even with explicit consent", async () => {
    const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "ruyi-private-evidence-"));
    const repositoryCasesPath = resolve(
      projectRoot,
      "evaluation/private-generator-should-not-be-committed.jsonl",
    );
    const inputDirectory = resolve(temporaryDirectory, "input");
    const outputDirectory = resolve(temporaryDirectory, "output");
    const sharedCasesSource = await readFile(
      resolve(projectRoot, "evaluation/cases/synthetic-smoke.jsonl"),
      "utf8",
    );
    const casesSource = sharedCasesSource.replace(
      '"privacyClass":"synthetic"',
      '"privacyClass":"authorized-private"',
    );
    const cases = parseEvaluationCases(casesSource);
    const report = reportFor(cases);
    const fixture = evidenceFixture(report, casesSource, cases);
    const reportPath = resolve(temporaryDirectory, "report.json");

    await writeFile(repositoryCasesPath, casesSource, "utf8");
    await writeFile(reportPath, JSON.stringify(report), "utf8");
    await writeGeneratorInput(inputDirectory, fixture);

    try {
      const generation = runEvidenceGenerator({
        casesPath: repositoryCasesPath,
        reportPath,
        inputDirectory,
        outputDirectory,
        allowAuthorizedPrivate: true,
      });
      expect(generation.status).toBe(1);
      expect(generation.stderr).toContain("Git 忽略的受控私有目录");
      await expect(stat(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
      await rm(repositoryCasesPath, { force: true });
    }
  });

  it("does not write the generated bundle inside its raw evidence input", async () => {
    const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "ruyi-overlap-evidence-"));
    const inputDirectory = resolve(temporaryDirectory, "input");
    const outputDirectory = resolve(inputDirectory, "generated");
    const casesSource = await readFile(
      resolve(projectRoot, "evaluation/cases/synthetic-smoke.jsonl"),
      "utf8",
    );
    const cases = parseEvaluationCases(casesSource);
    const report = reportFor(cases);
    const fixture = evidenceFixture(report, casesSource, cases);
    const casesPath = resolve(temporaryDirectory, "cases.jsonl");
    const reportPath = resolve(temporaryDirectory, "report.json");

    await writeFile(casesPath, casesSource, "utf8");
    await writeFile(reportPath, JSON.stringify(report), "utf8");
    await writeGeneratorInput(inputDirectory, fixture);

    try {
      const generation = runEvidenceGenerator({
        casesPath,
        reportPath,
        inputDirectory,
        outputDirectory,
      });
      expect(generation.status).toBe(1);
      expect(generation.stderr).toContain("输入目录和输出目录不能互相包含");
      await expect(stat(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("does not expose a generated manifest when record validation fails", async () => {
    const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "ruyi-invalid-evidence-"));
    const inputDirectory = resolve(temporaryDirectory, "input");
    const outputDirectory = resolve(temporaryDirectory, "output");
    const casesSource = await readFile(
      resolve(projectRoot, "evaluation/cases/synthetic-smoke.jsonl"),
      "utf8",
    );
    const cases = parseEvaluationCases(casesSource);
    const report = reportFor(cases);
    const fixture = evidenceFixture(report, casesSource, cases);
    const casesPath = resolve(temporaryDirectory, "cases.jsonl");
    const reportPath = resolve(temporaryDirectory, "report.json");

    await writeFile(casesPath, casesSource, "utf8");
    await writeFile(reportPath, JSON.stringify(report), "utf8");
    await writeGeneratorInput(inputDirectory, fixture);
    await writeFile(
      resolve(inputDirectory, "artifacts", "automaticChecks.jsonl"),
      "{not-json}\n",
      "utf8",
    );

    try {
      const generation = runEvidenceGenerator({
        casesPath,
        reportPath,
        inputDirectory,
        outputDirectory,
      });
      expect(generation.status).toBe(1);
      expect(generation.stderr).toContain("不是有效 JSON");
      expect(`${generation.stdout}${generation.stderr}`).not.toContain("{plantId}");
      await expect(stat(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rejects raw files that are not declared as evidence attachments", async () => {
    const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "ruyi-extra-evidence-"));
    const inputDirectory = resolve(temporaryDirectory, "input");
    const outputDirectory = resolve(temporaryDirectory, "output");
    const casesSource = await readFile(
      resolve(projectRoot, "evaluation/cases/synthetic-smoke.jsonl"),
      "utf8",
    );
    const cases = parseEvaluationCases(casesSource);
    const report = reportFor(cases);
    const fixture = evidenceFixture(report, casesSource, cases);
    const casesPath = resolve(temporaryDirectory, "cases.jsonl");
    const reportPath = resolve(temporaryDirectory, "report.json");

    await writeFile(casesPath, casesSource, "utf8");
    await writeFile(reportPath, JSON.stringify(report), "utf8");
    await writeGeneratorInput(inputDirectory, fixture);
    await writeFile(resolve(inputDirectory, "unlisted-private-output.txt"), "PRIVATE-MARKER", "utf8");

    try {
      const generation = runEvidenceGenerator({
        casesPath,
        reportPath,
        inputDirectory,
        outputDirectory,
      });
      expect(generation.status).toBe(1);
      expect(generation.stderr).toContain("附件索引之外的文件");
      expect(`${generation.stdout}${generation.stderr}`).not.toContain("PRIVATE-MARKER");
      expect(await readFile(resolve(inputDirectory, "unlisted-private-output.txt"), "utf8")).toBe(
        "PRIVATE-MARKER",
      );
      await expect(stat(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
