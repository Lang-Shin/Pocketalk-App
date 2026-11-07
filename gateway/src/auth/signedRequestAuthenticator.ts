import type {
  AuthenticationRequestContext,
  AuthenticatedIdentity,
  Authenticator,
} from '../auth';
import {
  AuthenticationError,
  AuthenticatorUnavailableError,
} from '../errors';
import type { AttestationVerifier } from './attestation';
import type { ChallengeStore } from './challengeStore';
import type { PublicKeyRegistry } from './publicKeyRegistry';
import {
  parseRequestProof,
  verifyRequestProof,
  type RequestProofFailureReason,
} from './requestProof';

export type SubjectPseudonymizer = (
  subject: string,
) => Promise<string> | string;

export interface SignedRequestAuthenticatorOptions {
  registry: PublicKeyRegistry;
  challenges: ChallengeStore;
  attestationVerifier: AttestationVerifier;
  allowSyntheticAttestation?: boolean;
  pseudonymize: SubjectPseudonymizer;
  issuer: string;
  audience: string;
  now?: () => number;
  maxProofAgeSeconds?: number;
  clockSkewSeconds?: number;
}

export class SignedRequestAuthenticator implements Authenticator {
  private readonly now: () => number;

  constructor(
    private readonly options: SignedRequestAuthenticatorOptions,
  ) {
    if (
      options.attestationVerifier.synthetic &&
      options.allowSyntheticAttestation !== true
    ) {
      throw new Error(
        'Synthetic attestation is only allowed in explicit test composition.',
      );
    }
    this.now = options.now ?? Date.now;
  }

  async authenticate(
    credential: string,
    context: AuthenticationRequestContext,
  ): Promise<AuthenticatedIdentity> {
    if (!context.challenge || !context.challengeId) {
      throw new AuthenticationError('invalid');
    }

    let proof;
    try {
      proof = parseRequestProof(credential);
    } catch {
      throw new AuthenticationError('invalid');
    }

    const registered = this.options.registry.get(proof.header.kid);
    if (!registered) {
      throw new AuthenticationError('invalid');
    }

    const nowMs = this.now();
    const verification = await verifyRequestProof({
      proof,
      publicKey: registered.publicKey,
      expectedIssuer: this.options.issuer,
      expectedSubject: registered.subject,
      expectedAudience: this.options.audience,
      expectedMethod: context.method,
      expectedRoute: context.route,
      expectedBodyHashHex: context.canonicalBodyHash,
      expectedChallengeId: context.challengeId,
      expectedChallenge: context.challenge,
      nowMs,
      maxProofAgeSeconds: this.options.maxProofAgeSeconds,
      clockSkewSeconds: this.options.clockSkewSeconds,
    });
    if (!verification.valid) {
      throw failureError(verification.reason);
    }

    const challenge = await this.options.challenges.inspect({
      challengeId: context.challengeId,
      challenge: context.challenge,
      keyId: proof.header.kid,
      subject: registered.subject,
      nowMs,
    });
    if (challenge.status === 'expired') {
      throw new AuthenticationError('expired');
    }
    if (challenge.status !== 'active') {
      throw new AuthenticationError('invalid');
    }

    let attestation;
    try {
      attestation = await this.options.attestationVerifier.verify({
        keyId: registered.keyId,
        subject: registered.subject,
        registeredAttestation: registered.attestation,
      });
    } catch {
      throw new AuthenticatorUnavailableError();
    }
    if (attestation.status === 'unavailable') {
      throw new AuthenticatorUnavailableError();
    }
    if (attestation.status === 'expired') {
      throw new AuthenticationError('expired');
    }
    if (
      attestation.status !== 'accepted' ||
      attestation.assurance !== 'synthetic_verified'
    ) {
      throw new AuthenticationError('invalid');
    }

    let subject: string;
    try {
      subject = await this.options.pseudonymize(registered.subject);
    } catch {
      throw new AuthenticatorUnavailableError();
    }
    if (
      typeof subject !== 'string' ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(subject) ||
      subject === registered.subject
    ) {
      throw new AuthenticatorUnavailableError();
    }

    const expiresAt = verification.claims.exp * 1000;
    if (!Number.isSafeInteger(expiresAt)) {
      throw new AuthenticationError('expired');
    }

    return {
      subject,
      expiresAt,
      attestation: 'verified',
      keyId: registered.keyId,
      assurance: 'synthetic_verified',
    };
  }
}

function failureError(
  reason: RequestProofFailureReason,
): AuthenticationError {
  if (
    reason === 'expired' ||
    reason === 'not_yet_valid' ||
    reason === 'proof_too_old'
  ) {
    return new AuthenticationError('expired');
  }
  return new AuthenticationError('invalid');
}
