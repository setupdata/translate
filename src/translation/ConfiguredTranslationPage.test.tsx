import { randomUUID } from "node:crypto";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  CurrentTranslationInputs,
  CurrentTranslationSnapshot,
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
  cachedModels: [],
  modelsFetchedAt: null,
};

function currentTranslationMethods(staleOnUpdate = false): Pick<
  RuyiRuntimeBridge,
  | "getCurrentTranslation"
  | "updateCurrentTranslationInputs"
  | "subscribeCurrentTranslation"
  | "clearCurrentTranslation"
  | "getServiceConfigurations"
  | "saveServiceConfiguration"
  | "duplicateServiceConfiguration"
  | "moveServiceConfiguration"
  | "setCurrentServiceConfiguration"
  | "deleteServiceConfiguration"
  | "saveServiceApiKey"
  | "deleteServiceApiKey"
  | "testServiceConnection"
  | "fetchServiceModels"
  | "cancelServiceOperation"
  | "getTerminologyState"
  | "saveTermbase"
  | "deleteTermbase"
  | "saveDomainProfile"
  | "deleteDomainProfile"
  | "setCurrentDomainProfile"
> {
  const configurationsState = () => ({
    currentServiceConfigurationId: missingKeyService.id,
    serviceConfigurations: [missingKeyService],
  });
  return {
    getTerminologyState: vi.fn(async () => ({
      termbases: [],
      domainProfiles: [],
      currentDomainProfileId: null,
    })),
    saveTermbase: vi.fn(async () => ({
      termbases: [],
      domainProfiles: [],
      currentDomainProfileId: null,
    })),
    deleteTermbase: vi.fn(async () => ({
      termbases: [],
      domainProfiles: [],
      currentDomainProfileId: null,
    })),
    saveDomainProfile: vi.fn(async () => ({
      termbases: [],
      domainProfiles: [],
      currentDomainProfileId: null,
    })),
    deleteDomainProfile: vi.fn(async () => ({
      termbases: [],
      domainProfiles: [],
      currentDomainProfileId: null,
    })),
    setCurrentDomainProfile: vi.fn(async () => ({
      termbases: [],
      domainProfiles: [],
      currentDomainProfileId: null,
    })),
    getCurrentTranslation: () => null,
    updateCurrentTranslationInputs: (inputs: CurrentTranslationInputs) =>
      ({
        revision: 1,
        phase: "editing",
        inputs,
        task: null,
        partialTranslation: "",
        result: null,
        stale: staleOnUpdate,
      }) satisfies CurrentTranslationSnapshot,
    subscribeCurrentTranslation: () => () => undefined,
    clearCurrentTranslation: vi.fn(),
    getServiceConfigurations: vi.fn(async () => configurationsState()),
    saveServiceConfiguration: vi.fn(async () => configurationsState()),
    duplicateServiceConfiguration: vi.fn(async () => configurationsState()),
    moveServiceConfiguration: vi.fn(async () => configurationsState()),
    setCurrentServiceConfiguration: vi.fn(async () => configurationsState()),
    deleteServiceConfiguration: vi.fn(async () => configurationsState()),
    saveServiceApiKey: vi.fn(async () => configurationsState()),
    deleteServiceApiKey: vi.fn(async () => configurationsState()),
    testServiceConnection: vi.fn(async () => ({ status: "completed" as const })),
    fetchServiceModels: vi.fn(async () => ({
      status: "completed" as const,
      models: [],
      fetchedAt: new Date(0).toISOString(),
      currentModelPresent: false,
    })),
    cancelServiceOperation: vi.fn(),
  };
}

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
      ...currentTranslationMethods(),
      getServiceConfiguration: vi.fn().mockResolvedValue(missingKeyState),
      saveApiKey: vi.fn(),
      startStandardTranslation: vi.fn().mockResolvedValue({
        status: "configuration_required",
        reason: "missing_api_key",
        sourceRetained: true,
        serviceConfiguration: missingKeyService,
      }),
      cancelTranslation: vi.fn(),
      copyTranslation: vi.fn(() => ({ status: "copied" as const })),
      pasteTranslation: vi.fn(() => ({ status: "pasted" as const })),
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
      ...currentTranslationMethods(),
      getServiceConfiguration: vi.fn().mockResolvedValue(noConfigurationState),
      saveApiKey: vi.fn(),
      startStandardTranslation: vi.fn().mockResolvedValue({
        status: "configuration_required",
        reason: "missing_configuration",
        sourceRetained: true,
        serviceConfiguration: null,
      }),
      cancelTranslation: vi.fn(),
      copyTranslation: vi.fn(() => ({ status: "copied" as const })),
      pasteTranslation: vi.fn(() => ({ status: "pasted" as const })),
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
      ...currentTranslationMethods(),
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
      copyTranslation: vi.fn(() => ({ status: "copied" as const })),
      pasteTranslation: vi.fn(() => ({ status: "pasted" as const })),
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
      ...currentTranslationMethods(),
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
      copyTranslation: vi.fn(() => ({ status: "copied" as const })),
      pasteTranslation: vi.fn(() => ({ status: "pasted" as const })),
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
      ...currentTranslationMethods(),
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
          quality: { risks: [], pasteBlocked: false },
        }),
      cancelTranslation: vi.fn(),
      copyTranslation: vi.fn(() => ({ status: "copied" as const })),
      pasteTranslation: vi.fn(() => ({ status: "pasted" as const })),
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

  it("shows deterministic risks, blocks paste, and copies only after confirmation", async () => {
    const user = userEvent.setup();
    const copyTranslation = vi
      .fn()
      .mockReturnValueOnce({ status: "confirmation_required" as const })
      .mockReturnValueOnce({ status: "confirmation_required" as const })
      .mockReturnValueOnce({ status: "copied" as const });
    const pasteTranslation = vi.fn(() => ({ status: "blocked" as const }));
    const runtime = createRuntimeForBoundary();
    runtime.startStandardTranslation = vi.fn().mockResolvedValue({
      status: "completed",
      taskId: "task-risk",
      translation: "版本 2.0",
      quality: {
        pasteBlocked: true,
        risks: [
          {
            id: "quality-1",
            code: "protected.number.mismatch",
            category: "protected_content",
            severity: "critical",
            certainty: "deterministic",
            message: "数字的数量或原值与源文不一致。",
          },
        ],
      },
    });
    runtime.copyTranslation = copyTranslation;
    runtime.pasteTranslation = pasteTranslation;

    render(
      <ConfiguredTranslationPage
        autoStart={false}
        initialText="Version 1.0"
        runtime={runtime}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "开始翻译" }));

    expect(await screen.findByRole("heading", { name: "质量风险" })).toBeInTheDocument();
    expect(screen.getByText("数字的数量或原值与源文不一致。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "粘贴回原窗口" })).toBeDisabled();
    expect(pasteTranslation).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "复制译文" }));
    expect(
      screen.getByRole("dialog", { name: "确认复制风险译文" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    expect(copyTranslation).toHaveBeenCalledWith("task-risk");
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "确认复制风险译文" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "复制译文" })).toHaveFocus(),
    );
    await user.click(screen.getByRole("button", { name: "复制译文" }));
    await user.click(screen.getByRole("button", { name: "确认并复制" }));
    expect(copyTranslation).toHaveBeenLastCalledWith("task-risk", true);
    expect(screen.getByText("译文已复制。")).toBeInTheDocument();
  });

  it("keeps heuristic warnings non-blocking for copy and paste", async () => {
    const user = userEvent.setup();
    const copyTranslation = vi.fn(() => ({ status: "copied" as const }));
    const pasteTranslation = vi.fn(() => ({ status: "pasted" as const }));
    const runtime = createRuntimeForBoundary();
    runtime.startStandardTranslation = vi.fn().mockResolvedValue({
      status: "completed",
      taskId: "task-warning",
      translation: "译文",
      quality: {
        pasteBlocked: false,
        risks: [
          {
            id: "quality-warning",
            code: "fluency.review",
            category: "fluency",
            severity: "major",
            certainty: "heuristic",
            message: "这处表达可能不够自然，请人工复核。",
          },
        ],
      },
    });
    runtime.copyTranslation = copyTranslation;
    runtime.pasteTranslation = pasteTranslation;

    render(
      <ConfiguredTranslationPage
        autoStart={false}
        initialText="source"
        runtime={runtime}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "开始翻译" }));
    expect(await screen.findByText("这处表达可能不够自然，请人工复核。")).toBeInTheDocument();
    const pasteButton = screen.getByRole("button", { name: "粘贴回原窗口" });
    expect(pasteButton).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "复制译文" }));
    await user.click(pasteButton);

    expect(copyTranslation).toHaveBeenCalledWith("task-warning");
    expect(pasteTranslation).toHaveBeenCalledWith("task-warning", "source");
    expect(
      screen.queryByRole("dialog", { name: "确认复制风险译文" }),
    ).not.toBeInTheDocument();
  });

  it("keeps an old translation visible but disables paste after the source changes", async () => {
    const user = userEvent.setup();
    const runtime = createRuntimeForBoundary(true);
    runtime.startStandardTranslation = vi.fn().mockResolvedValue({
      status: "completed",
      taskId: "task-stale",
      translation: "旧译文",
      quality: { risks: [], pasteBlocked: false },
    });

    render(
      <ConfiguredTranslationPage
        autoStart={false}
        initialText="old source"
        runtime={runtime}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "开始翻译" }));
    expect(await screen.findByRole("region", { name: "译文" })).toHaveTextContent(
      "旧译文",
    );

    const source = screen.getByRole("textbox", { name: "源文本" });
    await user.clear(source);
    await user.type(source, "new source");

    expect(screen.getByRole("region", { name: "译文" })).toHaveTextContent("旧译文");
    expect(screen.getByRole("button", { name: "粘贴回原窗口" })).toBeDisabled();
    expect(screen.getByText(/源文本或任务设置已修改/u)).toBeInTheDocument();
  });

  it("keeps an old translation stale when target language or task requirements change", async () => {
    const user = userEvent.setup();
    const runtime = createRuntimeForBoundary(true);
    const updateCurrentTranslationInputs = vi.fn(
      runtime.updateCurrentTranslationInputs,
    );
    runtime.updateCurrentTranslationInputs = updateCurrentTranslationInputs;
    runtime.startStandardTranslation = vi.fn().mockResolvedValue({
      status: "completed",
      taskId: "task-settings-stale",
      translation: "旧译文",
      quality: { risks: [], pasteBlocked: false },
    });

    render(
      <ConfiguredTranslationPage
        autoStart={false}
        initialText="old source"
        runtime={runtime}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "开始翻译" }));
    expect(await screen.findByRole("region", { name: "译文" })).toHaveTextContent(
      "旧译文",
    );
    vi.mocked(runtime.startStandardTranslation).mockClear();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "目标语言" }),
      "en",
    );
    await user.type(
      screen.getByRole("textbox", { name: "附加翻译要求" }),
      "Use concise wording.",
    );

    expect(runtime.startStandardTranslation).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "译文" })).toHaveTextContent("旧译文");
    expect(screen.getByRole("button", { name: "复制译文" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "粘贴回原窗口" })).toBeDisabled();
    expect(screen.getByText(/对应修改前的任务设置/u)).toBeInTheDocument();
    expect(updateCurrentTranslationInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceText: "old source",
        targetLanguage: expect.objectContaining({ id: "en" }),
        additionalRequirements: "Use concise wording.",
      }),
    );
  });

  it("switches the current service without automatically translating", async () => {
    const user = userEvent.setup();
    const runtime = createRuntimeForBoundary(true);
    const customService: ServiceConfigurationView = {
      ...missingKeyService,
      id: "custom-service",
      name: "Custom service",
      type: "custom",
      authentication: "none",
      model: "custom-model",
      hasApiKey: false,
      maskedApiKey: null,
    };
    runtime.getServiceConfigurations = vi.fn().mockResolvedValue({
      currentServiceConfigurationId: missingKeyService.id,
      serviceConfigurations: [missingKeyService, customService],
    });
    runtime.setCurrentServiceConfiguration = vi.fn().mockResolvedValue({
      currentServiceConfigurationId: customService.id,
      serviceConfigurations: [missingKeyService, customService],
    });
    runtime.getServiceConfiguration = vi.fn(async (configurationId?: string) => ({
      ...missingKeyState,
      serviceConfiguration:
        configurationId === customService.id ? customService : missingKeyService,
    }));
    runtime.startStandardTranslation = vi.fn().mockResolvedValue({
      status: "completed",
      taskId: "task-service-stale",
      translation: "旧译文",
      quality: { risks: [], pasteBlocked: false },
    });

    render(
      <ConfiguredTranslationPage
        autoStart={false}
        initialText="source"
        runtime={runtime}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "开始翻译" }));
    expect(await screen.findByRole("region", { name: "译文" })).toHaveTextContent(
      "旧译文",
    );
    vi.mocked(runtime.startStandardTranslation).mockClear();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "服务配置" }),
      customService.id,
    );

    await waitFor(() =>
      expect(runtime.setCurrentServiceConfiguration).toHaveBeenCalledWith(
        customService.id,
      ),
    );
    expect(runtime.startStandardTranslation).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "译文" })).toHaveTextContent("旧译文");
    expect(screen.getByRole("button", { name: "复制译文" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "粘贴回原窗口" })).toBeDisabled();
  });

  it("does not let a delayed initial configuration overwrite a later service selection", async () => {
    const user = userEvent.setup();
    let resolveInitialConfiguration: (state: RuntimeConfigurationState) => void = () =>
      undefined;
    const initialConfiguration = new Promise<RuntimeConfigurationState>((resolve) => {
      resolveInitialConfiguration = resolve;
    });
    const customService: ServiceConfigurationView = {
      ...missingKeyService,
      id: "custom-latest",
      name: "Custom latest",
      type: "custom",
      authentication: "none",
      model: "custom-model",
      hasApiKey: false,
      maskedApiKey: null,
    };
    const selectedState: RuntimeConfigurationState = {
      ...missingKeyState,
      serviceConfiguration: customService,
    };
    const runtime = createRuntimeForBoundary();
    runtime.getServiceConfigurations = vi.fn().mockResolvedValue({
      currentServiceConfigurationId: missingKeyService.id,
      serviceConfigurations: [missingKeyService, customService],
    });
    runtime.setCurrentServiceConfiguration = vi.fn().mockResolvedValue({
      currentServiceConfigurationId: customService.id,
      serviceConfigurations: [missingKeyService, customService],
    });
    runtime.getServiceConfiguration = vi.fn((configurationId?: string) =>
      configurationId === customService.id
        ? Promise.resolve(selectedState)
        : initialConfiguration,
    );

    render(
      <ConfiguredTranslationPage
        autoStart={false}
        initialText="source"
        runtime={runtime}
      />,
    );
    const selector = await screen.findByRole("combobox", { name: "服务配置" });
    await user.selectOptions(selector, customService.id);
    await waitFor(() => expect(selector).toHaveValue(customService.id));

    resolveInitialConfiguration(missingKeyState);

    await waitFor(() => expect(runtime.getServiceConfiguration).toHaveBeenCalledTimes(2));
    expect(selector).toHaveValue(customService.id);
  });

  it("dismisses an old send confirmation when the service changes", async () => {
    const user = userEvent.setup();
    const configuredOfficial = {
      ...missingKeyService,
      hasApiKey: true,
      maskedApiKey: "••••••••1234",
    };
    const customService: ServiceConfigurationView = {
      ...missingKeyService,
      id: "custom-confirmation",
      name: "Custom confirmation",
      type: "custom",
      authentication: "none",
      model: "custom-model",
      hasApiKey: false,
      maskedApiKey: null,
    };
    const runtime = createRuntimeForBoundary();
    runtime.getServiceConfigurations = vi.fn().mockResolvedValue({
      currentServiceConfigurationId: configuredOfficial.id,
      serviceConfigurations: [configuredOfficial, customService],
    });
    runtime.setCurrentServiceConfiguration = vi.fn().mockResolvedValue({
      currentServiceConfigurationId: customService.id,
      serviceConfigurations: [configuredOfficial, customService],
    });
    runtime.getServiceConfiguration = vi.fn(async (configurationId?: string) => ({
      ...missingKeyState,
      serviceConfiguration:
        configurationId === customService.id ? customService : configuredOfficial,
    }));
    runtime.startStandardTranslation = vi.fn().mockResolvedValue({
      status: "confirmation_required",
      sourceRetained: true,
      confirmationToken: "confirmation-old-service",
      preview: {
        serviceName: configuredOfficial.name,
        normalizedTranslationUrl: configuredOfficial.translationUrl,
        protocol: "Chat Completions",
        model: configuredOfficial.model,
        dataSent: ["源文本"],
        callCount: 1,
      },
    });

    render(
      <ConfiguredTranslationPage autoStart initialText="source" runtime={runtime} />,
    );
    expect(
      await screen.findByRole("dialog", { name: "确认发送翻译数据" }),
    ).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "服务配置" }),
      customService.id,
    );

    await waitFor(() =>
      expect(runtime.setCurrentServiceConfiguration).toHaveBeenCalledWith(customService.id),
    );
    expect(runtime.cancelTranslation).toHaveBeenCalledWith(expect.any(String));
    expect(
      screen.queryByRole("dialog", { name: "确认发送翻译数据" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the stale result when edited source text cannot start a new request", async () => {
    const user = userEvent.setup();
    const runtime = createRuntimeForBoundary(true);
    runtime.startStandardTranslation = vi.fn().mockResolvedValue({
      status: "completed",
      taskId: "task-invalid-edit",
      translation: "旧译文",
      quality: { risks: [], pasteBlocked: false },
    });

    render(
      <ConfiguredTranslationPage
        autoStart={false}
        initialText="old source"
        runtime={runtime}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "开始翻译" }));
    expect(await screen.findByRole("region", { name: "译文" })).toHaveTextContent(
      "旧译文",
    );

    const source = screen.getByRole("textbox", { name: "源文本" });
    await user.clear(source);
    await user.type(source, "   ");
    await user.click(screen.getByRole("button", { name: "开始翻译" }));

    expect(runtime.startStandardTranslation).toHaveBeenCalledOnce();
    expect(screen.getByRole("region", { name: "译文" })).toHaveTextContent("旧译文");
    expect(screen.getByRole("button", { name: "复制译文" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "粘贴回原窗口" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("有效文本");
  });

  it("clears the current source, result, temporary requirements, and quality risks", async () => {
    const user = userEvent.setup();
    const runtime = createRuntimeForBoundary();
    runtime.getServiceConfiguration = vi.fn().mockResolvedValue({
      ...missingKeyState,
      serviceConfiguration: {
        ...missingKeyService,
        hasApiKey: true,
        maskedApiKey: "••••••••1234",
      },
      defaults: {
        ...missingKeyState.defaults,
        targetLanguage: {
          kind: "preset",
          id: "en",
          displayName: "英语",
          modelLabel: "English",
        },
        additionalRequirements: "Saved default requirement.",
      },
    });
    runtime.clearCurrentTranslation = vi.fn();
    runtime.startStandardTranslation = vi.fn().mockResolvedValue({
      status: "completed",
      taskId: "task-clear-page",
      translation: "旧译文",
      quality: {
        pasteBlocked: true,
        risks: [
          {
            id: "quality-clear",
            code: "protected.number.mismatch",
            category: "protected_content",
            severity: "critical",
            certainty: "deterministic",
            message: "数字与源文不一致。",
          },
        ],
      },
    });

    render(
      <ConfiguredTranslationPage
        autoStart={false}
        initialText="source"
        runtime={runtime}
      />,
    );
    const requirements = await screen.findByRole("textbox", {
      name: "附加翻译要求",
    });
    await user.clear(requirements);
    await user.type(requirements, "temporary requirement");
    await user.click(screen.getByRole("button", { name: "开始翻译" }));
    expect(await screen.findByRole("heading", { name: "质量风险" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清空当前内容" }));

    expect(runtime.clearCurrentTranslation).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox", { name: "源文本" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "目标语言" })).toHaveValue("en");
    expect(screen.getByRole("textbox", { name: "附加翻译要求" })).toHaveValue(
      "Saved default requirement.",
    );
    expect(screen.queryByRole("region", { name: "译文" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "质量风险" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制译文" })).not.toBeInTheDocument();
  });

  it("restores the current translation when the page reopens in the same process", async () => {
    const restoredSnapshot: CurrentTranslationSnapshot = {
      revision: 8,
      phase: "completed",
      inputs: {
        sourceText: "source before hide",
        targetLanguage: {
          kind: "preset",
          id: "en",
          displayName: "英语",
          modelLabel: "English",
        },
        serviceConfigurationId: "deepseek-flash",
        domainProfileId: null,
        qualityMode: "standard",
        additionalRequirements: "Keep headings short.",
        taskTerms: [],
      },
      task: {
        taskId: "task-restored",
        sourceText: "source before hide",
        targetLanguage: {
          kind: "preset",
          id: "en",
          displayName: "英语",
          modelLabel: "English",
        },
        serviceConfigurationId: "deepseek-flash",
        domainProfileId: null,
        qualityMode: "standard",
        additionalRequirements: "Keep headings short.",
        taskTerms: [],
      },
      partialTranslation: "restored translation",
      result: {
        status: "completed",
        taskId: "task-restored",
        translation: "restored translation",
        quality: { risks: [], pasteBlocked: false },
      },
      stale: false,
    };
    const runtime = createRuntimeForBoundary();
    runtime.getCurrentTranslation = vi.fn(() => restoredSnapshot);
    runtime.startStandardTranslation = vi.fn();

    const firstRender = render(
      <ConfiguredTranslationPage autoStart={false} initialText="" runtime={runtime} />,
    );
    expect(
      await screen.findByRole("region", { name: "译文" }),
    ).toHaveTextContent("restored translation");
    expect(screen.getByRole("textbox", { name: "源文本" })).toHaveValue(
      "source before hide",
    );
    expect(screen.getByRole("combobox", { name: "目标语言" })).toHaveValue("en");
    expect(screen.getByRole("textbox", { name: "附加翻译要求" })).toHaveValue(
      "Keep headings short.",
    );
    firstRender.unmount();

    render(
      <ConfiguredTranslationPage autoStart={false} initialText="" runtime={runtime} />,
    );
    expect(
      await screen.findByRole("region", { name: "译文" }),
    ).toHaveTextContent("restored translation");
    expect(runtime.startStandardTranslation).not.toHaveBeenCalled();
  });

  it("cancels and replaces the restored task when a new entry supplies text", async () => {
    const oldSnapshot: CurrentTranslationSnapshot = {
      revision: 4,
      phase: "translating",
      inputs: {
        sourceText: "old source",
        targetLanguage: missingKeyState.defaults.targetLanguage,
        serviceConfigurationId: "deepseek-flash",
        domainProfileId: null,
        qualityMode: "standard",
        additionalRequirements: "",
        taskTerms: [],
      },
      task: {
        taskId: "task-old-entry",
        sourceText: "old source",
        targetLanguage: missingKeyState.defaults.targetLanguage,
        serviceConfigurationId: "deepseek-flash",
        domainProfileId: null,
        qualityMode: "standard",
        additionalRequirements: "",
        taskTerms: [],
      },
      partialTranslation: "旧的部分译文",
      result: null,
      stale: false,
    };
    const runtime = createRuntimeForBoundary();
    runtime.getCurrentTranslation = vi.fn(() => oldSnapshot);
    runtime.startStandardTranslation = vi.fn().mockResolvedValue({
      status: "completed",
      taskId: "task-new-entry",
      translation: "新译文",
      quality: { risks: [], pasteBlocked: false },
    });

    render(
      <ConfiguredTranslationPage
        autoStart
        initialText="new source"
        runtime={runtime}
      />,
    );

    expect(
      await screen.findByRole("region", { name: "译文" }),
    ).toHaveTextContent("新译文");
    expect(runtime.clearCurrentTranslation).toHaveBeenCalledOnce();
    expect(runtime.startStandardTranslation).toHaveBeenCalledWith(
      expect.objectContaining({ sourceText: "new source" }),
      expect.any(Function),
    );
    expect(screen.getByRole("textbox", { name: "源文本" })).toHaveValue("new source");
    expect(screen.queryByText("旧的部分译文")).not.toBeInTheDocument();
  });

  it("cancels restored work before waiting for service configuration on a new entry", async () => {
    let resolveConfiguration: (state: RuntimeConfigurationState) => void = () =>
      undefined;
    const configurationPromise = new Promise<RuntimeConfigurationState>((resolve) => {
      resolveConfiguration = resolve;
    });
    const oldInputs: CurrentTranslationInputs = {
      sourceText: "old source",
      targetLanguage: missingKeyState.defaults.targetLanguage,
      serviceConfigurationId: "deepseek-flash",
      domainProfileId: null,
      qualityMode: "standard",
      additionalRequirements: "",
      taskTerms: [],
    };
    const runtime = createRuntimeForBoundary();
    runtime.getCurrentTranslation = vi.fn(
      () =>
        ({
          revision: 3,
          phase: "translating",
          inputs: oldInputs,
          task: { taskId: "task-before-config", ...oldInputs },
          partialTranslation: "旧的部分译文",
          result: null,
          stale: false,
        }) satisfies CurrentTranslationSnapshot,
    );
    runtime.getServiceConfiguration = vi.fn(() => configurationPromise);
    runtime.clearCurrentTranslation = vi.fn();
    runtime.startStandardTranslation = vi.fn().mockResolvedValue({
      status: "completed",
      taskId: "task-after-config",
      translation: "新译文",
      quality: { risks: [], pasteBlocked: false },
    });

    render(
      <ConfiguredTranslationPage
        autoStart
        initialText="new source"
        runtime={runtime}
      />,
    );

    await waitFor(() => expect(runtime.clearCurrentTranslation).toHaveBeenCalledOnce());
    expect(runtime.startStandardTranslation).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "源文本" })).toHaveValue("new source");
    expect(screen.queryByText("旧的部分译文")).not.toBeInTheDocument();

    resolveConfiguration(await createRuntimeForBoundary().getServiceConfiguration());
    expect(
      await screen.findByRole("region", { name: "译文" }),
    ).toHaveTextContent("新译文");
  });

  it("does not revive cleared entry text when service configuration resolves late", async () => {
    const user = userEvent.setup();
    let resolveConfiguration: (state: RuntimeConfigurationState) => void = () =>
      undefined;
    const configurationPromise = new Promise<RuntimeConfigurationState>((resolve) => {
      resolveConfiguration = resolve;
    });
    const runtime = createRuntimeForBoundary();
    runtime.getServiceConfiguration = vi.fn(() => configurationPromise);
    runtime.startStandardTranslation = vi.fn();

    render(
      <ConfiguredTranslationPage
        autoStart
        initialText="must stay cleared"
        runtime={runtime}
      />,
    );
    await user.click(screen.getByRole("button", { name: "清空当前内容" }));
    resolveConfiguration(await createRuntimeForBoundary().getServiceConfiguration());

    await waitFor(() =>
      expect(runtime.getServiceConfiguration).toHaveBeenCalledOnce(),
    );
    expect(runtime.startStandardTranslation).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "源文本" })).toHaveValue("");
    expect(screen.queryByText("must stay cleared")).not.toBeInTheDocument();
  });

  it("does not auto-send an entry after the user edits it while configuration loads", async () => {
    const user = userEvent.setup();
    let resolveConfiguration: (state: RuntimeConfigurationState) => void = () =>
      undefined;
    const configurationPromise = new Promise<RuntimeConfigurationState>((resolve) => {
      resolveConfiguration = resolve;
    });
    const runtime = createRuntimeForBoundary();
    runtime.getServiceConfiguration = vi.fn(() => configurationPromise);
    runtime.startStandardTranslation = vi.fn();

    render(
      <ConfiguredTranslationPage
        autoStart
        initialText="entry source"
        runtime={runtime}
      />,
    );
    const source = screen.getByRole("textbox", { name: "源文本" });
    await user.clear(source);
    await user.type(source, "edited locally");
    resolveConfiguration(await createRuntimeForBoundary().getServiceConfiguration());

    await waitFor(() =>
      expect(runtime.getServiceConfiguration).toHaveBeenCalledOnce(),
    );
    expect(runtime.startStandardTranslation).not.toHaveBeenCalled();
    expect(source).toHaveValue("edited locally");
  });

  it("does not translate cleared text when API key saving resolves late", async () => {
    const user = userEvent.setup();
    let resolveSave: (state: RuntimeConfigurationState) => void = () => undefined;
    const savePromise = new Promise<RuntimeConfigurationState>((resolve) => {
      resolveSave = resolve;
    });
    const runtime: RuyiRuntimeBridge = {
      ...currentTranslationMethods(),
      getServiceConfiguration: vi.fn().mockResolvedValue(missingKeyState),
      saveApiKey: vi.fn(() => savePromise),
      startStandardTranslation: vi.fn().mockResolvedValue({
        status: "configuration_required",
        reason: "missing_api_key",
        sourceRetained: true,
        serviceConfiguration: missingKeyService,
      }),
      cancelTranslation: vi.fn(),
      copyTranslation: vi.fn(() => ({ status: "copied" as const })),
      pasteTranslation: vi.fn(() => ({ status: "pasted" as const })),
    };
    render(
      <ConfiguredTranslationPage
        autoStart
        initialText="clear before save"
        runtime={runtime}
      />,
    );
    await screen.findByRole("heading", { name: "配置 DeepSeek API Key" });
    await user.type(screen.getByLabelText("API Key"), "fixture-credential");
    await user.click(screen.getByRole("button", { name: "保存密钥" }));
    await user.click(screen.getByRole("button", { name: "清空当前内容" }));
    vi.mocked(runtime.startStandardTranslation).mockClear();
    resolveSave({
      ...missingKeyState,
      serviceConfiguration: {
        ...missingKeyService,
        hasApiKey: true,
        maskedApiKey: "••••••••tial",
      },
    });

    await waitFor(() => expect(runtime.saveApiKey).toHaveBeenCalledOnce());
    expect(runtime.startStandardTranslation).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "源文本" })).toHaveValue("");
  });

  it("keeps an incomplete partial translation and allows confirmed copy only", async () => {
    const user = userEvent.setup();
    const copyTranslation = vi
      .fn()
      .mockReturnValueOnce({ status: "confirmation_required" as const })
      .mockReturnValueOnce({ status: "copied" as const });
    const runtime = createRuntimeForBoundary(true);
    runtime.startStandardTranslation = vi.fn().mockResolvedValue({
      status: "failed",
      taskId: "task-partial-risk",
      sourceRetained: true,
      partialTranslation: "部分译文",
      error: { code: "protocol_error", message: "响应未正常结束。" },
      quality: {
        pasteBlocked: true,
        risks: [
          {
            id: "quality-stream",
            code: "stream.incomplete",
            category: "stream",
            severity: "critical",
            certainty: "deterministic",
            message: "模型响应没有按所选协议正常结束，现有译文可能不完整。",
          },
        ],
      },
    });
    runtime.copyTranslation = copyTranslation;

    render(
      <ConfiguredTranslationPage
        autoStart={false}
        initialText="source"
        runtime={runtime}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "开始翻译" }));

    expect(await screen.findByRole("region", { name: "部分译文" })).toHaveTextContent(
      "部分译文",
    );
    expect(screen.getByText(/没有按所选协议正常结束/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "粘贴回原窗口" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "源文本" }), " edited");
    expect(screen.getByText(/部分译文对应修改前的任务设置/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "复制部分译文" }));
    await user.click(screen.getByRole("button", { name: "确认并复制" }));
    expect(copyTranslation).toHaveBeenNthCalledWith(1, "task-partial-risk");
    expect(copyTranslation).toHaveBeenNthCalledWith(2, "task-partial-risk", true);
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
      ...currentTranslationMethods(),
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
      copyTranslation: vi.fn(() => ({ status: "copied" as const })),
      pasteTranslation: vi.fn(() => ({ status: "pasted" as const })),
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
      ...currentTranslationMethods(),
      getServiceConfiguration: vi.fn().mockResolvedValue(configuredState),
      saveApiKey: vi.fn(),
      startStandardTranslation,
      cancelTranslation: vi.fn(),
      copyTranslation: vi.fn(() => ({ status: "copied" as const })),
      pasteTranslation: vi.fn(() => ({ status: "pasted" as const })),
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
        quality: { risks: [], pasteBlocked: false },
      })
      .mockImplementationOnce((_request, onProgress) => {
        onProgress?.({ type: "started", taskId: "second" });
        return never;
      });
    const runtime: RuyiRuntimeBridge = {
      ...currentTranslationMethods(),
      getServiceConfiguration: vi.fn().mockResolvedValue(configuredState),
      saveApiKey: vi.fn(),
      startStandardTranslation,
      cancelTranslation: vi.fn(),
      copyTranslation: vi.fn(() => ({ status: "copied" as const })),
      pasteTranslation: vi.fn(() => ({ status: "pasted" as const })),
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

function createRuntimeForBoundary(staleOnUpdate = false): RuyiRuntimeBridge {
  return {
    ...currentTranslationMethods(staleOnUpdate),
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
    copyTranslation: vi.fn(() => ({ status: "copied" as const })),
    pasteTranslation: vi.fn(() => ({ status: "pasted" as const })),
  };
}
