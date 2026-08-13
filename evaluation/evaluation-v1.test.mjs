// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  createRequestFingerprint,
  evaluateReleaseGate,
  parseEvaluationCases,
} from "./lib/evaluation-v1.mjs";

function validCase(overrides = {}) {
  return {
    schemaVersion: "evaluation-case.v1",
    caseId: "energy-en-zh-0001",
    sourceLanguage: "English",
    targetLanguage: "Simplified Chinese",
    evaluationDomain: "energy",
    domainProfileId: "power-energy-v1",
    documentType: "technical-report",
    source: "Keep {plantId} at 3.5 kW.",
    references: [],
    segments: [
      { id: "p-1", ordinal: 0, sourceStart: 0, sourceEnd: 25 },
    ],
    terms: [],
    protectedItems: [
      {
        id: "protected-1",
        segmentId: "p-1",
        type: "placeholder",
        value: "{plantId}",
        sourceStart: 5,
        sourceEnd: 14,
      },
    ],
    referenceTranslationIds: [],
    expectedIssues: [],
    specialtyTags: ["structure"],
    privacyClass: "synthetic",
    notes: "Unicode ranges use code points.",
    ...overrides,
  };
}

describe("evaluation-case.v1 JSONL", () => {
  it("accepts a normalized case and rejects inconsistent IDs and ranges", () => {
    const parsed = parseEvaluationCases(`${JSON.stringify(validCase())}\n`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      caseId: "energy-en-zh-0001",
      privacyClass: "synthetic",
    });

    const duplicateSegments = validCase({
      segments: [
        { id: "p-1", ordinal: 0, sourceStart: 0, sourceEnd: 10 },
        { id: "p-1", ordinal: 1, sourceStart: 10, sourceEnd: 25 },
      ],
    });
    expect(() => parseEvaluationCases(JSON.stringify(duplicateSegments))).toThrow(
      /segment ID.*唯一/u,
    );

    const misplacedProtectedItem = validCase({
      protectedItems: [
        {
          id: "protected-1",
          segmentId: "missing",
          type: "placeholder",
          value: "{plantId}",
          sourceStart: 50,
          sourceEnd: 59,
        },
      ],
    });
    expect(() => parseEvaluationCases(JSON.stringify(misplacedProtectedItem))).toThrow(
      /protectedItems\[0\]/u,
    );

    const missingSourceRange = validCase({
      segments: [
        { id: "p-1", ordinal: 0, sourceStart: 0, sourceEnd: 5 },
        { id: "p-2", ordinal: 1, sourceStart: 10, sourceEnd: 25 },
      ],
      protectedItems: [],
    });
    expect(() => parseEvaluationCases(JSON.stringify(missingSourceRange))).toThrow(
      /连续完整覆盖/u,
    );

    expect(() =>
      parseEvaluationCases(
        JSON.stringify(
          validCase({
            references: ["reference text"],
            referenceTranslationIds: ["missing-ref", "extra-ref"],
          }),
        ),
      ),
    ).toThrow(/参考译例文本与 ID 必须一一对应/u);

    expect(() =>
      parseEvaluationCases(
        JSON.stringify(
          validCase({
            expectedIssues: [
              {
                id: "issue-1",
                segmentId: "missing",
                category: "accuracy",
                severity: "major",
                sourceStart: 0,
                sourceEnd: 4,
                notes: "invalid segment",
              },
            ],
          }),
        ),
      ),
    ).toThrow(/expectedIssues\[0\].*分段/u);
  });

  it("rejects duplicate source documents even when the case IDs differ", () => {
    const first = validCase();
    const second = validCase({ caseId: "energy-en-zh-0002" });

    expect(() =>
      parseEvaluationCases(`${JSON.stringify(first)}\n${JSON.stringify(second)}\n`),
    ).toThrow(/重复原文凑评测数量/u);
  });
});

