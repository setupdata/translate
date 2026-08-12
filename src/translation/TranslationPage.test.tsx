import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TranslationPage } from "./TranslationPage";

describe("TranslationPage", () => {
  it("shows an editable source field when no text was supplied", () => {
    render(
      <TranslationPage
        initialText=""
        autoStart={false}
        translate={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox", { name: "源文本" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "开始翻译" })).toBeEnabled();
  });

  it("sends supplied text unchanged and displays only the translation", async () => {
    const user = userEvent.setup();
    const sourceText = "  first line\n\n    second line  ";
    const translate = vi.fn().mockResolvedValue("这是模拟译文。\n第二段译文。");

    render(
      <TranslationPage
        initialText={sourceText}
        autoStart={false}
        translate={translate}
      />,
    );

    expect(screen.getByRole("textbox", { name: "源文本" })).toHaveValue(
      sourceText,
    );

    await user.click(screen.getByRole("button", { name: "开始翻译" }));

    expect(translate).toHaveBeenCalledOnce();
    expect(translate).toHaveBeenCalledWith(sourceText);
    expect(await screen.findByRole("region", { name: "译文" })).toHaveTextContent(
      "这是模拟译文。 第二段译文。",
    );
  });

  it("keeps whitespace-only input and asks for valid text without translating", async () => {
    const user = userEvent.setup();
    const translate = vi.fn();

    render(
      <TranslationPage
        initialText={" \n  "}
        autoStart={false}
        translate={translate}
      />,
    );

    await user.click(screen.getByRole("button", { name: "开始翻译" }));

    expect(translate).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "源文本" })).toHaveValue(" \n  ");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "请输入需要翻译的有效文本。",
    );
  });

  it("starts matched text automatically exactly once", async () => {
    const translate = vi.fn().mockResolvedValue("自动翻译结果");

    render(
      <TranslationPage
        initialText="matched text"
        autoStart
        translate={translate}
      />,
    );

    expect(await screen.findByRole("region", { name: "译文" })).toHaveTextContent(
      "自动翻译结果",
    );
    expect(translate).toHaveBeenCalledOnce();
    expect(translate).toHaveBeenCalledWith("matched text");
  });

  it("shows a useful message when the local translation service fails", async () => {
    const user = userEvent.setup();
    const translate = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    render(
      <TranslationPage
        initialText="source"
        autoStart={false}
        translate={translate}
      />,
    );
    await user.click(screen.getByRole("button", { name: "开始翻译" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "翻译失败，请确认受控本地模拟服务已经启动。",
    );
  });
});
