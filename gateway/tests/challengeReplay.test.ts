import assert from 'node:assert/strict';
import test from 'node:test';

import type { ReplayProtectionContext } from '../src/auth';
import {
  ChallengeReplayProtector,
  InMemoryChallengeStore,
  type ChallengeStore,
} from '../src/auth/challengeStore';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const KEY_ID = 'test-key-a';
const SUBJECT = 'install-a';

async function issue(
  store: InMemoryChallengeStore,
  overrides: Partial<{
    keyId: string;
    subject: string;
    ttlMs: number;
    nowMs: number;
  }> = {},
) {
  return store.issue({
    keyId: overrides.keyId ?? KEY_ID,
    subject: overrides.subject ?? SUBJECT,
    ttlMs: overrides.ttlMs ?? 60_000,
    nowMs: overrides.nowMs ?? NOW,
  });
}

function replayContext(
  issued: { challengeId: string; challenge: string },
  overrides: Partial<ReplayProtectionContext> = {},
): ReplayProtectionContext {
  return {
    identitySubject: 'pseudo:install-a',
    method: 'POST',
    route: '/v1/assistant/interpret',
    canonicalBodyHash: 'a'.repeat(64),
    challenge: issued.challenge,
    challengeId: issued.challengeId,
    keyId: KEY_ID,
    ...overrides,
  };
}

test('challenge store inspects, consumes once, and rejects reuse', async () => {
  const store = new InMemoryChallengeStore();
  const issued = await issue(store);
  assert.deepEqual(
    await store.inspect({
      challengeId: issued.challengeId,
      challenge: issued.challenge,
      keyId: KEY_ID,
      subject: SUBJECT,
      nowMs: NOW,
    }),
    {
      status: 'active',
      expiresAtMs: issued.expiresAtMs,
    },
  );
  assert.deepEqual(
    await store.consume({
      challengeId: issued.challengeId,
      challenge: issued.challenge,
      keyId: KEY_ID,
      subject: SUBJECT,
      nowMs: NOW,
    }),
    { status: 'consumed' },
  );
  assert.deepEqual(
    await store.inspect({
      challengeId: issued.challengeId,
      challenge: issued.challenge,
      keyId: KEY_ID,
      subject: SUBJECT,
      nowMs: NOW,
    }),
    { status: 'consumed' },
  );
  assert.deepEqual(
    await store.consume({
      challengeId: issued.challengeId,
      challenge: issued.challenge,
      keyId: KEY_ID,
      subject: SUBJECT,
      nowMs: NOW,
    }),
    { status: 'already_consumed' },
  );
});

test('concurrent challenge consumption admits exactly one consumer', async () => {
  const store = new InMemoryChallengeStore();
  const issued = await issue(store);
  const input = {
    challengeId: issued.challengeId,
    challenge: issued.challenge,
    keyId: KEY_ID,
    subject: SUBJECT,
    nowMs: NOW,
  };
  const results = await Promise.all([
    store.consume(input),
    store.consume(input),
  ]);
  assert.equal(
    results.filter((result) => result.status === 'consumed').length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === 'already_consumed').length,
    1,
  );
});

test('challenge store rejects expiry, key binding, and identity binding', async () => {
  const store = new InMemoryChallengeStore();
  const expired = await issue(store, { ttlMs: 1_000 });
  assert.deepEqual(
    await store.consume({
      challengeId: expired.challengeId,
      challenge: expired.challenge,
      keyId: KEY_ID,
      subject: SUBJECT,
      nowMs: NOW + 1_000,
    }),
    { status: 'expired' },
  );

  const bound = await issue(store);
  assert.deepEqual(
    await store.consume({
      challengeId: bound.challengeId,
      challenge: bound.challenge,
      keyId: 'other-key',
      subject: SUBJECT,
      nowMs: NOW,
    }),
    { status: 'binding_mismatch' },
  );
  assert.deepEqual(
    await store.consume({
      challengeId: bound.challengeId,
      challenge: bound.challenge,
      keyId: KEY_ID,
      subject: 'other-subject',
      nowMs: NOW,
    }),
    { status: 'binding_mismatch' },
  );
  assert.deepEqual(
    await store.consume({
      challengeId: bound.challengeId,
      challenge: 'other-challenge',
      keyId: KEY_ID,
      subject: SUBJECT,
      nowMs: NOW,
    }),
    { status: 'binding_mismatch' },
  );
});

test('challenge store cleanup removes only expired challenges', async () => {
  const store = new InMemoryChallengeStore();
  const expired = await issue(store, { ttlMs: 1_000 });
  const active = await issue(store, { ttlMs: 60_000 });
  assert.equal(await store.cleanup(NOW + 1_000), 1);
  assert.deepEqual(
    await store.inspect({
      challengeId: expired.challengeId,
      challenge: expired.challenge,
      keyId: KEY_ID,
      subject: SUBJECT,
      nowMs: NOW + 1_000,
    }),
    { status: 'unknown' },
  );
  assert.equal(
    (
      await store.inspect({
        challengeId: active.challengeId,
        challenge: active.challenge,
        keyId: KEY_ID,
        subject: SUBJECT,
        nowMs: NOW + 1_000,
      })
    ).status,
    'active',
  );
});

test('challenge replay protector maps successful and failed consumption', async () => {
  const store = new InMemoryChallengeStore();
  const issued = await issue(store);
  const protector = new ChallengeReplayProtector(store, { now: () => NOW });

  assert.deepEqual(
    await protector.consume(replayContext(issued)),
    { accepted: true },
  );
  assert.deepEqual(
    await protector.consume(replayContext(issued)),
    { accepted: false, reason: 'already_consumed' },
  );
  assert.deepEqual(
    await protector.consume(
      replayContext({
        challengeId: 'unknown',
        challenge: 'unknown',
      }),
    ),
    { accepted: false, reason: 'unknown' },
  );
  assert.deepEqual(
    await protector.consume(
      replayContext(issued, { challenge: null }),
    ),
    { accepted: false, reason: 'missing_challenge_metadata' },
  );
  assert.deepEqual(
    await protector.consume(
      replayContext(issued, { challengeId: null }),
    ),
    { accepted: false, reason: 'missing_challenge_metadata' },
  );
  assert.deepEqual(
    await protector.consume(
      replayContext(issued, { keyId: undefined }),
    ),
    { accepted: false, reason: 'missing_challenge_metadata' },
  );
});

test('challenge replay protector fails closed when storage throws', async () => {
  const failing: ChallengeStore = {
    async issue() {
      throw new Error('not used');
    },
    async inspect() {
      throw new Error('not used');
    },
    async consume() {
      throw new Error('challenge storage unavailable');
    },
    async cleanup() {
      return 0;
    },
  };
  const protector = new ChallengeReplayProtector(failing, {
    now: () => NOW,
  });
  await assert.rejects(
    () =>
      protector.consume(
        replayContext({
          challengeId: 'challenge-id',
          challenge: 'challenge',
        }),
      ),
    /challenge storage unavailable/,
  );
});
