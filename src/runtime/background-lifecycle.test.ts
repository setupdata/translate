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
    setItem: vi.fn((key: string, value: unknown) =>
      values.set(key, structuredClone(value)),
    ),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}

const servicePreset = {
  id: "local-background",
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

function translationRequest(taskId: string, sourceText = "含敏感内容的源文") {
  return {
    taskId,
    sourceText,
    targetLanguage: {
      kind: "preset",
      id: "zh-CN",
      modelLabel: "Simplified Chinese",
    },
  };
}

function completedResponse(content: string) {
  return {
    status: 200,
    headers: {},
    body: JSON.stringify({ choices: [{ message: { content } }] }),
    complete: true,
  };
}

function lifecycleHost(showImplementation?: (outcome: string) => void) {
  let enterHandler: (() => void) | undefined;
  let outHandler: ((isKill: boolean) => void) | undefined;
  const showTranslationNotification = vi.fn(showImplementation);
  return {
    actions: {
      onPluginEnter(handler: () => void) {
        enterHandler = handler;
      },
      onPluginOut(handler: (isKill: boolean) => void) {
        outHandler = handler;
      },
      showTranslationNotification,
    },
    enter() {
      expect(enterHandler).toBeTypeOf("function");
      enterHandler?.();
    },
    out(isKill: boolean) {
      expect(outHandler).toBeTypeOf("function");
      outHandler?.(isKill);
    },
    showTranslationNotification,
  };
}

function deferredTransport() {
  const pending: Array<{
    signal: AbortSignal;
    resolve(value: unknown): void;
    reject(error: unknown): void;
  }> = [];
  const request = vi.fn(
    ({ signal }: { signal: AbortSignal }) =>
      new Promise((resolve, reject) => {
        pending.push({ signal, resolve, reject });
        signal.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("cancelled"), { code: "cancelled" })),
          { once: true },
        );
      }),
  );
  return { request, pending };
}

function runtimeFixture(options: {
  plainStorage?: ReturnType<typeof memoryStorage>;
  transport?: ReturnType<typeof deferredTransport>;
  host?: ReturnType<typeof lifecycleHost>;
} = {}) {
  const { createRuyiRuntime } = require(runtimePath);
  const plainStorage = options.plainStorage ?? memoryStorage();
  const transport = options.transport ?? deferredTransport();
  const host = options.host ?? lifecycleHost();
  return {
    plainStorage,
    transport,
    host,
    runtime: createRuyiRuntime({
      plainStorage,
      cryptoStorage: memoryStorage(),
      transport,
      servicePreset,
      hostActions: host.actions,
    }),
  };
}

