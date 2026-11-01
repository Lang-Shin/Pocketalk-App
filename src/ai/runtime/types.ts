import type {
  AssistantContext,
  AssistantPendingIntent,
  AssistantResult,
} from '../localAssistant';

export type LocalModelRuntimeStatus =
  | 'unloaded'
  | 'loading'
  | 'ready'
  | 'generating'
  | 'error';

export interface LocalModelRequest {
  prompt: string;
  maxTokens?: number;
}

export interface LocalModelResponse {
  text: string;
  structured?: unknown;
}

export interface LocalModelMetrics {
  loadMs?: number;
  timeToFirstTokenMs?: number;
  totalMs?: number;
  promptTokens?: number;
  outputTokens?: number;
}

export interface LocalModelRuntime {
  status(): LocalModelRuntimeStatus;
  metrics(): LocalModelMetrics | null;
  load(): Promise<void>;
  generate(request: LocalModelRequest): Promise<LocalModelResponse>;
  cancel(): Promise<void>;
  unload(): Promise<void>;
}

export interface LocalModelPromptBuilder {
  interpretationPrompt(text: string, context: AssistantContext): string;
  containerChoicePrompt(
    containerId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): string;
  walletChoicePrompt(
    walletId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): string;
}

export interface LocalModelResponseParser {
  parse(
    response: LocalModelResponse,
    context: AssistantContext,
  ): AssistantResult;
}

export class LocalModelCancelledError extends Error {
  constructor() {
    super('Local model generation was cancelled.');
    this.name = 'LocalModelCancelledError';
  }
}
