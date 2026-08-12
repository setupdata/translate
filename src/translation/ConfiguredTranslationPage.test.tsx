import { randomUUID } from "node:crypto";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  RuntimeConfigurationState,
  RuyiRuntimeBridge,
  ServiceConfigurationView,
} from "../runtime/contracts";
import { ConfiguredTranslationPage } from "./ConfiguredTranslationPage";

const missingKeyService: ServiceConfigurationView = {
  id: "deepseek-flash",
  name: "DeepSeek Flash",
  type: "deepseek-official",
  protocol: "chat-completions",
  translationUrl: "https://api.deepseek.com/chat/completions",
  modelListUrl: "https://api.deepseek.com/models",
  authentication: "bearer",
  model: "deepseek-v4-flash",
  stream: true,
  hasApiKey: false,
  maskedApiKey: null,
};

const missingKeyState: RuntimeConfigurationState = {
  serviceConfiguration: missingKeyService,
  defaults: {
    targetLanguage: {
      kind: "preset",
      id: "zh-CN",
      displayName: "简体中文",
      modelLabel: "Simplified Chinese",
    },
    qualityMode: "standard",
    additionalRequirements: "",
  },
};

describe("ConfiguredTranslationPage", () => {
  it("keeps matched text and asks for the missing API key without sending", async () => {
    const sourceText = "  first line\n    second line  ";
    const runtime: RuyiRuntimeBridge = {
      getServiceConfiguration: vi.fn().mockResolvedValue(missingKeyState),
      saveApiKey: vi.fn(),
      startStandardTranslation: vi.fn().mockResolvedValue({
        status: "configuration_required",
        reason: "missing_api_key",
        sourceRetained: true,
        serviceConfiguration: missingKeyService,
      }),
      cancelTranslation: vi.fn(),
    };

    render(
      <ConfiguredTranslationPage
        autoStart
        initialText={sourceText}
        runtime={runtime}
      />,
    );

    expect(screen.getByRole("textbox", { name: "源文本" })).toHaveValue(
      sourceText,
    );
    expect(
      await screen.findByRole("heading", { name: "配置 DeepSeek API Key" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("API Key")).toHaveAttribute("type", "password");
    expect(runtime.startStandardTranslation).toHaveBeenCalledOnce();
    expect(runtime.startStandardTranslation).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceText,
        targetLanguage: missingKeyState.defaults.targetLanguage,
      }),
      expect.any(Function),
    );
  });

  it("keeps the source and guides the user when no service configuration is usable", async () => {
    const sourceText = "  source stays here  ";
    const noConfigurationState: RuntimeConfigurationState = {
      ...missingKeyState,
      serviceConfiguration: null,
    };
    const runtime: RuyiRuntimeBridge = {
      getServiceConfiguration: vi.fn().mockResolvedValue(noConfigurationState),
      saveApiKey: vi.fn(),
      startStandardTranslation: vi.fn().mockResolvedValue({
        status: "configuration_required",
        reason: "missing_configuration",
        sourceRetained: true,
        serviceConfiguration: null,
      }),
      cancelTranslation: vi.fn(),
    };

    render(
      <ConfiguredTranslationPage
        autoStart
        initialText={sourceText}
        runtime={runtime}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "需要服务配置" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/打开“如意翻译设置”/u)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "源文本" })).toHaveValue(
      sourceText,
    );
  });

  it("saves the key, shows only its mask, and presents the send preview", async () => {
    const user = userEvent.setup();
    const apiKeyFixture = `fixture-${randomUUID()}-1234`;
    const savedState: RuntimeConfigurationState = {
      ...missingKeyState,
      serviceConfiguration: {
        ...missingKeyService,
        hasApiKey: true,
        maskedApiKey: "••••••••1234",
      },
    };
    const runtime: RuyiRuntimeBridge = {
      getServiceConfiguration: vi.fn().mockResolvedValue(missingKeyState),
      saveApiKey: vi.fn().mockResolvedValue(savedState),
      startStandardTranslation: vi
        .fn()
        .mockResolvedValueOnce({
          status: "configuration_required",
          reason: "missing_api_key",
          sourceRetained: true,
          serviceConfiguration: missingKeyService,
        })
        .mockResolvedValueOnce({
          status: "confirmation_required",
          sourceRetained: true,
          confirmationToken: "confirmation-page",
          preview: {
            serviceName: "DeepSeek Flash",
            normalizedTranslationUrl:
              "https://api.deepseek.com/chat/completions",
            protocol: "Chat Completions",
            model: "deepseek-v4-flash",
            dataSent: ["源文本", "目标语言", "命中的术语"],
            callCount: 1,
          },
        }),
      cancelTranslation: vi.fn(),
    };
    const sourceText = "Hello";

    render(
      <ConfiguredTranslationPage
        autoStart
        initialText={sourceText}
        runtime={runtime}
      />,
    );
    const apiKeyInput = await screen.findByLabelText("API Key");
    const apiKeyForm = apiKeyInput.closest("form");
    await user.type(apiKeyInput, apiKeyFixture);
    await user.click(screen.getByRole("button", { name: "保存密钥" }));

    expect(runtime.saveApiKey).toHaveBeenCalledOnce();
    expect(runtime.saveApiKey).toHaveBeenCalledWith(apiKeyForm);
    expect(apiKeyInput).toHaveValue("");
    expect(await screen.findByText("••••••••1234")).toBeInTheDocument();
    expect(
      screen.queryByText(apiKeyFixture),
    ).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog", {
      name: "确认发送翻译数据",
    });
    expect(dialog).toHaveTextContent(
      "https://api.deepseek.com/chat/completions",
    );
    expect(dialog).toHaveTextContent("Chat Completions");
    expect(dialog).toHaveTextContent("源文本");
    expect(dialog).toHaveTextContent("目标语言");
    expect(dialog).toHaveTextContent("命中的术语");
    expect(runtime.startStandardTranslation).toHaveBeenCalledTimes(2);
  });

  it("dismisses the first-send preview without starting a model request", async () => {
    const user = userEvent.setup();
    const configuredState: RuntimeConfigurationState = {
      ...missingKeyState,
      serviceConfiguration: {
        ...missingKeyService,
        hasApiKey: true,
        maskedApiKey: "••••••••1234",
      },
    };
    const runtime: RuyiRuntimeBridge = {
      getServiceConfiguration: vi.fn().mockResolvedValue(configuredState),
      saveApiKey: vi.fn(),
      startStandardTranslation: vi.fn().mockResolvedValue({
        status: "confirmation_required",
        sourceRetained: true,
        confirmationToken: "confirmation-cancel",
        preview: {
          serviceName: "DeepSeek Flash",
          normalizedTranslationUrl:
            "https://api.deepseek.com/chat/completions",
          protocol: "Chat Completions",
          model: "deepseek-v4-flash",
          dataSent: ["源文本", "目标语言"],
          callCount: 1,
        },
      }),
      cancelTranslation: vi.fn(),
    };

    render(
      <ConfiguredTranslationPage
        autoStart
        initialText="Hello"
        runtime={runtime}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "取消" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "确认发送翻译数据" }),
    ).not.toBeInTheDocument();
    expect(runtime.startStandardTranslation).toHaveBeenCalledOnce();
    expect(runtime.cancelTranslation).toHaveBeenCalledWith(expect.any(String));
  });

  it("uses the opaque confirmation token and shows only the completed translation", async () => {
    const user = userEvent.setup();
    const configuredState: RuntimeConfigurationState = {
      ...missingKeyState,
      serviceConfiguration: {
        ...missingKeyService,
        hasApiKey: true,
        maskedApiKey: "••••••••1234",
      },
    };
    const runtime: RuyiRuntimeBridge = {
      getServiceConfiguration: vi.fn().mockResolvedValue(configuredState),
      saveApiKey: vi.fn(),
      startStandardTranslation: vi
        .fn()
        .mockResolvedValueOnce({
          status: "confirmation_required",
          sourceRetained: true,
          confirmationToken: "confirmation-agree",
          preview: {
            serviceName: "DeepSeek Flash",
            normalizedTranslationUrl:
              "https://api.deepseek.com/chat/completions",
            protocol: "Chat Completions",
            model: "deepseek-v4-flash",
            dataSent: ["源文本", "目标语言"],
            callCount: 1,
          },
        })
        .mockResolvedValueOnce({
          status: "completed",
          taskId: "task-page",
          translation: "你好",
        }),
      cancelTranslation: vi.fn(),
    };
    const sourceText = "  Hello\n  ";

    render(
      <ConfiguredTranslationPage
        autoStart
        initialText={sourceText}
        runtime={runtime}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "同意并发送" }),
    );

    expect(await screen.findByRole("region", { name: "译文" })).toHaveTextContent(
      "你好",
    );
    expect(screen.getByRole("textbox", { name: "源文本" })).toHaveValue(
      sourceText,
    );
    expect(runtime.startStandardTranslation).toHaveBeenCalledTimes(2);
    expect(runtime.startStandardTranslation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceText,
        confirmationToken: "confirmation-agree",
      }),
      expect.any(Function),
    );
    expect(screen.queryByText("翻译如下")).not.toBeInTheDocument();
  });

  it("shows streamed deltas, exposes cancellation, and keeps partial text on cancel", async () => {
    const user = userEvent.setup();
    const configuredState: RuntimeConfigurationState = {
      ...missingKeyState,
      serviceConfiguration: {
        ...missingKeyService,
        hasApiKey: true,
        maskedApiKey: "••••••••1234",
      },
    };
    let resolveRequest: (
      value:
        | Awaited<ReturnType<RuyiRuntimeBridge["startStandardTranslation"]>>
        | PromiseLike<
            Awaited<ReturnType<RuyiRuntimeBridge["startStandardTranslation"]>>
          >,
    ) => void = () => undefined;
    const runtime: RuyiRuntimeBridge = {
      getServiceConfiguration: vi.fn().mockResolvedValue(configuredState),
      saveApiKey: vi.fn(),
      startStandardTranslation: vi.fn((_request, onProgress) => {
        onProgress?.({ type: "started", taskId: "task-stream" });
        onProgress?.({
          type: "text_delta",
          taskId: "task-stream",
          delta: "部分译文",
        });
        return new Promise((resolve) => {
          resolveRequest = resolve;
        }) as ReturnType<RuyiRuntimeBridge["startStandardTranslation"]>;
      }),
      cancelTranslation: vi.fn(() => {
        resolveRequest({
          status: "failed",
          taskId: "task-stream",
          sourceRetained: true,
          partialTranslation: "部分译文",
          error: { code: "cancelled", message: "翻译已取消。" },
        });
      }),
    };

    render(
      <ConfiguredTranslationPage
        autoStart={false}
        initialText="source"
        runtime={runtime}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "开始翻译" }));

    expect(await screen.findByRole("status")).toHaveTextContent("正在翻译");
    expect(screen.getByRole("region", { name: "译文生成中" })).toHaveTextContent(
      "部分译文",
    );
    await user.click(screen.getByRole("button", { name: "取消翻译" }));
    expect(runtime.cancelTranslation).toHaveBeenCalledWith(expect.any(String));
    expect(await screen.findByRole("alert")).toHaveTextContent("翻译已取消");
    expect(screen.getByRole("region", { name: "部分译文" })).toHaveTextContent(
      "部分译文",
    );
  });

  it("supports Ctrl/Command+Enter to start, ordinary Enter for newlines, and Esc to cancel", async () => {
    const user = userEvent.setup();
    const configuredState: RuntimeConfigurationState = {
      ...missingKeyState,
      serviceConfiguration: {
        ...missingKeyService,
        hasApiKey: true,
        maskedApiKey: "••••••••1234",
      },
    };
    const startStandardTranslation = vi.fn((_request, onProgress) => {
      onProgress?.({ type: "started", taskId: "task-shortcut" });
      return new Promise(() => undefined) as ReturnType<
        RuyiRuntimeBridge["startStandardTranslation"]
      >;
    });
    const runtime: RuyiRuntimeBridge = {
      getServiceConfiguration: vi.fn().mockResolvedValue(configuredState),
      saveApiKey: vi.fn(),
      startStandardTranslation,
      cancelTranslation: vi.fn(),
    };

    render(
      <ConfiguredTranslationPage
        autoStart={false}
        initialText="source"
        runtime={runtime}
      />,
    );
    const source = await screen.findByRole("textbox", { name: "源文本" });
    await user.click(source);
    await user.keyboard("{Enter}");
    expect(startStandardTranslation).not.toHaveBeenCalled();
    expect(source).toHaveValue("source\n");

    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(startStandardTranslation).toHaveBeenCalledOnce();
    vi.mocked(runtime.cancelTranslation).mockClear();
    await user.keyboard("{Escape}");
    expect(runtime.cancelTranslation).toHaveBeenCalledOnce();
  });

  it("supports Command+Enter and clears an old result when a new request starts", async () => {
    const user = userEvent.setup();
    const configuredState: RuntimeConfigurationState = {
      ...missingKeyState,
      serviceConfiguration: {
        ...missingKeyService,
        hasApiKey: true,
        maskedApiKey: "••••••••1234",
      },
    };
    const never = new Promise<never>(() => undefined);
    const startStandardTranslation = vi
      .fn()
      .mockResolvedValueOnce({
        status: "completed",
        taskId: "first",
        translation: "旧译文",
      })
      .mockImplementationOnce((_request, onProgress) => {
        onProgress?.({ type: "started", taskId: "second" });
        return never;
      });
    const runtime: RuyiRuntimeBridge = {
      getServiceConfiguration: vi.fn().mockResolvedValue(configuredState),
      saveApiKey: vi.fn(),
      startStandardTranslation,
      cancelTranslation: vi.fn(),
    };

    render(
      <ConfiguredTranslationPage
        autoStart={false}
        initialText="source"
        runtime={runtime}
      />,
    );
    const source = await screen.findByRole("textbox", { name: "源文本" });
    await user.click(screen.getByRole("button", { name: "开始翻译" }));
    expect(await screen.findByRole("region", { name: "译文" })).toHaveTextContent(
      "旧译文",
    );

    await user.click(source);
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(startStandardTranslation).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("region", { name: "译文" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在翻译");
  });

  it("rejects source text over 10,000 code points without calling the runtime", async () => {
    const user = userEvent.setup();
    const runtime = {
      ...createRuntimeForBoundary(),
      startStandardTranslation: vi.fn(),
    } satisfies RuyiRuntimeBridge;

    render(
      <ConfiguredTranslationPage
        autoStart={false}
        initialText={"😀".repeat(10_001)}
        runtime={runtime}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "开始翻译" }));

    expect(runtime.startStandardTranslation).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("10,000");
  });
});

function createRuntimeForBoundary(): RuyiRuntimeBridge {
  return {
    getServiceConfiguration: vi.fn().mockResolvedValue({
      ...missingKeyState,
      serviceConfiguration: {
        ...missingKeyService,
        hasApiKey: true,
        maskedApiKey: "••••••••1234",
      },
    }),
    saveApiKey: vi.fn(),
    startStandardTranslation: vi.fn(),
    cancelTranslation: vi.fn(),
  };
}
