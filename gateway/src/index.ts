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
import { validateQuotaReservation } from './quota/types';

export interface GatewayEnvironment {
  POCKETA_ONLINE_GATEWAY_ENABLED?: string;
}

export interface GatewayTestComposition {
  kind: 'test';
  authenticator: Authenticator;
  rateLimiter: RateLimiter;
  provider: SemanticProvider;
  replayProtector?: ReplayProtector;
  quotaReservation?: {
    poolId: string;
    maxOutputTokens: number;
    framingOverheadTokens: number;
  };
  providerTimeoutMs?: number;
  now?: () => number;
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
  if (composition.quotaReservation) {
    validateQuotaReservation(composition.quotaReservation);
  }
  const dependencies: GatewayDependencies = {
    enabled,
    authenticator: composition.authenticator,
    rateLimiter: composition.rateLimiter,
    provider: composition.provider,
    replayProtector: composition.replayProtector,
    quotaReservation: composition.quotaReservation,
    providerTimeoutMs: composition.providerTimeoutMs,
    now: composition.now,
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
  AuthenticationAssurance,
  AuthenticationRequestContext,
  Authenticator,
  ReplayProtectionContext,
  ReplayProtectionDecision,
  ReplayProtector,
} from './auth';
export { FakeAuthenticator } from './auth';
export {
  InMemoryChallengeStore,
  ChallengeReplayProtector,
  type ChallengeConsumeInput,
  type ChallengeConsumeResult,
  type ChallengeInspectInput,
  type ChallengeInspectResult,
  type ChallengeIssue,
  type ChallengeIssueInput,
  type ChallengeReplayProtectorOptions,
  type ChallengeStore,
} from './auth/challengeStore';
export {
  SyntheticAttestationVerifier,
  type AttestationVerificationInput,
  type AttestationVerificationResult,
  type AttestationVerificationStatus,
  type AttestationVerifier,
  type SyntheticAttestationAssurance,
  type SyntheticAttestationFixture,
} from './auth/attestation';
export {
  InMemoryPublicKeyRegistry,
  type PublicKeyRegistry,
  type RegisteredPublicKey,
} from './auth/publicKeyRegistry';
export {
  base64UrlDecode,
  base64UrlEncode,
  parseRequestProof,
  verifyRequestProof,
  REQUEST_PROOF_ALGORITHM,
  REQUEST_PROOF_TYPE,
  REQUEST_PROOF_VERSION,
  RequestProofError,
  type ParsedRequestProof,
  type RequestProofClaims,
  type RequestProofErrorCode,
  type RequestProofFailureReason,
  type RequestProofHeader,
  type RequestProofVerificationResult,
  type VerifyRequestProofInput,
} from './auth/requestProof';
export {
  SignedRequestAuthenticator,
  type SignedRequestAuthenticatorOptions,
  type SubjectPseudonymizer,
} from './auth/signedRequestAuthenticator';
export type {
  RateLimitContext,
  RateLimitDecision,
  RateLimiter,
  RateLimitTokenReservation,
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
export {
  SqliteQuotaStore,
  type QuotaSqlStorage,
  type QuotaSqlValue,
} from './quota/sqliteQuotaStore';
export { SqliteQuotaLimiter } from './quota/sqliteQuotaLimiter';
export {
  hmacIdentityKey,
  type QuotaIdentityPseudonymizer,
} from './quota/identityKey';
export {
  createDurableObjectQuotaStorage,
  type DurableObjectQuotaRuntime,
  type DurableObjectSqlCursor,
  type DurableObjectSqlStorage,
} from './quota/durableObjectStorage';
export {
  QUOTA_OBJECT_PREFIX,
  quotaObjectId,
  quotaObjectName,
  quotaObjectStub,
  type DurableObjectIdLike,
  type DurableObjectNamespaceLike,
} from './quota/routing';
export {
  QuotaConfigError,
  tokenReservationTotal,
  validateQuotaConfig,
  validateQuotaReservation,
  type QuotaAdmissionInput,
  type QuotaConfig,
  type QuotaDecision,
  type QuotaDuplicateReason,
  type QuotaScope,
  type QuotaShortWindowLimits,
  type QuotaTokenReservation,
  type QuotaWindowKind,
  type QuotaWindowLimits,
} from './quota/types';

export default disabledGateway;
