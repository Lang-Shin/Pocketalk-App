import type { OnlineRequest, OnlineResponse } from '../../src/ai/online/contract';
import { ProviderUnavailableError } from './errors';

export interface SemanticProviderInterpretOptions {
  signal?: AbortSignal;
}

export interface SemanticProvider {
  interpret(
    request: OnlineRequest,
    options?: SemanticProviderInterpretOptions,
  ): Promise<OnlineResponse>;
}

export type FakeProviderResponder = (
  request: OnlineRequest,
) =>
  | OnlineResponse
  | Promise<OnlineResponse>;

export class FakeSemanticProvider implements SemanticProvider {
  constructor(private readonly responder: FakeProviderResponder) {}

  async interpret(
    request: OnlineRequest,
  ): Promise<OnlineResponse> {
    return this.responder(request);
  }
}

export function unavailableProvider(): SemanticProvider {
  return {
    async interpret() {
      throw new ProviderUnavailableError();
    },
  };
}
