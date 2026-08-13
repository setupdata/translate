import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimePluginEntryAction } from "./runtime/contracts";
import { createRuntimeStub } from "./test/runtime-stub";

afterEach(() => {
  vi.doUnmock("react-dom/client");
  vi.doUnmock("./runtime/browser-runtime");
  vi.resetModules();
  document.body.innerHTML = "";
});

describe("main entry bridge", () => {
  it("renders host entry actions received through the named runtime interface", async () => {
    const render = vi.fn();
    let listener: ((action: RuntimePluginEntryAction) => void) | undefined;
    const runtime = createRuntimeStub({
      subscribePluginEntry: vi.fn((nextListener) => {
        listener = nextListener;
        return () => undefined;
      }),
    });
    vi.doMock("react-dom/client", () => ({
      createRoot: () => ({ render }),
    }));
    vi.doMock("./runtime/browser-runtime", () => ({
      getBrowserRuntime: () => runtime,
    }));
    document.body.innerHTML = '<div id="root"></div>';

    await import("./main");

    expect(runtime.subscribePluginEntry).toHaveBeenCalledOnce();
    listener?.({ code: "settings", type: "text", payload: "" });
    expect(render.mock.calls.at(-1)?.[0].props.intent).toEqual({ page: "settings" });

    listener?.({ code: "translate", type: "text", payload: "" });
    expect(render.mock.calls.at(-1)?.[0].props.intent).toEqual({
      page: "translation",
      sourceText: "",
      autoStart: false,
    });
  });

  it("uses a queued host entry as the initial render without flashing an empty task", async () => {
    const render = vi.fn();
    const runtime = createRuntimeStub({
      subscribePluginEntry: vi.fn((listener) => {
        listener({ code: "translate", type: "over", payload: "queued source" });
        return () => undefined;
      }),
    });
    vi.doMock("react-dom/client", () => ({
      createRoot: () => ({ render }),
    }));
    vi.doMock("./runtime/browser-runtime", () => ({
      getBrowserRuntime: () => runtime,
    }));
    document.body.innerHTML = '<div id="root"></div>';

    await import("./main");

    expect(render).toHaveBeenCalledOnce();
    expect(render.mock.calls[0][0].props.intent).toEqual({
      page: "translation",
      sourceText: "queued source",
      autoStart: true,
    });
  });
});
