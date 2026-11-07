import {
  unavailableAuthenticator,
  type Authenticator,
  type ReplayProtector,
} from './auth';
import {
  handleGatewayRequest,
  type GatewayDependencies,
} from './handler';
import {
  unavailableRateLimiter,
  type RateLimiter,
} from './rateLimit';
import {
  unavailableProvider,
  type SemanticProvider,
} from './provider';

export interface GatewayEnvironment {
  POCKETA_ONLINE_GATEWAY_ENABLED?: string;
}

export interface GatewayTestComposition {
  kind: 'test';
  authenticator: Authenticator;
  rateLimiter: RateLimiter;
  provider: SemanticProvider;
  replayProtector?: ReplayProtector;
  providerTimeoutMs?: number;
}

export function isGatewayEnabled(environment: GatewayEnvironment): boolean {
  return environment.POCKETA_ONLINE_GATEWAY_ENABLED === 'true';
}

export function createGateway(
  enabled: boolean,
  composition: GatewayTestComposition,
): { fetch(request: Request): Promise<Response> } {
  if (
    !composition ||
    composition.kind !== 'test' ||
    !composition.authenticator ||
    !composition.rateLimiter ||
    !composition.provider
  ) {
    throw new Error(
      'An enabled production gateway requires approved production authentication, quota, and provider implementations.',
    );
  }
  const dependencies: GatewayDependencies = {
    enabled,
    authenticator: composition.authenticator,
    rateLimiter: composition.rateLimiter,
    provider: composition.provider,
    replayProtector: composition.replayProtector,
    providerTimeoutMs: composition.providerTimeoutMs,
  };
  return {
    fetch: (request: Request) => handleGatewayRequest(request, dependencies),
  };
}

export const disabledGateway = createGateway(false, {
  kind: 'test',
  authenticator: unavailableAuthenticator(),
  rateLimiter: unavailableRateLimiter(),
  provider: unavailableProvider(),
});

export function createTestGateway(
  enabled: boolean,
  composition: Omit<GatewayTestComposition, 'kind'>,
): { fetch(request: Request): Promise<Response> } {
  return createGateway(enabled, { ...composition, kind: 'test' });
}

export { handleGatewayRequest } from './handler';
export type { GatewayDependencies } from './handler';
export type {
  AttestationStatus,
  AuthenticatedIdentity,
  AuthenticationRequestContext,
  Authenticator,
  ReplayProtectionContext,
  ReplayProtectionDecision,
  ReplayProtector,
} from './auth';
export { FakeAuthenticator } from './auth';
export type {
  RateLimitContext,
  RateLimitDecision,
  RateLimiter,
} from './rateLimit';
export { InMemoryRateLimiter } from './rateLimit';
export type {
  SemanticProvider,
  SemanticProviderInterpretOptions,
} from './provider';
export { FakeSemanticProvider } from './provider';
export {
  AuthenticationError,
  AuthenticatorUnavailableError,
  GatewayHttpError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  RateLimiterUnavailableError,
  ReplayProtectionUnavailableError,
} from './errors';

export default disabledGateway;
