import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { TerminologyState } from "../runtime/contracts";
import { createRuntimeStub } from "../test/runtime-stub";
import { TerminologySettingsSection } from "./TerminologySettingsSection";

const emptyState: TerminologyState = {
  termbases: [],
  domainProfiles: [],
  referenceTranslations: [],
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
      referenceTranslations: [],
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

  it("saves a reference translation only after the user submits it", async () => {
    const user = userEvent.setup();
    const state: TerminologyState = {
      ...emptyState,
      domainProfiles: [
        {
          id: "profile-1",
          version: "1",
          name: "电力运行",
          field: "能源",
          documentType: null,
          audience: null,
          style: null,
          termbaseIds: [],
          preserveRules: [],
        },
      ],
    };
    const saveReferenceTranslation = vi.fn(async (input) => ({
      ...state,
      referenceTranslations: [{ ...input, id: "reference-1" }],
    }));
    const runtime = createRuntimeStub({
      getTerminologyState: vi.fn(async () => state),
      saveReferenceTranslation,
    });
    render(<TerminologySettingsSection runtime={runtime} />);

    await user.click(await screen.findByRole("button", { name: "新增参考译例" }));
    await user.selectOptions(screen.getByLabelText("关联行业配置"), "profile-1");
    await user.type(screen.getByLabelText("参考源语言"), "English");
    await user.type(screen.getByLabelText("参考目标语言"), "Simplified Chinese");
    await user.type(screen.getByLabelText("参考源文本"), "The grid is stable.");
    await user.type(screen.getByLabelText("参考译文"), "电网运行稳定。");

    expect(saveReferenceTranslation).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "保存参考译例" }));

    await waitFor(() => expect(saveReferenceTranslation).toHaveBeenCalledOnce());
    expect(saveReferenceTranslation).toHaveBeenCalledWith({
      id: null,
      domainProfileId: "profile-1",
      sourceLanguage: "English",
      targetLanguage: "Simplified Chinese",
      source: "The grid is stable.",
      translation: "电网运行稳定。",
    });
    expect(await screen.findByText("The grid is stable.")).toBeInTheDocument();
  });

  it("previews a CSV import and writes it only after confirmation", async () => {
    const user = userEvent.setup();
    const state: TerminologyState = {
      ...emptyState,
      termbases: [{ id: "base-1", name: "能源术语", enabled: true, entries: [] }],
    };
    const previewTermbaseCsv = vi.fn(async (request) => ({
      previewToken: "csv-preview-1",
      columns: ["sourceTerm", "source", "preferredTarget", "sourceLanguage", "targetLanguage"],
      requiredFields: ["sourceTerm", "preferredTarget", "sourceLanguage", "targetLanguage"],
      optionalFields: [],
      fieldMapping: {
        sourceTerm: request.mapping?.sourceTerm || "sourceTerm",
        preferredTarget: "preferredTarget",
        sourceLanguage: "sourceLanguage",
        targetLanguage: "targetLanguage",
      },
      issues: [],
      rowCount: 1,
      canImport: true,
    }));
    const discardTermbaseCsvPreview = vi.fn();
    const commitTermbaseCsv = vi.fn(async () => state);
    const runtime = createRuntimeStub({
      getTerminologyState: vi.fn(async () => state),
      previewTermbaseCsv,
      discardTermbaseCsvPreview,
      commitTermbaseCsv,
    });
    render(<TerminologySettingsSection runtime={runtime} />);

    const file = new File(
      ["sourceTerm,preferredTarget,sourceLanguage,targetLanguage\npower grid,电网,English,Simplified Chinese"],
      "terms.csv",
      { type: "text/csv" },
    );
    await user.upload(await screen.findByLabelText("导入 CSV 能源术语"), file);

    const previewDialog = await screen.findByRole("dialog", {
      name: "预览术语 CSV 导入",
    });
    expect(previewDialog).toHaveTextContent("1 条可导入记录");
    expect(screen.getByLabelText("CSV 字段 sourceTerm")).toHaveValue("sourceTerm");
    expect(screen.getByRole("button", { name: "取消导入" })).toHaveFocus();
    expect(commitTermbaseCsv).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText("CSV 字段 sourceTerm"), "source");
    await waitFor(() =>
      expect(previewTermbaseCsv).toHaveBeenLastCalledWith(
        expect.objectContaining({
          mapping: expect.objectContaining({ sourceTerm: "source" }),
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "取消导入" }));
    expect(discardTermbaseCsvPreview).toHaveBeenCalledWith("csv-preview-1");
    expect(commitTermbaseCsv).not.toHaveBeenCalled();

    await user.upload(screen.getByLabelText("导入 CSV 能源术语"), file);
    await screen.findByRole("dialog", { name: "预览术语 CSV 导入" });
    await user.click(screen.getByRole("button", { name: "确认整体导入" }));
    await waitFor(() => expect(commitTermbaseCsv).toHaveBeenCalledWith("csv-preview-1"));
  });

  it("rejects an oversized CSV before reading or previewing it", async () => {
    const user = userEvent.setup();
    const state: TerminologyState = {
      ...emptyState,
      termbases: [{ id: "base-1", name: "能源术语", enabled: true, entries: [] }],
    };
    const previewTermbaseCsv = vi.fn();
    const runtime = createRuntimeStub({
      getTerminologyState: vi.fn(async () => state),
      previewTermbaseCsv,
    });
    render(<TerminologySettingsSection runtime={runtime} />);

    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "too-large.csv", {
      type: "text/csv",
    });
    await user.upload(await screen.findByLabelText("导入 CSV 能源术语"), file);

    expect(await screen.findByRole("alert")).toHaveTextContent("CSV 文件不能超过 5 MiB");
    expect(previewTermbaseCsv).not.toHaveBeenCalled();
  });

  it("downloads the runtime's whitelisted CSV export", async () => {
    const user = userEvent.setup();
    const state: TerminologyState = {
      ...emptyState,
      termbases: [{ id: "base-1", name: "能源术语", enabled: true, entries: [] }],
    };
    const exportTermbaseCsv = vi.fn(async () => ({
      fileName: "能源术语.csv",
      bytes: new TextEncoder().encode("sourceTerm,preferredTarget\r\n"),
    }));
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURL = vi.fn(() => "blob:terms");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const runtime = createRuntimeStub({
      getTerminologyState: vi.fn(async () => state),
      exportTermbaseCsv,
    });
    render(<TerminologySettingsSection runtime={runtime} />);

    await user.click(await screen.findByRole("button", { name: "导出 CSV 能源术语" }));

    await waitFor(() => expect(exportTermbaseCsv).toHaveBeenCalledWith("base-1"));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:terms");
    click.mockRestore();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectURL,
    });
  });
});
