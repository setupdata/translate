import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  RuyiRuntimeBridge,
  ServiceConfigurationView,
  ServiceConfigurationsState,
} from "../runtime/contracts";
import { createRuntimeStub } from "../test/runtime-stub";
import { ServiceSettingsPage } from "./ServiceSettingsPage";

const official: ServiceConfigurationView = {
  id: "deepseek-flash",
  name: "DeepSeek Flash",
  type: "deepseek-official",
  protocol: "chat-completions",
  translationUrl: "https://api.deepseek.com/chat/completions",
  modelListUrl: "https://api.deepseek.com/models",
  authentication: "bearer",
  model: "deepseek-v4-flash",
  stream: true,
  hasApiKey: true,
  maskedApiKey: "••••••••1234",
  cachedModels: [],
  modelsFetchedAt: null,
  performanceSummary: null,
};

const custom: ServiceConfigurationView = {
  id: "custom-one",
  name: "Custom One",
  type: "custom",
  protocol: "responses",
  translationUrl: "https://gateway.example.test/responses",
  modelListUrl: "https://gateway.example.test/models",
  authentication: "none",
  model: "hand-entered-model",
  stream: true,
  hasApiKey: false,
  maskedApiKey: null,
  cachedModels: ["older-model"],
  modelsFetchedAt: "2026-08-12T00:00:00.000Z",
  performanceSummary: null,
};

const initialState: ServiceConfigurationsState = {
  currentServiceConfigurationId: official.id,
  serviceConfigurations: [official, custom],
  backgroundNotificationsEnabled: true,
};

