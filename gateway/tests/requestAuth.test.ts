import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AuthenticationError,
  AuthenticatorUnavailableError,
} from '../src/errors';
import {
  SyntheticAttestationVerifier,
  type SyntheticAttestationFixture,
} from '../src/auth/attestation';
import { InMemoryChallengeStore } from '../src/auth/challengeStore';
import {
  InMemoryPublicKeyRegistry,
  type RegisteredPublicKey,
} from '../src/auth/publicKeyRegistry';
import {
  REQUEST_PROOF_TYPE,
  RequestProofError,
  parseRequestProof,
  type RequestProofClaims,
} from '../src/auth/requestProof';
import { SignedRequestAuthenticator } from '../src/auth/signedRequestAuthenticator';
import {
  createTestKeyPair,
  requestProofClaims,
  requestProofHeader,
  sha256Hex,
  signRequestProof,
} from './authTestUtils';

const ISSUER = 'pocketa-test-issuer';
const AUDIENCE = 'gateway.test';
const METHOD = 'POST';
const ROUTE = '/v1/assistant/interpret';
const KEY_ID = 'test-key-a';
const SUBJECT = 'install-a';
const PROOF_ID = 'proof-id-0001';
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const NOW_SECONDS = Math.floor(NOW / 1000);
const BODY = JSON.stringify({
  version: 'online-intent-v1',
  message: 'Synthetic request',
});
const BODY_HASH = sha256Hex(BODY);

interface Context {
  authenticator: SignedRequestAuthenticator;
  challenges: InMemoryChallengeStore;
  registry: InMemoryPublicKeyRegistry;
  privateKey: CryptoKey;
  challengeId: string;
  challenge: string;
}

async function createContext(options: {
  attestationFixture?: SyntheticAttestationFixture;
  allowSyntheticAttestation?: boolean;
  now?: () => number;
  pseudonymize?: (subject: string) => string;
} = {}): Promise<Context> {
  const pair = await createTestKeyPair();
  const registry = new InMemoryPublicKeyRegistry();
  const registered: RegisteredPublicKey = {
    keyId: KEY_ID,
    subject: SUBJECT,
    publicKey: pair.publicKey,
    attestation: 'verified',
  };
  registry.register(registered);
  const challenges = new InMemoryChallengeStore();
  const challenge = await challenges.issue({
    keyId: KEY_ID,
    subject: SUBJECT,
    ttlMs: 60_000,
    nowMs: NOW,
  });
  const authenticator = new SignedRequestAuthenticator({
    registry,
    challenges,
    attestationVerifier: new SyntheticAttestationVerifier(
      new Map([
        [
          KEY_ID,
          options.attestationFixture ?? {
            status: 'accepted',
            assurance: 'synthetic_verified',
          },
        ],
      ]),
    ),
    allowSyntheticAttestation: options.allowSyntheticAttestation ?? true,
    pseudonymize: options.pseudonymize ?? ((subject) => `pseudo:${subject}`),
    issuer: ISSUER,
    audience: AUDIENCE,
    now: options.now ?? (() => NOW),
  });
  return {
    authenticator,
    challenges,
    registry,
    privateKey: pair.privateKey,
    challengeId: challenge.challengeId,
    challenge: challenge.challenge,
  };
}

async function sign(
  context: Context,
  overrides: Partial<{
    issuer: string;
    subject: string;
    audience: string;
    proofId: string;
    challengeId: string;
    challenge: string;
    method: string;
    route: string;
    bodyHash: string;
    issuedAt: number;
    expiresAt: number;
    kid: string;
  }> = {},
): Promise<string> {
  return signRequestProof({
    privateKey: context.privateKey,
    header: requestProofHeader(overrides.kid ?? KEY_ID),
    claims: requestProofClaims({
      issuer: overrides.issuer ?? ISSUER,
      subject: overrides.subject ?? SUBJECT,
      audience: overrides.audience ?? AUDIENCE,
      proofId: overrides.proofId ?? PROOF_ID,
      challengeId: overrides.challengeId ?? context.challengeId,
      challenge: overrides.challenge ?? context.challenge,
      method: overrides.method ?? METHOD,
      route: overrides.route ?? ROUTE,
      bodyHashHex: overrides.bodyHash ?? BODY_HASH,
      issuedAt: overrides.issuedAt ?? NOW_SECONDS,
      expiresAt: overrides.expiresAt ?? NOW_SECONDS + 60,
    }),
  });
}

