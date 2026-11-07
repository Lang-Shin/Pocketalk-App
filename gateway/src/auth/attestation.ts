import type { AttestationStatus } from '../auth';

export type SyntheticAttestationAssurance =
  | 'synthetic_verified'
  | 'unsupported';

export type AttestationVerificationStatus =
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'unavailable'
  | 'unsupported_assurance';

export interface AttestationVerificationInput {
  keyId: string;
  subject: string;
  registeredAttestation: AttestationStatus;
}

export interface AttestationVerificationResult {
  status: AttestationVerificationStatus;
  assurance?: SyntheticAttestationAssurance;
  reason?: string;
}

export interface AttestationVerifier {
  readonly synthetic: boolean;
  verify(
    input: AttestationVerificationInput,
  ):
    | AttestationVerificationResult
    | Promise<AttestationVerificationResult>;
}

export type SyntheticAttestationFixture =
  | {
      status: 'accepted';
      assurance: 'synthetic_verified';
    }
  | {
      status: 'rejected';
      reason?: string;
    }
  | {
      status: 'expired';
      reason?: string;
    }
  | {
      status: 'unavailable';
      reason?: string;
    }
  | {
      status: 'unsupported_assurance';
      assurance?: SyntheticAttestationAssurance;
      reason?: string;
    };

export class SyntheticAttestationVerifier implements AttestationVerifier {
  readonly synthetic = true;

  constructor(
    private readonly fixtures: ReadonlyMap<
      string,
      SyntheticAttestationFixture
    >,
  ) {}

  verify(
    input: AttestationVerificationInput,
  ): AttestationVerificationResult {
    const fixture = this.fixtures.get(input.keyId);
    if (!fixture) {
      return {
        status: 'rejected',
        reason: 'missing_synthetic_fixture',
      };
    }
    if (fixture.status === 'accepted') {
      return {
        status: 'accepted',
        assurance: fixture.assurance,
      };
    }
    return { ...fixture };
  }
}
