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
  authentication: "bearer" | "none";
  model: string;
  stream: boolean;
  hasApiKey: boolean;
  maskedApiKey: string | null;
  cachedModels: string[];
  modelsFetchedAt: string | null;
  performanceSummary: ServicePerformanceSummary | null;
  thinkingEnabled?: boolean;
};

export type TranslationQualityMode = "standard" | "precision";

export type ServicePerformanceSummary = {
  sampleCount: number;
  averageFirstOutputMilliseconds: number;
  averageCompletionMilliseconds: number;
  averageOutputCodePointsPerSecond: number;
};

export type ParallelAccelerationAdvice = {
  suggested: boolean;
  estimatedSeconds: number | null;
  reason: "no_samples_long_source" | "estimated_over_45_seconds" | null;
};

export type ServiceConfigurationInput = {
  id: string | null;
  name: string;
  type: "deepseek-official" | "custom";
  protocol: "chat-completions" | "responses";
  translationUrl: string;
  modelListUrl: string;
  authentication: "bearer" | "none";
  model: string;
  stream: boolean;
};

export type ServiceConfigurationsState = {
  currentServiceConfigurationId: string | null;
  serviceConfigurations: ServiceConfigurationView[];
  backgroundNotificationsEnabled?: boolean;
};

export type RuntimeConfigurationState = {
  serviceConfiguration: ServiceConfigurationView | null;
  defaults: {
    targetLanguage: TargetLanguage & { displayName: string };
    qualityMode: TranslationQualityMode;
    additionalRequirements: string;
    backgroundNotificationsEnabled?: boolean;
  };
};

export type StandardTranslationRequest = {
  taskId: string;
  sourceText: string;
  targetLanguage: TargetLanguage;
  serviceConfigurationId?: string | null;
  domainProfileId?: string | null;
  additionalRequirements?: string;
  taskTerms?: TaskTerm[];
  referenceTranslationIds?: string[] | null;
  referencePreviewToken?: string;
  confirmationToken?: string;
  parallelAcceleration?: boolean;
  parallelConcurrency?: number;
  qualityMode?: TranslationQualityMode;
  thinkingEnabled?: boolean;
};

export type TranslationCallPlan = {
  qualityMode: TranslationQualityMode;
  translationCalls: number;
  maximumCallCount: number;
  segmentCount: number;
  analysisCalls?: number;
  reviewCalls?: number;
  maximumRevisionCalls?: number;
};

export type PrecisionCallPlan = {
  analysisCalls: 1;
  translationCalls: number;
  reviewCalls: 2;
  maximumRevisionCalls: 1;
  maximumCallCount: number;
  segmentCount: number;
};

export type TaskTerm = {
  sourceTerm: string;
  preferredTarget: string;
};

export type TermStrictness = "preferred" | "exact";

export type TermEntry = {
  id: string | null;
  sourceTerm: string;
  preferredTarget: string;
  sourceLanguage: string;
  targetLanguage: string;
  allowedVariants: string[];
  forbiddenTargets: string[];
  meaning: string | null;
  strictness: TermStrictness;
  caseSensitive: boolean;
  aliases: string[];
  priority: number;
};

export type Termbase = {
  id: string | null;
  name: string;
  enabled: boolean;
  entries: TermEntry[];
};

export type DomainProfile = {
  id: string | null;
  version: string;
  name: string;
  field: string | null;
  documentType: string | null;
  audience: string | null;
  style: string | null;
  termbaseIds: string[];
  preserveRules: string[];
};

export type ReferenceTranslation = {
  id: string | null;
  sourceLanguage: string;
  targetLanguage: string;
  domainProfileId: string;
  source: string;
  translation: string;
};

export type TerminologyState = {
  termbases: Array<Termbase & { id: string }>;
  domainProfiles: Array<DomainProfile & { id: string }>;
  referenceTranslations: Array<ReferenceTranslation & { id: string }>;
  currentDomainProfileId: string | null;
};

export type TermbaseCsvIssue = {
  code:
    | "fatal_format"
    | "mapping"
    | "duplicate"
    | "conflict"
    | "language_direction"
    | "invalid_row";
  severity: "error";
  row: number;
  field?: string;
  message: string;
};

export type TermbaseCsvPreview = {
  previewToken: string | null;
  columns: string[];
  requiredFields: string[];
  optionalFields: string[];
  fieldMapping: Record<string, string | null>;
  issues: TermbaseCsvIssue[];
  rowCount: number;
  canImport: boolean;
};

