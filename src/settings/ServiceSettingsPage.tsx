import { useEffect, useRef, useState } from "react";

import type {
  RuyiRuntimeBridge,
  ServiceConfigurationInput,
  ServiceConfigurationsState,
} from "../runtime/contracts";

const OFFICIAL_TRANSLATION_URL = "https://api.deepseek.com/chat/completions";
const OFFICIAL_MODEL_LIST_URL = "https://api.deepseek.com/models";

const emptyCustomConfiguration = (): ServiceConfigurationInput => ({
  id: null,
  name: "",
  type: "custom",
  protocol: "chat-completions",
  translationUrl: "",
  modelListUrl: "",
  authentication: "bearer",
  model: "",
  stream: true,
});

const emptyOfficialConfiguration = (): ServiceConfigurationInput => ({
  id: null,
  name: "DeepSeek Flash",
  type: "deepseek-official",
  protocol: "chat-completions",
  translationUrl: OFFICIAL_TRANSLATION_URL,
  modelListUrl: OFFICIAL_MODEL_LIST_URL,
  authentication: "bearer",
  model: "deepseek-v4-flash",
  stream: true,
});

function editableConfiguration(
  configuration: ServiceConfigurationsState["serviceConfigurations"][number],
): ServiceConfigurationInput {
  return {
    id: configuration.id,
    name: configuration.name,
    type: configuration.type,
    protocol: configuration.protocol,
    translationUrl: configuration.translationUrl,
    modelListUrl: configuration.modelListUrl,
    authentication: configuration.authentication,
    model: configuration.model,
    stream: configuration.stream,
  };
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "服务配置操作失败。";
}