describe("evaluation request fingerprint", () => {
  it("is canonical and refuses secret-bearing input", () => {
    const condition = {
      thinkingMode: false,
      termbaseVersion: "terms-v1",
      sourceCaseId: "energy-en-zh-0001",
      serviceConfigurationId: "custom-1",
      segmentationMode: "segmented",
      schemaVersion: "ruyi-translate-v1",
      requestParameters: { temperature: 0, maxOutputCodePoints: 100_000 },
      reportedModelVersion: "2026-08-13",
      referenceTranslationIds: ["ref-1"],
      qualityMode: "precision",
      providerType: "custom",
      protocol: "chat-completions",
      promptVersion: "ruyi-prompts-v1",
      normalizedTranslationUrl: "https://api.example.test/v1/chat/completions",
      normalizedTargetLanguage: {
        modelLabel: "Simplified Chinese",
        kind: "preset",
        id: "zh-CN",
      },
      model: "model-v1",
      evaluationVersion: "ruyi-evaluation-v1",
      domainProfileVersion: "energy-v1",
      concurrency: 3,
      chunkingVersion: "ruyi-segmentation-v1",
      canonicalRequestBodyHash: "a".repeat(64),
      adapterBuildVersion: "7cb4369",
    };

    expect(createRequestFingerprint(condition)).toBe(
      "94f6523a363116fc88806914b9ee64995c43ac097b25943a0eef41610735a41d",
    );
    expect(() =>
      createRequestFingerprint({
        ...condition,
        requestParameters: { ...condition.requestParameters, apiKey: "must-not-be-read" },
      }),
    ).toThrow(/apiKey.*不得进入评测指纹/u);
    expect(() =>
      createRequestFingerprint({
        ...condition,
        normalizedTranslationUrl:
          "https://api.example.test/v1/chat/completions?api_key=must-not-be-hashed",
      }),
    ).toThrow(/URL.*密钥/u);
    expect(() =>
      createRequestFingerprint({
        ...condition,
        normalizedTranslationUrl:
          "https://api.example.test/v1/chat/completions?trace=sk-123456789012",
      }),
    ).toThrow(/查询参数值.*密钥/u);
    expect(() =>
      createRequestFingerprint({
        ...condition,
        requestParameters: { label: "sk-123456789012" },
      }),
    ).toThrow(/密钥值.*不得进入评测指纹/u);
    expect(() =>
      createRequestFingerprint({
        ...condition,
        requestParameters: { "x-api-key": "opaque-credential" },
      }),
    ).toThrow(/x-api-key.*不得进入评测指纹/u);
    expect(() =>
      createRequestFingerprint({
        ...condition,
        requestParameters: { ...condition.requestParameters, token: "must-not-be-hashed" },
      }),
    ).toThrow(/token.*不得进入评测指纹/u);
    expect(() =>
      createRequestFingerprint({
        ...condition,
        normalizedTranslationUrl:
          "https://api.example.test/v1/sk-must-not-be-hashed/chat/completions",
      }),
    ).toThrow(/URL.*密钥/u);
    expect(() =>
      createRequestFingerprint({
        ...condition,
        normalizedTranslationUrl: "https://api.example.test/v1/%ZZ",
      }),
    ).toThrow(/URL 路径包含无效的百分号编码/u);
  });
});

function pendingReport() {
  return {
    schemaVersion: "evaluation-report.v1",
    reportId: "baseline-v1",
    evaluationVersion: "ruyi-evaluation-v1",
    candidateVersion: "0.1.0",
    baselineVersion: null,
    evaluationDate: "2026-08-13",
    changeSummary: "Initial baseline is not yet collected.",
    datasetVersion: null,
    dataset: null,
    serviceConditions: [],
    pairedComparisons: null,
    sampleCounts: null,
    automaticChecks: null,
    humanReview: null,
    revision: null,
    concurrency: null,
    performance: null,
    platforms: null,
    decisions: [
      {
        reasonCodes: [
          "baseline.version.missing",
          "dataset.version.missing",
          "dataset.missing",
          "services.missing",
          "comparisons.missing",
          "samples.missing",
          "automation.missing",
          "human_review.missing",
          "revision.missing",
          "concurrency.missing",
          "performance.missing",
          "platforms.missing",
        ],
        decision: "保持待建立基线，不进入发布候选。",
      },
    ],
    notes: "This report records missing evidence instead of inventing results.",
  };
}

function directionEvidence() {
  return {
    documents: 100,
    segments: 500,
    longDocuments: 10,
    domains: {
      general: 15,
      software: 15,
      academic: 15,
      energy: 15,
      legal: 15,
    },
  };
}

