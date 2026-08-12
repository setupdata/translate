export type TargetLanguage = {
  kind: "preset";
  id: string;
  displayName?: string;
  modelLabel: string;
};

export type ServiceConfigurationView = {
  id: string;
  name: string;
  type: "deepseek-official";
  protocol: "chat-completions";
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

export type StandardTranslationResult =
  | {
      status: "validation_error";
      reason:
        | "invalid_source_text"
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
        protocol: "Chat Completions";
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
      error: { code: string; message: string };
    };

export interface RuyiRuntimeBridge {
  getServiceConfiguration(): Promise<RuntimeConfigurationState>;
  saveApiKey(credentialForm: HTMLFormElement): Promise<RuntimeConfigurationState>;
  startStandardTranslation(
    request: StandardTranslationRequest,
  ): Promise<StandardTranslationResult>;
  cancelTranslation(taskId: string): void;
}
