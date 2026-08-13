import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type { StandardTranslationResult } from "../runtime/contracts";
import { configuredRuntimeState, createRuntimeStub } from "../test/runtime-stub";
import { ConfiguredTranslationPage } from "./ConfiguredTranslationPage";

test("selects precision mode, remembers DeepSeek thinking, shows the call plan, and reports stages", async () => {
  const user = userEvent.setup();
  let finish: ((result: StandardTranslationResult) => void) | undefined;
  const startTranslation = vi.fn((request, onProgress) => {
    onProgress?.({
      type: "precision_stage",
      taskId: request.taskId,
      stage: "analyzing",
      callPlan: {
        analysisCalls: 1,
        translationCalls: 1,
        reviewCalls: 2,
        maximumRevisionCalls: 1,
        maximumCallCount: 5,
        segmentCount: 1,
      },
    });
    return new Promise<StandardTranslationResult>((resolve) => {
      finish = resolve;
    });
  });
  const setServiceThinkingMode = vi.fn(async () => ({
    currentServiceConfigurationId: "deepseek-flash",
    serviceConfigurations: [
      { ...configuredRuntimeState.serviceConfiguration!, thinkingEnabled: true },
    ],
  }));
  const runtime = createRuntimeStub({ startTranslation, setServiceThinkingMode });

  render(
    <ConfiguredTranslationPage
      initialText="Hello"
      autoStart={false}
      runtime={runtime}
    />,
  );

  await screen.findByText(/当前服务：DeepSeek Flash/u);
  await user.click(screen.getByText("翻译选项", { selector: "summary span" }));
  await user.selectOptions(screen.getByLabelText("质量模式"), "precision");
  expect(screen.getByText(/1 次分析.*1 次翻译.*2 次并行审校.*最多 1 次修订/u)).toBeVisible();
  expect(startTranslation).not.toHaveBeenCalled();

  await user.click(screen.getByLabelText("DeepSeek 思考模式"));
  await waitFor(() =>
    expect(setServiceThinkingMode).toHaveBeenCalledWith("deepseek-flash", true),
  );
  expect(screen.getByText(/等待时间和费用可能明显增加/u)).toBeVisible();

  await user.click(screen.getByRole("button", { name: "开始精译" }));
  await waitFor(() =>
    expect(startTranslation).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceText: "Hello",
        qualityMode: "precision",
        thinkingEnabled: true,
      }),
      expect.any(Function),
    ),
  );
  expect(screen.getByRole("status")).toHaveTextContent("正在分析全文");

  await act(async () => {
    finish?.({
      status: "completed",
      taskId: startTranslation.mock.calls[0][0].taskId,
      translation: "初译",
      quality: { risks: [], pasteBlocked: false },
      precision: {
        complete: false,
        failedStage: "language_review",
        callPlan: {
          analysisCalls: 1,
          translationCalls: 1,
          reviewCalls: 2,
          maximumRevisionCalls: 1,
          maximumCallCount: 5,
          segmentCount: 1,
        },
        reviewIssues: [],
        revisedSegmentIds: [],
        unresolvedIssueIds: [],
      },
    });
  });

  expect(screen.getByRole("alert")).toHaveTextContent("精译未完成");
  expect(screen.getByLabelText("译文")).toHaveTextContent("初译");
});

test("does not silently fall back to standard translation when the runtime lacks precision support", async () => {
  const user = userEvent.setup();
  const startStandardTranslation = vi.fn(async (request) => ({
    status: "completed" as const,
    taskId: request.taskId,
    translation: "标准译文",
    quality: { risks: [], pasteBlocked: false },
  }));
  const runtime = createRuntimeStub({
    startTranslation: undefined,
    startStandardTranslation,
  });
  render(
    <ConfiguredTranslationPage
      initialText="Hello"
      autoStart={false}
      runtime={runtime}
    />,
  );
  await screen.findByText(/当前服务：DeepSeek Flash/u);
  await user.click(screen.getByText("翻译选项", { selector: "summary span" }));
  await user.selectOptions(screen.getByLabelText("质量模式"), "precision");

  await user.click(screen.getByRole("button", { name: "开始精译" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("当前运行时版本不支持精译");
  expect(startStandardTranslation).not.toHaveBeenCalled();
});

test("shows the failed precision stage and offers retry or an explicit switch to standard mode", async () => {
  const user = userEvent.setup();
  const startTranslation = vi.fn(async (request): Promise<StandardTranslationResult> => ({
    status: "failed" as const,
    taskId: request.taskId,
    sourceRetained: true as const,
    precision: {
      complete: false,
      failedStage: "analysis" as const,
      callPlan: {
        analysisCalls: 1,
        translationCalls: 1,
        reviewCalls: 2,
        maximumRevisionCalls: 1,
        maximumCallCount: 5,
        segmentCount: 1,
      },
      reviewIssues: [],
      revisedSegmentIds: [],
      unresolvedIssueIds: [],
    },
    error: { code: "protocol_error" as const, message: "分析结果无效。" },
  }));
  const runtime = createRuntimeStub({ startTranslation });
  render(
    <ConfiguredTranslationPage
      initialText="Hello"
      autoStart={false}
      runtime={runtime}
    />,
  );
  await screen.findByText(/当前服务：DeepSeek Flash/u);
  await user.click(screen.getByText("翻译选项", { selector: "summary span" }));
  await user.selectOptions(screen.getByLabelText("质量模式"), "precision");
  await user.click(screen.getByRole("button", { name: "开始精译" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("精译未完成，失败阶段：分析");
  expect(screen.getByRole("button", { name: "重试精译" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "改用标准模式" }));
  expect(screen.getByLabelText("质量模式")).toHaveValue("standard");
  expect(startTranslation).toHaveBeenCalledOnce();
});

test("shows the concrete precision review category", async () => {
  const user = userEvent.setup();
  const startTranslation = vi.fn(async (request): Promise<StandardTranslationResult> => ({
    status: "completed",
    taskId: request.taskId,
    translation: "初译",
    quality: { risks: [], pasteBlocked: false },
    precision: {
      complete: true,
      callPlan: {
        analysisCalls: 1,
        translationCalls: 1,
        reviewCalls: 2,
        maximumRevisionCalls: 1,
        maximumCallCount: 5,
        segmentCount: 1,
      },
      reviewIssues: [
        {
          reviewRole: "accuracy",
          id: "accuracy-1",
          segmentId: "document-0-0-5",
          type: "mistranslation",
          severity: "major",
          sourceRange: { start: 0, end: 5 },
          translationRange: { start: 0, end: 2 },
          termId: null,
          suggestion: "改正含义",
          confidence: "high",
        },
      ],
      revisedSegmentIds: [],
      unresolvedIssueIds: ["accuracy-1"],
    },
  }));
  const runtime = createRuntimeStub({ startTranslation });
  render(
    <ConfiguredTranslationPage
      initialText="Hello"
      autoStart={false}
      runtime={runtime}
    />,
  );
  await screen.findByText(/当前服务：DeepSeek Flash/u);
  await user.click(screen.getByText("翻译选项", { selector: "summary span" }));
  await user.selectOptions(screen.getByLabelText("质量模式"), "precision");
  await user.click(screen.getByRole("button", { name: "开始精译" }));

  expect(await screen.findByText(/准确性风险（误译）：改正含义/u)).toBeVisible();
});
