import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { StandardTranslationResult } from "../runtime/contracts";
import { configuredRuntimeState, createRuntimeStub } from "../test/runtime-stub";
import { ConfiguredTranslationPage } from "./ConfiguredTranslationPage";

describe("ConfiguredTranslationPage parallel acceleration", () => {
  it("keeps acceleration manual and submits the selected concurrency", async () => {
    const user = userEvent.setup();
    const startStandardTranslation = vi.fn(async (request) => ({
      status: "completed" as const,
      taskId: request.taskId,
      translation: "译文",
      quality: { risks: [], pasteBlocked: false },
    }));
    const runtime = createRuntimeStub({ startStandardTranslation });

    render(
      <ConfiguredTranslationPage
        initialText="source"
        autoStart={false}
        runtime={runtime}
      />,
    );

    const acceleration = await screen.findByRole("checkbox", { name: "并发加速" });
    const concurrency = screen.getByRole("combobox", { name: "并发数" });
    expect(acceleration).not.toBeChecked();
    expect(concurrency).toBeDisabled();

    await user.click(acceleration);
    await user.selectOptions(concurrency, "4");
    expect(startStandardTranslation).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "开始翻译" }));
    await waitFor(() => expect(startStandardTranslation).toHaveBeenCalledOnce());
    expect(startStandardTranslation.mock.calls[0][0]).toMatchObject({
      parallelAcceleration: true,
      parallelConcurrency: 4,
    });
  });

  it("suggests acceleration for a long source without enabling it", async () => {
    const runtime = createRuntimeStub();
    render(
      <ConfiguredTranslationPage
        initialText={"x".repeat(4_001)}
        autoStart={false}
        runtime={runtime}
      />,
    );

    expect(
      await screen.findByText(/当前服务暂无速度样本.*建议手动开启并发加速/u),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "并发加速" })).not.toBeChecked();
  });

  it("shows segment progress without announcing every text delta", async () => {
    const user = userEvent.setup();
    const startStandardTranslation = vi.fn((_request, onProgress) => {
      onProgress({ type: "started", taskId: "parallel-progress" });
      onProgress({
        type: "parallel_plan",
        taskId: "parallel-progress",
        parallel: {
          requested: true,
          applied: true,
          concurrency: 3,
          segmentCount: 4,
          fallbackReason: null,
        },
      });
      onProgress({
        type: "segment_progress",
        taskId: "parallel-progress",
        completed: 1,
        total: 4,
        inFlight: 3,
        concurrency: 3,
      });
      return new Promise<StandardTranslationResult>(() => undefined);
    });
    const runtime = createRuntimeStub({ startStandardTranslation });
    render(
      <ConfiguredTranslationPage
        initialText="source"
        autoStart={false}
        runtime={runtime}
      />,
    );

    await user.click(await screen.findByRole("checkbox", { name: "并发加速" }));
    await user.click(screen.getByRole("button", { name: "开始翻译" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "并发翻译：已完成 1/4 段，正在处理 3 段",
    );
    expect(screen.getByLabelText("译文生成中")).toHaveAttribute("aria-live", "off");
  });

  it("uses the stored speed summary only for an estimate", async () => {
    const state = {
      ...configuredRuntimeState,
      serviceConfiguration: {
        ...configuredRuntimeState.serviceConfiguration!,
        performanceSummary: {
          sampleCount: 3,
          averageFirstOutputMilliseconds: 2_000,
          averageCompletionMilliseconds: 30_000,
          averageOutputCodePointsPerSecond: 50,
        },
      },
    };
    const runtime = createRuntimeStub({
      getServiceConfiguration: async () => state,
      getServiceConfigurations: async () => ({
        currentServiceConfigurationId: state.serviceConfiguration.id,
        serviceConfigurations: [state.serviceConfiguration],
      }),
      getParallelAccelerationAdvice: () => ({
        suggested: true,
        estimatedSeconds: 47,
        reason: "estimated_over_45_seconds",
      }),
    });
    render(
      <ConfiguredTranslationPage
        initialText={"x".repeat(2_201)}
        autoStart={false}
        runtime={runtime}
      />,
    );

    expect(await screen.findByText(/预计约 47 秒.*建议手动开启并发加速/u)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "并发加速" })).not.toBeChecked();
  });
});