describe("background translation lifecycle", () => {
  it("keeps an active request running while hidden and sends one content-free completion notice", async () => {
    const { runtime, transport, host } = runtimeFixture();
    const task = runtime.startStandardTranslation(
      translationRequest("background-complete", "secret source text"),
    );
    await vi.waitFor(() => expect(transport.request).toHaveBeenCalledOnce());

    host.out(false);
    expect(transport.pending[0].signal.aborted).toBe(false);
    transport.pending[0].resolve(completedResponse("secret translated text"));

    await expect(task).resolves.toMatchObject({
      status: "completed",
      translation: "secret translated text",
    });
    expect(host.showTranslationNotification).toHaveBeenCalledOnce();
    expect(host.showTranslationNotification).toHaveBeenCalledWith("completed");
    expect(JSON.stringify(host.showTranslationNotification.mock.calls)).not.toMatch(
      /secret source text|secret translated text|Authorization|api.?key/iu,
    );
  });

  it.each([
    ["network_error", "failed"],
    ["timeout", "timeout"],
  ] as const)(
    "reports a hidden %s with only a stable outcome",
    async (errorCode, notificationOutcome) => {
      const { runtime, transport, host } = runtimeFixture();
      const task = runtime.startStandardTranslation(
        translationRequest(`background-${errorCode}`),
      );
      await vi.waitFor(() => expect(transport.request).toHaveBeenCalledOnce());
      host.out(false);
      transport.pending[0].reject(Object.assign(new Error("sensitive upstream error"), {
        code: errorCode,
      }));

      await expect(task).resolves.toMatchObject({
        status: "failed",
        error: { code: errorCode },
      });
      expect(host.showTranslationNotification).toHaveBeenCalledWith(
        notificationOutcome,
      );
      expect(JSON.stringify(host.showTranslationNotification.mock.calls)).not.toContain(
        "sensitive upstream error",
      );
    },
  );

  it("keeps the ten-minute task deadline active while hidden", async () => {
    vi.useFakeTimers();
    try {
      const { runtime, transport, host } = runtimeFixture();
      const task = runtime.startStandardTranslation(
        translationRequest("background-total-timeout"),
      );
      for (let index = 0; index < 8 && transport.request.mock.calls.length === 0; index += 1) {
        await Promise.resolve();
      }
      expect(transport.request).toHaveBeenCalledOnce();
      host.out(false);

      await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);

      await expect(task).resolves.toMatchObject({
        status: "failed",
        error: { code: "timeout" },
      });
      expect(host.showTranslationNotification).toHaveBeenCalledWith("timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("best-effort cancels on process termination without notifying a cancelled task", async () => {
    const { runtime, transport, host } = runtimeFixture();
    const task = runtime.startStandardTranslation(
      translationRequest("background-process-end"),
    );
    await vi.waitFor(() => expect(transport.request).toHaveBeenCalledOnce());

    host.out(true);

    expect(transport.pending[0].signal.aborted).toBe(true);
    await expect(task).resolves.toMatchObject({
      status: "failed",
      error: { code: "cancelled" },
    });
    expect(host.showTranslationNotification).not.toHaveBeenCalled();
  });

  it("suppresses the replaced task notice and notifies only the current hidden task", async () => {
    const { runtime, transport, host } = runtimeFixture();
    const oldTask = runtime.startStandardTranslation(
      translationRequest("background-old"),
    );
    await vi.waitFor(() => expect(transport.request).toHaveBeenCalledTimes(1));
    host.out(false);

    const currentTask = runtime.startStandardTranslation(
      translationRequest("background-current"),
    );
    await vi.waitFor(() => expect(transport.request).toHaveBeenCalledTimes(2));
    expect(transport.pending[0].signal.aborted).toBe(true);
    transport.pending[1].resolve(completedResponse("current translation"));

    await expect(oldTask).resolves.toMatchObject({
      status: "failed",
      error: { code: "cancelled" },
    });
    await expect(currentTask).resolves.toMatchObject({ status: "completed" });
    expect(host.showTranslationNotification.mock.calls).toEqual([["completed"]]);
  });

  it("persists a default-on notification preference and suppresses notices when disabled", async () => {
    const plainStorage = memoryStorage();
    const first = runtimeFixture({ plainStorage });

    await expect(first.runtime.getServiceConfigurations()).resolves.toMatchObject({
      backgroundNotificationsEnabled: true,
    });
    await expect(
      first.runtime.setBackgroundNotificationsEnabled(false),
    ).resolves.toMatchObject({ backgroundNotificationsEnabled: false });

    const second = runtimeFixture({ plainStorage });
    await expect(second.runtime.getServiceConfigurations()).resolves.toMatchObject({
      backgroundNotificationsEnabled: false,
    });
    const task = second.runtime.startStandardTranslation(
      translationRequest("background-disabled"),
    );
    await vi.waitFor(() => expect(second.transport.request).toHaveBeenCalledOnce());
    second.host.out(false);
    second.transport.pending[0].resolve(completedResponse("译文"));
    await expect(task).resolves.toMatchObject({ status: "completed" });
    expect(second.host.showTranslationNotification).not.toHaveBeenCalled();
  });

  it("does not notify after the plugin becomes visible again", async () => {
    const { runtime, transport, host } = runtimeFixture();
    const task = runtime.startStandardTranslation(
      translationRequest("background-visible-again"),
    );
    await vi.waitFor(() => expect(transport.request).toHaveBeenCalledOnce());
    host.out(false);
    host.enter();
    transport.pending[0].resolve(completedResponse("译文"));
    await task;

    expect(host.showTranslationNotification).not.toHaveBeenCalled();
  });

  it("does not change a completed result when the host notification API fails", async () => {
    const host = lifecycleHost(() => {
      throw new Error("notification unavailable");
    });
    const { runtime, transport } = runtimeFixture({ host });
    const task = runtime.startStandardTranslation(
      translationRequest("background-notification-error"),
    );
    await vi.waitFor(() => expect(transport.request).toHaveBeenCalledOnce());
    host.out(false);
    transport.pending[0].resolve(completedResponse("译文"));

    await expect(task).resolves.toMatchObject({
      status: "completed",
      translation: "译文",
    });
  });
});
