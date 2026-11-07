import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import test from 'node:test';

import type { ChallengeSqlStorage } from '../src/auth/challengeStorageAdapter';
import { SyntheticAttestationVerifier } from '../src/auth/attestation';
import {
  ChallengeIssuanceLimitError,
  ChallengeReplayProtector,
  InMemoryChallengeIssuanceLimiter,
  type ChallengeConsumeInput,
  type ChallengeInspectInput,
} from '../src/auth/challengeStore';
import { InMemoryPublicKeyRegistry } from '../src/auth/publicKeyRegistry';
import { SignedRequestAuthenticator } from '../src/auth/signedRequestAuthenticator';
import { SqliteChallengeStore } from '../src/auth/sqliteChallengeStore';
import {
  createTestKeyPair,
  requestProofClaims,
  requestProofHeader,
  sha256Hex,
  signRequestProof,
} from './authTestUtils';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const KEY_ID = 'sqlite-test-key';
const SUBJECT = 'sqlite-test-install';

class NodeSqlStorage implements ChallengeSqlStorage {
  private readonly database: DatabaseSync;

  constructor(path = ':memory:') {
    this.database = new DatabaseSync(path, { timeout: 5_000 });
  }

  transaction<T>(work: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  get<T>(
    sql: string,
    params: readonly (string | number | null)[] = [],
  ): T | undefined {
    return this.database
      .prepare(sql)
      .get(...(params as SQLInputValue[])) as T | undefined;
  }

  all<T>(
    sql: string,
    params: readonly (string | number | null)[] = [],
  ): T[] {
    return this.database
      .prepare(sql)
      .all(...(params as SQLInputValue[])) as T[];
  }

  run(
    sql: string,
    params: readonly (string | number | null)[] = [],
  ): void {
    this.database.prepare(sql).run(...(params as SQLInputValue[]));
  }

  close(): void {
    this.database.close();
  }
}

function createStore(
  storage: ChallengeSqlStorage,
  retentionMs = 5_000,
): SqliteChallengeStore {
  return new SqliteChallengeStore(storage, { retentionMs });
}

async function issue(store: SqliteChallengeStore, ttlMs = 60_000) {
  return store.issue({
    keyId: KEY_ID,
    subject: SUBJECT,
    ttlMs,
    nowMs: NOW,
  });
}

function inspectInput(
  issued: { challengeId: string; challenge: string },
  overrides: Partial<ChallengeInspectInput> = {},
): ChallengeInspectInput {
  return {
    challengeId: issued.challengeId,
    challenge: issued.challenge,
    keyId: KEY_ID,
    subject: SUBJECT,
    nowMs: NOW,
    ...overrides,
  };
}

function consumeInput(
  issued: { challengeId: string; challenge: string },
  overrides: Partial<ChallengeConsumeInput> = {},
): ChallengeConsumeInput {
  return {
    challengeId: issued.challengeId,
    challenge: issued.challenge,
    keyId: KEY_ID,
    subject: SUBJECT,
    nowMs: NOW,
    ...overrides,
  };
}

test('SQLite challenge schema is idempotent and stores no plaintext challenge', async () => {
  const storage = new NodeSqlStorage();
  const store = createStore(storage);
  const second = createStore(storage);
  assert.ok(second);

  const columns = storage
    .all<{ name: string }>(
      "SELECT name FROM pragma_table_info('auth_challenges')",
    )
    .map((column) => column.name);
  assert.deepEqual(columns.sort(), [
    'challenge_hash',
    'challenge_id',
    'consumed_at_ms',
    'expires_at_ms',
    'issued_at_ms',
    'key_id',
    'subject',
  ]);
  for (const forbidden of [
    'message',
    'amount',
    'wallet',
    'container',
    'body',
    'provider_response',
    'private_key',
    'token',
  ]) {
    assert.equal(columns.includes(forbidden), false);
  }

  const issued = await issue(store);
  const row = storage.get<Record<string, unknown>>(
    'SELECT * FROM auth_challenges WHERE challenge_id = ?',
    [issued.challengeId],
  );
  assert.ok(row);
  assert.equal(row.challenge_hash === issued.challenge, false);
  assert.equal(JSON.stringify(row).includes(issued.challenge), false);
  assert.equal(row.key_id, KEY_ID);
  assert.equal(row.subject, SUBJECT);
  assert.equal(row.issued_at_ms, NOW);
  assert.equal(row.expires_at_ms, NOW + 60_000);
  assert.equal(row.consumed_at_ms, null);
  storage.close();
});

test('SQLite challenge inspect/consume is single-use and rejects reuse', async () => {
  const store = createStore(new NodeSqlStorage());
  const issued = await issue(store);
  assert.deepEqual(await store.inspect(inspectInput(issued)), {
    status: 'active',
    expiresAtMs: NOW + 60_000,
  });
  assert.deepEqual(await store.consume(consumeInput(issued)), {
    status: 'consumed',
  });
  assert.deepEqual(await store.inspect(inspectInput(issued)), {
    status: 'consumed',
  });
  assert.deepEqual(await store.consume(consumeInput(issued)), {
    status: 'already_consumed',
  });
});

test('SQLite challenge rejects expiry, wrong key, wrong subject, and wrong challenge', async () => {
  const store = createStore(new NodeSqlStorage());
  const expired = await issue(store, 1_000);
  assert.deepEqual(
    await store.consume(consumeInput(expired, {
      nowMs: NOW + 1_000,
    })),
    { status: 'expired' },
  );

  const bound = await issue(store);
  assert.deepEqual(
    await store.consume(consumeInput(bound, { keyId: 'other-key' })),
    { status: 'binding_mismatch' },
  );
  assert.deepEqual(
    await store.consume(consumeInput(bound, { subject: 'other-subject' })),
    { status: 'binding_mismatch' },
  );
  assert.deepEqual(
    await store.consume(consumeInput(bound, { challenge: 'other-challenge' })),
    { status: 'binding_mismatch' },
  );
});

test('SQLite challenge cleanup honors the configured retention window', async () => {
  const store = createStore(new NodeSqlStorage(), 1_000);
  const issued = await issue(store, 1_000);
  assert.equal(await store.cleanup(NOW + 2_000), 0);
  assert.equal(
    (await store.inspect(inspectInput(issued, { nowMs: NOW + 2_000 }))).status,
    'expired',
  );
  assert.equal(await store.cleanup(NOW + 2_001), 1);
  assert.deepEqual(
    await store.inspect(inspectInput(issued, { nowMs: NOW + 2_001 })),
    { status: 'unknown' },
  );
});

test('cleanup removes consumed challenges without making them reusable', async () => {
  const store = createStore(new NodeSqlStorage(), 1_000);
  const issued = await issue(store, 1_000);
  assert.deepEqual(await store.consume(consumeInput(issued)), {
    status: 'consumed',
  });
  assert.equal(await store.cleanup(NOW + 2_001), 1);
  assert.deepEqual(
    await store.inspect(inspectInput(issued, { nowMs: NOW + 2_001 })),
    { status: 'unknown' },
  );
  assert.deepEqual(
    await store.consume(consumeInput(issued, { nowMs: NOW + 2_001 })),
    { status: 'unknown' },
  );
});

test('challenge issuance limiter bounds persistent challenge creation', async () => {
  const storage = new NodeSqlStorage();
  const store = new SqliteChallengeStore(storage, {
    retentionMs: 5_000,
    issuanceLimiter: new InMemoryChallengeIssuanceLimiter(2, 60_000),
  });
  await issue(store);
  await issue(store);
  await assert.rejects(
    () => issue(store),
    ChallengeIssuanceLimitError,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM auth_challenges',
    )?.n,
    2,
  );
  storage.close();
});

