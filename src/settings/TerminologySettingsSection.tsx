import { useEffect, useRef, useState } from "react";

import { useModalDialog } from "../accessibility/use-modal-dialog";
import type {
  DomainProfile,
  ReferenceTranslation,
  RuyiRuntimeBridge,
  Termbase,
  TermbaseCsvPreview,
  TermEntry,
  TerminologyState,
} from "../runtime/contracts";

const MAX_CSV_FILE_BYTES = 5 * 1024 * 1024;

function emptyTerm(): TermEntry {
  return {
    id: null,
    sourceTerm: "",
    preferredTarget: "",
    sourceLanguage: "",
    targetLanguage: "",
    allowedVariants: [],
    forbiddenTargets: [],
    meaning: null,
    strictness: "preferred",
    caseSensitive: false,
    aliases: [],
    priority: 0,
  };
}

function emptyTermbase(): Termbase {
  return { id: null, name: "", enabled: false, entries: [] };
}

function emptyDomainProfile(): DomainProfile {
  return {
    id: null,
    version: "1",
    name: "",
    field: null,
    documentType: null,
    audience: null,
    style: null,
    termbaseIds: [],
    preserveRules: [],
  };
}

function emptyReferenceTranslation(domainProfileId = ""): ReferenceTranslation {
  return {
    id: null,
    domainProfileId,
    sourceLanguage: "",
    targetLanguage: "",
    source: "",
    translation: "",
  };
}

function readFileBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取 CSV 文件。"));
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error("无法读取 CSV 文件。"));
        return;
      }
      resolve(new Uint8Array(reader.result));
    };
    reader.readAsArrayBuffer(file);
  });
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function editingLines(value: string): string[] {
  return value.split(/\r?\n/u);
}

function listText(value: string[]): string {
  return value.join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "术语配置操作失败。";
}

