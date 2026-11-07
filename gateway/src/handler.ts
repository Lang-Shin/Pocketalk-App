import type {
  AuthenticationRequestContext,
  Authenticator,
  ReplayProtector,
} from './auth';
import {
  AuthenticationError,
  AuthenticatorUnavailableError,
  GatewayHttpError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  RateLimiterUnavailableError,
  ReplayProtectionUnavailableError,
  errorResponse,
  jsonResponse,
} from './errors';
import type { RateLimiter } from './rateLimit';
import type { SemanticProvider } from './provider';
import {
  contentLengthExceedsLimit,
  isJsonContentType,
  readGatewayRequest,
  validateProviderOutput,
} from './validation';

export interface GatewayDependencies {
  enabled: boolean;
  authenticator: Authenticator;
  rateLimiter: RateLimiter;
  provider: SemanticProvider;
  replayProtector?: ReplayProtector;
  providerTimeoutMs?: number;
  now?: () => number;
}

export async function handleGatewayRequest(
  request: Request,
  dependencies: GatewayDependencies,
): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      throw new GatewayHttpError(
        405,
        'method_not_allowed',
        'Only POST is supported.',
        { allow: 'POST' },
      );
    }
    if (!dependencies.enabled) {
      throw new GatewayHttpError(
        503,
        'service_unavailable',
        'The gateway is disabled.',
      );
    }
    if (!isJsonContentType(request.headers.get('content-type'))) {
      throw new GatewayHttpError(
        415,
        'unsupported_media_type',
        'JSON content type is required.',
      );
    }
    if (
      contentLengthExceedsLimit(request.headers.get('content-length'))
    ) {
      throw new GatewayHttpError(
        413,
        'payload_too_large',
        'Request body is too large.',
      );
    }

    const now = (dependencies.now ?? Date.now)();
    const payload = await readGatewayRequest(request);
    const authContext: AuthenticationRequestContext = {
      method: request.method,
      route: new URL(request.url).pathname,
      canonicalBodyHash: payload.canonicalBodyHash,
      challenge: request.headers.get('x-pocketa-challenge'),
    };
    const identity = await authenticate(
      request,
      dependencies.authenticator,
      now,
      authContext,
    );
    if (dependencies.replayProtector) {
      try {
        const replay = await dependencies.replayProtector.consume({
          identitySubject: identity.subject,
          method: authContext.method,
          route: authContext.route,
          canonicalBodyHash: authContext.canonicalBodyHash,
          challenge: authContext.challenge,
        });
        if (!replay.accepted) {
          throw new GatewayHttpError(
            401,
            'unauthorized',
            'Replay protection rejected the request.',
          );
        }
      } catch (error) {
        if (error instanceof GatewayHttpError) throw error;
        throw new ReplayProtectionUnavailableError();
      }
    }
    let decision;
    try {
      decision = await dependencies.rateLimiter.admit({
        identity: identity.subject,
        now,
      });
    } catch {
      throw new RateLimiterUnavailableError();
    }
    if (!decision.allowed) {
      const headers: Record<string, string> = {};
      if (decision.retryAfterSeconds !== undefined) {
        headers['retry-after'] = String(decision.retryAfterSeconds);
      }
      throw new GatewayHttpError(
        429,
        'quota_exhausted',
        'The request quota is exhausted.',
        headers,
      );
    }

    let providerOutput;
    try {
      providerOutput = await runProviderWithDeadline(
        dependencies.provider,
        payload.request,
        dependencies.providerTimeoutMs ?? 10_000,
      );
    } catch (error) {
      if (error instanceof ProviderTimeoutError) throw error;
      throw new ProviderUnavailableError();
    }

    return jsonResponse(200, validateProviderOutput(providerOutput));
  } catch (error) {
    return errorResponse(error);
  }
}

async function authenticate(
  request: Request,
  authenticator: Authenticator,
  now: number,
  context: AuthenticationRequestContext,
) {
  const authorization = request.headers.get('authorization');
  if (!authorization) {
    throw new GatewayHttpError(
      401,
      'unauthorized',
      'Authentication is required.',
    );
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const credential = match?.[1];
  if (!credential) {
    throw new GatewayHttpError(
      401,
      'unauthorized',
      'Authentication is invalid.',
    );
  }

  let identity;
  try {
    identity = await authenticator.authenticate(credential, context);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw new GatewayHttpError(
        401,
        'unauthorized',
        'Authentication is invalid or expired.',
      );
    }
    throw new AuthenticatorUnavailableError();
  }
  if (!identity.subject.trim()) {
    throw new GatewayHttpError(
      401,
      'unauthorized',
      'Authentication is invalid.',
    );
  }
  if (!Number.isFinite(identity.expiresAt) || identity.expiresAt <= now) {
    throw new GatewayHttpError(
      401,
      'unauthorized',
      'Authentication is expired.',
    );
  }
  return identity;
}

function runProviderWithDeadline(
  provider: SemanticProvider,
  request: Parameters<SemanticProvider['interpret']>[0],
  timeoutMs: number,
): Promise<Awaited<ReturnType<SemanticProvider['interpret']>>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operation = provider.interpret(request, {
    signal: controller.signal,
  });
  operation.catch(() => undefined);
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderTimeoutError());
    }, timeoutMs);
  });
  return Promise.race([operation, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
