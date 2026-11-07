export const REQUEST_PROOF_TYPE = 'pocketa-request-proof+jws';
export const REQUEST_PROOF_ALGORITHM = 'ES256';
export const REQUEST_PROOF_VERSION = 'pocketa-request-proof-v1';

export type RequestProofErrorCode =
  | 'invalid_format'
  | 'unsupported_algorithm'
  | 'invalid_claims';

export class RequestProofError extends Error {
  constructor(readonly code: RequestProofErrorCode) {
    super('The request proof is invalid.');
    this.name = 'RequestProofError';
  }
}

export interface RequestProofHeader {
  alg: typeof REQUEST_PROOF_ALGORITHM;
  typ: typeof REQUEST_PROOF_TYPE;
  kid: string;
}

export interface RequestProofClaims {
  v: typeof REQUEST_PROOF_VERSION;
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  htm: string;
  htu: string;
  bh: string;
  cid: string;
  ch: string;
}

export interface ParsedRequestProof {
  header: RequestProofHeader;
  claims: RequestProofClaims;
  signingInput: Uint8Array;
  signature: Uint8Array;
}

export type RequestProofFailureReason =
  | 'invalid_signature'
  | 'wrong_version'
  | 'wrong_issuer'
  | 'wrong_subject'
  | 'wrong_audience'
  | 'not_yet_valid'
  | 'expired'
  | 'proof_too_old'
  | 'wrong_method'
  | 'wrong_route'
  | 'wrong_body_hash'
  | 'wrong_challenge_id'
  | 'wrong_challenge';

export type RequestProofVerificationResult =
  | {
      valid: true;
      header: RequestProofHeader;
      claims: RequestProofClaims;
    }
  | {
      valid: false;
      reason: RequestProofFailureReason;
    };

export interface VerifyRequestProofInput {
  proof: ParsedRequestProof;
  publicKey: CryptoKey;
  expectedIssuer: string;
  expectedSubject: string;
  expectedAudience: string;
  expectedMethod: string;
  expectedRoute: string;
  expectedBodyHashHex: string;
  expectedChallengeId: string;
  expectedChallenge: string;
  nowMs: number;
  maxProofAgeSeconds?: number;
  clockSkewSeconds?: number;
}

const DEFAULT_MAX_PROOF_AGE_SECONDS = 120;
const DEFAULT_CLOCK_SKEW_SECONDS = 30;
const HEX_HASH_PATTERN = /^[0-9a-f]{64}$/i;
const HEADER_KEYS = new Set(['alg', 'typ', 'kid']);
const CLAIM_KEYS = new Set([
  'v',
  'iss',
  'sub',
  'aud',
  'iat',
  'exp',
  'jti',
  'htm',
  'htu',
  'bh',
  'cid',
  'ch',
]);

/**
 * Canonical proof serialization:
 * - UTF-8 JSON header and claims.
 * - JWS compact serialization: BASE64URL(header).BASE64URL(claims).BASE64URL(signature).
 * - ES256 over the ASCII signing input "BASE64URL(header).BASE64URL(claims)".
 * - ECDSA P-256 SHA-256 signature in JOSE raw R||S form, exactly 64 bytes.
 * - bh is lowercase hexadecimal SHA-256 of the exact accepted request bytes.
 * - htm is the uppercase HTTP method.
 * - htu is the canonical pathname only, without scheme, host, query, or fragment.
 * - iat/exp are Unix seconds; exp must be after iat.
 */
export function parseRequestProof(value: string): ParsedRequestProof {
  if (typeof value !== 'string') {
    throw new RequestProofError('invalid_format');
  }
  const parts = value.split('.');
  if (parts.length !== 3) {
    throw new RequestProofError('invalid_format');
  }
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) {
    throw new RequestProofError('invalid_format');
  }

  let headerValue: unknown;
  let payloadValue: unknown;
  try {
    headerValue = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        base64UrlDecode(headerPart),
      ),
    );
    payloadValue = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        base64UrlDecode(payloadPart),
      ),
    );
  } catch {
    throw new RequestProofError('invalid_format');
  }

  const header = parseHeader(headerValue);
  const claims = parseClaims(payloadValue);
  const signature = base64UrlDecode(signaturePart);
  if (signature.byteLength !== 64) {
    throw new RequestProofError('invalid_format');
  }

  return {
    header,
    claims,
    signingInput: new TextEncoder().encode(
      `${headerPart}.${payloadPart}`,
    ),
    signature,
  };
}