export function TerminologySettingsSection({ runtime }: { runtime: RuyiRuntimeBridge }) {
  const [state, setState] = useState<TerminologyState | null>(null);
  const [editingTermbase, setEditingTermbase] = useState<Termbase | null>(null);
  const [editingProfile, setEditingProfile] = useState<DomainProfile | null>(null);
  const [editingReference, setEditingReference] = useState<ReferenceTranslation | null>(null);
  const [csvPreview, setCsvPreview] = useState<
    (TermbaseCsvPreview & { termbaseId: string; termbaseName: string }) | null
  >(null);
  const [csvBytes, setCsvBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pendingDeletion, setPendingDeletion] = useState<{
    kind: "termbase" | "domainProfile" | "referenceTranslation";
    id: string;
    name: string;
  } | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const deleteCancel = useRef<HTMLButtonElement | null>(null);
  const csvImportTrigger = useRef<HTMLInputElement | null>(null);
  const csvCancel = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let mounted = true;
    void runtime
      .getTerminologyState()
      .then((next) => {
        if (mounted) setState(next);
      })
      .catch((loadError) => {
        if (mounted) setError(errorMessage(loadError));
      });
    return () => {
      mounted = false;
    };
  }, [runtime]);

  useEffect(() => {
    const previewToken = csvPreview?.previewToken;
    return () => {
      if (previewToken) runtime.discardTermbaseCsvPreview(previewToken);
    };
  }, [csvPreview?.previewToken, runtime]);

  function cancelDeletion() {
    setPendingDeletion(null);
  }

  function mutateTermbase(patch: Partial<Termbase>) {
    setEditingTermbase((current) => (current ? { ...current, ...patch } : current));
  }

  function mutateEntry(index: number, patch: Partial<TermEntry>) {
    setEditingTermbase((current) => {
      if (!current) return current;
      return {
        ...current,
        entries: current.entries.map((entry, entryIndex) =>
          entryIndex === index ? { ...entry, ...patch } : entry,
        ),
      };
    });
  }

  function mutateProfile(patch: Partial<DomainProfile>) {
    setEditingProfile((current) => (current ? { ...current, ...patch } : current));
  }

  function mutateReference(patch: Partial<ReferenceTranslation>) {
    setEditingReference((current) => (current ? { ...current, ...patch } : current));
  }

  async function run(action: () => Promise<TerminologyState>, success: string) {
    setError("");
    setStatus("");
    try {
      setState(await action());
      setStatus(success);
      return true;
    } catch (operationError) {
      setError(errorMessage(operationError));
      return false;
    }
  }

  async function previewCsv(termbase: Termbase & { id: string }, file: File) {
    setError("");
    setStatus("");
    if (file.size > MAX_CSV_FILE_BYTES) {
      setError("CSV 文件不能超过 5 MiB。");
      return;
    }
    try {
      const bytes = await readFileBytes(file);
      const preview = await runtime.previewTermbaseCsv({
        termbaseId: termbase.id,
        bytes,
      });
      setCsvBytes(bytes);
      setCsvPreview({ ...preview, termbaseId: termbase.id, termbaseName: termbase.name });
    } catch (previewError) {
      setError(errorMessage(previewError));
    }
  }

  async function remapCsv(field: string, column: string) {
    if (!csvPreview || !csvBytes) return;
    setError("");
    const nextMapping = { ...csvPreview.fieldMapping, [field]: column || null };
    const requestMapping = Object.fromEntries(
      Object.entries(nextMapping).map(([mappingField, mappedColumn]) => [
        mappingField,
        mappedColumn ?? "",
      ]),
    );
    try {
      const preview = await runtime.previewTermbaseCsv({
        termbaseId: csvPreview.termbaseId,
        bytes: csvBytes,
        mapping: requestMapping,
      });
      setCsvPreview({
        ...preview,
        termbaseId: csvPreview.termbaseId,
        termbaseName: csvPreview.termbaseName,
      });
    } catch (mappingError) {
      setError(errorMessage(mappingError));
    }
  }

  function cancelCsvPreview() {
    if (csvPreview?.previewToken) {
      runtime.discardTermbaseCsvPreview(csvPreview.previewToken);
    }
    setCsvBytes(null);
    setCsvPreview(null);
  }

  async function exportCsv(termbaseId: string) {
    setError("");
    setStatus("");
    try {
      const exported = await runtime.exportTermbaseCsv(termbaseId);
      const bytes = Uint8Array.from(exported.bytes);
      const url = URL.createObjectURL(
        new Blob([bytes.buffer], { type: "text/csv;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exported.fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatus(`已导出 ${exported.fileName}。`);
    } catch (exportError) {
      setError(errorMessage(exportError));
    }
  }

  const csvPreviewDialog = useModalDialog({
    open: Boolean(csvPreview),
    initialFocusRef: csvCancel,
    returnFocusRef: csvImportTrigger,
    onDismiss: cancelCsvPreview,
  });
  const deleteDialog = useModalDialog({
    open: Boolean(pendingDeletion),
    initialFocusRef: deleteCancel,
    returnFocusRef: deleteTrigger,
    onDismiss: cancelDeletion,
  });

  return (
    <section aria-labelledby="terminology-settings-heading">
      <div className="settings-heading-row">
        <div>
          <h2 id="terminology-settings-heading">术语库与行业配置</h2>
          <p>只会把当前源文本实际命中的术语发送给模型。</p>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {state?.storageIssue && <p role="alert">{state.storageIssue.message}</p>}
      {status && <p role="status">{status}</p>}
      {!state && !error && <p role="status">正在读取术语配置…</p>}

      {state && !state.storageIssue && (
        <>
          <div className="settings-heading-row">
            <h3>术语库</h3>
            <button type="button" onClick={() => setEditingTermbase(emptyTermbase())}>
              新增术语库
            </button>
          </div>
          {state.termbases.length === 0 ? (
            <p>还没有术语库。</p>
          ) : (
            <ul className="service-configuration-list" aria-label="术语库列表">
              {state.termbases.map((termbase) => (
                <li className="service-configuration-card" key={termbase.id}>
                  <div>
                    <h3>{termbase.name}</h3>
                    <p>
                      {termbase.entries.length} 条术语
                      {termbase.enabled ? " · 已用于通用匹配" : " · 仅由行业配置引用"}
                    </p>
                  </div>
                  <div className="compact-actions">
                    <label className="file-action">
                      导入 CSV
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        aria-label={`导入 CSV ${termbase.name}`}
                        onChange={(event) => {
                          const input = event.currentTarget;
                          const file = input.files?.[0];
                          if (!file) return;
                          csvImportTrigger.current = input;
                          void previewCsv(termbase, file).finally(() => {
                            input.value = "";
                          });
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      aria-label={`导出 CSV ${termbase.name}`}
                      onClick={() => void exportCsv(termbase.id)}
                    >
                      导出 CSV
                    </button>
                    <button
                      type="button"
                      aria-label={`编辑术语库 ${termbase.name}`}
                      onClick={() => setEditingTermbase(structuredClone(termbase))}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      aria-label={`删除术语库 ${termbase.name}`}
                      onClick={(event) => {
                        deleteTrigger.current = event.currentTarget;
                        setPendingDeletion({
                          kind: "termbase",
                          id: termbase.id,
                          name: termbase.name,
                        });
                      }}
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {editingTermbase && (
            <div className="configuration-card terminology-editor">
              <h3>{editingTermbase.id ? "编辑术语库" : "新增术语库"}</h3>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    () =>
                      runtime.saveTermbase({
                        ...editingTermbase,
                        entries: editingTermbase.entries.map((entry) => ({
                          ...entry,
                          allowedVariants: lines(listText(entry.allowedVariants)),
                          forbiddenTargets: lines(listText(entry.forbiddenTargets)),
                          aliases: lines(listText(entry.aliases)),
                        })),
                      }),
                    "术语库已保存。",
                  ).then((saved) => {
                    if (saved) setEditingTermbase(null);
                  });
                }}
              >
                <label htmlFor="termbase-name">术语库名称</label>
                <input
                  id="termbase-name"
                  value={editingTermbase.name}
                  onChange={(event) => mutateTermbase({ name: event.target.value })}
                />
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={editingTermbase.enabled}
                    onChange={(event) => mutateTermbase({ enabled: event.target.checked })}
                  />
                  作为通用术语库启用
                </label>
                <div className="settings-heading-row">
                  <h4>术语条目</h4>
                  <button
                    type="button"
                    onClick={() =>
                      mutateTermbase({ entries: [...editingTermbase.entries, emptyTerm()] })
                    }
                  >
                    新增术语
                  </button>
                </div>
                {editingTermbase.entries.map((entry, index) => {
                  const suffix = index === 0 ? "" : ` ${index + 1}`;
                  return (
                    <fieldset className="term-entry" key={entry.id ?? `new-${index}`}>
                      <legend>术语 {index + 1}</legend>
                      <label>
                        源术语
                        <input
                          aria-label={`源术语${suffix}`}
                          value={entry.sourceTerm}
                          onChange={(event) =>
                            mutateEntry(index, { sourceTerm: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        首选译法
                        <input
                          aria-label={`首选译法${suffix}`}
                          value={entry.preferredTarget}
                          onChange={(event) =>
                            mutateEntry(index, { preferredTarget: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        源语言
                        <input
                          aria-label={`源语言${suffix}`}
                          value={entry.sourceLanguage}
                          onChange={(event) =>
                            mutateEntry(index, { sourceLanguage: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        目标语言
                        <input
                          aria-label={`目标语言${suffix}`}
                          value={entry.targetLanguage}
                          onChange={(event) =>
                            mutateEntry(index, { targetLanguage: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        严格程度
                        <select
                          aria-label={`严格程度${suffix}`}
                          value={entry.strictness}
                          onChange={(event) =>
                            mutateEntry(index, {
                              strictness: event.target.value as TermEntry["strictness"],
                            })
                          }
                        >
                          <option value="preferred">推荐</option>
                          <option value="exact">严格</option>
                        </select>
                      </label>
                      <label className="checkbox-label">
                        <input
                          aria-label={`区分大小写${suffix}`}
                          type="checkbox"
                          checked={entry.caseSensitive}
                          onChange={(event) =>
                            mutateEntry(index, { caseSensitive: event.target.checked })
                          }
                        />
                        区分大小写
                      </label>
                      <label>
                        优先级
                        <input
                          aria-label={`优先级${suffix}`}
                          type="number"
                          value={entry.priority}
                          onChange={(event) =>
                            mutateEntry(index, { priority: Number(event.target.value) })
                          }
                        />
                      </label>
                      <label>
                        允许变体（每行一项）
                        <textarea
                          aria-label={`允许变体（每行一项）${suffix}`}
                          value={listText(entry.allowedVariants)}
                          onChange={(event) =>
                            mutateEntry(index, {
                              allowedVariants: editingLines(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        禁止译法（每行一项）
                        <textarea
                          aria-label={`禁止译法（每行一项）${suffix}`}
                          value={listText(entry.forbiddenTargets)}
                          onChange={(event) =>
                            mutateEntry(index, {
                              forbiddenTargets: editingLines(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        别名（每行一项）
                        <textarea
                          aria-label={`别名（每行一项）${suffix}`}
                          value={listText(entry.aliases)}
                          onChange={(event) =>
                            mutateEntry(index, { aliases: editingLines(event.target.value) })
                          }
                        />
                      </label>
                      <label>
                        含义或适用语境
                        <textarea
                          aria-label={`含义或适用语境${suffix}`}
                          value={entry.meaning ?? ""}
                          onChange={(event) =>
                            mutateEntry(index, { meaning: event.target.value || null })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        aria-label={`删除术语 ${index + 1}`}
                        onClick={() =>
                          mutateTermbase({
                            entries: editingTermbase.entries.filter(
                              (_, entryIndex) => entryIndex !== index,
                            ),
                          })
                        }
                      >
                        删除这条术语
                      </button>
                    </fieldset>
                  );
                })}
                <div className="dialog-actions">
                  <button type="button" onClick={() => setEditingTermbase(null)}>
                    取消
                  </button>
                  <button type="submit">保存术语库</button>
                </div>
              </form>
            </div>
          )}

          <div className="settings-heading-row">
            <h3>行业配置</h3>
            <button type="button" onClick={() => setEditingProfile(emptyDomainProfile())}>
              新增行业配置
            </button>
          </div>
          {state.domainProfiles.length === 0 ? (
            <p>还没有行业配置。</p>
          ) : (
            <ul className="service-configuration-list" aria-label="行业配置列表">
              {state.domainProfiles.map((domainProfile) => {
                const current = state.currentDomainProfileId === domainProfile.id;
                return (
                  <li className="service-configuration-card" key={domainProfile.id}>
                    <div>
                      <h3>{domainProfile.name}</h3>
                      <p>{domainProfile.field || "未填写行业领域"}</p>
                      {current && <strong>当前使用</strong>}
                    </div>
                    <div className="compact-actions">
                      {!current && (
                        <button
                          type="button"
                          aria-label={`设为当前 ${domainProfile.name}`}
                          onClick={() =>
                            void run(
                              () => runtime.setCurrentDomainProfile(domainProfile.id),
                              `已选择行业配置“${domainProfile.name}”。`,
                            )
                          }
                        >
                          设为当前
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`编辑行业配置 ${domainProfile.name}`}
                        onClick={() => setEditingProfile(structuredClone(domainProfile))}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        aria-label={`删除行业配置 ${domainProfile.name}`}
                        onClick={(event) => {
                          deleteTrigger.current = event.currentTarget;
                          setPendingDeletion({
                            kind: "domainProfile",
                            id: domainProfile.id,
                            name: domainProfile.name,
                          });
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {editingProfile && (
            <div className="configuration-card terminology-editor">
              <h3>{editingProfile.id ? "编辑行业配置" : "新增行业配置"}</h3>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    () =>
                      runtime.saveDomainProfile({
                        ...editingProfile,
                        preserveRules: lines(listText(editingProfile.preserveRules)),
                      }),
                    "行业配置已保存。",
                  ).then((saved) => {
                    if (saved) setEditingProfile(null);
                  });
                }}
              >
                {[
                  ["profile-name", "行业配置名称", "name"],
                  ["profile-field", "行业领域", "field"],
                  ["profile-document-type", "文档类型", "documentType"],
                  ["profile-audience", "目标读者", "audience"],
                  ["profile-style", "文体和语气", "style"],
                ].map(([id, label, field]) => (
                  <label htmlFor={id} key={id}>
                    {label}
                    <input
                      id={id}
                      value={(editingProfile[field as keyof DomainProfile] as string | null) ?? ""}
                      onChange={(event) =>
                        mutateProfile({ [field]: event.target.value || null })
                      }
                    />
                  </label>
                ))}
                <fieldset>
                  <legend>关联术语库</legend>
                  {state.termbases.length === 0 ? (
                    <p>请先创建术语库。</p>
                  ) : (
                    state.termbases.map((termbase) => (
                      <label className="checkbox-label" key={termbase.id}>
                        <input
                          type="checkbox"
                          aria-label={`关联术语库 ${termbase.name}`}
                          checked={editingProfile.termbaseIds.includes(termbase.id)}
                          onChange={(event) =>
                            mutateProfile({
                              termbaseIds: event.target.checked
                                ? [...editingProfile.termbaseIds, termbase.id]
                                : editingProfile.termbaseIds.filter((id) => id !== termbase.id),
                            })
                          }
                        />
                        {termbase.name}
                      </label>
                    ))
                  )}
                </fieldset>
                <label htmlFor="profile-preserve-rules">保留规则（每行一项）</label>
                <textarea
                  id="profile-preserve-rules"
                  value={listText(editingProfile.preserveRules)}
                  onChange={(event) =>
                    mutateProfile({ preserveRules: editingLines(event.target.value) })
                  }
                />
                <div className="dialog-actions">
                  <button type="button" onClick={() => setEditingProfile(null)}>
                    取消
                  </button>
                  <button type="submit">保存行业配置</button>
                </div>
              </form>
            </div>
          )}

          <div className="settings-heading-row">
            <div>
              <h3>参考译例</h3>
              <p>参考译例必须由你明确保存，并与一个行业配置及语言方向关联。</p>
            </div>
            <button
              type="button"
              disabled={state.domainProfiles.length === 0}
              onClick={() =>
                setEditingReference(
                  emptyReferenceTranslation(
                    state.currentDomainProfileId ?? state.domainProfiles[0]?.id ?? "",
                  ),
                )
              }
            >
              新增参考译例
            </button>
          </div>
          {state.referenceTranslations.length === 0 ? (
            <p>还没有参考译例。</p>
          ) : (
            <ul className="service-configuration-list" aria-label="参考译例列表">
              {state.referenceTranslations.map((reference) => {
                const profileName =
                  state.domainProfiles.find((profile) => profile.id === reference.domainProfileId)
                    ?.name ?? "已删除的行业配置";
                return (
                  <li className="service-configuration-card" key={reference.id}>
                    <div>
                      <h4>{reference.source}</h4>
                      <p>{reference.translation}</p>
                      <p>
                        {profileName} · {reference.sourceLanguage} → {reference.targetLanguage}
                      </p>
                    </div>
                    <div className="compact-actions">
                      <button
                        type="button"
                        aria-label={`编辑参考译例 ${reference.source}`}
                        onClick={() => setEditingReference(structuredClone(reference))}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        aria-label={`删除参考译例 ${reference.source}`}
                        onClick={(event) => {
                          deleteTrigger.current = event.currentTarget;
                          setPendingDeletion({
                            kind: "referenceTranslation",
                            id: reference.id,
                            name: reference.source,
                          });
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {editingReference && (
            <div className="configuration-card terminology-editor">
              <h3>{editingReference.id ? "编辑参考译例" : "新增参考译例"}</h3>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    () => runtime.saveReferenceTranslation(editingReference),
                    "参考译例已保存。",
                  ).then((saved) => {
                    if (saved) setEditingReference(null);
                  });
                }}
              >
                <label htmlFor="reference-domain-profile">关联行业配置</label>
                <select
                  id="reference-domain-profile"
                  value={editingReference.domainProfileId}
                  onChange={(event) =>
                    mutateReference({ domainProfileId: event.target.value })
                  }
                >
                  {state.domainProfiles.map((profile) => (
                    <option value={profile.id} key={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
                <label htmlFor="reference-source-language">参考源语言</label>
                <input
                  id="reference-source-language"
                  value={editingReference.sourceLanguage}
                  onChange={(event) =>
                    mutateReference({ sourceLanguage: event.target.value })
                  }
                />
                <label htmlFor="reference-target-language">参考目标语言</label>
                <input
                  id="reference-target-language"
                  value={editingReference.targetLanguage}
                  onChange={(event) =>
                    mutateReference({ targetLanguage: event.target.value })
                  }
                />
                <label htmlFor="reference-source">参考源文本</label>
                <textarea
                  id="reference-source"
                  value={editingReference.source}
                  onChange={(event) => mutateReference({ source: event.target.value })}
                />
                <label htmlFor="reference-translation">参考译文</label>
                <textarea
                  id="reference-translation"
                  value={editingReference.translation}
                  onChange={(event) => mutateReference({ translation: event.target.value })}
                />
                <div className="dialog-actions">
                  <button type="button" onClick={() => setEditingReference(null)}>
                    取消
                  </button>
                  <button type="submit">保存参考译例</button>
                </div>
              </form>
            </div>
          )}

          {csvPreview && (
            <section
              ref={csvPreviewDialog}
              className="configuration-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="csv-preview-heading"
              aria-describedby="csv-preview-description"
            >
              <h3 id="csv-preview-heading">预览术语 CSV 导入</h3>
              <p id="csv-preview-description">
                将导入到“{csvPreview.termbaseName}”：{csvPreview.rowCount} 条可导入记录
              </p>
              <h4>字段映射</h4>
              <div className="csv-field-mapping">
                {[...csvPreview.requiredFields, ...csvPreview.optionalFields].map((field) => (
                  <label key={field}>
                    {field}
                    {csvPreview.requiredFields.includes(field) ? "（必填）" : "（可选）"}
                    <select
                      aria-label={`CSV 字段 ${field}`}
                      value={csvPreview.fieldMapping[field] ?? ""}
                      onChange={(event) => void remapCsv(field, event.target.value)}
                    >
                      <option value="">未映射</option>
                      {csvPreview.columns.map((column) => (
                        <option value={column} key={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {csvPreview.issues.length > 0 ? (
                <>
                  <h4>发现的问题</h4>
                  <ul aria-label="CSV 导入问题">
                    {csvPreview.issues.map((issue, index) => (
                      <li key={`${issue.row}:${issue.field ?? "row"}:${index}`}>
                        第 {issue.row} 行{issue.field ? ` · ${issue.field}` : ""}：
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p role="status">未发现重复、冲突、语言方向或字段错误。</p>
              )}
              <div className="dialog-actions">
                <button ref={csvCancel} type="button" onClick={cancelCsvPreview}>
                  取消导入
                </button>
                <button
                  type="button"
                  disabled={!csvPreview.canImport || !csvPreview.previewToken}
                  onClick={() => {
                    if (!csvPreview.previewToken) return;
                    const previewToken = csvPreview.previewToken;
                    void run(
                      () => runtime.commitTermbaseCsv(previewToken),
                      `已将 CSV 整体导入“${csvPreview.termbaseName}”。`,
                    ).then((imported) => {
                      if (imported) setCsvPreview(null);
                    });
                  }}
                >
                  确认整体导入
                </button>
              </div>
            </section>
          )}
          {pendingDeletion && (
            <section
              ref={deleteDialog}
              className="configuration-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="terminology-delete-heading"
              aria-describedby="terminology-delete-description"
            >
              <h3 id="terminology-delete-heading">
                {pendingDeletion.kind === "termbase"
                  ? "确认删除术语库"
                  : pendingDeletion.kind === "domainProfile"
                    ? "确认删除行业配置"
                    : "确认删除参考译例"}
              </h3>
              <p id="terminology-delete-description">
                删除“{pendingDeletion.name}”后无法撤销。
                {pendingDeletion.kind === "termbase"
                  ? "引用它的行业配置也会解除关联。"
                  : pendingDeletion.kind === "domainProfile"
                    ? "与它关联的参考译例也会一并删除。"
                    : ""}
              </p>
              <div className="dialog-actions">
                <button ref={deleteCancel} type="button" onClick={cancelDeletion}>
                  取消删除
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const deletion = pendingDeletion;
                    void run(
                      () =>
                        deletion.kind === "termbase"
                          ? runtime.deleteTermbase(deletion.id)
                          : deletion.kind === "domainProfile"
                            ? runtime.deleteDomainProfile(deletion.id)
                            : runtime.deleteReferenceTranslation(deletion.id),
                      deletion.kind === "termbase"
                        ? `已删除术语库“${deletion.name}”。`
                        : deletion.kind === "domainProfile"
                          ? `已删除行业配置“${deletion.name}”。`
                          : "已删除参考译例。",
                    ).then((deleted) => {
                      if (deleted) setPendingDeletion(null);
                    });
                  }}
                >
                  确认删除
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
