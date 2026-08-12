import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuyiRuntimeBridge } from "./contracts";
import { getBrowserRuntime } from "./browser-runtime";

afterEach(() => {
  delete window.ruyiTranslation;
});

describe("getBrowserRuntime", () => {
  it("returns the preload business interface without exposing another API", () => {
    const bridge: RuyiRuntimeBridge = {
      getServiceConfiguration: vi.fn(),
      saveApiKey: vi.fn(),
      startStandardTranslation: vi.fn(),
      cancelTranslation: vi.fn(),
    };
    window.ruyiTranslation = bridge;

    expect(getBrowserRuntime()).toBe(bridge);
  });

  it("returns a clear failure interface outside the uTools preload environment", async () => {
    const runtime = getBrowserRuntime();

    await expect(runtime.getServiceConfiguration()).rejects.toThrow(
      "如意翻译运行时尚未就绪，请在 uTools 中打开插件。",
    );
  });
});
