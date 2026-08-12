import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

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
        "startStandardTranslation",
        "subscribeCurrentTranslation",
        "testServiceConnection",
        "updateCurrentTranslationInputs",
      ].sort(),
    );
    expect(JSON.stringify(runtime)).not.toMatch(/dbStorage|dbCryptoStorage|Authorization/u);
  });
});