export async function verifyRequestProof(
  input: VerifyRequestProofInput,
): Promise<RequestProofVerificationResult> {
  const { proof, publicKey } = input;
  const { claims } = proof;

  let signatureValid: boolean;
  try {
    signatureValid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      toArrayBuffer(proof.signature),
      toArrayBuffer(proof.signingInput),
    );
  } catch {
    return { valid: false, reason: 'invalid_signature' };
  }
  if (!signatureValid) {
    return { valid: false, reason: 'invalid_signature' };
  }

  if (claims.v !== REQUEST_PROOF_VERSION) {
    return { valid: false, reason: 'wrong_version' };
  }
  if (claims.iss !== input.expectedIssuer) {
    return { valid: false, reason: 'wrong_issuer' };
  }
  if (claims.sub !== input.expectedSubject) {
    return { valid: false, reason: 'wrong_subject' };
  }
  if (claims.aud !== input.expectedAudience) {
    return { valid: false, reason: 'wrong_audience' };
  }
  if (claims.htm !== input.expectedMethod) {
    return { valid: false, reason: 'wrong_method' };
  }
  if (claims.htu !== input.expectedRoute) {
    return { valid: false, reason: 'wrong_route' };
  }
  if (
    !constantTimeEqualString(
      claims.bh,
      input.expectedBodyHashHex.toLowerCase(),
    )
  ) {
    return { valid: false, reason: 'wrong_body_hash' };
  }
  if (claims.cid !== input.expectedChallengeId) {
    return { valid: false, reason: 'wrong_challenge_id' };
  }
  if (!constantTimeEqualString(claims.ch, input.expectedChallenge)) {
    return { valid: false, reason: 'wrong_challenge' };
  }

  const nowSeconds = Math.floor(input.nowMs / 1000);
  const skew = input.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;
  const maxAge =
    input.maxProofAgeSeconds ?? DEFAULT_MAX_PROOF_AGE_SECONDS;
  if (claims.iat > nowSeconds + skew) {
    return { valid: false, reason: 'not_yet_valid' };
  }
  if (claims.exp <= nowSeconds) {
    return { valid: false, reason: 'expired' };
  }
  if (
    claims.exp - claims.iat > maxAge ||
    nowSeconds - claims.iat > maxAge + skew
  ) {
    return { valid: false, reason: 'proof_too_old' };
  }

  return {
    valid: true,
    header: proof.header,
    claims: proof.claims,
  };
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64UrlDecode(value: string): Uint8Array {
  if (
    !/^[A-Za-z0-9_-]*$/.test(value) ||
    value.length % 4 === 1
  ) {
    throw new RequestProofError('invalid_format');
  }
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new RequestProofError('invalid_format');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function parseHeader(value: unknown): RequestProofHeader {
  const record = asRecord(value, 'invalid_format');
  assertOnlyKeys(record, HEADER_KEYS, 'invalid_format');
  if (record.alg !== REQUEST_PROOF_ALGORITHM) {
    throw new RequestProofError('unsupported_algorithm');
  }
  if (record.typ !== REQUEST_PROOF_TYPE) {
    throw new RequestProofError('invalid_format');
  }
  if (typeof record.kid !== 'string' || !record.kid.trim()) {
    throw new RequestProofError('invalid_format');
  }
  return {
    alg: REQUEST_PROOF_ALGORITHM,
    typ: REQUEST_PROOF_TYPE,
    kid: record.kid,
  };
}

function parseClaims(value: unknown): RequestProofClaims {
  const record = asRecord(value, 'invalid_claims');
  assertOnlyKeys(record, CLAIM_KEYS, 'invalid_claims');

  if (record.v !== REQUEST_PROOF_VERSION) {
    throw new RequestProofError('invalid_claims');
  }
  const iss = boundedString(record.iss, 256);
  const sub = boundedString(record.sub, 256);
  const aud = boundedString(record.aud, 256);
  const jti = boundedString(record.jti, 128);
  const cid = boundedString(record.cid, 128);
  const ch = boundedString(record.ch, 128);
  const htm = boundedString(record.htm, 32);
  const htu = boundedString(record.htu, 512);
  const bh = boundedString(record.bh, 64).toLowerCase();

  if (!/^[A-Z]+$/.test(htm) || !htu.startsWith('/')) {
    throw new RequestProofError('invalid_claims');
  }
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(jti)) {
    throw new RequestProofError('invalid_claims');
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(cid)) {
    throw new RequestProofError('invalid_claims');
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(ch)) {
    throw new RequestProofError('invalid_claims');
  }
  if (!HEX_HASH_PATTERN.test(bh)) {
    throw new RequestProofError('invalid_claims');
  }
  if (
    !Number.isSafeInteger(record.iat) ||
    !Number.isSafeInteger(record.exp)
  ) {
    throw new RequestProofError('invalid_claims');
  }
  const iat = record.iat as number;
  const exp = record.exp as number;
  if (iat < 0 || exp <= iat) {
    throw new RequestProofError('invalid_claims');
  }

  return {
    v: REQUEST_PROOF_VERSION,
    iss,
    sub,
    aud,
    iat,
    exp,
    jti,
    htm,
    htu,
    bh,
    cid,
    ch,
  };
}

function asRecord(
  value: unknown,
  code: RequestProofErrorCode,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestProofError(code);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  code: RequestProofErrorCode,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new RequestProofError(code);
    }
  }
}

function boundedString(value: unknown, maxLength: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maxLength
  ) {
    throw new RequestProofError('invalid_claims');
  }
  return value;
}

function constantTimeEqualString(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |=
      (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer as ArrayBuffer;
}
