import { describe, expect, it } from "vitest";

import pluginManifest from "../../public/plugin.json";

describe("plugin.json", () => {
  it("declares the files uTools needs in development and production", () => {
    expect(pluginManifest).toMatchObject({
      main: "index.html",
      logo: "logo.png",
      preload: "preload.js",
      development: { main: "http://127.0.0.1:5173/index.html" },
    });
  });

  it("exposes the translation commands and arbitrary text matching", () => {
    const translationFeature = pluginManifest.features.find(
      (feature) => feature.code === "translate",
    );

    expect(translationFeature?.cmds).toEqual([
      "如意翻译",
      "翻译",
      "fy",
      {
        type: "over",
        label: "用如意翻译",
        minLength: 1,
        maxLength: 10_000,
      },
    ]);
  });

  it("exposes a dedicated settings entry", () => {
    expect(pluginManifest.features).toContainEqual({
      code: "settings",
      explain: "配置如意翻译",
      cmds: ["如意翻译设置"],
    });
  });
});