export type TermbaseCsvExport = {
  fileName: string;
  bytes: Uint8Array;
};

export type TerminologyConflict = {
  source: string;
  choices: Array<{
    termId: string;
    preferredTarget: string;
    origin: "task" | "domain" | "general";
  }>;
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

export type ServiceOperationError = {
  code: StableTranslationErrorCode;
  message: string;
  httpStatus?: number;
  requestId?: string;
};

export type ServiceConnectionResult =
  | { status: "completed" }
  | { status: "failed"; error: ServiceOperationError };

export type ModelListResult =
  | {
      status: "completed";
      models: string[];
      fetchedAt: string;
      currentModelPresent: boolean;
    }
  | { status: "failed"; error: ServiceOperationError };

export type TranslationProgressEvent =
  | { type: "started"; taskId: string }
  | { type: "text_delta"; taskId: string; delta: string }
  | {
      type: "precision_plan";
      taskId: string;
      callPlan: PrecisionCallPlan;
    }
  | {
      type: "precision_stage";
      taskId: string;
      stage: "analyzing" | "translating" | "reviewing" | "revising";
      callPlan: PrecisionCallPlan;
    }
  | {
      type: "parallel_plan";
      taskId: string;
      parallel: ParallelTranslationSummary;
    }
  | {
      type: "segment_progress";
      taskId: string;
      completed: number;
      total: number;
      inFlight: number;
      concurrency: number;
    }
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

export type ParallelTranslationSummary = {
  requested: boolean;
  applied: boolean;
  concurrency: number;
  segmentCount: number;
  fallbackReason: string | null;
};

export type ParallelTranslationProgress = {
  completed: number;
  total: number;
  inFlight: number;
  concurrency: number;
  fallbackReason: string | null;
};

export type TranslationHostActionResult =
  | { status: "copied" | "pasted" }
  | { status: "confirmation_required" | "blocked" | "unavailable" };

export type PrecisionAnalysis = {
  schemaVersion: "analysis-output.v1";
  taskId: string;
  detectedSourceLanguage: string;
  inferredDomain: { name: string | null; confidence: "low" | "medium" | "high" };
  documentType: string | null;
  audience: string | null;
  tone: string | null;
  ambiguities: Array<{
    segmentId: string;
    sourceRange: { start: number; end: number };
    category: string;
    note: string;
  }>;
  termApplicability: Array<{ termId: string; applies: boolean; note: string }>;
  risks: Array<{ segmentId: string | null; category: string; note: string }>;
};

export type PrecisionReviewIssue = {
  reviewRole: "accuracy" | "language";
  id: string;
  segmentId: string;
  type: string;
  severity: "critical" | "major" | "minor";
  sourceRange: { start: number; end: number } | null;
  translationRange: { start: number; end: number } | null;
  termId: string | null;
  suggestion: string;
  confidence: "low" | "medium" | "high";
};

export type PrecisionTranslationSummary = {
  complete: boolean;
  callPlan: PrecisionCallPlan;
  analysis?: PrecisionAnalysis;
  failedStage?:
    | "preparing"
    | "analysis"
    | "translation"
    | "accuracy_review"
    | "language_review"
    | "reviews"
    | "revision";
  reviewIssues: PrecisionReviewIssue[];
  revisedSegmentIds: string[];
  unresolvedIssueIds: string[];
};

export type StandardTranslationResult =
  | {
      status: "validation_error";
      reason:
        | "invalid_source_text"
        | "source_text_too_long"
        | "invalid_target_language"
        | "invalid_confirmation"
        | "invalid_reference_selection"
        | "invalid_parallel_configuration"
        | "invalid_terminology"
        | "terminology_conflict"
        | "terminology_limit_exceeded"
        | "input_budget_exceeded";
      field?: string;
      message?: string;
      terminologyConflicts?: TerminologyConflict[];
      sourceRetained: true;
    }
  | {
      status: "reference_confirmation_required";
      sourceRetained: true;
      previewToken: string;
      referenceTranslations: Array<ReferenceTranslation & { id: string }>;
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
        callCount: number;
        qualityMode?: TranslationQualityMode;
        precisionCallPlan?: PrecisionCallPlan;
        parallel?: ParallelTranslationSummary;
      };
    }
  | {
      status: "completed";
      taskId: string;
      translation: string;
      quality: TranslationQuality;
      parallel?: ParallelTranslationSummary;
      precision?: PrecisionTranslationSummary;
    }
  | {
      status: "failed";
      taskId: string;
      sourceRetained: true;
      partialTranslation?: string;
      quality?: TranslationQuality;
      parallel?: ParallelTranslationSummary;
      precision?: PrecisionTranslationSummary;
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
  domainProfileId: string | null;
  qualityMode: TranslationQualityMode;
  thinkingEnabled?: boolean;
  additionalRequirements: string;
  taskTerms: TaskTerm[];
  referenceTranslationIds: string[] | null;
  parallelAcceleration: boolean;
  parallelConcurrency: number;
};

