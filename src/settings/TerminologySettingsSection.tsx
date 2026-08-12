import { useEffect, useRef, useState } from "react";

import type {
  DomainProfile,
  RuyiRuntimeBridge,
  Termbase,
  TermEntry,
  TerminologyState,
} from "../runtime/contracts";

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
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pendingDeletion, setPendingDeletion] = useState<{
    kind: "termbase" | "domainProfile";
    id: string;
    name: string;
  } | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const deleteCancel = useRef<HTMLButtonElement | null>(null);
  const restoreDeleteFocus = useRef(false);

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
    if (pendingDeletion) {
      deleteCancel.current?.focus();
    } else if (restoreDeleteFocus.current) {
      restoreDeleteFocus.current = false;
      deleteTrigger.current?.focus();
    }
  }, [pendingDeletion]);

  function cancelDeletion() {
    restoreDeleteFocus.current = true;
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

  return (
    <section aria-labelledby="terminology-settings-heading">
      <div className="settings-heading-row">
        <div>
          <h2 id="terminology-settings-heading">术语库与行业配置</h2>
          <p>只会把当前源文本实际命中的术语发送给模型。</p>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {!state && !error && <p role="status">正在读取术语配置…</p>}

      {state && (
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
          {pendingDeletion && (
            <section
              className="configuration-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="terminology-delete-heading"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelDeletion();
                }
              }}
            >
              <h3 id="terminology-delete-heading">
                {pendingDeletion.kind === "termbase"
                  ? "确认删除术语库"
                  : "确认删除行业配置"}
              </h3>
              <p>
                删除“{pendingDeletion.name}”后无法撤销。
                {pendingDeletion.kind === "termbase"
                  ? "引用它的行业配置也会解除关联。"
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
                          : runtime.deleteDomainProfile(deletion.id),
                      deletion.kind === "termbase"
                        ? `已删除术语库“${deletion.name}”。`
                        : `已删除行业配置“${deletion.name}”。`,
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
