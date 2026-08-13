import { useEffect, useRef, useState } from "react";

import type {
  RuyiRuntimeBridge,
  ServiceConfigurationInput,
  ServiceConfigurationsState,
} from "../runtime/contracts";
import { TerminologySettingsSection } from "./TerminologySettingsSection";

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
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState("");
  const [terminologyRevision, setTerminologyRevision] = useState(0);
  const operationSequence = useRef(0);
  const activeOperations = useRef(new Set<string>());
  const deleteDialogCancelButton = useRef<HTMLButtonElement>(null);
  const deleteDialogTrigger = useRef<HTMLButtonElement | null>(null);
  const resetDialogCancelButton = useRef<HTMLButtonElement>(null);
  const resetDialogTrigger = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    if (!resetDialogOpen) return;
    resetDialogCancelButton.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || resetting) return;
      event.preventDefault();
      setResetDialogOpen(false);
      resetDialogTrigger.current?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [resetDialogOpen, resetting]);

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

  async function resetAllSettings() {
    setResetting(true);
    setError("");
    setResetMessage("");
    try {
      if (!runtime.resetAllSettings) {
        throw new Error("当前插件版本不支持恢复所有设置，请更新后重试。");
      }
      cancelActiveServiceOperations();
      const next = await runtime.resetAllSettings(true);
      setState(next);
      setEditing(null);
      setPendingDeleteId(null);
      setResetDialogOpen(false);
      resetDialogTrigger.current?.focus();
      setTerminologyRevision((revision) => revision + 1);
      setResetMessage(
        "已恢复所有设置，已重新建立空密钥 DeepSeek Flash 预设，请重新编辑 API Key。",
      );
    } catch (resetError) {
      setError(safeErrorMessage(resetError));
    } finally {
      setResetting(false);
    }
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
            disabled={Boolean(state?.storageIssue)}
            type="button"
            onClick={() => startNewConfiguration(emptyCustomConfiguration())}
          >
            新增配置
          </button>
        </div>

        {error && <p role="alert">{error}</p>}
        {state?.storageIssue && <p role="alert">{state.storageIssue.message}</p>}
        {!state && !error && <p role="status">正在读取服务配置…</p>}
        {state && state.serviceConfigurations.length === 0 && (
          <div className="configuration-card first-configuration-card">
            <h3>首次配置</h3>
            <p>
              当前没有可用服务配置。你可以重新添加 DeepSeek 官方配置，也可以新增自定义服务。
            </p>
            <div className="compact-actions">
              <button
                disabled={Boolean(state.storageIssue)}
                type="button"
                onClick={() => startNewConfiguration(emptyOfficialConfiguration())}
              >
                添加 DeepSeek 官方配置
              </button>
              <button
                disabled={Boolean(state.storageIssue)}
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
                    {configuration.disabled && (
                      <p role="alert">{configuration.migrationError}</p>
                    )}
                    <p>
                      {configuration.authentication === "none"
                        ? "不鉴权"
                        : configuration.maskedApiKey ?? "未配置 API Key"}
                    </p>
                    {configuration.performanceSummary ? (
                      <p className="service-performance-summary">
                        {configuration.performanceSummary.sampleCount} 次本地样本；平均首段输出
                        {" "}
                        {(configuration.performanceSummary.averageFirstOutputMilliseconds / 1_000).toFixed(1)}
                        {" 秒，平均完成 "}
                        {(configuration.performanceSummary.averageCompletionMilliseconds / 1_000).toFixed(1)}
                        {" 秒，平均 "}
                        {configuration.performanceSummary.averageOutputCodePointsPerSecond.toFixed(1)}
                        {" 码点/秒。"}
                      </p>
                    ) : (
                      <p className="service-performance-summary">暂无本地性能样本。</p>
                    )}
                    {current && !configuration.disabled && <strong>当前使用</strong>}
                  </div>
                  <div className="compact-actions">
                    {!current && (
                      <button
                        aria-label={`设为当前 ${configuration.name}`}
                        type="button"
                        disabled={configuration.disabled}
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
                      aria-label={`${configuration.disabled ? "重新编辑" : "编辑"} ${configuration.name}`}
                      disabled={configuration.disabled && !configuration.repairable}
                      type="button"
                      onClick={() => edit(configuration.id)}
                    >
                      {configuration.disabled ? "重新编辑" : "编辑"}
                    </button>
                    <button
                      aria-label={`复制 ${configuration.name}`}
                      type="button"
                      disabled={configuration.disabled}
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
                      disabled={configuration.disabled || index === 0}
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
                      disabled={
                        configuration.disabled ||
                        index === state.serviceConfigurations.length - 1
                      }
                      onClick={() =>
                        void runMutation(() =>
                          runtime.moveServiceConfiguration(configuration.id, "down"),
                        )
                      }
                    >
                      下移
                    </button>
                    <button
                      aria-label={`清除 ${configuration.name} 的性能数据`}
                      type="button"
                      disabled={
                        configuration.disabled || !configuration.performanceSummary
                      }
                      onClick={() =>
                        void runMutation(() =>
                          runtime.clearServicePerformanceData(configuration.id),
                        )
                      }
                    >
                      清除性能数据
                    </button>
                    <button
                      aria-label={`删除 ${configuration.name}`}
                      disabled={configuration.disabled}
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
            {editing.id
              ? state?.serviceConfigurations.find(
                    (configuration) => configuration.id === editing.id,
                  )?.disabled
                ? "重新编辑服务配置"
                : "编辑服务配置"
              : "新增服务配置"}
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
        aria-labelledby="background-notifications-heading"
        className="configuration-card"
      >
        <h2 id="background-notifications-heading">后台翻译与通知</h2>
        <label className="checkbox-label">
          <input
            checked={state?.backgroundNotificationsEnabled !== false}
            disabled={!state || Boolean(state.storageIssue)}
            type="checkbox"
            onChange={(event) =>
              void runMutation(() =>
                runtime.setBackgroundNotificationsEnabled!(event.target.checked),
              )
            }
          />
          后台翻译完成后显示系统通知
        </label>
        <p>
          普通隐藏插件时，当前请求会在插件进程仍然存活的前提下尽力继续，无数据超时和十分钟总时限仍然生效。通知只显示完成、失败或超时等通用状态；点击通知会返回当前翻译，不会自动复制或粘贴。
        </p>
        <p>
          后台继续和系统通知都不保证必定完成或送达。断网、退出 uTools、结束插件进程、系统休眠、强制终止或更新插件都可能中断请求；使用“清空当前内容”会主动取消当前请求。
        </p>
      </section>

      <TerminologySettingsSection key={terminologyRevision} runtime={runtime} />

      <section
        aria-labelledby="privacy-notice-heading"
        className="configuration-card privacy-notice"
      >
        <h2 id="privacy-notice-heading">隐私与数据说明</h2>
        <p>
          插件没有自有中转服务，而是使用你选择的服务配置直接连接模型服务。翻译时，源文本、命中术语、选中的参考译例、行业配置和附加要求会离开设备；精译模式会向同一服务发起多次调用。服务可用性、数据处理与保留、费用和限流由相应服务提供方决定。
        </p>
        <p>
          API Key 使用 uTools 的 dbCryptoStorage 在本机加密保存，页面不会回填完整密钥，但客户端密钥仍可能被本机高权限程序或调试手段提取。
        </p>
        <p>
          服务配置名称、地址、协议、模型、模型列表缓存、默认目标语言、默认质量模式和默认附加要求保存在本地数据库中；API Key、术语库、行业配置和参考译例使用 dbCryptoStorage 加密存储。uTools 没有保证加密存储一定排除数据同步，开启同步后，这些数据可能形成远端或其他设备副本。
        </p>
        <p>
          最近请求的汇总性能数据只记录首个输出时间、完成耗时、输出码点数、平均速度、翻译方式和分段数，不含源文本、译文、用户标识或单次请求日志，也不会发送给模型服务。它只用于等待提示，可在每项配置中清除；若已开启上述同步功能，仍可能形成同步副本。
        </p>
        <p>
          当前翻译只保留在插件进程内存中，不写入本地数据库、文件或日志；结束进程后无法恢复。可用每项配置的“删除”按钮删除该配置、API Key 和模型列表缓存，也可在编辑配置时单独“删除 API Key”。已同步的副本仍需在 uTools 的同步数据管理中另行处理。删除本地数据不能删除模型服务已经保留的请求内容，也不能保证删除 uTools 已同步到远端或其他设备的副本。
        </p>
      </section>

      <section aria-labelledby="data-management-heading" className="configuration-card">
        <h2 id="data-management-heading">数据管理</h2>
        <p>
          恢复所有设置会取消当前任务，并删除插件能够控制的本地配置与加密数据。此操作不可撤销。
        </p>
        {resetMessage && <p role="status">{resetMessage}</p>}
        <button
          ref={resetDialogTrigger}
          type="button"
          onClick={() => {
            setResetMessage("");
            setResetDialogOpen(true);
          }}
        >
          恢复所有设置
        </button>
      </section>

      {pendingDelete && (
        <section
          aria-labelledby="delete-configuration-heading"
          aria-modal="true"
          className="confirmation-card"
          role="dialog"
        >
          <h2 id="delete-configuration-heading">确认删除服务配置</h2>
          <p>将删除“{pendingDelete.name}”及其 API Key、模型列表缓存和性能数据。</p>
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
      {resetDialogOpen && (
        <section
          aria-labelledby="reset-all-settings-heading"
          aria-modal="true"
          className="confirmation-card"
          role="dialog"
        >
          <h2 id="reset-all-settings-heading">确认恢复所有设置</h2>
          <p>
            此操作会删除所有服务配置和 API Key、模型列表缓存、连接确认、性能数据、通知和默认设置、术语库、行业配置和参考译例，并清除当前翻译、取消在途任务。
          </p>
          <p>
            完成后只会重新建立一个未配置 API Key 的 DeepSeek Flash 预设。此操作不能保证删除 uTools 已同步到远端或其他设备的副本，也不能删除模型服务已经保留的数据。
          </p>
          <div className="dialog-actions">
            <button
              aria-label="取消恢复"
              disabled={resetting}
              ref={resetDialogCancelButton}
              type="button"
              onClick={() => {
                setResetDialogOpen(false);
                resetDialogTrigger.current?.focus();
              }}
            >
              取消
            </button>
            <button
              disabled={resetting}
              type="button"
              onClick={() => void resetAllSettings()}
            >
              {resetting ? "正在恢复…" : "确认恢复并删除"}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
