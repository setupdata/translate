import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

describe("preload storage boundary", () => {
  it("refuses to save a key when uTools encrypted storage is unavailable", async () => {
    const preloadPath = resolve(import.meta.dirname, "../../public/preload.js");
    const preloadSource = await readFile(preloadPath, "utf8");
    const preloadWindow: Record<string, unknown> = {};

    runInNewContext(
      preloadSource,
      {
        require: createRequire(preloadPath),
        window: preloadWindow,
      },
      { filename: preloadPath },
    );

    const runtime = preloadWindow.ruyiTranslation as {
      saveApiKey(value: HTMLFormElement): Promise<unknown>;
    };
    const form = document.createElement("form");
    const input = document.createElement("input");
    input.name = "apiKey";
    input.value = "ephemeral-test-value";
    form.append(input);
    await expect(runtime.saveApiKey(form)).rejects.toThrow(
      "uTools 加密存储不可用，API Key 未保存。",
    );
  });

  it("exposes only named business methods and never exposes storage or Node objects", async () => {
    const preloadPath = resolve(import.meta.dirname, "../../public/preload.js");
    const preloadSource = await readFile(preloadPath, "utf8");
    const preloadWindow: Record<string, unknown> = {
      utools: {
        dbStorage: {
          getItem: () => undefined,
          setItem: () => undefined,
          removeItem: () => undefined,
        },
        dbCryptoStorage: {
          getItem: () => undefined,
          setItem: () => undefined,
          removeItem: () => undefined,
        },
      },
    };
    runInNewContext(
      preloadSource,
      { require: createRequire(preloadPath), window: preloadWindow },
      { filename: preloadPath },
    );

    const runtime = preloadWindow.ruyiTranslation as Record<string, unknown>;
    expect(Object.keys(runtime).sort()).toEqual(
      [
        "cancelServiceOperation",
        "cancelTranslation",
        "clearCurrentTranslation",
        "clearServicePerformanceData",
        "copyTranslation",
        "deleteServiceApiKey",
        "deleteServiceConfiguration",
        "deleteDomainProfile",
        "deleteReferenceTranslation",
        "deleteTermbase",
        "duplicateServiceConfiguration",
        "exportTermbaseCsv",
        "fetchServiceModels",
        "getCurrentTranslation",
        "getParallelAccelerationAdvice",
        "getTranslationCallPlan",
        "getServiceConfiguration",
        "getServiceConfigurations",
        "getTerminologyState",
        "commitTermbaseCsv",
        "moveServiceConfiguration",
        "pasteTranslation",
        "previewTermbaseCsv",
        "discardTermbaseCsvPreview",
        "saveApiKey",
        "saveServiceApiKey",
        "saveServiceConfiguration",
        "saveDomainProfile",
        "saveReferenceTranslation",
        "saveTermbase",
        "setCurrentServiceConfiguration",
        "setCurrentDomainProfile",
        "setBackgroundNotificationsEnabled",
        "setServiceThinkingMode",
        "startTranslation",
        "startStandardTranslation",
        "subscribeCurrentTranslation",
        "testServiceConnection",
        "updateCurrentTranslationInputs",
      ].sort(),
    );
    expect(JSON.stringify(runtime)).not.toMatch(/dbStorage|dbCryptoStorage|Authorization/u);
  });

  it("keeps lifecycle and content-free notification clicks behind preload without copy or paste", async () => {
    const preloadPath = resolve(import.meta.dirname, "../../public/preload.js");
    const preloadSource = await readFile(preloadPath, "utf8");
    const onPluginEnter = vi.fn();
    const onPluginOut = vi.fn();
    const showNotification = vi.fn();
    const copyText = vi.fn();
    const hideMainWindowPasteText = vi.fn();
    let hostActions: Record<string, unknown> | undefined;
    const preloadRequire = (id: string) => {
      if (id === "./lib/node-chat-transport.cjs") {
        return { createNodeChatTransport: () => ({}) };
      }
      if (id === "./lib/ruyi-runtime.cjs") {
        return {
          createRuyiRuntime(options: { hostActions: Record<string, unknown> }) {
            hostActions = options.hostActions;
            return Object.freeze({ businessMethod: true });
          },
        };
      }
      throw new Error(`unexpected require: ${id}`);
    };
    const preloadWindow: Record<string, unknown> = {
      utools: {
        onPluginEnter,
        onPluginOut,
        showNotification,
        copyText,
        hideMainWindowPasteText,
      },
    };

    runInNewContext(
      preloadSource,
      { require: preloadRequire, window: preloadWindow },
      { filename: preloadPath },
    );

    expect(hostActions).toBeDefined();
    const enterHandler = vi.fn();
    const outHandler = vi.fn();
    (hostActions?.onPluginEnter as (handler: () => void) => void)(enterHandler);
    (hostActions?.onPluginOut as (handler: (isKill: boolean) => void) => void)(outHandler);
    expect(onPluginEnter).toHaveBeenCalledWith(enterHandler);
    expect(onPluginOut).toHaveBeenCalledWith(outHandler);

    const notify = hostActions?.showTranslationNotification as (
      outcome: "completed" | "failed" | "timeout",
    ) => void;
    notify("completed");
    notify("failed");
    notify("timeout");
    expect(showNotification.mock.calls).toEqual([
      ["后台翻译已完成，请返回如意翻译查看。", "translate"],
      ["后台翻译未完成，请返回如意翻译查看。", "translate"],
      ["后台翻译已超时，请返回如意翻译查看。", "translate"],
    ]);
    expect(JSON.stringify(showNotification.mock.calls)).not.toMatch(
      /source|translation|term|api.?key|Authorization/iu,
    );
    expect(copyText).not.toHaveBeenCalled();
    expect(hideMainWindowPasteText).not.toHaveBeenCalled();
    expect(preloadWindow.ruyiTranslation).toEqual({ businessMethod: true });
  });
});