test('duplicate challenge ID insertion retries safely', async () => {
  const base = new NodeSqlStorage();
  let collisions = 1;
  const storage: ChallengeSqlStorage = {
    transaction: <T>(work: () => T): T => base.transaction(work),
    exec: (sql) => base.exec(sql),
    get: <T>(sql: string, params?: readonly (string | number | null)[]) =>
      base.get<T>(sql, params),
    run: (sql, params) => {
      if (
        collisions > 0 &&
        sql.includes('INSERT INTO auth_challenges')
      ) {
        collisions -= 1;
        throw new Error(
          'UNIQUE constraint failed: auth_challenges.challenge_id',
        );
      }
      base.run(sql, params);
    },
  };
  const store = createStore(storage);
  const issued = await issue(store);
  assert.ok(issued.challengeId);
  assert.equal(
    base.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM auth_challenges',
    )?.n,
    1,
  );
  base.close();
});

test('failed consumption transaction rolls back consumed state', async () => {
  const base = new NodeSqlStorage();
  let failAfterUpdate = false;
  const storage: ChallengeSqlStorage = {
    transaction: <T>(work: () => T): T => base.transaction(work),
    exec: (sql) => base.exec(sql),
    get: <T>(sql: string, params?: readonly (string | number | null)[]) =>
      base.get<T>(sql, params),
    run: (sql, params) => {
      base.run(sql, params);
      if (failAfterUpdate && sql.includes('UPDATE auth_challenges')) {
        throw new Error('post-update failure');
      }
    },
  };
  const store = createStore(storage);
  const issued = await issue(store);
  failAfterUpdate = true;
  await assert.rejects(
    () => store.consume(consumeInput(issued)),
    /post-update failure/,
  );
  failAfterUpdate = false;
  assert.equal(
    base.get<{ consumed_at_ms: number | null }>(
      'SELECT consumed_at_ms FROM auth_challenges WHERE challenge_id = ?',
      [issued.challengeId],
    )?.consumed_at_ms,
    null,
  );
  assert.deepEqual(await store.consume(consumeInput(issued)), {
    status: 'consumed',
  });
  base.close();
});

