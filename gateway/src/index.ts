import {
  unavailableAuthenticator,
  type Authenticator,
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

export interface GatewayComposition {
  authenticator: Authenticator;
  rateLimiter: RateLimiter;
  provider: SemanticProvider;
}

export function isGatewayEnabled(environment: GatewayEnvironment): boolean {
  return environment.POCKETA_ONLINE_GATEWAY_ENABLED === 'true';
}

export function createGateway(
  enabled: boolean,
  composition: GatewayComposition,
): { fetch(request: Request): Promise<Response> } {
  const dependencies: GatewayDependencies = {
    enabled,
    authenticator: composition.authenticator,
    rateLimiter: composition.rateLimiter,
    provider: composition.provider,
  };
  return {
    fetch: (request: Request) => handleGatewayRequest(request, dependencies),
  };
}

export const disabledGateway = createGateway(false, {
  authenticator: unavailableAuthenticator(),
  rateLimiter: unavailableRateLimiter(),
  provider: unavailableProvider(),
});

export { handleGatewayRequest } from './handler';
export type { GatewayDependencies } from './handler';
export type {
  AuthenticatedIdentity,
  Authenticator,
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
} from './errors';

export default disabledGateway;
