import { createHash } from 'node:crypto';

import {
  base64UrlEncode,
  REQUEST_PROOF_ALGORITHM,
  REQUEST_PROOF_TYPE,
  REQUEST_PROOF_VERSION,
  type RequestProofClaims,
  type RequestProofHeader,
} from '../src/auth/requestProof';

export interface TestKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

export async function createTestKeyPair(): Promise<TestKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256')
    .update(
      typeof value === 'string' ? new TextEncoder().encode(value) : value,
    )
    .digest('hex');
}

export interface SignRequestProofInput {
  privateKey: CryptoKey;
  header: RequestProofHeader;
  claims: RequestProofClaims;
}

export async function signRequestProof(
  input: SignRequestProofInput,
): Promise<string> {
  const headerPart = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(input.header)),
  );
  const payloadPart = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(input.claims)),
  );
  const signingInput = new TextEncoder().encode(
    `${headerPart}.${payloadPart}`,
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    input.privateKey,
    new Uint8Array(signingInput).buffer as ArrayBuffer,
  );
  return `${headerPart}.${payloadPart}.${base64UrlEncode(
    new Uint8Array(signature),
  )}`;
}

export function requestProofHeader(keyId: string): RequestProofHeader {
  return {
    alg: REQUEST_PROOF_ALGORITHM,
    typ: REQUEST_PROOF_TYPE,
    kid: keyId,
  };
}

export function requestProofClaims(input: {
  issuer: string;
  subject: string;
  audience: string;
  proofId: string;
  challengeId: string;
  challenge: string;
  method?: string;
  route?: string;
  bodyHashHex: string;
  issuedAt: number;
  expiresAt: number;
}): RequestProofClaims {
  return {
    v: REQUEST_PROOF_VERSION,
    iss: input.issuer,
    sub: input.subject,
    aud: input.audience,
    iat: input.issuedAt,
    exp: input.expiresAt,
    jti: input.proofId,
    htm: input.method ?? 'POST',
    htu: input.route ?? '/v1/assistant/interpret',
    bh: input.bodyHashHex,
    cid: input.challengeId,
    ch: input.challenge,
  };
}
