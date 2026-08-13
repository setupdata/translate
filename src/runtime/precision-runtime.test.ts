import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { TranslationProgressEvent } from "./contracts";

const require = createRequire(import.meta.url);
const runtimePath = resolve(process.cwd(), "public/lib/ruyi-runtime.cjs");

function memoryStorage() {
  const values = new Map<string, unknown>();
  return {
    values,
    getItem: (key: string) => values.get(key),
    setItem: vi.fn((key: string, value: unknown) => values.set(key, structuredClone(value))),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}

const targetLanguage = {
  kind: "preset",
  id: "zh-CN",
  modelLabel: "Simplified Chinese",
};

const servicePreset = {
  id: "local-precision",
  name: "本地精译模型",
  type: "custom",
  protocol: "chat-completions",
  translationUrl: "http://127.0.0.1:11434/v1/chat/completions",
  modelListUrl: "http://127.0.0.1:11434/v1/models",
  authentication: "none",
  model: "fixture-model",
  stream: false,
  confirmedTranslationUrl: "http://127.0.0.1:11434/v1/chat/completions",
  confirmedPrecisionTranslationUrl: "http://127.0.0.1:11434/v1/chat/completions",
};

function inputFromRequest(request: { body: string }) {
  const body = JSON.parse(request.body);
  return JSON.parse(body.messages[1].content);
}

function stageOf(request: { body: string }) {
  const input = inputFromRequest(request);
  if (input.schemaVersion === "analysis-input.v1") return "analysis";
  if (input.schemaVersion === "accuracy-review-input.v1") return "accuracy";
  if (input.schemaVersion === "language-review-input.v1") return "language";
  if (input.schemaVersion === "revision-input.v1") return "revision";
  return "translation";
}

function reviewRole(stage: ReturnType<typeof stageOf>): "accuracy" | "language" {
  if (stage !== "accuracy" && stage !== "language") {
    throw new Error(`unexpected review stage: ${stage}`);
  }
  return stage;
}

function completedResponse(content: string) {
  return {
    status: 200,
    headers: {},
    body: JSON.stringify({ choices: [{ message: { content } }] }),
    complete: true,
  };
}

function responsesCompletedResponse(content: string) {
  return {
    status: 200,
    headers: {},
    body: JSON.stringify({ output_text: content }),
    complete: true,
  };
}

function analysisFor(input: ReturnType<typeof inputFromRequest>) {
  return {
    schemaVersion: "analysis-output.v1",
    taskId: input.taskId,
    detectedSourceLanguage: "English",
    inferredDomain: { name: null, confidence: "low" },
    documentType: null,
    audience: null,
    tone: "neutral",
    ambiguities: [],
    termApplicability: input.matchedTerms.map((term: { id: string }) => ({
      termId: term.id,
      applies: true,
      note: "适用",
    })),
    risks: [],
  };
}

function emptyReview(input: ReturnType<typeof inputFromRequest>, role: "accuracy" | "language") {
  return {
    schemaVersion: "review-output.v1",
    taskId: input.taskId,
    role,
    issues: [],
  };
}

function precisionRequest(taskId = "precision-task") {
  return {
    taskId,
    sourceText: "Hello",
    targetLanguage,
    qualityMode: "precision",
    thinkingEnabled: false,
  };
}

function longSource(paragraphCount = 5) {
  return Array.from(
    { length: paragraphCount },
    (_, index) => `第${index + 1}段 ${"source ".repeat(200)}。\n\n`,
  ).join("");
}

describe("Ruyi runtime precision translation", () => {
  it("runs one analysis, one translation, and two concurrent reviews without revision when no issue exists", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const reviewPending: Array<{
      input: ReturnType<typeof inputFromRequest>;
      role: "accuracy" | "language";
      resolve(value: unknown): void;
    }> = [];
    const transport = {
      request: vi.fn((request) => {
        const input = inputFromRequest(request);
        const stage = stageOf(request);
        if (stage === "analysis") {
          return Promise.resolve(completedResponse(JSON.stringify(analysisFor(input))));
        }
        if (stage === "translation") {
          return Promise.resolve(completedResponse("你好"));
        }
        if (stage === "revision") throw new Error("unexpected revision");
        return new Promise((resolve) => {
          reviewPending.push({ input, role: stage, resolve });
        });
      }),
    };
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport, servicePreset });
    const progress = vi.fn();

    const running = runtime.startTranslation(precisionRequest(), progress);
    await vi.waitFor(() => expect(transport.request).toHaveBeenCalledTimes(4));
    expect(reviewPending.map((item) => item.role).sort()).toEqual(["accuracy", "language"]);
    for (const pending of reviewPending) {
      pending.resolve(completedResponse(JSON.stringify(emptyReview(pending.input, pending.role))));
    }

    await expect(running).resolves.toMatchObject({
      status: "completed",
      translation: "你好",
      precision: {
        complete: true,
        callPlan: {
          analysisCalls: 1,
          translationCalls: 1,
          reviewCalls: 2,
          maximumRevisionCalls: 1,
          maximumCallCount: 5,
        },
        reviewIssues: [],
        revisedSegmentIds: [],
        unresolvedIssueIds: [],
      },
    });
    expect(transport.request.mock.calls.map(([request]) => stageOf(request))).toEqual([
      "analysis",
      "translation",
      "accuracy",
      "language",
    ]);
    for (const [request] of transport.request.mock.calls) {
      const body = JSON.parse(request.body);
      if (stageOf(request) !== "translation") expect(body.stream).toBe(false);
    }
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ type: "precision_stage", stage: "analyzing" }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ type: "precision_stage", stage: "reviewing" }),
    );
  });

  it("revises only risky segments once and requires exact issue coverage", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn(async (request) => {
        const input = inputFromRequest(request);
        const stage = stageOf(request);
        if (stage === "analysis") {
          return completedResponse(JSON.stringify(analysisFor(input)));
        }
        if (stage === "translation") return completedResponse("你好");
        if (stage === "accuracy") {
          return completedResponse(
            JSON.stringify({
              schemaVersion: "review-output.v1",
              taskId: input.taskId,
              role: "accuracy",
              issues: [
                {
                  id: "accuracy-1",
                  segmentId: input.segments[0].id,
                  type: "mistranslation",
                  severity: "major",
                  sourceRange: { start: 0, end: 5 },
                  translationRange: { start: 0, end: 2 },
                  suggestion: "使用更礼貌的译法",
                  confidence: "high",
                },
              ],
            }),
          );
        }
        if (stage === "language") {
          return completedResponse(JSON.stringify(emptyReview(input, "language")));
        }
        expect(input.segments).toHaveLength(1);
        expect(input.issues.map((issue: { id: string }) => issue.id)).toEqual(["accuracy-1"]);
        return completedResponse(
          JSON.stringify({
            schemaVersion: "revision-output.v1",
            taskId: input.taskId,
            revisions: [
              {
                segmentId: input.segments[0].id,
                replacement: "您好",
                resolvedIssueIds: ["accuracy-1"],
              },
            ],
            unresolvedIssueIds: [],
          }),
        );
      }),
    };
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport, servicePreset });

    await expect(runtime.startTranslation(precisionRequest("precision-revision"))).resolves.toMatchObject({
      status: "completed",
      translation: "您好",
      precision: {
        complete: true,
        revisedSegmentIds: [expect.any(String)],
        unresolvedIssueIds: [],
      },
    });
    expect(transport.request.mock.calls.map(([request]) => stageOf(request))).toEqual([
      "analysis",
      "translation",
      "accuracy",
      "language",
      "revision",
    ]);
  });

  it("keeps the initial translation when either review is invalid and never calls revision or standard fallback", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn(async (request) => {
        const input = inputFromRequest(request);
        const stage = stageOf(request);
        if (stage === "analysis") {
          return completedResponse(JSON.stringify(analysisFor(input)));
        }
        if (stage === "translation") return completedResponse("初译");
        if (stage === "accuracy") {
          return completedResponse(
            JSON.stringify({
              schemaVersion: "review-output.v1",
              taskId: input.taskId,
              role: "accuracy",
              issues: [
                {
                  id: "accuracy-retained",
                  segmentId: input.segments[0].id,
                  type: "mistranslation",
                  severity: "major",
                  sourceRange: { start: 0, end: 5 },
                  translationRange: { start: 0, end: 2 },
                  suggestion: "人工核对译法",
                  confidence: "medium",
                },
              ],
            }),
          );
        }
        return completedResponse('{"schemaVersion":"review-output.v1","role":"language"}');
      }),
    };
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport, servicePreset });

    await expect(runtime.startTranslation(precisionRequest("precision-review-failure"))).resolves.toMatchObject({
      status: "completed",
      translation: "初译",
      precision: {
        complete: false,
        failedStage: "language_review",
        reviewIssues: [expect.objectContaining({ id: "accuracy-retained" })],
        revisedSegmentIds: [],
      },
    });
    expect(transport.request).toHaveBeenCalledTimes(4);
    expect(transport.request.mock.calls.map(([request]) => stageOf(request))).not.toContain("revision");
  });

  it("stops after invalid analysis without a repair request or silent standard translation", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn(async () => completedResponse('{"schemaVersion":"analysis-output.v1"}')),
    };
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport, servicePreset });

    await expect(runtime.startTranslation(precisionRequest("precision-analysis-failure"))).resolves.toMatchObject({
      status: "failed",
      error: { code: "protocol_error" },
      precision: { complete: false, failedStage: "analysis" },
    });
    expect(transport.request).toHaveBeenCalledOnce();
  });

  it("reports cancellation during parallel reviews as cancelled while retaining the initial translation", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn((request) => {
        const input = inputFromRequest(request);
        const stage = stageOf(request);
        if (stage === "analysis") {
          return Promise.resolve(completedResponse(JSON.stringify(analysisFor(input))));
        }
        if (stage === "translation") return Promise.resolve(completedResponse("初译"));
        return new Promise((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("cancelled"), { code: "cancelled" })),
            { once: true },
          );
        });
      }),
    };
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport, servicePreset });
    const running = runtime.startTranslation(precisionRequest("precision-review-cancel"));
    await vi.waitFor(() => expect(transport.request).toHaveBeenCalledTimes(4));

    runtime.cancelTranslation("precision-review-cancel");

    await expect(running).resolves.toMatchObject({
      status: "failed",
      partialTranslation: "初译",
      precision: { complete: false, failedStage: "accuracy_review" },
      error: { code: "cancelled" },
    });
  });

  it("rejects a merged segmented precision translation above the output limit", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const oversizedSegment = "译".repeat(60_000);
    const transport = {
      request: vi.fn(async (request) => {
        const input = inputFromRequest(request);
        const stage = stageOf(request);
        if (stage === "analysis") {
          return completedResponse(JSON.stringify(analysisFor(input)));
        }
        if (stage === "translation") return completedResponse(oversizedSegment);
        return completedResponse(JSON.stringify(emptyReview(input, reviewRole(stage))));
      }),
    };
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport, servicePreset });

    const result = await runtime.startTranslation({
      ...precisionRequest("precision-output-limit"),
      sourceText: longSource(),
      parallelAcceleration: true,
      parallelConcurrency: 2,
    });

    expect(result).toMatchObject({
      status: "failed",
      error: { code: "response_too_large" },
      precision: { failedStage: "translation" },
    });
    expect(Array.from(result.partialTranslation ?? "")).toHaveLength(100_000);
  });

  it("analyzes a segmented document once and reviews the complete merged translation once", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const seenInputs: Array<ReturnType<typeof inputFromRequest>> = [];
    const transport = {
      request: vi.fn(async (request) => {
        const input = inputFromRequest(request);
        seenInputs.push(input);
        const stage = stageOf(request);
        if (stage === "analysis") {
          expect(input.segments.length).toBeGreaterThan(1);
          return completedResponse(JSON.stringify(analysisFor(input)));
        }
        if (stage === "translation") {
          expect(input.mode).toBe("segment");
          expect(input).not.toHaveProperty("sourceText");
          return completedResponse(`译文${input.segment.ordinal}`);
        }
        expect(input.segments ?? input.translations).toHaveLength(
          seenInputs.filter((candidate) => candidate.schemaVersion === "translation-input.v1")
            .length,
        );
        return completedResponse(JSON.stringify(emptyReview(input, reviewRole(stage))));
      }),
    };
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport, servicePreset });

    const result = await runtime.startTranslation({
      ...precisionRequest("precision-segmented"),
      sourceText: longSource(),
      parallelAcceleration: true,
      parallelConcurrency: 3,
    });

    expect(result).toMatchObject({ status: "completed", precision: { complete: true } });
    const stages = transport.request.mock.calls.map(([request]) => stageOf(request));
    expect(stages.filter((stage) => stage === "analysis")).toHaveLength(1);
    expect(stages.filter((stage) => stage === "translation").length).toBeGreaterThan(1);
    expect(stages.filter((stage) => stage === "accuracy")).toHaveLength(1);
    expect(stages.filter((stage) => stage === "language")).toHaveLength(1);
    expect(stages).not.toContain("revision");
  });

  it("requires a separate first precision confirmation and exposes the complete call plan", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = { request: vi.fn() };
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      servicePreset: {
        ...servicePreset,
        confirmedPrecisionTranslationUrl: undefined,
      },
      tokenFactory: () => "precision-confirmation-token",
    });

    await expect(
      runtime.startTranslation(precisionRequest("precision-confirmation")),
    ).resolves.toMatchObject({
      status: "confirmation_required",
      confirmationToken: "precision-confirmation-token",
      preview: {
        qualityMode: "precision",
        callCount: 5,
        precisionCallPlan: {
          analysisCalls: 1,
          translationCalls: 1,
          reviewCalls: 2,
          maximumRevisionCalls: 1,
          maximumCallCount: 5,
        },
      },
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("uses the remembered DeepSeek thinking setting for every precision role", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    cryptoStorage.values.set("ruyi.secret.api-key.deepseek-flash", "sk-test");
    const officialPreset = {
      id: "deepseek-flash",
      name: "DeepSeek Flash",
      type: "deepseek-official",
      protocol: "chat-completions",
      translationUrl: "https://api.deepseek.com/chat/completions",
      modelListUrl: "https://api.deepseek.com/models",
      authentication: "bearer",
      model: "deepseek-v4-flash",
      stream: true,
      thinkingEnabled: false,
      confirmedTranslationUrl: "https://api.deepseek.com/chat/completions",
      confirmedPrecisionTranslationUrl: "https://api.deepseek.com/chat/completions",
    };
    const transport = {
      request: vi.fn(async (request) => {
        const input = inputFromRequest(request);
        const stage = stageOf(request);
        if (stage === "analysis") {
          return completedResponse(JSON.stringify(analysisFor(input)));
        }
        if (stage === "translation") {
          request.onData(
            'data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\n\n',
          );
          request.onData('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n');
          request.onData("data: [DONE]\n\n");
          return { status: 200, headers: {}, body: "", complete: true };
        }
        return completedResponse(JSON.stringify(emptyReview(input, reviewRole(stage))));
      }),
    };
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      servicePreset: officialPreset,
    });
    await runtime.setServiceThinkingMode("deepseek-flash", true);

    const result = await runtime.startTranslation({
      taskId: "precision-thinking",
      sourceText: "Hello",
      targetLanguage,
      qualityMode: "precision",
    });

    expect(result).toMatchObject({ status: "completed", translation: "你好" });
    for (const [request] of transport.request.mock.calls) {
      const body = JSON.parse(request.body);
      expect(body.thinking).toEqual({ type: "enabled" });
      expect(body.messages[0].content).not.toContain("Hello");
      if (stageOf(request) !== "translation") expect(body.stream).toBe(false);
    }
  });

  it("runs structured precision roles through the Responses protocol", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const responsesPreset = {
      ...servicePreset,
      id: "local-responses-precision",
      protocol: "responses",
    };
    const transport = {
      request: vi.fn(async (request) => {
        const body = JSON.parse(request.body);
        const input = JSON.parse(body.input);
        const stage =
          input.schemaVersion === "analysis-input.v1"
            ? "analysis"
            : input.schemaVersion === "accuracy-review-input.v1"
              ? "accuracy"
              : input.schemaVersion === "language-review-input.v1"
                ? "language"
                : "translation";
        expect(body.stream).toBe(false);
        if (stage === "analysis") {
          return responsesCompletedResponse(JSON.stringify(analysisFor(input)));
        }
        if (stage === "translation") return responsesCompletedResponse("你好");
        return responsesCompletedResponse(JSON.stringify(emptyReview(input, stage)));
      }),
    };
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      servicePreset: responsesPreset,
    });

    await expect(
      runtime.startTranslation(precisionRequest("precision-responses")),
    ).resolves.toMatchObject({
      status: "completed",
      translation: "你好",
      precision: { complete: true },
    });
    expect(transport.request).toHaveBeenCalledTimes(4);
  });

  it("keeps normalized analysis ranges aligned with protected content in CRLF input", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const sourceText = "a\r\nhttps://x.y\r\nb";
    const transport = {
      request: vi.fn(async (request) => {
        const input = inputFromRequest(request);
        const stage = stageOf(request);
        if (stage === "analysis") {
          expect(input.sourceText).toBe("a\nhttps://x.y\nb");
          expect(input.protectedItems).toEqual([
            expect.objectContaining({
              segmentId: input.segments[0].id,
              sourceValue: "https://x.y",
              sourceRange: { start: 2, end: 13 },
            }),
          ]);
          return completedResponse(JSON.stringify(analysisFor(input)));
        }
        if (stage === "translation") {
          expect(input.sourceText).toBe("a\nhttps://x.y\nb");
          return completedResponse("译文");
        }
        return completedResponse(JSON.stringify(emptyReview(input, reviewRole(stage))));
      }),
    };
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport, servicePreset });

    await expect(
      runtime.startTranslation({
        ...precisionRequest("precision-crlf-ranges"),
        sourceText,
      }),
    ).resolves.toMatchObject({ status: "completed", precision: { complete: true } });
  });

  it("accepts a full-document CRLF source at the normalized 10,000 code-point limit", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const sourceText = "a\r\n".repeat(5_000);
    const normalizedSourceText = "a\n".repeat(5_000);
    const transport = {
      request: vi.fn(async (request) => {
        const input = inputFromRequest(request);
        const stage = stageOf(request);
        if (stage === "analysis") {
          expect(input.sourceText).toBe(normalizedSourceText);
          return completedResponse(JSON.stringify(analysisFor(input)));
        }
        if (stage === "translation") {
          expect(input.sourceText).toBe(normalizedSourceText);
          return completedResponse("译文");
        }
        return completedResponse(JSON.stringify(emptyReview(input, reviewRole(stage))));
      }),
    };
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport, servicePreset });

    await expect(
      runtime.startTranslation({
        ...precisionRequest("precision-crlf-limit"),
        sourceText,
      }),
    ).resolves.toMatchObject({ status: "completed", precision: { complete: true } });
    expect(transport.request).toHaveBeenCalledTimes(4);
  });

  it("does not start the translation stage after cancellation at the stage boundary", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn(async (request) => {
        const input = inputFromRequest(request);
        expect(stageOf(request)).toBe("analysis");
        return completedResponse(JSON.stringify(analysisFor(input)));
      }),
    };
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport, servicePreset });
    const taskId = "precision-cancel-stage-boundary";

    const result = await runtime.startTranslation(
      precisionRequest(taskId),
      (event: TranslationProgressEvent) => {
        if (event.type === "precision_stage" && event.stage === "translating") {
          runtime.cancelTranslation(taskId);
        }
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      precision: { failedStage: "translation" },
      error: { code: "cancelled" },
    });
    expect(transport.request).toHaveBeenCalledOnce();
  });

  it("reports cancellation during revision and retains the reviewed initial translation", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn((request) => {
        const input = inputFromRequest(request);
        const stage = stageOf(request);
        if (stage === "analysis") {
          return Promise.resolve(completedResponse(JSON.stringify(analysisFor(input))));
        }
        if (stage === "translation") return Promise.resolve(completedResponse("初译"));
        if (stage === "accuracy") {
          return Promise.resolve(
            completedResponse(
              JSON.stringify({
                schemaVersion: "review-output.v1",
                taskId: input.taskId,
                role: "accuracy",
                issues: [
                  {
                    id: "accuracy-cancel-revision",
                    segmentId: input.segments[0].id,
                    type: "mistranslation",
                    severity: "major",
                    sourceRange: { start: 0, end: 5 },
                    translationRange: { start: 0, end: 2 },
                    suggestion: "改译",
                    confidence: "high",
                  },
                ],
              }),
            ),
          );
        }
        if (stage === "language") {
          return Promise.resolve(completedResponse(JSON.stringify(emptyReview(input, "language"))));
        }
        return new Promise((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("cancelled"), { code: "cancelled" })),
            { once: true },
          );
        });
      }),
    };
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport, servicePreset });
    const running = runtime.startTranslation(precisionRequest("precision-revision-cancel"));
    await vi.waitFor(() => expect(transport.request).toHaveBeenCalledTimes(5));

    runtime.cancelTranslation("precision-revision-cancel");

    await expect(running).resolves.toMatchObject({
      status: "failed",
      partialTranslation: "初译",
      precision: {
        complete: false,
        failedStage: "revision",
        reviewIssues: [expect.objectContaining({ id: "accuracy-cancel-revision" })],
      },
      error: { code: "cancelled" },
    });
  });
});
