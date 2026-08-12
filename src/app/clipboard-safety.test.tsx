import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRuntimeStub } from "../test/runtime-stub";
import { App } from "./App";

describe("clipboard safety", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("does not read or monitor the clipboard while starting a translation", async () => {
    const readText = vi.fn(() => {
      throw new Error("不应读取剪贴板");
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText },
    });
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const startStandardTranslation = vi.fn().mockImplementation(async (request) => ({
      status: "completed",
      taskId: request.taskId,
      translation: "译文",
    }));

    render(
      <App
        intent={{ page: "translation", sourceText: "source", autoStart: false }}
        runtime={createRuntimeStub({ startStandardTranslation })}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    setIntervalSpy.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "开始翻译" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("region", { name: "译文" })).toHaveTextContent("译文");
    expect(readText).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(
      addEventListenerSpy.mock.calls.some(
        ([eventName]) => eventName === "clipboardchange" || eventName === "copy",
      ),
    ).toBe(false);
  });
});
