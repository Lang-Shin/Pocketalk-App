import type {
  AssistantContext,
  AssistantPendingIntent,
  AssistantResult,
} from '../localAssistant';

export type AssistantProviderKind = 'mock' | 'local_llm';

export interface AssistantProviderInfo {
  id: string;
  displayName: string;
  kind: AssistantProviderKind;
  isRealModel: boolean;
  modelName?: string;
  needsModelDownload: boolean;
  offline: boolean;
  description: string;
}

export interface AssistantProvider {
  readonly info: AssistantProviderInfo;
  load(): Promise<void>;
  unload(): Promise<void>;
  interpret(text: string, context: AssistantContext): Promise<AssistantResult>;
  resolveContainerChoice(
    containerId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): Promise<AssistantResult>;
  resolveWalletChoice(
    walletId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): Promise<AssistantResult>;
}
