import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { TerminologyState } from "../runtime/contracts";
import { configuredRuntimeState, createRuntimeStub } from "../test/runtime-stub";
import { ConfiguredTranslationPage } from "./ConfiguredTranslationPage";

const terminologyState: TerminologyState = {
  termbases: [],
  domainProfiles: [
    {
      id: "energy-profile",
      version: "1",
      name: "能源行业",
      field: "Energy",
      documentType: null,
      audience: null,
      style: null,
      termbaseIds: [],
      preserveRules: [],
    },
  ],
  currentDomainProfileId: null,
};

describe("ConfiguredTranslationPage terminology", () => {
  it("does not carry task terms into a replacement text entry", async () => {
    const previousInputs = {
      sourceText: "old source",
      targetLanguage: configuredRuntimeState.defaults.targetLanguage,
      serviceConfigurationId: "deepseek-flash",
      domainProfileId: null,
      qualityMode: "standard" as const,
      additionalRequirements: "",
      taskTerms: [{ sourceTerm: "old source", preferredTarget: "旧译法" }],
    };
    const startStandardTranslation = vi.fn(async (request) => ({
      status: "completed" as const,
      taskId: request.taskId,
      translation: "新译文",
      quality: { risks: [], pasteBlocked: false },
    }));
    const updateCurrentTranslationInputs = vi.fn((inputs) => ({
      revision: 2,
      phase: "editing" as const,
      inputs,
      task: null,
      partialTranslation: "",
      result: null,
      stale: false,
    }));
    const runtime = createRuntimeStub({
      getTerminologyState: vi.fn(async () => ({
        ...terminologyState,
        currentDomainProfileId: "energy-profile",
      })),
      getCurrentTranslation: vi.fn(() => ({
        revision: 1,
        phase: "completed" as const,
        inputs: previousInputs,
        task: { ...previousInputs, taskId: "old-task" },
        partialTranslation: "",
        result: {
          status: "completed" as const,
          taskId: "old-task",
          translation: "旧译文",
          quality: { risks: [], pasteBlocked: false },
        },
        stale: false,
      })),
      updateCurrentTranslationInputs,
      startStandardTranslation,
    });

    render(
      <ConfiguredTranslationPage autoStart initialText="new source" runtime={runtime} />,
    );

    await waitFor(() => expect(startStandardTranslation).toHaveBeenCalledOnce());
    expect(startStandardTranslation).toHaveBeenCalledWith(
      expect.objectContaining({
        domainProfileId: null,
        sourceText: "new source",
        taskTerms: [],
      }),
      expect.any(Function),
    );
    expect(updateCurrentTranslationInputs).toHaveBeenCalledWith(
      expect.objectContaining({ sourceText: "new source", taskTerms: [] }),
    );
  });

  it("edits task terms and selects a domain profile without sending until submit", async () => {
    const user = userEvent.setup();
    const startStandardTranslation = vi.fn(async (request) => ({
      status: "completed" as const,
      taskId: request.taskId,
      translation: "译文",
      quality: { risks: [], pasteBlocked: false },
    }));
    const setCurrentDomainProfile = vi.fn(async (id: string | null) => ({
      ...terminologyState,
      currentDomainProfileId: id,
    }));
    const runtime = createRuntimeStub({
      getTerminologyState: vi.fn(async () => terminologyState),
      setCurrentDomainProfile,
      startStandardTranslation,
    });
    render(
      <ConfiguredTranslationPage
        autoStart={false}
        initialText="Use the power grid."
        runtime={runtime}
      />,
    );

    await user.selectOptions(await screen.findByLabelText("行业配置"), "energy-profile");
    expect(setCurrentDomainProfile).toHaveBeenCalledWith("energy-profile");
    expect(startStandardTranslation).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "新增本次术语" }));
    await user.type(screen.getByLabelText("本次术语源术语"), "power grid");
    await user.type(screen.getByLabelText("本次术语译法"), "电网");
    expect(startStandardTranslation).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "开始翻译" }));
    await waitFor(() => expect(startStandardTranslation).toHaveBeenCalledOnce());
    expect(startStandardTranslation).toHaveBeenCalledWith(
      expect.objectContaining({
        domainProfileId: "energy-profile",
        taskTerms: [{ sourceTerm: "power grid", preferredTarget: "电网" }],
      }),
      expect.any(Function),
    );
  });

  it("shows strict conflicts and turns the user's choice into a task term", async () => {
    const user = userEvent.setup();
    const startStandardTranslation = vi.fn(async () => ({
      status: "validation_error" as const,
      reason: "terminology_conflict" as const,
      sourceRetained: true as const,
      terminologyConflicts: [
        {
          source: "power grid",
          choices: [
            { termId: "one", preferredTarget: "电网", origin: "general" as const },
            { termId: "two", preferredTarget: "电力网", origin: "general" as const },
          ],
        },
      ],
    }));
    const runtime = createRuntimeStub({ startStandardTranslation });
    render(
      <ConfiguredTranslationPage
        autoStart={false}
        initialText="Use the power grid."
        runtime={runtime}
      />,
    );

    await screen.findByText(/当前服务/u);
    await user.click(screen.getByRole("button", { name: "开始翻译" }));
    expect(await screen.findByRole("heading", { name: "术语冲突" })).toBeInTheDocument();
    const choiceButton = screen.getByRole("button", { name: "使用译法 电网" });
    expect(choiceButton.closest('[role="alert"]')).toBeNull();
    expect(screen.getByText(/同一优先级的严格术语/u)).toHaveAttribute("role", "alert");
    await user.click(choiceButton);

    expect(screen.getByLabelText("本次术语源术语")).toHaveValue("power grid");
    expect(screen.getByLabelText("本次术语译法")).toHaveValue("电网");
    expect(startStandardTranslation).toHaveBeenCalledOnce();
    expect(screen.queryByRole("heading", { name: "术语冲突" })).not.toBeInTheDocument();
  });

  it("shows the runtime's concrete terminology budget message", async () => {
    const user = userEvent.setup();
    const runtime = createRuntimeStub({
      startStandardTranslation: vi.fn(async () => ({
        status: "validation_error" as const,
        reason: "input_budget_exceeded" as const,
        field: "additionalRequirements",
        message: "附加翻译要求不能超过 2,000 个 Unicode 码点。",
        sourceRetained: true as const,
      })),
      getServiceConfiguration: vi.fn(async () => configuredRuntimeState),
    });
    render(
      <ConfiguredTranslationPage autoStart={false} initialText="source" runtime={runtime} />,
    );

    await screen.findByText(/当前服务/u);
    await user.click(screen.getByRole("button", { name: "开始翻译" }));
    expect(
      await screen.findByRole("alert", {
        name: "",
      }),
    ).toHaveTextContent("附加翻译要求不能超过 2,000 个 Unicode 码点。");
  });
});