test('SQLite challenge consumption is atomic across two simulated gateway instances', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pocketa-auth-'));
  const path = join(directory, 'challenge.db');
  const storageA = new NodeSqlStorage(path);
  const storageB = new NodeSqlStorage(path);
  try {
    const storeA = createStore(storageA);
    const storeB = createStore(storageB);
    const issued = await storeA.issue({
      keyId: KEY_ID,
      subject: SUBJECT,
      ttlMs: 60_000,
      nowMs: NOW,
    });
    const results = await Promise.all([
      storeA.consume(consumeInput(issued)),
      storeB.consume(consumeInput(issued)),
    ]);
    assert.equal(
      results.filter((result) => result.status === 'consumed').length,
      1,
    );
    assert.equal(
      results.filter((result) => result.status === 'already_consumed').length,
      1,
    );
  } finally {
    storageA.close();
    storageB.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SQLite challenge store integrates with signed authentication and replay', async () => {
  const storage = new NodeSqlStorage();
  const store = createStore(storage);
  const pair = await createTestKeyPair();
  const registry = new InMemoryPublicKeyRegistry();
  registry.register({
    keyId: KEY_ID,
    subject: SUBJECT,
    publicKey: pair.publicKey,
    attestation: 'verified',
  });
  const issued = await issue(store);
  const body = JSON.stringify({ version: 'online-intent-v1' });
  const bodyHash = sha256Hex(body);
  const nowSeconds = Math.floor(NOW / 1000);
  const proof = await signRequestProof({
    privateKey: pair.privateKey,
    header: requestProofHeader(KEY_ID),
    claims: requestProofClaims({
      issuer: 'pocketa-test-issuer',
      subject: SUBJECT,
      audience: 'gateway.test',
      proofId: 'sqlite-proof-0001',
      challengeId: issued.challengeId,
      challenge: issued.challenge,
      bodyHashHex: bodyHash,
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 60,
    }),
  });
  const authenticator = new SignedRequestAuthenticator({
    registry,
    challenges: store,
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
    issuer: 'pocketa-test-issuer',
    audience: 'gateway.test',
    now: () => NOW,
  });
  const identity = await authenticator.authenticate(proof, {
    method: 'POST',
    route: '/v1/assistant/interpret',
    canonicalBodyHash: bodyHash,
    challenge: issued.challenge,
    challengeId: issued.challengeId,
  });
  assert.equal(identity.keyId, KEY_ID);
  assert.equal(identity.subject, `pseudo:${SUBJECT}`);

  const protector = new ChallengeReplayProtector(store, {
    now: () => NOW,
    registry,
  });
  const context = {
    identitySubject: identity.subject,
    method: 'POST',
    route: '/v1/assistant/interpret',
    canonicalBodyHash: bodyHash,
    challenge: issued.challenge,
    challengeId: issued.challengeId,
    keyId: KEY_ID,
  };
  assert.deepEqual(await protector.consume(context), { accepted: true });
  assert.deepEqual(await protector.consume(context), {
    accepted: false,
    reason: 'already_consumed',
  });
  storage.close();
});

