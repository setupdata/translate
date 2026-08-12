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
  confirmationToken?: string;
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
  | { status: "completed"; taskId: string; translation: string }
  | {
      status: "failed";
      taskId: string;
      sourceRetained: true;
      partialTranslation?: string;
      error: {
        code: StableTranslationErrorCode;
        message: string;
        httpStatus?: number;
        requestId?: string;
      };
    };

export interface RuyiRuntimeBridge {
  getServiceConfiguration(): Promise<RuntimeConfigurationState>;
  saveApiKey(credentialForm: HTMLFormElement): Promise<RuntimeConfigurationState>;
  startStandardTranslation(
    request: StandardTranslationRequest,
    onProgress?: (event: TranslationProgressEvent) => void,
  ): Promise<StandardTranslationResult>;
  cancelTranslation(taskId: string): void;
}
