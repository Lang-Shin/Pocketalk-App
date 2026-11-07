import type { AttestationStatus } from '../auth';

export interface RegisteredPublicKey {
  keyId: string;
  subject: string;
  publicKey: CryptoKey;
  attestation: AttestationStatus;
}

export interface PublicKeyRegistry {
  get(keyId: string): RegisteredPublicKey | undefined;
  revoke(keyId: string): boolean;
}

interface RegistryEntry extends RegisteredPublicKey {
  revoked: boolean;
}

export class InMemoryPublicKeyRegistry implements PublicKeyRegistry {
  private readonly keys = new Map<string, RegistryEntry>();

  register(entry: RegisteredPublicKey): void {
    validateKey(entry.keyId, 'keyId');
    validateKey(entry.subject, 'subject');
    if (entry.publicKey.type !== 'public') {
      throw new RangeError('Registered key must be a public key.');
    }
    const algorithm = entry.publicKey.algorithm;
    if (
      algorithm.name !== 'ECDSA' ||
      !('namedCurve' in algorithm) ||
      algorithm.namedCurve !== 'P-256' ||
      !entry.publicKey.usages.includes('verify')
    ) {
      throw new RangeError(
        'Registered key must be an ECDSA P-256 verification key.',
      );
    }
    if (this.keys.has(entry.keyId)) {
      throw new RangeError('A key with this keyId is already registered.');
    }
    this.keys.set(entry.keyId, { ...entry, revoked: false });
  }

  get(keyId: string): RegisteredPublicKey | undefined {
    const entry = this.keys.get(keyId);
    if (!entry || entry.revoked) return undefined;
    return {
      keyId: entry.keyId,
      subject: entry.subject,
      publicKey: entry.publicKey,
      attestation: entry.attestation,
    };
  }

  revoke(keyId: string): boolean {
    const entry = this.keys.get(keyId);
    if (!entry || entry.revoked) return false;
    entry.revoked = true;
    return true;
  }
}

function validateKey(value: string, label: string): void {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(value)
  ) {
    throw new RangeError(`${label} is invalid.`);
  }
}