function authContext(
  setup: Context,
  overrides: Partial<
    Parameters<SignedRequestAuthenticator['authenticate']>[1]
  > = {},
) {
  return {
    method: METHOD,
    route: ROUTE,
    canonicalBodyHash: BODY_HASH,
    challenge: setup.challenge,
    challengeId: setup.challengeId,
    ...overrides,
  };
}

test('valid request proof authenticates with a pseudonymous identity', async () => {
  const setup = await createContext();
  const identity = await setup.authenticator.authenticate(
    await sign(setup),
    authContext(setup),
  );
  assert.equal(identity.subject, `pseudo:${SUBJECT}`);
  assert.equal(identity.attestation, 'verified');
  assert.equal(identity.assurance, 'synthetic_verified');
  assert.equal(identity.keyId, KEY_ID);
  assert.equal(identity.expiresAt, (NOW_SECONDS + 60) * 1000);
});

test('request proof rejects body, method, route, audience, issuer, subject, challenge, and key changes', async () => {
  const setup = await createContext();
  const cases = [
    { proof: await sign(setup, { bodyHash: sha256Hex('other body') }) },
    { proof: await sign(setup, { method: 'GET' }) },
    { proof: await sign(setup, { route: '/v1/other' }) },
    { proof: await sign(setup, { audience: 'other-gateway' }) },
    { proof: await sign(setup, { issuer: 'other-issuer' }) },
    { proof: await sign(setup, { subject: 'other-install' }) },
    { proof: await sign(setup, { challengeId: 'other-challenge-id' }) },
    { proof: await sign(setup, { challenge: 'other-challenge' }) },
    { proof: await sign(setup, { kid: 'unknown-key' }) },
  ];
  for (const item of cases) {
    await assert.rejects(
      () => setup.authenticator.authenticate(item.proof, authContext(setup)),
      AuthenticationError,
    );
  }
});

test('request proof rejects a signature from an unregistered key', async () => {
  const setup = await createContext();
  const other = await createTestKeyPair();
  const proof = await signRequestProof({
    privateKey: other.privateKey,
    header: requestProofHeader(KEY_ID),
    claims: requestProofClaims({
      issuer: ISSUER,
      subject: SUBJECT,
      audience: AUDIENCE,
      proofId: PROOF_ID,
      challengeId: setup.challengeId,
      challenge: setup.challenge,
      bodyHashHex: BODY_HASH,
      issuedAt: NOW_SECONDS,
      expiresAt: NOW_SECONDS + 60,
    }),
  });
  await assert.rejects(
    () => setup.authenticator.authenticate(proof, authContext(setup)),
    AuthenticationError,
  );
});

test('request proof rejects expired, future-issued, and overlong proofs', async () => {
  const setup = await createContext();
  const expired = await sign(setup, {
    issuedAt: NOW_SECONDS - 120,
    expiresAt: NOW_SECONDS - 1,
  });
  const future = await sign(setup, {
    issuedAt: NOW_SECONDS + 120,
    expiresAt: NOW_SECONDS + 180,
  });
  const tooOld = await sign(setup, {
    issuedAt: NOW_SECONDS - 200,
    expiresAt: NOW_SECONDS + 60,
  });
  for (const proof of [expired, future, tooOld]) {
    await assert.rejects(
      () => setup.authenticator.authenticate(proof, authContext(setup)),
      AuthenticationError,
    );
  }
});