function platformEvidence(recordId) {
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

function completeReport() {
  return {
    ...pendingReport(),
    baselineVersion: "baseline-v1",
    datasetVersion: "dataset-v1",
    dataset: {
      frozen: true,
      core: { enZh: directionEvidence(), zhEn: directionEvidence() },
      basic: {
        jaZh: { documents: 30, segments: 100 },
        koZh: { documents: 30, segments: 100 },
        frZh: { documents: 30, segments: 100 },
        deZh: { documents: 30, segments: 100 },
        esZh: { documents: 30, segments: 100 },
      },
      specialty: {
        terminology: 100,
        structure: 100,
        injection: 100,
        crossSegment: 40,
        boundaryFixtures: true,
      },
      privacyClasses: ["synthetic", "public-licensed"],
    },
    serviceConditions: [
      {
        conditionId: "deepseek-chat",
        kind: "deepseek-official",
        serviceConfigurationId: "deepseek-flash",
        normalizedTranslationUrl: "https://api.deepseek.com/chat/completions",
        adapterBuildVersion: "a".repeat(40),
        model: "deepseek-v4-flash",
        reportedModelVersion: "2026-08-13",
        protocol: "chat-completions",
        promptVersion: "ruyi-prompts-v1",
        schemaVersion: "ruyi-translate-v1",
        reportVersion: "evaluation-report.v1",
      },
      {
        conditionId: "custom-chat",
        kind: "custom",
        serviceConfigurationId: "custom-1",
        normalizedTranslationUrl: "https://api.example.test/v1/chat/completions",
        adapterBuildVersion: "a".repeat(40),
        model: "model-v1",
        reportedModelVersion: "2026-08-13",
        protocol: "chat-completions",
        promptVersion: "ruyi-prompts-v1",
        schemaVersion: "ruyi-translate-v1",
        reportVersion: "evaluation-report.v1",
      },
      {
        conditionId: "custom-responses",
        kind: "custom",
        serviceConfigurationId: "custom-1",
        normalizedTranslationUrl: "https://api.example.test/v1/responses",
        adapterBuildVersion: "a".repeat(40),
        model: "model-v1",
        reportedModelVersion: "2026-08-13",
        protocol: "responses",
        promptVersion: "ruyi-prompts-v1",
        schemaVersion: "ruyi-translate-v1",
        reportVersion: "evaluation-report.v1",
      },
    ],
    pairedComparisons: [
      {
        factor: "quality-mode",
        values: ["standard", "precision"],
        serviceConditionIds: ["custom-chat"],
        sampleCount: 200,
        controlledConditionHash: "c".repeat(64),
      },
      {
        factor: "terminology",
        values: ["none", "applicable", "inapplicable"],
        serviceConditionIds: ["custom-chat"],
        sampleCount: 100,
        controlledConditionHash: "d".repeat(64),
      },
      {
        factor: "reference-translations",
        values: ["0", "3", "4-rejected"],
        serviceConditionIds: ["custom-chat"],
        sampleCount: 20,
        controlledConditionHash: "e".repeat(64),
      },
      {
        factor: "domain-selection",
        values: ["selected", "none"],
        serviceConditionIds: ["custom-chat"],
        sampleCount: 20,
        controlledConditionHash: "f".repeat(64),
      },
      {
        factor: "segmentation",
        values: ["full-document", "segmented"],
        serviceConditionIds: ["custom-chat"],
        sampleCount: 20,
        controlledConditionHash: "1".repeat(64),
      },
      {
        factor: "thinking-mode",
        values: ["disabled", "enabled"],
        serviceConditionIds: ["deepseek-chat"],
        sampleCount: 20,
        controlledConditionHash: "2".repeat(64),
      },
      {
        factor: "protocol",
        values: ["chat-completions", "responses"],
        serviceConditionIds: ["custom-chat", "custom-responses"],
        sampleCount: 20,
        controlledConditionHash: "3".repeat(64),
      },
    ],
    sampleCounts: {
      standard: 200,
      precision: 200,
      fullDocument: 20,
      segmented: 20,
      thinkingEnabled: 20,
      thinkingDisabled: 20,
    },
    automaticChecks: {
      testsPassed: true,
      schemaPassed: true,
      protocolPassed: true,
      entryPassed: true,
      authenticationPassed: true,
      cancellationPassed: true,
      injection: { total: 100, detected: 100 },
      protectedContent: { total: 100, detected: 100 },
      chunkIntegrity: { total: 30, detected: 30 },
      crossOriginRedirect: { total: 10, blocked: 10 },
      runtimeIsolationPassed: true,
      resetStoragePassed: true,
    },
    humanReview: {
      reviewerCount: 2,
      domainReviewerCount: 1,
      agreementRate: 0.95,
      cohenKappa: 0.85,
      unresolvedSamples: 0,
      unflaggedCritical: 0,
      standardCritical: 0,
      precisionCritical: 0,
      standardWeightedPoints: 100,
      precisionWeightedPoints: 90,
      precisionCiUpperRelativeDifference: 0.01,
      strictTermUndetected: 0,
      preferredApplicable: 100,
      preferredMatched: 97,
      forbiddenTotal: 10,
      forbiddenDetected: 10,
      basicSevereFailures: 0,
    },
    revision: {
      introducedCritical: 0,
      revisedSegments: 100,
      harmedSegments: 2,
      resolvedIssues: 30,
      introducedIssues: 5,
    },
    concurrency: {
      localSimulationSamples: {
        concurrency1: 10,
        concurrency3: 10,
        concurrency6: 10,
      },
      realBenchmarkSamples: {
        fullDocument: 10,
        concurrency2: 10,
        concurrency3: 10,
        concurrency4: 10,
      },
      criticalIncrease: 0,
      undetectedStructuralDamage: 0,
      fullWeightedPoints: 100,
      concurrency3WeightedPoints: 102,
      fullP50Ms: 100_000,
      concurrency3P50Ms: 75_000,
      fullTokens: 100_000,
      concurrency3Tokens: 120_000,
      missingSegments: 0,
      duplicateSegments: 0,
      outOfOrderSegments: 0,
      periodCount: 3,
    },
    performance: {
      conditionCount: 2,
      summaries: [
        {
          conditionId: "standard-full",
          serviceConditionId: "custom-chat",
          requestFingerprint: "a".repeat(64),
          sampleCount: 10,
          periodCount: 3,
          firstCodePointP50Ms: 1_000,
          firstCodePointP95Ms: 1_500,
          completionP50Ms: 10_000,
          completionP95Ms: 15_000,
          inputTokens: 1_000,
          outputTokens: 800,
          reasoningTokens: 0,
          callCount: 10,
          cancellationRate: 0,
          timeoutRate: 0,
          revisionTriggerRate: 0,
          feeAmount: 1.5,
          feeCurrency: "CNY",
        },
        {
          conditionId: "precision-full",
          serviceConditionId: "custom-responses",
          requestFingerprint: "b".repeat(64),
          sampleCount: 10,
          periodCount: 3,
          firstCodePointP50Ms: 1_200,
          firstCodePointP95Ms: 1_800,
          completionP50Ms: 15_000,
          completionP95Ms: 20_000,
          inputTokens: 2_000,
          outputTokens: 900,
          reasoningTokens: 500,
          callCount: 50,
          cancellationRate: 0,
          timeoutRate: 0,
          revisionTriggerRate: 0.5,
          feeAmount: 3.5,
          feeCurrency: "CNY",
        },
      ],
    },
    platforms: {
      windows: platformEvidence("windows-2026-08-13"),
      macOS: platformEvidence("macos-2026-08-13"),
      linux: platformEvidence("linux-2026-08-13"),
    },
    decisions: [
      {
        reasonCodes: ["release.conclusion"],
        decision: "所有发布门槛均已通过，可以进入发布候选。",
      },
    ],
  };
}

describe("baseline-v1 release gate", () => {
  it("keeps an evidence-incomplete report pending and non-publishable", () => {
    const gate = evaluateReleaseGate(pendingReport());

    expect(gate).toMatchObject({ status: "pending", canPublish: false });
    expect(gate.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        "baseline.version.missing",
        "dataset.missing",
        "services.missing",
        "automation.missing",
        "human_review.missing",
        "performance.missing",
        "platforms.missing",
      ]),
    );
  });

  it("fails when any injection fixture escapes deterministic detection", () => {
    const report = completeReport();
    report.automaticChecks.injection.detected = 99;

    const gate = evaluateReleaseGate(report);

    expect(gate).toMatchObject({ status: "fail", canPublish: false });
    expect(gate.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "automation.injection.failed", status: "fail" }),
      ]),
    );
  });

  it("does not accept a complete-looking report without verified evidence files", () => {
    const report = completeReport();
    report.decisions = [
      {
        reasonCodes: ["evidence.missing"],
        decision: "补齐并校验实际用例、模型输出、人工、性能和平台证据文件。",
      },
    ];

    expect(evaluateReleaseGate(report)).toMatchObject({
      status: "pending",
      canPublish: false,
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: "evidence.missing" }),
      ]),
    });
  });

  it("does not expose an option that can brand a hand-built object as verified", () => {
    const report = completeReport();
    report.decisions = [
      {
        reasonCodes: ["evidence.missing"],
        decision: "必须通过读取原始证据文件的入口完成核验。",
      },
    ];

    expect(evaluateReleaseGate(report, { verifiedEvidence: {} })).toMatchObject({
      status: "pending",
      canPublish: false,
      reasons: expect.arrayContaining([expect.objectContaining({ code: "evidence.missing" })]),
    });
  });

  it("requires a persisted decision for the computed release conclusion", () => {
    const report = completeReport();
    report.decisions = [];

    expect(evaluateReleaseGate(report)).toMatchObject({
      status: "pending",
      canPublish: false,
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: "evidence.missing" }),
        expect.objectContaining({ code: "decisions.unaddressed" }),
      ]),
    });
  });

  it("keeps the report pending when a required paired factor is absent", () => {
    const report = completeReport();
    report.pairedComparisons = report.pairedComparisons.filter(
      (comparison) => comparison.factor !== "protocol",
    );
    report.decisions = [
      {
        reasonCodes: ["comparisons.protocol.missing"],
        decision: "补充同一端点和模型的双协议配对结果。",
      },
    ];

    expect(evaluateReleaseGate(report)).toMatchObject({
      status: "pending",
      canPublish: false,
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: "comparisons.protocol.missing" }),
      ]),
    });
  });

  it("rejects a protocol comparison that crosses services or models", () => {
    const report = completeReport();
    const protocol = report.pairedComparisons.find(
      (comparison) => comparison.factor === "protocol",
    );
    protocol.serviceConditionIds = ["deepseek-chat", "custom-responses"];

    expect(() => evaluateReleaseGate(report)).toThrow(/同一服务、主机、模型和版本/u);
  });

  it("requires the thinking-mode comparison to use the official DeepSeek condition", () => {
    const report = completeReport();
    const thinking = report.pairedComparisons.find(
      (comparison) => comparison.factor === "thinking-mode",
    );
    thinking.serviceConditionIds = ["custom-chat"];

    expect(() => evaluateReleaseGate(report)).toThrow(/思考模式配对.*DeepSeek 官方/u);
  });

  it("requires every platform acceptance category instead of trusting a record ID", () => {
    const report = completeReport();
    report.platforms.windows.status = "pending";
    report.platforms.windows.checks.httpsAndLoopbackHttp = "pending";
    report.decisions = [
      {
        reasonCodes: ["platforms.windows.httpsAndLoopbackHttp.pending"],
        decision: "在 Windows 实机补充 HTTPS 与回环 HTTP 记录。",
      },
    ];

    expect(evaluateReleaseGate(report)).toMatchObject({
      status: "pending",
      canPublish: false,
      reasons: expect.arrayContaining([
        expect.objectContaining({
          code: "platforms.windows.httpsAndLoopbackHttp.pending",
        }),
      ]),
    });
  });

  it("requires local concurrency 1/3/6 and real full/2/3/4 samples", () => {
    const report = completeReport();
    report.concurrency.localSimulationSamples.concurrency6 = 0;
    report.concurrency.realBenchmarkSamples.concurrency4 = 0;
    report.decisions = [
      {
        reasonCodes: [
          "concurrency.local.concurrency6.missing",
          "concurrency.real.concurrency4.missing",
          "evidence.missing",
        ],
        decision: "补齐本地并发 6 和真实并发 4 的样本，再核验原始证据。",
      },
    ];

    expect(evaluateReleaseGate(report)).toMatchObject({
      status: "pending",
      canPublish: false,
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: "concurrency.local.concurrency6.missing" }),
        expect.objectContaining({ code: "concurrency.real.concurrency4.missing" }),
      ]),
    });
  });
});
