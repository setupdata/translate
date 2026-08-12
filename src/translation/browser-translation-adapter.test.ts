import { afterEach, describe, expect, it, vi } from "vitest";

import { translateWithPreload } from "./browser-translation-adapter";

describe("translateWithPreload", () => {
  afterEach(() => {
    delete window.ruyiTranslation;
  });

  it("passes source text unchanged through the preload business API", async () => {
    const sourceText = "  first line\n    second line\n";
    const translate = vi.fn().mockResolvedValue("纯译文");
    window.ruyiTranslation = { translate };

    await expect(translateWithPreload(sourceText)).resolves.toBe("纯译文");
    expect(translate).toHaveBeenCalledOnce();
    expect(translate).toHaveBeenCalledWith(sourceText);
  });

  it("reports a clear error when the preload bridge is unavailable", async () => {
    await expect(translateWithPreload("hello")).rejects.toThrow(
      "翻译服务尚未就绪，请在 uTools 中打开插件。",
    );
  });
});