test('synthetic attestation fixtures drive acceptance and failure status', async () => {
  const accepted = await createContext();
  const identity = await accepted.authenticator.authenticate(
    await sign(accepted),
    authContext(accepted),
  );
  assert.equal(identity.attestation, 'verified');
  assert.equal(identity.assurance, 'synthetic_verified');

  const rejected = await createContext({
    attestationFixture: { status: 'rejected' },
  });
  const rejectedProof = await sign(rejected);
  await assert.rejects(
    () =>
      rejected.authenticator.authenticate(
        rejectedProof,
        authContext(rejected),
      ),
    AuthenticationError,
  );

  const expired = await createContext({
    attestationFixture: { status: 'expired' },
  });
  const expiredProof = await sign(expired);
  await assert.rejects(
    () =>
      expired.authenticator.authenticate(
        expiredProof,
        authContext(expired),
      ),
    AuthenticationError,
  );

  const unavailable = await createContext({
    attestationFixture: { status: 'unavailable' },
  });
  const unavailableProof = await sign(unavailable);
  await assert.rejects(
    () =>
      unavailable.authenticator.authenticate(
        unavailableProof,
        authContext(unavailable),
      ),
    AuthenticatorUnavailableError,
  );

  const unsupported = await createContext({
    attestationFixture: {
      status: 'unsupported_assurance',
      assurance: 'unsupported',
    },
  });
  const unsupportedProof = await sign(unsupported);
  await assert.rejects(
    () =>
      unsupported.authenticator.authenticate(
        unsupportedProof,
        authContext(unsupported),
      ),
    AuthenticationError,
  );
});