describe("ServiceSettingsPage", () => {
  it("shows the default-on background notification preference and persists disabling it", async () => {
    const disabledState = {
      ...initialState,
      backgroundNotificationsEnabled: false,
    };
    const setBackgroundNotificationsEnabled = vi.fn(async () => disabledState);
    const runtime = createRuntimeStub({
      getServiceConfigurations: vi.fn(async () => initialState),
      setBackgroundNotificationsEnabled,
    });

    render(<ServiceSettingsPage runtime={runtime} />);

    const checkbox = await screen.findByRole("checkbox", {
      name: "后台翻译完成后显示系统通知",
    });
    expect(checkbox).toBeChecked();
    await userEvent.click(checkbox);

    await waitFor(() =>
      expect(setBackgroundNotificationsEnabled).toHaveBeenCalledWith(false),
    );
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText(/后台继续和系统通知都不保证必定完成或送达/u)).toBeInTheDocument();
  });

  it("loads saved configurations without testing connections or fetching models", async () => {
    const getServiceConfigurations = vi.fn(async () => initialState);
    const testServiceConnection = vi.fn();
    const fetchServiceModels = vi.fn();
    const runtime = createRuntimeStub({
      getServiceConfigurations,
      testServiceConnection,
      fetchServiceModels,
    });

    render(<ServiceSettingsPage runtime={runtime} />);

    expect(await screen.findByText("DeepSeek Flash")).toBeInTheDocument();
    expect(screen.getByText("Custom One")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "隐私与数据说明" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/开启同步后/u)).toBeInTheDocument();
    expect(screen.getByText(/本机高权限程序或调试手段/u)).toBeInTheDocument();
    expect(screen.getByText(/服务配置名称、地址、协议、模型、模型列表缓存/u)).toBeInTheDocument();
    expect(screen.getByText(/删除 API Key/u)).toBeInTheDocument();
    expect(screen.getByText(/uTools 的同步数据管理/u)).toBeInTheDocument();
    expect(screen.getByText(/API Key、术语库、行业配置和参考译例/u)).toBeInTheDocument();
    expect(screen.getByText(/当前翻译只保留在插件进程内存中/u)).toBeInTheDocument();
    expect(screen.getByText(/精译模式会向同一服务发起多次调用/u)).toBeInTheDocument();
    expect(screen.getByText(/不能保证删除 uTools 已同步到远端或其他设备的副本/u)).toBeInTheDocument();
    expect(getServiceConfigurations).toHaveBeenCalledOnce();
    expect(testServiceConnection).not.toHaveBeenCalled();
    expect(fetchServiceModels).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "编辑 DeepSeek Flash" }));
    expect(screen.getByLabelText("协议")).toBeDisabled();
    expect(screen.getByLabelText("翻译地址")).toBeDisabled();
    expect(screen.getByLabelText("模型列表地址")).toBeDisabled();
    expect(screen.getByLabelText("鉴权方式")).toBeDisabled();
    expect(screen.getByLabelText("模型 ID")).toBeEnabled();
  });

  it("adds a custom Responses configuration without making a network request", async () => {
    const savedState: ServiceConfigurationsState = {
      currentServiceConfigurationId: "custom-new",
      serviceConfigurations: [
        official,
        {
          ...custom,
          id: "custom-new",
          name: "New gateway",
          model: "manual-model",
          cachedModels: [],
          modelsFetchedAt: null,
        },
      ],
    };
    const saveServiceConfiguration = vi.fn(async () => savedState);
    const testServiceConnection = vi.fn();
    const fetchServiceModels = vi.fn();
    const runtime = createRuntimeStub({
      getServiceConfigurations: vi.fn(async () => ({
        currentServiceConfigurationId: official.id,
        serviceConfigurations: [official],
      })),
      saveServiceConfiguration,
      testServiceConnection,
      fetchServiceModels,
    });

    render(<ServiceSettingsPage runtime={runtime} />);
    await screen.findByText("DeepSeek Flash");
    await userEvent.click(screen.getByRole("button", { name: "新增配置" }));
    await userEvent.type(screen.getByLabelText("配置名称"), "New gateway");
    await userEvent.selectOptions(screen.getByLabelText("协议"), "responses");
    await userEvent.clear(screen.getByLabelText("翻译地址"));
    await userEvent.type(
      screen.getByLabelText("翻译地址"),
      "https://new.example.test/responses",
    );
    await userEvent.clear(screen.getByLabelText("模型列表地址"));
    await userEvent.type(
      screen.getByLabelText("模型列表地址"),
      "https://new.example.test/models",
    );
    await userEvent.selectOptions(screen.getByLabelText("鉴权方式"), "none");
    await userEvent.type(screen.getByLabelText("模型 ID"), "manual-model");
    await userEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(saveServiceConfiguration).toHaveBeenCalledOnce());
    expect(saveServiceConfiguration).toHaveBeenCalledWith(
      {
        id: null,
        name: "New gateway",
        type: "custom",
        protocol: "responses",
        translationUrl: "https://new.example.test/responses",
        modelListUrl: "https://new.example.test/models",
        authentication: "none",
        model: "manual-model",
        stream: true,
      },
      expect.any(HTMLFormElement),
    );
    expect(testServiceConnection).not.toHaveBeenCalled();
    expect(fetchServiceModels).not.toHaveBeenCalled();
  });

  it("supports selection, copy, sorting, and confirmed deletion", async () => {
    const setCurrentServiceConfiguration = vi.fn(async () => ({
      ...initialState,
      currentServiceConfigurationId: custom.id,
    }));
    const duplicateServiceConfiguration = vi.fn(async () => initialState);
    const moveServiceConfiguration = vi.fn(async () => initialState);
    const deleteServiceConfiguration = vi.fn(async () => ({
      currentServiceConfigurationId: official.id,
      serviceConfigurations: [official],
    }));
    const runtime = createRuntimeStub({
      getServiceConfigurations: vi.fn(async () => initialState),
      setCurrentServiceConfiguration,
      duplicateServiceConfiguration,
      moveServiceConfiguration,
      deleteServiceConfiguration,
    });

    render(<ServiceSettingsPage runtime={runtime} />);
    await screen.findByText("Custom One");
    await userEvent.click(screen.getByRole("button", { name: "设为当前 Custom One" }));
    expect(setCurrentServiceConfiguration).toHaveBeenCalledWith("custom-one");
    await userEvent.click(screen.getByRole("button", { name: "复制 Custom One" }));
    expect(duplicateServiceConfiguration).toHaveBeenCalledWith("custom-one");
    await userEvent.click(screen.getByRole("button", { name: "上移 Custom One" }));
    expect(moveServiceConfiguration).toHaveBeenCalledWith("custom-one", "up");
    await userEvent.click(screen.getByRole("button", { name: "删除 Custom One" }));
    expect(screen.getByRole("dialog", { name: "确认删除服务配置" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(deleteServiceConfiguration).toHaveBeenCalledWith("custom-one", false);
  });

  it("moves focus into the deletion dialog and restores it when Escape closes it", async () => {
    const runtime = createRuntimeStub({
      getServiceConfigurations: vi.fn(async () => initialState),
    });

    render(<ServiceSettingsPage runtime={runtime} />);
    await screen.findByText("Custom One");
    const deleteButton = screen.getByRole("button", { name: "删除 Custom One" });
    await userEvent.click(deleteButton);

    const cancelButton = screen.getByRole("button", { name: "取消删除" });
    await waitFor(() => expect(cancelButton).toHaveFocus());
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "确认删除服务配置" })).not.toBeInTheDocument();
    expect(deleteButton).toHaveFocus();
  });

  it("tests and fetches only on click while retaining a hand-entered model", async () => {
    const testServiceConnection = vi.fn(async () => ({ status: "completed" as const }));
    const fetchServiceModels = vi.fn(async () => ({
      status: "completed" as const,
      models: ["listed-model"],
      fetchedAt: "2026-08-13T00:00:00.000Z",
      currentModelPresent: false,
    }));
    const runtime = createRuntimeStub({
      getServiceConfigurations: vi.fn(async () => initialState),
      testServiceConnection,
      fetchServiceModels,
    });

    render(<ServiceSettingsPage runtime={runtime} />);
    await screen.findByText("Custom One");
    await userEvent.click(screen.getByRole("button", { name: "编辑 Custom One" }));
    expect(screen.getByLabelText("模型 ID")).toHaveValue("hand-entered-model");
    expect(screen.getByText("https://gateway.example.test/models")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "测试连接" }));
    await waitFor(() => expect(testServiceConnection).toHaveBeenCalledOnce());
    expect(await screen.findByText("连接测试成功。")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "获取模型" }));
    await waitFor(() => expect(fetchServiceModels).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("模型 ID")).toHaveValue("hand-entered-model");
    expect(
      await screen.findByText("模型列表不含当前手填模型，仍可保存并用于翻译。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "listed-model" })).toBeInTheDocument();
  });

  it("cancels in-flight service operations when the editor closes", async () => {
    let resolveConnection: (
      result: Awaited<ReturnType<RuyiRuntimeBridge["testServiceConnection"]>>,
    ) => void = () => undefined;
    const pendingConnection = new Promise<
      Awaited<ReturnType<RuyiRuntimeBridge["testServiceConnection"]>>
    >((resolve) => {
      resolveConnection = resolve;
    });
    const cancelServiceOperation = vi.fn();
    const runtime = createRuntimeStub({
      getServiceConfigurations: vi.fn(async () => initialState),
      testServiceConnection: vi.fn(() => pendingConnection),
      cancelServiceOperation,
    });

    render(<ServiceSettingsPage runtime={runtime} />);
    await screen.findByText("Custom One");
    await userEvent.click(screen.getByRole("button", { name: "编辑 Custom One" }));
    await userEvent.click(screen.getByRole("button", { name: "测试连接" }));
    await waitFor(() => expect(runtime.testServiceConnection).toHaveBeenCalledOnce());

    await userEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(cancelServiceOperation).toHaveBeenCalledWith("connection-1");
    resolveConnection({
      status: "failed",
      error: { code: "cancelled", message: "连接测试已取消。" },
    });
  });

  it("ignores a late model result after switching to another editor", async () => {
    let resolveModels: (
      result: Awaited<ReturnType<RuyiRuntimeBridge["fetchServiceModels"]>>,
    ) => void = () => undefined;
    const pendingModels = new Promise<
      Awaited<ReturnType<RuyiRuntimeBridge["fetchServiceModels"]>>
    >((resolve) => {
      resolveModels = resolve;
    });
    const cancelServiceOperation = vi.fn();
    const runtime = createRuntimeStub({
      getServiceConfigurations: vi.fn(async () => initialState),
      fetchServiceModels: vi.fn(() => pendingModels),
      cancelServiceOperation,
    });

    render(<ServiceSettingsPage runtime={runtime} />);
    await screen.findByText("Custom One");
    await userEvent.click(screen.getByRole("button", { name: "编辑 Custom One" }));
    await userEvent.click(screen.getByRole("button", { name: "获取模型" }));
    await waitFor(() => expect(runtime.fetchServiceModels).toHaveBeenCalledOnce());
    await userEvent.click(screen.getByRole("button", { name: "编辑 DeepSeek Flash" }));

    expect(cancelServiceOperation).toHaveBeenCalledWith("models-1");
    expect(screen.getByLabelText("模型 ID")).toHaveValue("deepseek-v4-flash");
    resolveModels({
      status: "completed",
      models: ["late-custom-model"],
      fetchedAt: "2026-08-13T00:00:00.000Z",
      currentModelPresent: false,
    });
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: "late-custom-model" })).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("模型 ID")).toHaveValue("deepseek-v4-flash");
  });

  it("closes an editor when its configuration is deleted", async () => {
    const runtime = createRuntimeStub({
      getServiceConfigurations: vi.fn(async () => initialState),
      deleteServiceConfiguration: vi.fn(async () => ({
        currentServiceConfigurationId: official.id,
        serviceConfigurations: [official],
      })),
    });

    render(<ServiceSettingsPage runtime={runtime} />);
    await screen.findByText("Custom One");
    await userEvent.click(screen.getByRole("button", { name: "编辑 Custom One" }));
    expect(
      screen.getByRole("heading", { name: "编辑服务配置" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "删除 Custom One" }));
    await userEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "编辑服务配置" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("returns to a first-configuration view after deleting the last item", async () => {
    const singleState: ServiceConfigurationsState = {
      currentServiceConfigurationId: official.id,
      serviceConfigurations: [official],
    };
    const runtime = createRuntimeStub({
      getServiceConfigurations: vi.fn(async () => singleState),
      deleteServiceConfiguration: vi.fn(async () => ({
        currentServiceConfigurationId: null,
        serviceConfigurations: [],
      })),
    });

    render(<ServiceSettingsPage runtime={runtime} />);
    await screen.findByText("DeepSeek Flash");
    await userEvent.click(screen.getByRole("button", { name: "删除 DeepSeek Flash" }));
    await userEvent.click(screen.getByRole("button", { name: "确认删除" }));

    expect(
      await screen.findByRole("heading", { name: "首次配置" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "添加 DeepSeek 官方配置" }),
    ).toBeEnabled();
  });

  it("shows a migration failure, keeps the affected configuration disabled, and offers editing", async () => {
    const disabledState: ServiceConfigurationsState = {
      ...initialState,
      storageIssue: {
        code: "migration_failed",
        message: "部分服务配置无法安全迁移，原数据未被覆盖。",
      },
      serviceConfigurations: [
        {
          ...custom,
          name: "需要修复的服务",
          disabled: true,
          repairable: true,
          migrationError: "配置数据无法安全迁移，已停用；请重新编辑。",
        },
      ],
    };
    const runtime = createRuntimeStub({
      getServiceConfigurations: vi.fn(async () => disabledState),
    });

    render(<ServiceSettingsPage runtime={runtime} />);

    expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent(
      "部分服务配置无法安全迁移，原数据未被覆盖。",
    );
    expect(screen.getByText(/配置数据无法安全迁移，已停用/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设为当前 需要修复的服务" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "重新编辑 需要修复的服务" }));
    expect(screen.getByRole("heading", { name: "重新编辑服务配置" })).toBeInTheDocument();
  });

  it("confirms restoring all settings, restores focus on Escape, and refreshes the empty preset", async () => {
    const resetState: ServiceConfigurationsState = {
      currentServiceConfigurationId: "deepseek-flash",
      serviceConfigurations: [
        {
          ...official,
          hasApiKey: false,
          maskedApiKey: null,
          cachedModels: [],
          modelsFetchedAt: null,
          performanceSummary: null,
        },
      ],
      backgroundNotificationsEnabled: true,
    };
    const resetAllSettings = vi.fn(async () => resetState);
    const runtime = createRuntimeStub({
      getServiceConfigurations: vi.fn(async () => initialState),
      resetAllSettings,
    });

    render(<ServiceSettingsPage runtime={runtime} />);
    await screen.findByText("Custom One");
    const trigger = screen.getByRole("button", { name: "恢复所有设置" });
    await userEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "确认恢复所有设置" });
    expect(dialog).toHaveTextContent("所有服务配置和 API Key");
    expect(dialog).toHaveTextContent("术语库、行业配置和参考译例");
    expect(dialog).toHaveTextContent("当前翻译");
    expect(dialog).toHaveTextContent("不能保证删除 uTools 已同步到远端或其他设备的副本");
    const cancel = screen.getByRole("button", { name: "取消恢复" });
    await waitFor(() => expect(cancel).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "确认恢复所有设置" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: "确认恢复并删除" }));

    await waitFor(() => expect(resetAllSettings).toHaveBeenCalledWith(true));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "已恢复所有设置，已重新建立空密钥 DeepSeek Flash 预设",
    );
    expect(screen.getByText("未配置 API Key")).toBeInTheDocument();
    expect(screen.queryByText("Custom One")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
