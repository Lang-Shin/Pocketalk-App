export type GatewayErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'quota_exhausted'
  | 'invalid_provider_response'
  | 'service_unavailable'
  | 'provider_timeout';

export class GatewayHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: GatewayErrorCode,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'GatewayHttpError';
  }
}

export class AuthenticationError extends Error {
  constructor(
    readonly code: 'missing' | 'invalid' | 'expired',
    message = 'Authentication failed.',
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthenticatorUnavailableError extends Error {
  constructor(message = 'Authentication is unavailable.') {
    super(message);
    this.name = 'AuthenticatorUnavailableError';
  }
}

export class RateLimiterUnavailableError extends Error {
  constructor(message = 'Quota storage is unavailable.') {
    super(message);
    this.name = 'RateLimiterUnavailableError';
  }
}

export class ProviderUnavailableError extends Error {
  constructor(message = 'The semantic provider is unavailable.') {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

export class ProviderTimeoutError extends Error {
  constructor(message = 'The semantic provider timed out.') {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof GatewayHttpError) {
    return jsonResponse(
      error.status,
      {
        error: {
          code: error.code,
          message: safeMessage(error.status, error.code),
        },
      },
      error.headers,
    );
  }
  if (error instanceof AuthenticationError) {
    return jsonResponse(401, {
      error: {
        code: 'unauthorized',
        message: safeMessage(401, 'unauthorized'),
      },
    });
  }
  if (
    error instanceof AuthenticatorUnavailableError ||
    error instanceof RateLimiterUnavailableError
  ) {
    return jsonResponse(503, {
      error: {
        code: 'service_unavailable',
        message: safeMessage(503, 'service_unavailable'),
      },
    });
  }
  if (error instanceof ProviderTimeoutError) {
    return jsonResponse(504, {
      error: {
        code: 'provider_timeout',
        message: safeMessage(504, 'provider_timeout'),
      },
    });
  }
  return jsonResponse(503, {
    error: {
      code: 'service_unavailable',
      message: safeMessage(503, 'service_unavailable'),
    },
  });
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'pragma': 'no-cache',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

function safeMessage(status: number, code: GatewayErrorCode): string {
  if (status === 400) return 'The request is invalid.';
  if (status === 401) return 'Authentication is required or invalid.';
  if (status === 403) return 'The request is not authorized.';
  if (status === 405) return 'Only POST is supported.';
  if (status === 413) return 'The request body is too large.';
  if (status === 415) return 'The request body must be JSON.';
  if (status === 429) return 'The request quota is exhausted.';
  if (status === 502) return 'The provider returned an invalid response.';
  if (status === 504) return 'The provider timed out.';
  if (code === 'service_unavailable') {
    return 'The online gateway is unavailable.';
  }
  return 'The request could not be completed.';
}