test('synthetic attestation is rejected by default composition', async () => {
  const pair = await createTestKeyPair();
  const registry = new InMemoryPublicKeyRegistry();
  registry.register({
    keyId: KEY_ID,
    subject: SUBJECT,
    publicKey: pair.publicKey,
    attestation: 'verified',
  });
  assert.throws(
    () =>
      new SignedRequestAuthenticator({
        registry,
        challenges: new InMemoryChallengeStore(),
        attestationVerifier: new SyntheticAttestationVerifier(
          new Map([
            [
              KEY_ID,
              {
                status: 'accepted',
                assurance: 'synthetic_verified',
              },
            ],
          ]),
        ),
        pseudonymize: (subject) => `pseudo:${subject}`,
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    /Synthetic attestation/i,
  );
});

test('challenge must exist and must be current', async () => {
  const setup = await createContext();
  const unknownChallengeProof = await signRequestProof({
    privateKey: setup.privateKey,
    header: requestProofHeader(KEY_ID),
    claims: requestProofClaims({
      issuer: ISSUER,
      subject: SUBJECT,
      audience: AUDIENCE,
      proofId: PROOF_ID,
      challengeId: 'not-issued',
      challenge: 'not-issued',
      bodyHashHex: BODY_HASH,
      issuedAt: NOW_SECONDS,
      expiresAt: NOW_SECONDS + 60,
    }),
  });
  await assert.rejects(
    () =>
      setup.authenticator.authenticate(
        unknownChallengeProof,
        authContext(setup, {
          challengeId: 'not-issued',
          challenge: 'not-issued',
        }),
      ),
    AuthenticationError,
  );

  const expiredStore = new InMemoryChallengeStore();
  const challenge = await expiredStore.issue({
    keyId: KEY_ID,
    subject: SUBJECT,
    ttlMs: 1_000,
    nowMs: NOW,
  });
  const pair = await createTestKeyPair();
  const registry = new InMemoryPublicKeyRegistry();
  registry.register({
    keyId: KEY_ID,
    subject: SUBJECT,
    publicKey: pair.publicKey,
    attestation: 'verified',
  });
  const authenticator = new SignedRequestAuthenticator({
    registry,
    challenges: expiredStore,
    attestationVerifier: new SyntheticAttestationVerifier(
      new Map([
        [
          KEY_ID,
          {
            status: 'accepted',
            assurance: 'synthetic_verified',
          },
        ],
      ]),
    ),
    allowSyntheticAttestation: true,
    pseudonymize: (subject) => `pseudo:${subject}`,
    issuer: ISSUER,
    audience: AUDIENCE,
    now: () => NOW + 2_000,
  });
  const proof = await signRequestProof({
    privateKey: pair.privateKey,
    header: requestProofHeader(KEY_ID),
    claims: requestProofClaims({
      issuer: ISSUER,
      subject: SUBJECT,
      audience: AUDIENCE,
      proofId: PROOF_ID,
      challengeId: challenge.challengeId,
      challenge: challenge.challenge,
      bodyHashHex: BODY_HASH,
      issuedAt: NOW_SECONDS,
      expiresAt: NOW_SECONDS + 60,
    }),
  });
  await assert.rejects(
    () =>
      authenticator.authenticate(proof, {
        method: METHOD,
        route: ROUTE,
        canonicalBodyHash: BODY_HASH,
        challengeId: challenge.challengeId,
        challenge: challenge.challenge,
      }),
    AuthenticationError,
  );
});

test('malformed proofs and unsupported algorithms are rejected', async () => {
  const setup = await createContext();
  for (const proof of ['', 'a.b', 'a.b.c', 'not-a-proof']) {
    await assert.rejects(
      () => setup.authenticator.authenticate(proof, authContext(setup)),
      AuthenticationError,
    );
  }

  const header = Buffer.from(
    JSON.stringify({
      alg: 'none',
      typ: REQUEST_PROOF_TYPE,
      kid: KEY_ID,
    }),
  ).toString('base64url');
  const payload = Buffer.from(JSON.stringify({})).toString('base64url');
  assert.throws(
    () => parseRequestProof(`${header}.${payload}.AA`),
    (error: unknown) =>
      error instanceof RequestProofError &&
      error.code === 'unsupported_algorithm',
  );

  const embeddedKeyHeader = Buffer.from(
    JSON.stringify({
      alg: 'ES256',
      typ: REQUEST_PROOF_TYPE,
      kid: KEY_ID,
      jwk: { kty: 'EC' },
    }),
  ).toString('base64url');
  assert.throws(
    () => parseRequestProof(`${embeddedKeyHeader}.${payload}.AA`),
    (error: unknown) =>
      error instanceof RequestProofError &&
      error.code === 'invalid_format',
  );

  const extraClaimPayload = Buffer.from(
    JSON.stringify({ attested: true }),
  ).toString('base64url');
  assert.throws(
    () =>
      parseRequestProof(
        `${Buffer.from(
          JSON.stringify({
            alg: 'ES256',
            typ: REQUEST_PROOF_TYPE,
            kid: KEY_ID,
          }),
        ).toString('base64url')}.${extraClaimPayload}.AA`,
      ),
    (error: unknown) =>
      error instanceof RequestProofError &&
      error.code === 'invalid_claims',
  );

  const completeClaims = requestProofClaims({
    issuer: ISSUER,
    subject: SUBJECT,
    audience: AUDIENCE,
    proofId: PROOF_ID,
    challengeId: setup.challengeId,
    challenge: setup.challenge,
    bodyHashHex: BODY_HASH,
    issuedAt: NOW_SECONDS,
    expiresAt: NOW_SECONDS + 60,
  });
  const { ch: _ch, ...missingClaim } = completeClaims;
  const missingProof = await signRequestProof({
    privateKey: setup.privateKey,
    header: requestProofHeader(KEY_ID),
    claims: missingClaim as RequestProofClaims,
  });
  await assert.rejects(
    () => setup.authenticator.authenticate(missingProof, authContext(setup)),
    AuthenticationError,
  );
});

test('pseudonymizer failures fail closed', async () => {
  const setup = await createContext({
    pseudonymize: () => {
      throw new Error('pseudonymizer down');
    },
  });
  const proof = await sign(setup);
  await assert.rejects(
    () => setup.authenticator.authenticate(proof, authContext(setup)),
    AuthenticatorUnavailableError,
  );
});

test('revoked registered keys cannot authenticate', async () => {
  const setup = await createContext();
  const proof = await sign(setup);
  assert.equal(setup.registry.revoke(KEY_ID), true);
  await assert.rejects(
    () => setup.authenticator.authenticate(proof, authContext(setup)),
    AuthenticationError,
  );
});

test('public key registry rejects duplicates and revoked keys', async () => {
  const pair = await createTestKeyPair();
  const registry = new InMemoryPublicKeyRegistry();
  const entry: RegisteredPublicKey = {
    keyId: KEY_ID,
    subject: SUBJECT,
    publicKey: pair.publicKey,
    attestation: 'verified',
  };
  registry.register(entry);
  assert.throws(() => registry.register(entry), /already registered/);
  assert.equal(registry.revoke(KEY_ID), true);
  assert.equal(registry.revoke(KEY_ID), false);
  assert.equal(registry.get(KEY_ID), undefined);
});