export function ServiceSettingsPage({ runtime }: { runtime: RuyiRuntimeBridge }) {
  const [state, setState] = useState<ServiceConfigurationsState | null>(null);
  const [editing, setEditing] = useState<ServiceConfigurationInput | null>(null);
  const [error, setError] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [modelMessage, setModelMessage] = useState("");
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [connectionOperationId, setConnectionOperationId] = useState<string | null>(null);
  const [modelOperationId, setModelOperationId] = useState<string | null>(null);
  const operationSequence = useRef(0);
  const activeOperations = useRef(new Set<string>());
  const deleteDialogCancelButton = useRef<HTMLButtonElement>(null);
  const deleteDialogTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let mounted = true;
    void runtime
      .getServiceConfigurations()
      .then((next) => {
        if (mounted) setState(next);
      })
      .catch((loadError) => {
        if (mounted) setError(safeErrorMessage(loadError));
      });
    return () => {
      mounted = false;
      for (const operationId of activeOperations.current) {
        runtime.cancelServiceOperation(operationId);
      }
      activeOperations.current.clear();
    };
  }, [runtime]);

  useEffect(() => {
    if (!pendingDeleteId) return;
    deleteDialogCancelButton.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPendingDeleteId(null);
      deleteDialogTrigger.current?.focus();
      deleteDialogTrigger.current = null;
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [pendingDeleteId]);

  function nextOperationId(kind: "connection" | "models") {
    operationSequence.current += 1;
    return `${kind}-${operationSequence.current}`;
  }

  function cancelActiveServiceOperations() {
    for (const operationId of activeOperations.current) {
      runtime.cancelServiceOperation(operationId);
    }
    activeOperations.current.clear();
    setConnectionOperationId(null);
    setModelOperationId(null);
  }

  function closeEditor() {
    cancelActiveServiceOperations();
    setEditing(null);
    setFetchedModels([]);
    setConnectionMessage("");
    setModelMessage("");
  }

  function closeDeleteDialog() {
    setPendingDeleteId(null);
    deleteDialogTrigger.current?.focus();
    deleteDialogTrigger.current = null;
  }

  function cancelPendingOperation(
    operationId: string,
    kind: "connection" | "models",
  ) {
    runtime.cancelServiceOperation(operationId);
    activeOperations.current.delete(operationId);
    if (kind === "connection") {
      setConnectionOperationId(null);
    } else {
      setModelOperationId(null);
    }
  }

  function applyState(next: ServiceConfigurationsState) {
    setState(next);
    if (editing?.id) {
      const latest = next.serviceConfigurations.find(
        (configuration) => configuration.id === editing.id,
      );
      if (latest) {
        setEditing(editableConfiguration(latest));
      } else {
        closeEditor();
      }
    }
  }

  async function runMutation(
    mutation: () => Promise<ServiceConfigurationsState>,
  ) {
    setError("");
    try {
      applyState(await mutation());
    } catch (mutationError) {
      setError(safeErrorMessage(mutationError));
    }
  }

  function edit(configurationId: string) {
    const configuration = state?.serviceConfigurations.find(
      (candidate) => candidate.id === configurationId,
    );
    if (!configuration) return;
    cancelActiveServiceOperations();
    setEditing(editableConfiguration(configuration));
    setFetchedModels(configuration.cachedModels);
    setConnectionMessage("");
    setModelMessage("");
    setError("");
  }

  function startNewConfiguration(input: ServiceConfigurationInput) {
    cancelActiveServiceOperations();
    setEditing(input);
    setFetchedModels([]);
    setConnectionMessage("");
    setModelMessage("");
    setError("");
  }

  function updateEditing(patch: Partial<ServiceConfigurationInput>) {
    setEditing((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      if (patch.type === "deepseek-official") {
        return {
          ...next,
          protocol: "chat-completions",
          translationUrl: OFFICIAL_TRANSLATION_URL,
          modelListUrl: OFFICIAL_MODEL_LIST_URL,
          authentication: "bearer",
        };
      }
      return next;
    });
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = event.currentTarget;
    setError("");
    try {
      const next = await runtime.saveServiceConfiguration(editing, form);
      setState(next);
      closeEditor();
    } catch (saveError) {
      setError(safeErrorMessage(saveError));
    }
  }

  async function testConnection() {
    if (!editing?.id || connectionOperationId) return;
    const configurationId = editing.id;
    const operationId = nextOperationId("connection");
    activeOperations.current.add(operationId);
    setConnectionOperationId(operationId);
    setConnectionMessage("");
    const result = await runtime.testServiceConnection({
      operationId,
      configurationId,
    });
    if (!activeOperations.current.delete(operationId)) return;
    setConnectionOperationId(null);
    setConnectionMessage(
      result.status === "completed" ? "连接测试成功。" : result.error.message,
    );
  }

  async function fetchModels() {
    if (!editing?.id || modelOperationId) return;
    const configurationId = editing.id;
    const operationId = nextOperationId("models");
    activeOperations.current.add(operationId);
    setModelOperationId(operationId);
    setModelMessage("");
    const result = await runtime.fetchServiceModels({
      operationId,
      configurationId,
    });
    if (!activeOperations.current.delete(operationId)) return;
    setModelOperationId(null);
    if (result.status === "failed") {
      setModelMessage(result.error.message);
      return;
    }
    setFetchedModels(result.models);
    if (result.models.length === 0) {
      setModelMessage("服务没有返回可用模型，仍可手填模型并保存。");
    } else if (!result.currentModelPresent) {
      setModelMessage("模型列表不含当前手填模型，仍可保存并用于翻译。");
    } else {
      setModelMessage(`已获取 ${result.models.length} 个模型。`);
    }
    setState((current) =>
      current
        ? {
            ...current,
            serviceConfigurations: current.serviceConfigurations.map((configuration) =>
              configuration.id === configurationId
                ? {
                    ...configuration,
                    cachedModels: [...result.models],
                    modelsFetchedAt: result.fetchedAt,
                  }
                : configuration,
            ),
          }
        : current,
    );
  }

  const pendingDelete = state?.serviceConfigurations.find(
    (configuration) => configuration.id === pendingDeleteId,
  );

  return (
    <main className="app-shell settings-page">
      <h1>设置</h1>
      <section aria-labelledby="service-configurations-heading">
        <div className="settings-heading-row">
          <div>
            <h2 id="service-configurations-heading">服务配置</h2>
            <p>每项配置绑定一个模型。模型列表只会在你点击获取时联网。</p>
          </div>
          <button
            type="button"
            onClick={() => startNewConfiguration(emptyCustomConfiguration())}
          >
            新增配置
          </button>
        </div>

        {error && <p role="alert">{error}</p>}
        {!state && !error && <p role="status">正在读取服务配置…</p>}
        {state && state.serviceConfigurations.length === 0 && (
          <div className="configuration-card first-configuration-card">
            <h3>首次配置</h3>
            <p>
              当前没有可用服务配置。你可以重新添加 DeepSeek 官方配置，也可以新增自定义服务。
            </p>
            <div className="compact-actions">
              <button
                type="button"
                onClick={() => startNewConfiguration(emptyOfficialConfiguration())}
              >
                添加 DeepSeek 官方配置
              </button>
              <button
                type="button"
                onClick={() => startNewConfiguration(emptyCustomConfiguration())}
              >
                添加自定义配置
              </button>
            </div>
          </div>
        )}
        {state && state.serviceConfigurations.length > 0 && (
          <ol className="service-configuration-list" aria-label="服务配置列表">
            {state.serviceConfigurations.map((configuration, index) => {
              const current = state.currentServiceConfigurationId === configuration.id;
              return (
                <li className="service-configuration-card" key={configuration.id}>
                  <div>
                    <h3>{configuration.name}</h3>
                    <p>
                      {configuration.protocol === "responses"
                        ? "Responses"
                        : "Chat Completions"}
                      {" · "}
                      {configuration.model}
                    </p>
                    <p>
                      {configuration.authentication === "none"
                        ? "不鉴权"
                        : configuration.maskedApiKey ?? "未配置 API Key"}
                    </p>
                    {current && <strong>当前使用</strong>}
                  </div>
                  <div className="compact-actions">
                    {!current && (
                      <button
                        aria-label={`设为当前 ${configuration.name}`}
                        type="button"
                        onClick={() =>
                          void runMutation(() =>
                            runtime.setCurrentServiceConfiguration(configuration.id),
                          )
                        }
                      >
                        设为当前
                      </button>
                    )}
                    <button
                      aria-label={`编辑 ${configuration.name}`}
                      type="button"
                      onClick={() => edit(configuration.id)}
                    >
                      编辑
                    </button>
                    <button
                      aria-label={`复制 ${configuration.name}`}
                      type="button"
                      onClick={() =>
                        void runMutation(() =>
                          runtime.duplicateServiceConfiguration(configuration.id),
                        )
                      }
                    >
                      复制
                    </button>
                    <button
                      aria-label={`上移 ${configuration.name}`}
                      type="button"
                      disabled={index === 0}
                      onClick={() =>
                        void runMutation(() =>
                          runtime.moveServiceConfiguration(configuration.id, "up"),
                        )
                      }
                    >
                      上移
                    </button>
                    <button
                      aria-label={`下移 ${configuration.name}`}
                      type="button"
                      disabled={index === state.serviceConfigurations.length - 1}
                      onClick={() =>
                        void runMutation(() =>
                          runtime.moveServiceConfiguration(configuration.id, "down"),
                        )
                      }
                    >
                      下移
                    </button>
                    <button
                      aria-label={`删除 ${configuration.name}`}
                      type="button"
                      onClick={(event) => {
                        deleteDialogTrigger.current = event.currentTarget;
                        setPendingDeleteId(configuration.id);
                      }}
                    >
                      删除
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {editing && (
        <section className="configuration-card" aria-labelledby="configuration-editor-heading">
          <h2 id="configuration-editor-heading">
            {editing.id ? "编辑服务配置" : "新增服务配置"}
          </h2>
          <form onSubmit={(event) => void save(event)}>
            <label htmlFor="configuration-name">配置名称</label>
            <input
              id="configuration-name"
              value={editing.name}
              onChange={(event) => updateEditing({ name: event.target.value })}
            />

            <label htmlFor="configuration-type">服务类型</label>
            <select
              id="configuration-type"
              disabled={editing.id !== null && editing.type === "deepseek-official"}
              value={editing.type}
              onChange={(event) =>
                updateEditing({
                  type: event.target.value as ServiceConfigurationInput["type"],
                })
              }
            >
              <option value="custom">自定义</option>
              <option value="deepseek-official">DeepSeek 官方</option>
            </select>

            <label htmlFor="configuration-protocol">协议</label>
            <select
              id="configuration-protocol"
              disabled={editing.type === "deepseek-official"}
              value={editing.protocol}
              onChange={(event) =>
                updateEditing({
                  protocol: event.target.value as ServiceConfigurationInput["protocol"],
                })
              }
            >
              <option value="chat-completions">Chat Completions</option>
              <option value="responses">Responses</option>
            </select>

            <label htmlFor="configuration-translation-url">翻译地址</label>
            <input
              id="configuration-translation-url"
              disabled={editing.type === "deepseek-official"}
              value={editing.translationUrl}
              onChange={(event) => updateEditing({ translationUrl: event.target.value })}
            />

            <label htmlFor="configuration-model-list-url">模型列表地址</label>
            <input
              id="configuration-model-list-url"
              disabled={editing.type === "deepseek-official"}
              value={editing.modelListUrl}
              onChange={(event) => updateEditing({ modelListUrl: event.target.value })}
            />

            <label htmlFor="configuration-authentication">鉴权方式</label>
            <select
              id="configuration-authentication"
              disabled={editing.type === "deepseek-official"}
              value={editing.authentication}
              onChange={(event) =>
                updateEditing({
                  authentication: event.target
                    .value as ServiceConfigurationInput["authentication"],
                })
              }
            >
              <option value="bearer">Bearer</option>
              <option value="none">不鉴权</option>
            </select>

            {editing.authentication === "bearer" && (
              <>
                <label htmlFor="configuration-api-key">API Key</label>
                <input
                  id="configuration-api-key"
                  name="apiKey"
                  type="password"
                  autoComplete="off"
                  placeholder="留空则沿用现有密钥"
                />
                {editing.id &&
                  state?.serviceConfigurations.find(
                    (configuration) => configuration.id === editing.id,
                  )?.maskedApiKey && (
                    <p>
                      当前密钥：
                      {
                        state.serviceConfigurations.find(
                          (configuration) => configuration.id === editing.id,
                        )?.maskedApiKey
                      }
                    </p>
                  )}
              </>
            )}

            <label htmlFor="configuration-model">模型 ID</label>
            <input
              id="configuration-model"
              value={editing.model}
              onChange={(event) => updateEditing({ model: event.target.value })}
            />
            {fetchedModels.length > 0 && (
              <>
                <label htmlFor="configuration-model-suggestion">模型列表建议</label>
                <select
                  id="configuration-model-suggestion"
                  value=""
                  onChange={(event) => {
                    if (event.target.value) updateEditing({ model: event.target.value });
                  }}
                >
                  <option value="">保留手填模型</option>
                  {fetchedModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </>
            )}

            <label className="checkbox-label">
              <input
                checked={editing.stream}
                type="checkbox"
                onChange={(event) => updateEditing({ stream: event.target.checked })}
              />
              流式响应
            </label>

            {editing.id && (
              <div className="service-request-tools">
                <p>连接测试只发送固定短文本，可能产生少量模型费用。</p>
                <div className="compact-actions">
                  <button
                    disabled={Boolean(connectionOperationId)}
                    type="button"
                    onClick={() => void testConnection()}
                  >
                    测试连接
                  </button>
                  {connectionOperationId && (
                    <button
                      type="button"
                      onClick={() =>
                        cancelPendingOperation(connectionOperationId, "connection")
                      }
                    >
                      取消连接测试
                    </button>
                  )}
                </div>
                {connectionMessage && <p role="status">{connectionMessage}</p>}
                <p>
                  获取前请确认模型列表地址：<span>{editing.modelListUrl}</span>
                </p>
                <div className="compact-actions">
                  <button
                    disabled={Boolean(modelOperationId)}
                    type="button"
                    onClick={() => void fetchModels()}
                  >
                    获取模型
                  </button>
                  {modelOperationId && (
                    <button
                      type="button"
                      onClick={() => cancelPendingOperation(modelOperationId, "models")}
                    >
                      取消获取模型
                    </button>
                  )}
                </div>
                {modelMessage && <p role="status">{modelMessage}</p>}
              </div>
            )}

            <div className="dialog-actions">
              <button type="button" onClick={closeEditor}>
                取消
              </button>
              <button type="submit">保存配置</button>
            </div>
          </form>
          {editing.id &&
            editing.authentication === "bearer" &&
            state?.serviceConfigurations.find(
              (configuration) => configuration.id === editing.id,
            )?.hasApiKey && (
              <button
                type="button"
                onClick={() =>
                  void runMutation(() => runtime.deleteServiceApiKey(editing.id!))
                }
              >
                删除 API Key
              </button>
            )}
        </section>
      )}

      <section
        aria-labelledby="privacy-notice-heading"
        className="configuration-card privacy-notice"
      >
        <h2 id="privacy-notice-heading">隐私与数据说明</h2>
        <p>
          插件使用你选择的服务配置直接连接模型服务。翻译时，源文本和本次任务资料会离开设备；服务可用性、数据保留、费用和限流由相应服务提供方决定。
        </p>
        <p>
          API Key 使用 uTools 的 dbCryptoStorage 在本机加密保存，页面不会回填完整密钥，但客户端密钥仍可能被本机高权限程序或调试手段提取。
        </p>
        <p>
          服务配置名称、地址、协议、模型和模型列表缓存在本地数据库中；API Key，以及今后启用的术语库、行业配置和参考译例，使用加密存储。开启 uTools 数据同步后，这些数据可能形成远端或其他设备副本。
        </p>
        <p>
          可用每项配置的“删除”按钮删除该配置、API Key 和模型列表缓存，也可在编辑配置时单独“删除 API Key”。已同步的副本还需在 uTools 的同步数据管理中处理；删除本地数据不能删除模型服务已经保留的请求内容。
        </p>
      </section>

      {pendingDelete && (
        <section
          aria-labelledby="delete-configuration-heading"
          aria-modal="true"
          className="confirmation-card"
          role="dialog"
        >
          <h2 id="delete-configuration-heading">确认删除服务配置</h2>
          <p>将删除“{pendingDelete.name}”及其 API Key 和模型列表缓存。</p>
          <div className="dialog-actions">
            <button
              aria-label="取消删除"
              ref={deleteDialogCancelButton}
              type="button"
              onClick={closeDeleteDialog}
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                const confirmCurrent =
                  state?.currentServiceConfigurationId === pendingDelete.id;
                setPendingDeleteId(null);
                deleteDialogTrigger.current = null;
                void runMutation(() =>
                  runtime.deleteServiceConfiguration(
                    pendingDelete.id,
                    Boolean(confirmCurrent),
                  ),
                );
              }}
            >
              确认删除
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
