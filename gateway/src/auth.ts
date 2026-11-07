import {
  AuthenticationError,
  AuthenticatorUnavailableError,
} from './errors';

export type AttestationStatus = 'not_verified' | 'verified';
export type AuthenticationAssurance = 'none' | 'synthetic_verified';

export interface AuthenticationRequestContext {
  method: string;
  route: string;
  canonicalBodyHash: string;
  challenge: string | null;
  challengeId?: string | null;
}

export interface AuthenticatedIdentity {
  subject: string;
  expiresAt: number;
  attestation: AttestationStatus;
  keyId?: string;
  assurance?: AuthenticationAssurance;
}

export interface Authenticator {
  authenticate(
    credential: string,
    context: AuthenticationRequestContext,
  ): Promise<AuthenticatedIdentity>;
}

export interface ReplayProtectionContext {
  identitySubject: string;
  method: string;
  route: string;
  canonicalBodyHash: string;
  challenge: string | null;
  challengeId?: string | null;
  keyId?: string;
}

export interface ReplayProtectionDecision {
  accepted: boolean;
  reason?: string;
}

export interface ReplayProtector {
  consume(
    context: ReplayProtectionContext,
  ): Promise<ReplayProtectionDecision>;
}

export class FakeAuthenticator implements Authenticator {
  constructor(
    private readonly identities: ReadonlyMap<
      string,
      AuthenticatedIdentity | 'expired'
    >,
  ) {}

  async authenticate(credential: string): Promise<AuthenticatedIdentity> {
    const identity = this.identities.get(credential);
    if (!identity) {
      throw new AuthenticationError('invalid');
    }
    if (identity === 'expired') {
      throw new AuthenticationError('expired');
    }
    if (!identity.subject.trim()) {
      throw new AuthenticationError('invalid');
    }
    return identity;
  }
}

export function unavailableAuthenticator(): Authenticator {
  return {
    async authenticate() {
      throw new AuthenticatorUnavailableError();
    },
  };
}
