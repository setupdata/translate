import { describe, expect, it } from "vitest";

import { resolveEntryIntent } from "./entry-intent";

describe("resolveEntryIntent", () => {
  it.each([
    ["text", ""],
    ["text", "ignored payload"],
  ])("opens an empty translation page for a function command", (type, payload) => {
    expect(
      resolveEntryIntent({ code: "translate", type, payload }),
    ).toEqual({ page: "translation", sourceText: "", autoStart: false });
  });

  it("preserves matched text exactly and starts its translation", () => {
    const sourceText = "  first line\n\n    second line  ";

    expect(
      resolveEntryIntent({ code: "translate", type: "over", payload: sourceText }),
    ).toEqual({ page: "translation", sourceText, autoStart: true });
  });

  it("opens settings for the settings feature", () => {
    expect(
      resolveEntryIntent({ code: "settings", type: "text", payload: "" }),
    ).toEqual({ page: "settings" });
  });
});
