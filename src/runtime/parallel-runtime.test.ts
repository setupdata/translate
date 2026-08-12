import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

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
  id: "local-chat",
  name: "本地模型",
  type: "custom",
  protocol: "chat-completions",
  translationUrl: "http://127.0.0.1:11434/v1/chat/completions",
  modelListUrl: "http://127.0.0.1:11434/v1/models",
  authentication: "none",
  model: "fixture-model",
  stream: false,
  confirmedTranslationUrl: "http://127.0.0.1:11434/v1/chat/completions",
};

function longSource(paragraphCount = 5) {
  return Array.from(
    { length: paragraphCount },
    (_, index) => `第${index + 1}段 {item${index + 1}} ${"source ".repeat(200)}。\n\n`,
  ).join("");
}

function inputFromRequest(request: { body: string }) {
  const body = JSON.parse(request.body);
  return JSON.parse(body.messages[1].content);
}

function completedResponse(content: string) {
  return {
    status: 200,
    headers: {},
    body: JSON.stringify({ choices: [{ message: { content } }] }),
    complete: true,
  };
}

describe("Ruyi runtime parallel acceleration", () => {
  it("sends one segment request per block concurrently and merges reverse completion in source order", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const pending: Array<{
      request: { body: string; signal: AbortSignal };
      resolve(value: unknown): void;
    }> = [];
    const transport = {
      request: vi.fn(
        (request) =>
          new Promise((resolve, reject) => {
            request.signal.addEventListener(
              "abort",
              () => reject(Object.assign(new Error("cancelled"), { code: "cancelled" })),
              { once: true },
            );
            pending.push({ request, resolve });
          }),
      ),
    };
    let clock = 0;
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      servicePreset,
      now: () => new Date((clock += 1_000)),
    });
    const progress = vi.fn();
    const sourceText = longSource();

    const running = runtime.startStandardTranslation(
      {
        taskId: "parallel-reverse",
        sourceText,
        targetLanguage,
        parallelAcceleration: true,
        parallelConcurrency: 3,
      },
      progress,
    );

    await vi.waitFor(() => expect(transport.request).toHaveBeenCalledTimes(3));
    const inputs: Array<{
      mode: string;
      segment: { ordinal: number; ownedSource: string; sourceContextBefore: string };
      protectedItems: Array<{ id: string }>;
    }> = pending.map(({ request }) => inputFromRequest(request));
    expect(inputs.every((input) => input.mode === "segment" && !("sourceText" in input))).toBe(true);
    expect(inputs.map((input) => input.segment.ordinal)).toEqual([0, 1, 2]);
    expect(inputs.every((input) => Array.from(input.segment.ownedSource).length <= 3_000)).toBe(true);
    expect(inputs.every((input) => Array.from(input.segment.sourceContextBefore).length <= 500)).toBe(true);
    const protectedIds = inputs.flatMap((input) =>
      input.protectedItems.map((item: { id: string }) => item.id),
    );
    expect(new Set(protectedIds).size).toBe(protectedIds.length);

    for (const item of [...pending].reverse()) {
      const input = inputFromRequest(item.request);
      item.resolve(completedResponse(`[译文-${input.segment.ordinal}]`));
      await Promise.resolve();
    }

    const result = await running;
    expect(result).toMatchObject({
      status: "completed",
      translation: "[译文-0][译文-1][译文-2]",
      parallel: {
        requested: true,
        applied: true,
        concurrency: 3,
        segmentCount: 3,
        fallbackReason: null,
      },
    });
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ type: "segment_progress", completed: 1, total: 3 }),
    );
    const firstTextDelta = progress.mock.calls.find(([event]) => event.type === "text_delta")?.[0];
    expect(firstTextDelta?.delta).toBe("[译文-0]");

    const configuration = await runtime.getServiceConfiguration("local-chat");
    expect(configuration.serviceConfiguration?.performanceSummary).toMatchObject({ sampleCount: 1 });
    const stored = JSON.stringify([...plainStorage.values.values()]);
    expect(stored).not.toContain(sourceText);
    expect(stored).not.toContain("[译文-0]");
  });

  it("stops queued segments and aborts all in-flight segment requests on cancellation", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const pendingSignals: AbortSignal[] = [];
    const transport = {
      request: vi.fn(
        (request) =>
          new Promise((_resolve, reject) => {
            pendingSignals.push(request.signal);
            request.signal.addEventListener(
              "abort",
              () => reject(Object.assign(new Error("cancelled"), { code: "cancelled" })),
              { once: true },
            );
          }),
      ),
    };
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport, servicePreset });

    const running = runtime.startStandardTranslation({
      taskId: "parallel-cancel",
      sourceText: longSource(7),
      targetLanguage,
      parallelAcceleration: true,
      parallelConcurrency: 2,
    });
    await vi.waitFor(() => expect(transport.request).toHaveBeenCalledTimes(2));
    runtime.cancelTranslation("parallel-cancel");

    await expect(running).resolves.toMatchObject({
      status: "failed",
      error: { code: "cancelled" },
      parallel: { applied: true, concurrency: 2 },
    });
    expect(transport.request).toHaveBeenCalledTimes(2);
    expect(pendingSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it("falls back to one full-document request and explains an oversized code block", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = {
      request: vi.fn(async (_request: { body: string }) => completedResponse("全文译文")),
    };
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport, servicePreset });
    const sourceText = `before\n\n\`\`\`text\n${"x".repeat(3_001)}\n\`\`\`\nafter`;

    const result = await runtime.startStandardTranslation({
      taskId: "parallel-fallback",
      sourceText,
      targetLanguage,
      parallelAcceleration: true,
      parallelConcurrency: 3,
    });

    expect(transport.request).toHaveBeenCalledOnce();
    expect(inputFromRequest(transport.request.mock.calls[0][0])).toMatchObject({
      mode: "full_document",
      sourceText,
    });
    expect(result).toMatchObject({
      status: "completed",
      parallel: {
        requested: true,
        applied: false,
        segmentCount: 1,
        fallbackReason: expect.stringContaining("代码块"),
      },
    });
  });

  it("rejects an invalid concurrency before sending", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = { request: vi.fn() };
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({ plainStorage, cryptoStorage, transport, servicePreset });

    const result = await runtime.startStandardTranslation({
      taskId: "parallel-invalid",
      sourceText: longSource(),
      targetLanguage,
      parallelAcceleration: true,
      parallelConcurrency: 7,
    });

    expect(result).toMatchObject({
      status: "validation_error",
      reason: "invalid_parallel_configuration",
      field: "parallelConcurrency",
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("shows the actual segment call count in first-send confirmation", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = { request: vi.fn() };
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      servicePreset: { ...servicePreset, confirmedTranslationUrl: null },
      tokenFactory: () => "parallel-confirmation",
    });

    const result = await runtime.startStandardTranslation({
      taskId: "parallel-confirmation",
      sourceText: longSource(),
      targetLanguage,
      parallelAcceleration: true,
      parallelConcurrency: 3,
    });

    expect(result).toMatchObject({
      status: "confirmation_required",
      preview: {
        callCount: 3,
        parallel: {
          requested: true,
          applied: true,
          concurrency: 3,
          segmentCount: 3,
        },
      },
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("clears local performance summaries without touching the service configuration", async () => {
    const plainStorage = memoryStorage();
    const cryptoStorage = memoryStorage();
    const transport = { request: vi.fn(async () => completedResponse("译文")) };
    let clock = 0;
    const { createRuyiRuntime } = require(runtimePath);
    const runtime = createRuyiRuntime({
      plainStorage,
      cryptoStorage,
      transport,
      servicePreset,
      now: () => new Date((clock += 1_000)),
    });
    await runtime.startStandardTranslation({
      taskId: "performance-sample",
      sourceText: "source",
      targetLanguage,
    });
    expect((await runtime.getServiceConfiguration("local-chat")).serviceConfiguration)
      .toMatchObject({ performanceSummary: { sampleCount: 1 } });

    const state = await runtime.clearServicePerformanceData("local-chat");

    expect(state.serviceConfigurations[0]).toMatchObject({
      id: "local-chat",
      performanceSummary: null,
    });
    expect(transport.request).toHaveBeenCalledOnce();
  });

  it("applies the ten-minute total timeout to the whole segmented task", async () => {
    vi.useFakeTimers();
    try {
      const plainStorage = memoryStorage();
      const cryptoStorage = memoryStorage();
      const transport = {
        request: vi.fn(
          ({ signal }: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              signal.addEventListener(
                "abort",
                () => reject(Object.assign(new Error("cancelled"), { code: "cancelled" })),
                { once: true },
              );
            }),
        ),
      };
      const { createRuyiRuntime } = require(runtimePath);
      const runtime = createRuyiRuntime({
        plainStorage,
        cryptoStorage,
        transport,
        servicePreset,
      });

      const running = runtime.startStandardTranslation({
        taskId: "parallel-total-timeout",
        sourceText: longSource(),
        targetLanguage,
        parallelAcceleration: true,
        parallelConcurrency: 1,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(transport.request).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(600_000);

      await expect(running).resolves.toMatchObject({
        status: "failed",
        error: { code: "timeout" },
        parallel: { applied: true },
      });
      expect(transport.request).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
