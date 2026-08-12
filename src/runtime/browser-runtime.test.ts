import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuyiRuntimeBridge } from "./contracts";
import { getBrowserRuntime } from "./browser-runtime";

afterEach(() => {
  delete window.ruyiTranslation;
});

describe("getBrowserRuntime", () => {
  it("returns the preload business interface without exposing another API", () => {
    const bridge: RuyiRuntimeBridge = {
      getTerminologyState: vi.fn(),
      saveTermbase: vi.fn(),
      deleteTermbase: vi.fn(),
      saveDomainProfile: vi.fn(),
      deleteDomainProfile: vi.fn(),
      setCurrentDomainProfile: vi.fn(),
      saveReferenceTranslation: vi.fn(),
      deleteReferenceTranslation: vi.fn(),
      previewTermbaseCsv: vi.fn(),
      discardTermbaseCsvPreview: vi.fn(),
      commitTermbaseCsv: vi.fn(),
      exportTermbaseCsv: vi.fn(),
      getServiceConfiguration: vi.fn(),
      getServiceConfigurations: vi.fn(),
      saveServiceConfiguration: vi.fn(),
      duplicateServiceConfiguration: vi.fn(),
      moveServiceConfiguration: vi.fn(),
      setCurrentServiceConfiguration: vi.fn(),
      deleteServiceConfiguration: vi.fn(),
      saveServiceApiKey: vi.fn(),
      deleteServiceApiKey: vi.fn(),
      clearServicePerformanceData: vi.fn(),
      getParallelAccelerationAdvice: vi.fn(),
      testServiceConnection: vi.fn(),
      fetchServiceModels: vi.fn(),
      cancelServiceOperation: vi.fn(),
      saveApiKey: vi.fn(),
      startStandardTranslation: vi.fn(),
      cancelTranslation: vi.fn(),
      copyTranslation: vi.fn(),
      pasteTranslation: vi.fn(),
      getCurrentTranslation: vi.fn(),
      updateCurrentTranslationInputs: vi.fn(),
      subscribeCurrentTranslation: vi.fn(),
      clearCurrentTranslation: vi.fn(),
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
