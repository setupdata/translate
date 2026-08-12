import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createRuntimeStub } from "../test/runtime-stub";
import { App } from "./App";

describe("App", () => {
  it("renders the translation page for a function command", () => {
    render(
      <App
        intent={{ page: "translation", sourceText: "", autoStart: false }}
        runtime={createRuntimeStub()}
      />,
    );

    expect(screen.getByRole("heading", { name: "如意翻译" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "源文本" })).toBeInTheDocument();
  });

  it("renders the settings page for the settings command", () => {
    render(<App intent={{ page: "settings" }} runtime={createRuntimeStub()} />);

    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "源文本" })).not.toBeInTheDocument();
  });
});
