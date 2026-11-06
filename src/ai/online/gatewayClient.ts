import {
  parseOnlineResponseJson,
  validateOnlineRequest,
  type OnlineRequest,
  type OnlineResponse,
} from './contract';

export type OnlineGatewayErrorCode =
  | 'network_unavailable'
  | 'timeout'
  | 'quota_exhausted'
  | 'unauthorized'
  | 'service_unavailable'
  | 'invalid_response'
  | 'cancelled';

export class OnlineGatewayError extends Error {
  constructor(
    readonly code: OnlineGatewayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OnlineGatewayError';
  }
}

export interface OnlineGatewayTransportRequest {
  readonly body: string;
  readonly signal: AbortSignal;
}

export interface OnlineGatewayTransportResponse {
  readonly status: number;
  readonly body: string;
}

export interface OnlineGatewayTransport {
  send(
    request: OnlineGatewayTransportRequest,
  ): Promise<OnlineGatewayTransportResponse>;
}

export interface OnlineGatewayClientOptions {
  transport: OnlineGatewayTransport;
  timeoutMs?: number;
}

export interface OnlineGatewayRequestOptions {
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class OnlineGatewayClient {
  private readonly transport: OnlineGatewayTransport;
  private readonly timeoutMs: number;

  constructor(options: OnlineGatewayClientOptions) {
    this.transport = options.transport;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new RangeError('Online gateway timeout must be positive.');
    }
  }

  async interpret(
    request: OnlineRequest,
    options: OnlineGatewayRequestOptions = {},
  ): Promise<OnlineResponse> {
    const validated = validateOnlineRequest(request);
    if (options.signal?.aborted) {
      throw new OnlineGatewayError(
        'cancelled',
        'The online gateway request was cancelled.',
      );
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await this.transport.send({
        body: JSON.stringify(validated),
        signal: controller.signal,
      });

      if (timedOut) {
        throw new OnlineGatewayError(
          'timeout',
          'The online gateway request timed out.',
        );
      }
      if (controller.signal.aborted) {
        throw new OnlineGatewayError(
          'cancelled',
          'The online gateway request was cancelled.',
        );
      }
      if (!Number.isInteger(response.status)) {
        throw new OnlineGatewayError(
          'invalid_response',
          'The online gateway returned an invalid status.',
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new OnlineGatewayError(
          'unauthorized',
          'The online gateway request was not authorized.',
        );
      }
      if (response.status === 429) {
        throw new OnlineGatewayError(
          'quota_exhausted',
          'The online gateway quota is exhausted.',
        );
      }
      if (response.status === 408) {
        throw new OnlineGatewayError(
          'timeout',
          'The online gateway request timed out.',
        );
      }
      if (response.status < 200 || response.status >= 300) {
        throw new OnlineGatewayError(
          'service_unavailable',
          'The online gateway is unavailable.',
        );
      }
      if (typeof response.body !== 'string') {
        throw new OnlineGatewayError(
          'invalid_response',
          'The online gateway returned an invalid response.',
        );
      }

      try {
        return parseOnlineResponseJson(response.body);
      } catch {
        throw new OnlineGatewayError(
          'invalid_response',
          'The online gateway returned an invalid response.',
        );
      }
    } catch (error) {
      if (error instanceof OnlineGatewayError) throw error;
      if (timedOut) {
        throw new OnlineGatewayError(
          'timeout',
          'The online gateway request timed out.',
        );
      }
      if (options.signal?.aborted || controller.signal.aborted) {
        throw new OnlineGatewayError(
          'cancelled',
          'The online gateway request was cancelled.',
        );
      }
      throw new OnlineGatewayError(
        'network_unavailable',
        'The online gateway could not be reached.',
      );
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
}
