import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";

describe("App", () => {
  it("renders the translation page for a function command", () => {
    render(
      <App
        intent={{ page: "translation", sourceText: "", autoStart: false }}
        translate={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "如意翻译" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "源文本" })).toBeInTheDocument();
  });

  it("renders the settings page for the settings command", () => {
    render(<App intent={{ page: "settings" }} translate={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "源文本" })).not.toBeInTheDocument();
  });
});