export type CurrentTranslationSnapshot = {
  revision: number;
  phase:
    | "editing"
    | "preparing"
    | "needs_configuration"
    | "awaiting_confirmation"
    | "analyzing"
    | "translating"
    | "reviewing"
    | "revising"
    | "completed"
    | "failed";
  inputs: CurrentTranslationInputs;
  task: (CurrentTranslationInputs & { taskId: string }) | null;
  partialTranslation: string;
  result: StandardTranslationResult | null;
  parallelProgress: ParallelTranslationProgress | null;
  stale: boolean;
};

export interface RuyiRuntimeBridge {
  getTerminologyState(): Promise<TerminologyState>;
  saveTermbase(input: Termbase): Promise<TerminologyState>;
  deleteTermbase(termbaseId: string): Promise<TerminologyState>;
  saveDomainProfile(input: DomainProfile): Promise<TerminologyState>;
  deleteDomainProfile(domainProfileId: string): Promise<TerminologyState>;
  setCurrentDomainProfile(domainProfileId: string | null): Promise<TerminologyState>;
  saveReferenceTranslation(input: ReferenceTranslation): Promise<TerminologyState>;
  deleteReferenceTranslation(referenceTranslationId: string): Promise<TerminologyState>;
  previewTermbaseCsv(request: {
    termbaseId: string;
    bytes: Uint8Array;
    mapping?: Record<string, string>;
  }): Promise<TermbaseCsvPreview>;
  discardTermbaseCsvPreview(previewToken: string): void;
  commitTermbaseCsv(previewToken: string): Promise<TerminologyState>;
  exportTermbaseCsv(termbaseId: string): Promise<TermbaseCsvExport>;
  getServiceConfiguration(
    configurationId?: string,
  ): Promise<RuntimeConfigurationState>;
  getServiceConfigurations(): Promise<ServiceConfigurationsState>;
  saveServiceConfiguration(
    input: ServiceConfigurationInput,
    credentialForm?: HTMLFormElement,
  ): Promise<ServiceConfigurationsState>;
  duplicateServiceConfiguration(
    configurationId: string,
  ): Promise<ServiceConfigurationsState>;
  moveServiceConfiguration(
    configurationId: string,
    direction: "up" | "down",
  ): Promise<ServiceConfigurationsState>;
  setCurrentServiceConfiguration(
    configurationId: string,
  ): Promise<ServiceConfigurationsState>;
  deleteServiceConfiguration(
    configurationId: string,
    confirmCurrent?: boolean,
  ): Promise<ServiceConfigurationsState>;
  saveServiceApiKey(
    configurationId: string,
    credentialForm: HTMLFormElement,
  ): Promise<ServiceConfigurationsState>;
  deleteServiceApiKey(configurationId: string): Promise<ServiceConfigurationsState>;
  clearServicePerformanceData(configurationId: string): Promise<ServiceConfigurationsState>;
  setBackgroundNotificationsEnabled?(
    enabled: boolean,
  ): Promise<ServiceConfigurationsState>;
  setServiceThinkingMode?(
    configurationId: string,
    enabled: boolean,
  ): Promise<ServiceConfigurationsState>;
  getParallelAccelerationAdvice(
    sourceText: string,
    configurationId?: string,
  ): ParallelAccelerationAdvice;
  getTranslationCallPlan?(request?: {
    sourceText?: string;
    qualityMode?: TranslationQualityMode;
    parallelAcceleration?: boolean;
    parallelConcurrency?: number;
  }): TranslationCallPlan;
  testServiceConnection(request: {
    operationId: string;
    configurationId: string;
  }): Promise<ServiceConnectionResult>;
  fetchServiceModels(request: {
    operationId: string;
    configurationId: string;
  }): Promise<ModelListResult>;
  cancelServiceOperation(operationId: string): void;
  saveApiKey(credentialForm: HTMLFormElement): Promise<RuntimeConfigurationState>;
  startTranslation?(
    request: StandardTranslationRequest,
    onProgress?: (event: TranslationProgressEvent) => void,
  ): Promise<StandardTranslationResult>;
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
