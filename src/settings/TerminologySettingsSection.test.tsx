import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { TerminologyState } from "../runtime/contracts";
import { createRuntimeStub } from "../test/runtime-stub";
import { TerminologySettingsSection } from "./TerminologySettingsSection";

const emptyState: TerminologyState = {
  termbases: [],
  domainProfiles: [],
  currentDomainProfileId: null,
};

describe("TerminologySettingsSection", () => {
  it("creates a termbase with the complete term fields", async () => {
    const user = userEvent.setup();
    const saveTermbase = vi.fn(async (input) => ({
      ...emptyState,
      termbases: [{ ...input, id: "base-1", entries: [{ ...input.entries[0], id: "term-1" }] }],
    }));
    const runtime = createRuntimeStub({
      getTerminologyState: vi.fn(async () => emptyState),
      saveTermbase,
    });
    render(<TerminologySettingsSection runtime={runtime} />);

    await screen.findByRole("heading", { name: "术语库与行业配置" });
    await user.click(screen.getByRole("button", { name: "新增术语库" }));
    await user.type(screen.getByLabelText("术语库名称"), "能源术语");
    await user.click(screen.getByLabelText("作为通用术语库启用"));
    await user.click(screen.getByRole("button", { name: "新增术语" }));
    await user.type(screen.getByLabelText("源术语"), "power grid");
    await user.type(screen.getByLabelText("首选译法"), "电网");
    await user.type(screen.getByLabelText("源语言"), "English");
    await user.type(screen.getByLabelText("目标语言"), "Simplified Chinese");
    await user.selectOptions(screen.getByLabelText("严格程度"), "exact");
    await user.click(screen.getByLabelText("区分大小写"));
    await user.clear(screen.getByLabelText("优先级"));
    await user.type(screen.getByLabelText("优先级"), "20");
    await user.type(screen.getByLabelText("允许变体（每行一项）"), "电力网");
    await user.type(screen.getByLabelText("禁止译法（每行一项）"), "电力网络");
    await user.type(screen.getByLabelText("别名（每行一项）"), "electric grid");
    await user.type(screen.getByLabelText("含义或适用语境"), "输配电系统");
    await user.click(screen.getByRole("button", { name: "保存术语库" }));

    await waitFor(() => expect(saveTermbase).toHaveBeenCalledOnce());
    expect(saveTermbase).toHaveBeenCalledWith({
      id: null,
      name: "能源术语",
      enabled: true,
      entries: [
        expect.objectContaining({
          id: null,
          sourceTerm: "power grid",
          preferredTarget: "电网",
          sourceLanguage: "English",
          targetLanguage: "Simplified Chinese",
          allowedVariants: ["电力网"],
          forbiddenTargets: ["电力网络"],
          aliases: ["electric grid"],
          meaning: "输配电系统",
          strictness: "exact",
          caseSensitive: true,
          priority: 20,
        }),
      ],
    });
  });

  it("creates and selects a domain profile linked to termbases", async () => {
    const user = userEvent.setup();
    const state: TerminologyState = {
      ...emptyState,
      termbases: [
        {
          id: "base-1",
          name: "能源术语",
          enabled: true,
          entries: [],
        },
      ],
    };
    const saved: TerminologyState = {
      ...state,
      domainProfiles: [
        {
          id: "profile-1",
          version: "1",
          name: "电力运行",
          field: "能源",
          documentType: "规程",
          audience: "运行人员",
          style: "准确简洁",
          termbaseIds: ["base-1"],
          preserveRules: ["保留设备编号"],
        },
      ],
    };
    const saveDomainProfile = vi.fn(async () => saved);
    const setCurrentDomainProfile = vi.fn(async () => ({
      ...saved,
      currentDomainProfileId: "profile-1",
    }));
    const runtime = createRuntimeStub({
      getTerminologyState: vi.fn(async () => state),
      saveDomainProfile,
      setCurrentDomainProfile,
    });
    render(<TerminologySettingsSection runtime={runtime} />);

    await user.click(await screen.findByRole("button", { name: "新增行业配置" }));
    await user.type(screen.getByLabelText("行业配置名称"), "电力运行");
    await user.type(screen.getByLabelText("行业领域"), "能源");
    await user.type(screen.getByLabelText("文档类型"), "规程");
    await user.type(screen.getByLabelText("目标读者"), "运行人员");
    await user.type(screen.getByLabelText("文体和语气"), "准确简洁");
    await user.click(screen.getByLabelText("关联术语库 能源术语"));
    await user.type(screen.getByLabelText("保留规则（每行一项）"), "保留设备编号");
    await user.click(screen.getByRole("button", { name: "保存行业配置" }));

    expect(saveDomainProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: null,
        name: "电力运行",
        termbaseIds: ["base-1"],
        preserveRules: ["保留设备编号"],
      }),
    );
    await user.click(await screen.findByRole("button", { name: "设为当前 电力运行" }));
    expect(setCurrentDomainProfile).toHaveBeenCalledWith("profile-1");
    expect(await screen.findByText("当前使用")).toBeInTheDocument();
  });

  it("asks for confirmation before deleting reusable terminology", async () => {
    const user = userEvent.setup();
    const state: TerminologyState = {
      termbases: [
        { id: "base-1", name: "能源术语", enabled: true, entries: [] },
      ],
      domainProfiles: [],
      currentDomainProfileId: null,
    };
    const deleteTermbase = vi.fn(async () => emptyState);
    const runtime = createRuntimeStub({
      getTerminologyState: vi.fn(async () => state),
      deleteTermbase,
    });
    render(<TerminologySettingsSection runtime={runtime} />);

    const deleteButton = await screen.findByRole("button", {
      name: "删除术语库 能源术语",
    });
    await user.click(deleteButton);
    expect(deleteTermbase).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "确认删除术语库" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消删除" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(deleteTermbase).toHaveBeenCalledWith("base-1"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
