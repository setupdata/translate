export type TargetLanguage = {
  kind: "preset";
  id: string;
  displayName?: string;
  modelLabel: string;
};

export type ServiceConfigurationView = {
  id: string;
  name: string;
  type: "deepseek-official" | "custom";
  protocol: "chat-completions" | "responses";
  translationUrl: string;
  modelListUrl: string;
  authentication: "bearer";
  model: string;
  stream: boolean;
  hasApiKey: boolean;
  maskedApiKey: string | null;
};

export type RuntimeConfigurationState = {
  serviceConfiguration: ServiceConfigurationView | null;
  defaults: {
    targetLanguage: TargetLanguage & { displayName: string };
    qualityMode: "standard";
    additionalRequirements: string;
  };
};

export type StandardTranslationRequest = {
  taskId: string;
  sourceText: string;
  targetLanguage: TargetLanguage;
  serviceConfigurationId?: string | null;
  additionalRequirements?: string;
  taskTerms?: TaskTerm[];
  confirmationToken?: string;
};

export type TaskTerm = {
  sourceTerm: string;
  preferredTarget: string;
};

export type StableTranslationErrorCode =
  | "configuration_error"
  | "authentication_error"
  | "permission_error"
  | "request_rejected"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "tls_error"
  | "timeout"
  | "cancelled"
  | "response_too_large"
  | "protocol_error"
  | "content_rejected"
  | "unknown_error";

export type TranslationProgressEvent =
  | { type: "started"; taskId: string }
  | { type: "text_delta"; taskId: string; delta: string }
  | {
      type: "finished";
      taskId: string;
      status: "completed" | "failed" | "cancelled";
    };

export type TranslationQualityRisk = {
  id: string;
  code: string;
  category:
    | "protected_content"
    | "structure"
    | "output_contract"
    | "stream"
    | "terminology"
    | "fluency"
    | "other";
  severity: "critical" | "major" | "minor";
  certainty: "deterministic" | "heuristic";
  message: string;
};

export type TranslationQuality = {
  risks: TranslationQualityRisk[];
  pasteBlocked: boolean;
};

export type TranslationHostActionResult =
  | { status: "copied" | "pasted" }
  | { status: "confirmation_required" | "blocked" | "unavailable" };

export type StandardTranslationResult =
  | {
      status: "validation_error";
      reason:
        | "invalid_source_text"
        | "source_text_too_long"
        | "invalid_target_language"
        | "invalid_confirmation";
      sourceRetained: true;
    }
  | {
      status: "configuration_required";
      reason: "missing_api_key" | "missing_configuration";
      sourceRetained: true;
      serviceConfiguration: ServiceConfigurationView | null;
    }
  | {
      status: "confirmation_required";
      sourceRetained: true;
      confirmationToken: string;
      preview: {
        serviceName: string;
        normalizedTranslationUrl: string;
        protocol: "Chat Completions" | "Responses";
        model: string;
        dataSent: string[];
        callCount: 1;
      };
    }
  | {
      status: "completed";
      taskId: string;
      translation: string;
      quality: TranslationQuality;
    }
  | {
      status: "failed";
      taskId: string;
      sourceRetained: true;
      partialTranslation?: string;
      quality?: TranslationQuality;
      error: {
        code: StableTranslationErrorCode;
        message: string;
        httpStatus?: number;
        requestId?: string;
      };
    };

export type CurrentTranslationInputs = {
  sourceText: string;
  targetLanguage: TargetLanguage;
  serviceConfigurationId: string | null;
  qualityMode: "standard";
  additionalRequirements: string;
  taskTerms: TaskTerm[];
};

export type CurrentTranslationSnapshot = {
  revision: number;
  phase:
    | "editing"
    | "preparing"
    | "needs_configuration"
    | "awaiting_confirmation"
    | "translating"
    | "completed"
    | "failed";
  inputs: CurrentTranslationInputs;
  task: (CurrentTranslationInputs & { taskId: string }) | null;
  partialTranslation: string;
  result: StandardTranslationResult | null;
  stale: boolean;
};

export interface RuyiRuntimeBridge {
  getServiceConfiguration(): Promise<RuntimeConfigurationState>;
  saveApiKey(credentialForm: HTMLFormElement): Promise<RuntimeConfigurationState>;
  startStandardTranslation(
    request: StandardTranslationRequest,
    onProgress?: (event: TranslationProgressEvent) => void,
  ): Promise<StandardTranslationResult>;
  cancelTranslation(taskId: string): void;
  copyTranslation(taskId: string, confirmRisks?: boolean): TranslationHostActionResult;
  pasteTranslation(taskId: string, currentSourceText: string): TranslationHostActionResult;
  getCurrentTranslation(): CurrentTranslationSnapshot | null;
  updateCurrentTranslationInputs(
    inputs: CurrentTranslationInputs,
  ): CurrentTranslationSnapshot;
  subscribeCurrentTranslation(
    listener: (snapshot: CurrentTranslationSnapshot | null) => void,
  ): () => void;
  clearCurrentTranslation(): void;
}
