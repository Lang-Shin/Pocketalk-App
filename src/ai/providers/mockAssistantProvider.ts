import {
  interpretAssistantMessage,
  resolveAssistantContainerChoice,
  resolveAssistantWalletChoice,
  type AssistantContext,
  type AssistantPendingIntent,
  type AssistantResult,
} from '../localAssistant';
import type {
  AssistantProvider,
  AssistantProviderInfo,
} from './assistantProvider';

export class MockAssistantProvider implements AssistantProvider {
  readonly info: AssistantProviderInfo = {
    id: 'mock-rules-v1',
    displayName: 'Rules-based mock',
    kind: 'mock',
    isRealModel: false,
    needsModelDownload: false,
    offline: true,
    description:
      'Deterministic local rules for interpreting finance messages. This is not a language model.',
  };

  async load(): Promise<void> {
    return;
  }

  async unload(): Promise<void> {
    return;
  }

  async interpret(
    text: string,
    context: AssistantContext,
  ): Promise<AssistantResult> {
    return interpretAssistantMessage(text, context);
  }

  async resolveContainerChoice(
    containerId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): Promise<AssistantResult> {
    return resolveAssistantContainerChoice(containerId, pending, context);
  }

  async resolveWalletChoice(
    walletId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): Promise<AssistantResult> {
    return resolveAssistantWalletChoice(walletId, pending, context);
  }
}