test('SQLite challenge storage failures fail closed', async () => {
  const base = new NodeSqlStorage();
  let fail = false;
  const failing: ChallengeSqlStorage = {
    transaction: <T>(work: () => T): T => {
      if (fail) throw new Error('challenge storage unavailable');
      return base.transaction(work);
    },
    exec: (sql) => base.exec(sql),
    get: <T>(sql: string, params?: readonly (string | number | null)[]) =>
      base.get<T>(sql, params),
    run: (sql, params) => base.run(sql, params),
  };
  const store = createStore(failing);
  const issued = await issue(store);
  fail = true;
  await assert.rejects(
    () => store.consume(consumeInput(issued)),
    /challenge storage unavailable/,
  );
  base.close();
});

test('SQLite challenge rejects unknown challenge identifiers', async () => {
  const store = createStore(new NodeSqlStorage());
  assert.deepEqual(
    await store.inspect({
      challengeId: 'unknown-challenge',
      challenge: 'unknown-challenge-value',
      keyId: KEY_ID,
      subject: SUBJECT,
      nowMs: NOW,
    }),
    { status: 'unknown' },
  );
  assert.deepEqual(
    await store.consume({
      challengeId: 'unknown-challenge',
      challenge: 'unknown-challenge-value',
      keyId: KEY_ID,
      subject: SUBJECT,
      nowMs: NOW,
    }),
    { status: 'unknown' },
  );
});

test('SQLite challenge rejects invalid retention and issuer limits', () => {
  assert.throws(
    () =>
      new SqliteChallengeStore(new NodeSqlStorage(), {
        retentionMs: -1,
      }),
    /retention/i,
  );
  assert.throws(
    () => new InMemoryChallengeIssuanceLimiter(0, 1_000),
    /issuance limits/i,
  );
  assert.throws(
    () => new InMemoryChallengeIssuanceLimiter(1, 0),
    /issuance limits/i,
  );
});

test('SQLite challenge rejects invalid identifiers, timestamps, and TTLs', async () => {
  const store = createStore(new NodeSqlStorage());
  await assert.rejects(
    () =>
      store.issue({
        keyId: 'bad key',
        subject: SUBJECT,
        ttlMs: 1_000,
        nowMs: NOW,
      }),
    /keyId/,
  );
  await assert.rejects(
    () =>
      store.issue({
        keyId: KEY_ID,
        subject: SUBJECT,
        ttlMs: 0,
        nowMs: NOW,
      }),
    /TTL/,
  );
  await assert.rejects(
    () =>
      store.issue({
        keyId: KEY_ID,
        subject: SUBJECT,
        ttlMs: 1_000,
        nowMs: -1,
      }),
    /time/,
  );
  await assert.rejects(
    () =>
      store.inspect({
        challengeId: '',
        challenge: 'challenge',
        keyId: KEY_ID,
        nowMs: NOW,
      }),
    /challengeId/,
  );
});
