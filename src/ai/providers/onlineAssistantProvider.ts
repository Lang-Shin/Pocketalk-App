import {
  resolveAssistantContainerChoice,
  resolveAssistantWalletChoice,
  type AssistantContext,
  type AssistantPendingIntent,
  type AssistantResult,
} from '../localAssistant';
import { createOnlineRequest, toGatewayRequest } from '../online/contract';
import {
  OnlineGatewayError,
  type OnlineGatewayClient,
} from '../online/gatewayClient';
import { adaptOnlineResponse } from '../online/responseAdapter';
import type {
  AssistantProvider,
  AssistantProviderInfo,
} from './assistantProvider';

export type OnlineAssistantProviderErrorCode =
  | 'not_initialized'
  | 'stale_response'
  | 'cancelled';

export class OnlineAssistantProviderError extends Error {
  constructor(
    readonly code: OnlineAssistantProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OnlineAssistantProviderError';
  }
}

export interface OnlineAssistantProviderOptions {
  client: OnlineGatewayClient;
  info?: AssistantProviderInfo;
}

export class OnlineAssistantProvider implements AssistantProvider {
  readonly info: AssistantProviderInfo;
  private readonly client: OnlineGatewayClient;
  private state: 'unloaded' | 'ready' = 'unloaded';
  private sessionId = 0;
  private requestSequence = 0;
  private activeAbort: AbortController | null = null;

  constructor(options: OnlineAssistantProviderOptions) {
    this.client = options.client;
    this.info = options.info ?? {
      id: 'online-gateway-v1',
      displayName: 'Online gateway',
      kind: 'online',
      isRealModel: true,
      needsModelDownload: false,
      offline: false,
      description:
        'Optional remote LLM interpretation through a secure gateway. Inactive in this build.',
    };
  }

  async load(): Promise<void> {
    if (this.state === 'ready') return;
    this.sessionId += 1;
    this.state = 'ready';
  }

  async unload(): Promise<void> {
    this.sessionId += 1;
    this.state = 'unloaded';
    this.activeAbort?.abort();
    this.activeAbort = null;
  }

  async interpret(
    text: string,
    context: AssistantContext,
  ): Promise<AssistantResult> {
    this.assertReady();
    const requestId = ++this.requestSequence;
    const sessionId = this.sessionId;
    const controller = new AbortController();
    this.activeAbort?.abort();
    this.activeAbort = controller;

    try {
      const envelope = createOnlineRequest(text, context);
      const response = await this.client.interpret(
        toGatewayRequest(envelope),
        { signal: controller.signal },
      );
      this.assertCurrent(sessionId, requestId, controller);
      const result = adaptOnlineResponse(response, envelope, context);
      this.assertCurrent(sessionId, requestId, controller);
      return result;
    } catch (error) {
      if (
        error instanceof OnlineGatewayError &&
        error.code === 'cancelled' &&
        this.isStale(sessionId, requestId)
      ) {
        throw new OnlineAssistantProviderError(
          'stale_response',
          'The online assistant response is no longer current.',
        );
      }
      throw error;
    } finally {
      if (this.activeAbort === controller) {
        this.activeAbort = null;
      }
    }
  }

  async resolveContainerChoice(
    containerId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): Promise<AssistantResult> {
    this.assertReady();
    return resolveAssistantContainerChoice(containerId, pending, context);
  }

  async resolveWalletChoice(
    walletId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): Promise<AssistantResult> {
    this.assertReady();
    return resolveAssistantWalletChoice(walletId, pending, context);
  }

  private assertReady() {
    if (this.state !== 'ready') {
      throw new OnlineAssistantProviderError(
        'not_initialized',
        'The online assistant provider is not initialized.',
      );
    }
  }

  private isStale(sessionId: number, requestId: number): boolean {
    return (
      this.state !== 'ready' ||
      this.sessionId !== sessionId ||
      this.requestSequence !== requestId
    );
  }

  private assertCurrent(
    sessionId: number,
    requestId: number,
    controller: AbortController,
  ) {
    if (this.isStale(sessionId, requestId)) {
      throw new OnlineAssistantProviderError(
        'stale_response',
        'The online assistant response is no longer current.',
      );
    }
    if (controller.signal.aborted) {
      throw new OnlineAssistantProviderError(
        'cancelled',
        'The online assistant request was cancelled.',
      );
    }
  }
}
