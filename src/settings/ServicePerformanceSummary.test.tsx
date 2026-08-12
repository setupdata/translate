import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { configuredRuntimeState, createRuntimeStub } from "../test/runtime-stub";
import { ServiceSettingsPage } from "./ServiceSettingsPage";

describe("ServiceSettingsPage performance summary", () => {
  it("shows privacy-safe local measurements and lets the user clear them", async () => {
    const user = userEvent.setup();
    const configuration = {
      ...configuredRuntimeState.serviceConfiguration!,
      performanceSummary: {
        sampleCount: 3,
        averageFirstOutputMilliseconds: 1_500,
        averageCompletionMilliseconds: 12_000,
        averageOutputCodePointsPerSecond: 42.5,
      },
    };
    const populatedState = {
      currentServiceConfigurationId: configuration.id,
      serviceConfigurations: [configuration],
    };
    const clearedState = {
      ...populatedState,
      serviceConfigurations: [{ ...configuration, performanceSummary: null }],
    };
    const clearServicePerformanceData = vi.fn(async () => clearedState);
    const runtime = createRuntimeStub({
      getServiceConfigurations: async () => populatedState,
      clearServicePerformanceData,
    });

    render(<ServiceSettingsPage runtime={runtime} />);

    expect(await screen.findByText(/3 次本地样本/u)).toBeInTheDocument();
    expect(screen.getByText(/平均完成 12\.0 秒/u)).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "清除 DeepSeek Flash 的性能数据" }),
    );

    await waitFor(() => expect(clearServicePerformanceData).toHaveBeenCalledWith("deepseek-flash"));
    expect(await screen.findByText("暂无本地性能样本。")).toBeInTheDocument();
  });
});
