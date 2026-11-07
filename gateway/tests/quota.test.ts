import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import test from 'node:test';

import { FakeAuthenticator } from '../src/auth';
import { FakeSemanticProvider } from '../src/provider';
import { handleGatewayRequest } from '../src/handler';
import { createTestGateway, InMemoryRateLimiter } from '../src/index';
import type { RateLimitContext } from '../src/rateLimit';
import {
  createDurableObjectQuotaStorage,
  type DurableObjectQuotaRuntime,
} from '../src/quota/durableObjectStorage';
import {
  hmacIdentityKey,
  type QuotaIdentityPseudonymizer,
} from '../src/quota/identityKey';
import {
  quotaObjectId,
  quotaObjectName,
  quotaObjectStub,
} from '../src/quota/routing';
import { SqliteQuotaLimiter } from '../src/quota/sqliteQuotaLimiter';
import {
  SqliteQuotaStore,
  type QuotaSqlStorage,
  type QuotaSqlValue,
} from '../src/quota/sqliteQuotaStore';
import {
  QuotaConfigError,
  type QuotaAdmissionInput,
  type QuotaConfig,
  type QuotaTokenReservation,
} from '../src/quota/types';

class NodeQuotaStorage implements QuotaSqlStorage {
  private readonly database: DatabaseSync;

  constructor(path = ':memory:', database?: DatabaseSync) {
    this.database = database ?? new DatabaseSync(path, { timeout: 0 });
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
    params: readonly QuotaSqlValue[] = [],
  ): T | undefined {
    return this.database
      .prepare(sql)
      .get(...(params as SQLInputValue[])) as T | undefined;
  }

  all<T>(
    sql: string,
    params: readonly QuotaSqlValue[] = [],
  ): T[] {
    return this.database
      .prepare(sql)
      .all(...(params as SQLInputValue[])) as T[];
  }

  run(sql: string, params: readonly QuotaSqlValue[] = []): void {
    this.database.prepare(sql).run(...(params as SQLInputValue[]));
  }

  close(): void {
    this.database.close();
  }
}

function quotaConfig(overrides: Partial<QuotaConfig> = {}): QuotaConfig {
  return {
    daily: {
      globalRequests: 100,
      identityRequests: 100,
      globalTokens: 100_000,
      identityTokens: 100_000,
    },
    reservationRetentionMs: 60_000,
    windowRetentionMs: 7 * 86_400_000,
    ...overrides,
  };
}

function tokenReservation(
  overrides: Partial<QuotaTokenReservation> = {},
): QuotaTokenReservation {
  return {
    expectedInputTokens: 100,
    maxOutputTokens: 0,
    framingOverheadTokens: 0,
    ...overrides,
  };
}

function admission(
  overrides: Partial<QuotaAdmissionInput> & { maxTokens?: number } = {},
): QuotaAdmissionInput {
  const { maxTokens, ...rest } = overrides;
  return {
    poolId: 'groq-free-primary',
    identityKey: 'identity-a',
    reservationId: 'reservation-a',
    now: Date.UTC(2026, 10, 7, 12, 0, 0),
    tokens: tokenReservation({
      expectedInputTokens: maxTokens ?? 100,
    }),
    ...rest,
  };
}

function createStore(
  config = quotaConfig(),
  storage = new NodeQuotaStorage(),
): { store: SqliteQuotaStore; storage: NodeQuotaStorage } {
  return {
    store: new SqliteQuotaStore(storage, config),
    storage,
  };
}

function runConcurrent<T>(
  tasks: ReadonlyArray<() => T | PromiseLike<T>>,
): Promise<Awaited<T>[]> {
  return Promise.all(tasks.map((task) => Promise.resolve().then(task)));
}

const pseudonymize: QuotaIdentityPseudonymizer = (subject) =>
  `pkey:${subject}`;

test('global and identity daily request caps reject without partial counters', () => {
  const config = quotaConfig({
    daily: {
      globalRequests: 2,
      identityRequests: 1,
      globalTokens: 10_000,
      identityTokens: 10_000,
    },
  });
  const { store, storage } = createStore(config);

  assert.deepEqual(store.admit(admission()), { status: 'admitted' });
  assert.deepEqual(store.admit(admission({
    identityKey: 'identity-b',
    reservationId: 'reservation-b',
  })), { status: 'admitted' });
  assert.deepEqual(store.admit(admission({
    identityKey: 'identity-c',
    reservationId: 'reservation-c',
  })), {
    status: 'quota_exhausted',
    scope: 'global',
    window: 'daily',
    retryAfterSeconds: 43_200,
  });

  const deniedIdentity = storage.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM quota_identity_windows
      WHERE identity_key = 'identity-c'`,
  );
  assert.equal(deniedIdentity?.count, 0);
  const global = storage.get<{ requests: number }>(
    `SELECT global_requests AS requests FROM quota_windows`,
  );
  assert.equal(global?.requests, 2);

  const identityStore = createStore(
    quotaConfig({
      daily: {
        globalRequests: 100,
        identityRequests: 1,
        globalTokens: 10_000,
        identityTokens: 10_000,
      },
    }),
  ).store;
  assert.deepEqual(identityStore.admit(admission()), {
    status: 'admitted',
  });
  assert.deepEqual(identityStore.admit(admission({
    reservationId: 'reservation-a2',
  })), {
    status: 'quota_exhausted',
    scope: 'identity',
    window: 'daily',
    retryAfterSeconds: 43_200,
  });
});

test('short-window request caps are enforced for global and identity scopes', () => {
  const config = quotaConfig({
    shortWindow: {
      seconds: 60,
      limits: {
        globalRequests: 1,
        identityRequests: 1,
        globalTokens: 10_000,
        identityTokens: 10_000,
      },
    },
  });
  const { store } = createStore(config);
  assert.deepEqual(store.admit(admission()), { status: 'admitted' });
  assert.deepEqual(store.admit(admission({
    identityKey: 'identity-b',
    reservationId: 'reservation-b',
  })), {
    status: 'quota_exhausted',
    scope: 'global',
    window: 'short',
    retryAfterSeconds: 60,
  });

  const identityConfig = quotaConfig({
    shortWindow: {
      seconds: 60,
      limits: {
        globalRequests: 10,
        identityRequests: 1,
        globalTokens: 10_000,
        identityTokens: 10_000,
      },
    },
  });
  const identityStore = createStore(identityConfig).store;
  assert.deepEqual(identityStore.admit(admission()), {
    status: 'admitted',
  });
  assert.deepEqual(identityStore.admit(admission({
    reservationId: 'reservation-a2',
  })), {
    status: 'quota_exhausted',
    scope: 'identity',
    window: 'short',
    retryAfterSeconds: 60,
  });
});

test('token reservations are conservative and enforce both scopes', () => {
  const globalConfig = quotaConfig({
    daily: {
      globalRequests: 10,
      identityRequests: 10,
      globalTokens: 100,
      identityTokens: 10_000,
    },
  });
  const globalStore = createStore(globalConfig).store;
  assert.deepEqual(globalStore.admit(admission({ maxTokens: 60 })), {
    status: 'admitted',
  });

  const globalStore2 = createStore(globalConfig).store;
  assert.deepEqual(globalStore2.admit(admission({ maxTokens: 60 })), {
    status: 'admitted',
  });
  assert.deepEqual(globalStore2.admit(admission({
    reservationId: 'reservation-b',
    maxTokens: 60,
  })), {
    status: 'quota_exhausted',
    scope: 'global',
    window: 'daily',
    retryAfterSeconds: 43_200,
  });

  const identityConfig = quotaConfig({
    daily: {
      globalRequests: 10,
      identityRequests: 10,
      globalTokens: 10_000,
      identityTokens: 100,
    },
  });
  const identityStore = createStore(identityConfig).store;
  assert.deepEqual(identityStore.admit(admission({ maxTokens: 60 })), {
    status: 'admitted',
  });
  assert.deepEqual(identityStore.admit(admission({
    reservationId: 'reservation-b',
    maxTokens: 60,
  })), {
    status: 'quota_exhausted',
    scope: 'identity',
    window: 'daily',
    retryAfterSeconds: 43_200,
  });
});

test('token reservations count input, output, and framing headroom together', () => {
  const config = quotaConfig({
    daily: {
      globalRequests: 10,
      identityRequests: 10,
      globalTokens: 150,
      identityTokens: 150,
    },
  });
  const { store, storage } = createStore(config);
  assert.deepEqual(
    store.admit(
      admission({
        tokens: tokenReservation({
          expectedInputTokens: 40,
          maxOutputTokens: 100,
          framingOverheadTokens: 10,
        }),
      }),
    ),
    { status: 'admitted' },
  );

  const global = storage.get<{ global_tokens: number }>(
    'SELECT global_tokens FROM quota_windows',
  );
  const identity = storage.get<{ tokens: number }>(
    'SELECT tokens FROM quota_identity_windows',
  );
  assert.equal(global?.global_tokens, 150);
  assert.equal(identity?.tokens, 150);

  assert.deepEqual(
    store.admit(
      admission({
        reservationId: 'reservation-b',
        tokens: tokenReservation({
          expectedInputTokens: 1,
          maxOutputTokens: 0,
          framingOverheadTokens: 0,
        }),
      }),
    ),
    {
      status: 'quota_exhausted',
      scope: 'global',
      window: 'daily',
      retryAfterSeconds: 43_200,
    },
  );
});

test('token reservations larger than either budget are rejected without partial writes', () => {
  const { store, storage } = createStore(
    quotaConfig({
      daily: {
        globalRequests: 10,
        identityRequests: 10,
        globalTokens: 100,
        identityTokens: 100,
      },
    }),
  );

  assert.deepEqual(
    store.admit(
      admission({
        tokens: tokenReservation({
          expectedInputTokens: 40,
          maxOutputTokens: 40,
          framingOverheadTokens: 21,
        }),
      }),
    ),
    {
      status: 'quota_exhausted',
      scope: 'global',
      window: 'daily',
      retryAfterSeconds: 43_200,
    },
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_windows',
    )?.n,
    0,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_reservations',
    )?.n,
    0,
  );
});

test('duplicate reservations are rejected and never consume counters twice', () => {
  const { store, storage } = createStore();
  const input = admission();
  assert.deepEqual(store.admit(input), { status: 'admitted' });
  assert.deepEqual(store.admit(input), {
    status: 'duplicate',
    reason: 'identical',
  });
  assert.deepEqual(store.admit({ ...input, identityKey: 'identity-b' }), {
    status: 'duplicate',
    reason: 'conflict',
  });
  assert.deepEqual(store.admit({ ...input, poolId: 'other-pool' }), {
    status: 'duplicate',
    reason: 'conflict',
  });
  assert.deepEqual(
    store.admit({
      ...input,
      tokens: tokenReservation({ expectedInputTokens: 101 }),
    }),
    {
      status: 'duplicate',
      reason: 'conflict',
    },
  );

  const global = storage.get<{ global_requests: number; global_tokens: number }>(
    `SELECT global_requests, global_tokens FROM quota_windows LIMIT 1`,
  );
  assert.equal(global?.global_requests, 1);
  assert.equal(global?.global_tokens, 100);
});

test('UTC daily windows roll over at midnight and short windows remain bounded', () => {
  const config = quotaConfig({
    daily: {
      globalRequests: 1,
      identityRequests: 1,
      globalTokens: 10_000,
      identityTokens: 10_000,
    },
  });
  const { store, storage } = createStore(config);
  const beforeMidnight = admission({
    now: Date.UTC(2026, 10, 7, 23, 59, 59),
    reservationId: 'before-midnight',
  });
  const afterMidnight = admission({
    now: Date.UTC(2026, 10, 8, 0, 0, 0),
    reservationId: 'after-midnight',
  });

  assert.equal(store.admit(beforeMidnight).status, 'admitted');
  assert.equal(store.admit(beforeMidnight).status, 'duplicate');
  assert.equal(store.admit(afterMidnight).status, 'admitted');

  const windows = storage.all<{ window_start_ms: number }>(
    `SELECT window_start_ms FROM quota_windows ORDER BY window_start_ms`,
  );
  assert.deepEqual(
    windows.map((window) => window.window_start_ms),
    [Date.UTC(2026, 10, 7), Date.UTC(2026, 10, 8)],
  );
});

test('UTC daily windows are independent of simulated local time zones', () => {
  const { store, storage } = createStore();
  const instant = Date.parse('2026-11-07T23:59:59Z');
  const fromUtcPlus14 = Date.parse('2026-11-08T13:59:59+14:00');
  const fromUtcMinus12 = Date.parse('2026-11-07T11:59:59-12:00');
  assert.equal(instant, fromUtcPlus14);
  assert.equal(instant, fromUtcMinus12);

  for (const [index, now] of [
    instant,
    fromUtcPlus14,
    fromUtcMinus12,
  ].entries()) {
    assert.equal(
      store.admit(admission({ now, reservationId: `timezone-${index}` }))
        .status,
      'admitted',
    );
  }
  let windows = storage.all<{ window_start_ms: number }>(
    `SELECT window_start_ms FROM quota_windows ORDER BY window_start_ms`,
  );
  assert.deepEqual(
    windows.map((window) => window.window_start_ms),
    [Date.UTC(2026, 10, 7)],
  );

  assert.equal(
    store.admit(admission({
      now: Date.UTC(2026, 10, 8, 0, 0, 0),
      reservationId: 'timezone-next-day',
    })).status,
    'admitted',
  );
  windows = storage.all<{ window_start_ms: number }>(
    `SELECT window_start_ms FROM quota_windows ORDER BY window_start_ms`,
  );
  assert.deepEqual(
    windows.map((window) => window.window_start_ms),
    [Date.UTC(2026, 10, 7), Date.UTC(2026, 10, 8)],
  );
});

test('short window duration is configurable and rolls over deterministically', () => {
  const config = quotaConfig({
    shortWindow: {
      seconds: 30,
      limits: {
        globalRequests: 1,
        identityRequests: 1,
        globalTokens: 10_000,
        identityTokens: 10_000,
      },
    },
  });
  const { store, storage } = createStore(config);
  const start = Date.UTC(2026, 10, 7, 12, 0, 0);

  assert.equal(store.admit(admission({ now: start })).status, 'admitted');
  assert.deepEqual(
    store.admit(admission({
      now: start + 29_999,
      reservationId: 'short-b',
    })),
    {
      status: 'quota_exhausted',
      scope: 'global',
      window: 'short',
      retryAfterSeconds: 1,
    },
  );
  assert.equal(
    store.admit(admission({
      now: start + 30_000,
      reservationId: 'short-c',
    })).status,
    'admitted',
  );

  const shortWindows = storage.all<{ window_start_ms: number }>(
    `SELECT window_start_ms FROM quota_windows
      WHERE window_kind = 'short'
      ORDER BY window_start_ms`,
  );
  assert.deepEqual(
    shortWindows.map((window) => window.window_start_ms),
    [start, start + 30_000],
  );
});

test('client clock headers and body dates cannot set quota time', async () => {
  const { store, storage } = createStore();
  const fixedNow = Date.UTC(2026, 10, 7, 12, 0, 0);
  const response = await handleGatewayRequest(
    new Request('https://gateway.test/v1/assistant/interpret', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid',
        'content-type': 'application/json',
        date: 'Sun, 08 Nov 2026 00:00:00 GMT',
        'x-pocketa-now': String(Date.UTC(2026, 11, 31, 23, 59, 59)),
        'x-pocketa-client-time': '2026-12-31T23:59:59Z',
      },
      body: JSON.stringify({
        version: 'online-intent-v1',
        message: 'Spent 50 on lunch from Food & drinks',
        todayDateKey: '2026-12-31',
        activeMonthKey: '2026-12',
        wallets: [{ ref: 'w1', label: 'Cash', kind: 'cash' }],
        containers: [{ ref: 'c1', label: 'Food & drinks', kind: 'ordinary' }],
      }),
    }),
    {
      enabled: true,
      authenticator: new FakeAuthenticator(
        new Map([
          ['valid', { subject: 'identity-a', expiresAt: 4_000_000_000_000, attestation: 'not_verified' as const }],
        ]),
      ),
      rateLimiter: new SqliteQuotaLimiter(store, pseudonymize),
      provider: new FakeSemanticProvider(async () => ({
        version: 'online-intent-v1' as const,
        kind: 'refusal' as const,
        intent: 'unknown' as const,
        reason: 'unsupported' as const,
      })),
      quotaReservation: {
        poolId: 'groq-free-primary',
        maxOutputTokens: 100,
        framingOverheadTokens: 10,
      },
      now: () => fixedNow,
    },
  );
  assert.equal(response.status, 200);
  const window = storage.get<{ window_start_ms: number }>(
    `SELECT window_start_ms FROM quota_windows WHERE window_kind = 'daily'`,
  );
  assert.equal(window?.window_start_ms, Date.UTC(2026, 10, 7));
});

test('concurrent global and identity contention never exceeds limits', async () => {
  const config = quotaConfig({
    daily: {
      globalRequests: 5,
      identityRequests: 5,
      globalTokens: 10_000,
      identityTokens: 10_000,
    },
  });
  const { store } = createStore(config);
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      Promise.resolve().then(() =>
        store.admit(admission({
          identityKey: `identity-${index}`,
          reservationId: `reservation-${index}`,
        })),
      ),
    ),
  );
  assert.equal(
    results.filter((result) => result.status === 'admitted').length,
    5,
  );
  assert.equal(
    results.filter((result) => result.status === 'quota_exhausted').length,
    15,
  );

  const identityStore = createStore(
    quotaConfig({
      daily: {
        globalRequests: 100,
        identityRequests: 5,
        globalTokens: 10_000,
        identityTokens: 10_000,
      },
    }),
  ).store;
  const identityResults = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      Promise.resolve().then(() =>
        identityStore.admit(admission({
          identityKey: 'same-identity',
          reservationId: `identity-reservation-${index}`,
        })),
      ),
    ),
  );
  assert.equal(
    identityResults.filter((result) => result.status === 'admitted').length,
    5,
  );
});

test('concurrent duplicate reservations produce one admit and duplicates', async () => {
  const { store } = createStore();
  const input = admission();
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      Promise.resolve().then(() => store.admit(input)),
    ),
  );
  assert.equal(
    results.filter((result) => result.status === 'admitted').length,
    1,
  );
  assert.equal(
    results.filter(
      (result) =>
        result.status === 'duplicate' && result.reason === 'identical',
    ).length,
    19,
  );
});

test('many requests competing for one remaining global slot admit exactly one', async () => {
  const { store, storage } = createStore(
    quotaConfig({
      daily: {
        globalRequests: 1,
        identityRequests: 100,
        globalTokens: 100_000,
        identityTokens: 100_000,
      },
    }),
  );
  const results = await runConcurrent(
    Array.from({ length: 32 }, (_, index) => () =>
      store.admit(
        admission({
          identityKey: `identity-${index}`,
          reservationId: `reservation-${index}`,
        }),
      ),
    ),
  );
  assert.equal(
    results.filter((result) => result.status === 'admitted').length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === 'quota_exhausted').length,
    31,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT global_requests AS n FROM quota_windows',
    )?.n,
    1,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT global_tokens AS n FROM quota_windows',
    )?.n,
    100,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_identity_windows',
    )?.n,
    1,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_reservations',
    )?.n,
    1,
  );
});

test('many requests competing for one remaining identity slot admit exactly one', async () => {
  const { store, storage } = createStore(
    quotaConfig({
      daily: {
        globalRequests: 100,
        identityRequests: 1,
        globalTokens: 100_000,
        identityTokens: 100_000,
      },
    }),
  );
  const results = await runConcurrent(
    Array.from({ length: 32 }, (_, index) => () =>
      store.admit(
        admission({
          identityKey: 'same-identity',
          reservationId: `reservation-${index}`,
        }),
      ),
    ),
  );
  assert.equal(
    results.filter((result) => result.status === 'admitted').length,
    1,
  );
  assert.equal(
    results.filter(
      (result) =>
        result.status === 'quota_exhausted' &&
        result.scope === 'identity',
    ).length,
    31,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT global_requests AS n FROM quota_windows',
    )?.n,
    1,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT requests AS n FROM quota_identity_windows',
    )?.n,
    1,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT tokens AS n FROM quota_identity_windows',
    )?.n,
    100,
  );
});

test('simultaneous request and token limits reject without partial counters', async () => {
  const { store, storage } = createStore(
    quotaConfig({
      daily: {
        globalRequests: 2,
        identityRequests: 10,
        globalTokens: 100,
        identityTokens: 100,
      },
    }),
  );
  assert.deepEqual(
    store.admit(
      admission({
        identityKey: 'identity-a',
        reservationId: 'reservation-a',
        tokens: tokenReservation({ expectedInputTokens: 60 }),
      }),
    ),
    { status: 'admitted' },
  );

  const contenders = [
    admission({
      identityKey: 'identity-b',
      reservationId: 'reservation-b',
      tokens: tokenReservation({ expectedInputTokens: 50 }),
    }),
    admission({
      identityKey: 'identity-c',
      reservationId: 'reservation-c',
      tokens: tokenReservation({ expectedInputTokens: 30 }),
    }),
  ];
  const results = await runConcurrent(
    contenders.map((input) => () => store.admit(input)),
  );
  assert.equal(
    results.filter((result) => result.status === 'admitted').length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === 'quota_exhausted').length,
    1,
  );

  const admittedIndex = results.findIndex(
    (result) => result.status === 'admitted',
  );
  assert.notEqual(admittedIndex, -1);
  const rejected = contenders[1 - admittedIndex];
  assert.ok(rejected);

  assert.equal(
    storage.get<{ n: number }>(
      'SELECT global_requests AS n FROM quota_windows',
    )?.n,
    2,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT global_tokens AS n FROM quota_windows',
    )?.n,
    90,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_reservations',
    )?.n,
    2,
  );
  assert.equal(
    storage.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM quota_identity_windows
        WHERE identity_key = ?`,
      [rejected.identityKey],
    )?.n,
    0,
  );
  assert.equal(
    storage.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM quota_reservations
        WHERE reservation_id = ?`,
      [rejected.reservationId],
    )?.n,
    0,
  );
});

test('concurrent duplicate reservation IDs across simulated gateways admit once', async () => {
  const { store, storage } = createStore();
  const limiters = Array.from(
    { length: 4 },
    () => new SqliteQuotaLimiter(store, pseudonymize),
  );
  const input = {
    identity: 'identity-a',
    now: Date.UTC(2026, 10, 7, 12),
    reservationId: 'shared-reservation',
    poolId: 'groq-free-primary',
    tokenReservation: tokenReservation(),
  };
  const results = await runConcurrent(
    Array.from({ length: 16 }, (_, index) => () =>
      limiters[index % limiters.length]!.admit(input),
    ),
  );
  assert.equal(
    results.filter((result) => result.allowed).length,
    1,
  );
  assert.equal(
    results.filter(
      (result) =>
        result.status === 'duplicate' &&
        result.reason === 'identical',
    ).length,
    15,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT global_requests AS n FROM quota_windows',
    )?.n,
    1,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_reservations',
    )?.n,
    1,
  );
});

test('multiple simulated gateway instances share one authoritative global slot', async () => {
  const { store, storage } = createStore(
    quotaConfig({
      daily: {
        globalRequests: 1,
        identityRequests: 100,
        globalTokens: 100_000,
        identityTokens: 100_000,
      },
    }),
  );
  const limiters = Array.from(
    { length: 4 },
    () => new SqliteQuotaLimiter(store, pseudonymize),
  );
  const results = await runConcurrent(
    Array.from({ length: 16 }, (_, index) => () =>
      limiters[index % limiters.length]!.admit({
        identity: `identity-${index}`,
        now: Date.UTC(2026, 10, 7, 12),
        reservationId: `reservation-${index}`,
        poolId: 'groq-free-primary',
        tokenReservation: tokenReservation(),
      }),
    ),
  );
  assert.equal(
    results.filter((result) => result.allowed).length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === 'quota_exhausted').length,
    15,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT global_requests AS n FROM quota_windows',
    )?.n,
    1,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_reservations',
    )?.n,
    1,
  );
});

test('storage failure during reservation insert rolls back counters and permits retry', () => {
  const storage = new NodeQuotaStorage();
  let failReservationInsert = true;
  const failing: QuotaSqlStorage = {
    transaction: <T>(work: () => T): T => storage.transaction(work),
    exec: (sql) => storage.exec(sql),
    get: <T>(
      sql: string,
      params?: readonly QuotaSqlValue[],
    ): T | undefined => storage.get<T>(sql, params),
    run: (sql, params) => {
      if (
        failReservationInsert &&
        sql.includes('INSERT INTO quota_reservations')
      ) {
        throw new Error('simulated reservation insert failure');
      }
      storage.run(sql, params);
    },
  };
  const store = new SqliteQuotaStore(failing, quotaConfig());

  assert.deepEqual(store.admit(admission()), { status: 'unavailable' });
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_windows',
    )?.n,
    0,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_identity_windows',
    )?.n,
    0,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_reservations',
    )?.n,
    0,
  );

  failReservationInsert = false;
  assert.deepEqual(store.admit(admission()), { status: 'admitted' });
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_windows',
    )?.n,
    1,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_identity_windows',
    )?.n,
    1,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_reservations',
    )?.n,
    1,
  );
});

test('storage failures fail closed and roll back partial writes', () => {
  const storage = new NodeQuotaStorage();
  let failCommit = false;
  const failing: QuotaSqlStorage = {
    transaction: <T>(work: () => T): T =>
      storage.transaction(() => {
        const result = work();
        if (failCommit) {
          failCommit = false;
          throw new Error('simulated commit failure');
        }
        return result;
      }),
    exec: (sql) => storage.exec(sql),
    get: <T>(
      sql: string,
      params?: readonly QuotaSqlValue[],
    ): T | undefined => storage.get<T>(sql, params),
    run: (sql, params) => storage.run(sql, params),
  };
  const store = new SqliteQuotaStore(failing, quotaConfig());
  failCommit = true;
  assert.deepEqual(store.admit(admission()), { status: 'unavailable' });

  const rows = storage.all<{ count: number }>(
    'SELECT COUNT(*) AS count FROM quota_windows',
  );
  assert.equal(rows[0]?.count, 0);
});

test('invalid configuration and token values fail closed', () => {
  assert.throws(
    () =>
      new SqliteQuotaStore(
        new NodeQuotaStorage(),
        quotaConfig({
          daily: {
            globalRequests: 0,
            identityRequests: 1,
            globalTokens: 1,
            identityTokens: 1,
          },
        }),
      ),
    QuotaConfigError,
  );

  assert.throws(
    () =>
      new SqliteQuotaStore(
        new NodeQuotaStorage(),
        undefined as unknown as QuotaConfig,
      ),
    QuotaConfigError,
  );
  assert.throws(
    () =>
      new SqliteQuotaStore(
        new NodeQuotaStorage(),
        quotaConfig({
          daily: undefined as unknown as QuotaConfig['daily'],
        }),
      ),
    QuotaConfigError,
  );
  assert.throws(
    () =>
      new SqliteQuotaStore(
        new NodeQuotaStorage(),
        quotaConfig({
          shortWindow: null as unknown as QuotaConfig['shortWindow'],
        }),
      ),
    QuotaConfigError,
  );

  const { store } = createStore();
  assert.deepEqual(store.admit(admission({ maxTokens: 0 })), {
    status: 'unavailable',
  });
  assert.deepEqual(store.admit(admission({ maxTokens: 1.5 })), {
    status: 'unavailable',
  });
  const invalidReservations: QuotaTokenReservation[] = [
    {
      expectedInputTokens: -1,
      maxOutputTokens: 10,
      framingOverheadTokens: 1,
    },
    {
      expectedInputTokens: 10,
      maxOutputTokens: -1,
      framingOverheadTokens: 1,
    },
    {
      expectedInputTokens: 10,
      maxOutputTokens: 10,
      framingOverheadTokens: -1,
    },
    {
      expectedInputTokens: 10.5,
      maxOutputTokens: 10,
      framingOverheadTokens: 1,
    },
    {
      expectedInputTokens: Number.NaN,
      maxOutputTokens: 10,
      framingOverheadTokens: 1,
    },
    {
      expectedInputTokens: 10,
      maxOutputTokens: Number.POSITIVE_INFINITY,
      framingOverheadTokens: 1,
    },
    {
      expectedInputTokens: 10,
      maxOutputTokens: 10,
      framingOverheadTokens: Number.MAX_SAFE_INTEGER,
    },
    {
      expectedInputTokens: Number.MAX_SAFE_INTEGER,
      maxOutputTokens: 10,
      framingOverheadTokens: 1,
    },
    {
      expectedInputTokens: 10,
      maxOutputTokens: Number.MAX_SAFE_INTEGER,
      framingOverheadTokens: 1,
    },
    {
      expectedInputTokens: 10,
      maxOutputTokens: 10,
      framingOverheadTokens: 1.5,
    },
  ];
  for (const tokens of invalidReservations) {
    assert.deepEqual(store.admit(admission({ tokens })), {
      status: 'unavailable',
    });
  }
});

test('cleanup removes expired reservations and old windows without resetting active ones', () => {
  const config = quotaConfig({
    reservationRetentionMs: 1_000,
    windowRetentionMs: 86_400_000,
  });
  const { store } = createStore(config);
  const input = admission({
    now: Date.UTC(2026, 10, 7, 12, 0, 0),
  });
  assert.equal(store.admit(input).status, 'admitted');
  store.cleanup(input.now + 500);
  assert.equal(store.admit(input).status, 'duplicate');
  store.cleanup(input.now + 2_000);
  assert.equal(
    store.admit({ ...input, reservationId: 'reservation-cleanup' }).status,
    'admitted',
  );
});

test('cleanup retains reservations through the configured retry horizon', () => {
  const retention = 5_000;
  const config = quotaConfig({
    reservationRetentionMs: retention,
    windowRetentionMs: 2 * 86_400_000,
  });
  const { store, storage } = createStore(config);
  const input = admission({ now: Date.UTC(2026, 10, 7, 12) });
  assert.equal(store.admit(input).status, 'admitted');

  store.cleanup(input.now + retention - 1);
  assert.equal(store.admit(input).status, 'duplicate');
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_reservations',
    )?.n,
    1,
  );

  store.cleanup(input.now + retention);
  assert.equal(store.admit(input).status, 'duplicate');

  store.cleanup(input.now + retention + 1);
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_reservations',
    )?.n,
    0,
  );
  assert.equal(store.admit(input).status, 'admitted');
});

test('cleanup can prune old windows without releasing an unexpired reservation', () => {
  const dayMs = 86_400_000;
  const config = quotaConfig({
    daily: {
      globalRequests: 10,
      identityRequests: 10,
      globalTokens: 100_000,
      identityTokens: 100_000,
    },
    reservationRetentionMs: 10 * dayMs,
    windowRetentionMs: dayMs,
  });
  const { store, storage } = createStore(config);
  const input = admission({ now: Date.UTC(2026, 10, 7, 12) });
  assert.equal(store.admit(input).status, 'admitted');

  store.cleanup(input.now + 2 * dayMs);
  assert.equal(store.admit(input).status, 'duplicate');
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_windows',
    )?.n,
    0,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_reservations',
    )?.n,
    1,
  );
});

test('cleanup prunes old identity counters and windows but preserves active ones', () => {
  const dayMs = 86_400_000;
  const config = quotaConfig({
    daily: {
      globalRequests: 10,
      identityRequests: 10,
      globalTokens: 100_000,
      identityTokens: 100_000,
    },
    reservationRetentionMs: 1_000,
    windowRetentionMs: dayMs,
  });
  const { store, storage } = createStore(config);
  const oldNow = Date.UTC(2026, 10, 7, 12);
  const activeNow = oldNow + 2 * dayMs;

  assert.equal(
    store.admit(
      admission({
        identityKey: 'old-identity',
        reservationId: 'old-reservation',
        now: oldNow,
      }),
    ).status,
    'admitted',
  );
  assert.equal(
    store.admit(
      admission({
        identityKey: 'active-identity',
        reservationId: 'active-reservation',
        now: activeNow,
      }),
    ).status,
    'admitted',
  );

  store.cleanup(activeNow);

  assert.equal(
    storage.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM quota_identity_windows
        WHERE identity_key = 'old-identity'`,
    )?.n,
    0,
  );
  assert.equal(
    storage.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM quota_identity_windows
        WHERE identity_key = 'active-identity'`,
    )?.n,
    1,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_windows',
    )?.n,
    1,
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_reservations',
    )?.n,
    1,
  );
});

test('cleanup cannot reset an active daily window before its UTC boundary', () => {
  const dayMs = 86_400_000;
  const config = quotaConfig({
    daily: {
      globalRequests: 1,
      identityRequests: 10,
      globalTokens: 100_000,
      identityTokens: 100_000,
    },
    reservationRetentionMs: 1_000,
    windowRetentionMs: 30 * dayMs,
  });
  const { store, storage } = createStore(config);
  const beforeMidnight = Date.UTC(2026, 10, 7, 23, 59, 59);
  assert.equal(
    store.admit(admission({ now: beforeMidnight })).status,
    'admitted',
  );

  store.cleanup(beforeMidnight + 500);
  assert.deepEqual(
    store.admit(
      admission({
        now: beforeMidnight + 500,
        reservationId: 'reservation-before-midnight',
      }),
    ),
    {
      status: 'quota_exhausted',
      scope: 'global',
      window: 'daily',
      retryAfterSeconds: 1,
    },
  );

  const afterMidnight = Date.UTC(2026, 10, 8, 0, 0, 0);
  store.cleanup(afterMidnight);
  assert.equal(
    store.admit(
      admission({
        now: afterMidnight,
        reservationId: 'reservation-after-midnight',
      }),
    ).status,
    'admitted',
  );
  assert.equal(
    storage.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quota_windows',
    )?.n,
    2,
  );
});

test('retention durations must be positive and outlive short windows', () => {
  const base = quotaConfig();
  assert.throws(
    () =>
      new SqliteQuotaStore(new NodeQuotaStorage(), {
        ...base,
        reservationRetentionMs: 0,
      }),
    QuotaConfigError,
  );
  assert.throws(
    () =>
      new SqliteQuotaStore(new NodeQuotaStorage(), {
        ...base,
        windowRetentionMs: 0,
      }),
    QuotaConfigError,
  );
  assert.throws(
    () =>
      new SqliteQuotaStore(new NodeQuotaStorage(), {
        ...base,
        shortWindow: { seconds: 60, limits: base.daily },
        windowRetentionMs: 60_000,
      }),
    QuotaConfigError,
  );
});

test('schema exposes the required quota fields', () => {
  const { storage } = createStore();
  const required: Record<string, string[]> = {
    quota_windows: [
      'pool_id',
      'window_kind',
      'window_key',
      'global_requests',
      'global_tokens',
    ],
    quota_identity_windows: [
      'pool_id',
      'identity_key',
      'window_kind',
      'window_key',
      'requests',
      'tokens',
    ],
    quota_reservations: [
      'reservation_id',
      'pool_id',
      'identity_key',
      'window_key',
      'max_tokens',
      'created_at_ms',
      'expires_at_ms',
    ],
  };
  for (const [table, fields] of Object.entries(required)) {
    const names = storage
      .all<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`)
      .map((column) => column.name);
    for (const field of fields) {
      assert.equal(names.includes(field), true, `${table}.${field} is required`);
    }
  }
});

test('storage schema contains only operational quota fields', () => {
  const { store, storage } = createStore();
  assert.equal(store.admit(admission()).status, 'admitted');
  const forbidden = [
    'message',
    'body',
    'prompt',
    'output',
    'response',
    'provider',
    'request',
    'bearer',
    'token',
    'attestation',
    'wallet',
    'container',
    'balance',
    'transaction',
    'email',
    'name',
  ];
  for (const table of [
    'quota_windows',
    'quota_identity_windows',
    'quota_reservations',
  ]) {
    const columns = storage.all<{ name: string }>(
      `SELECT name FROM pragma_table_info('${table}')`,
    );
    const names = columns.map((column) => column.name);
    for (const banned of forbidden) {
      assert.equal(
        names.includes(banned),
        false,
        `${table} must not store ${banned}`,
      );
    }
  }
});

test('HMAC identity keys are deterministic, secret-bound, and hex encoded', async () => {
  const secretA = 'a'.repeat(32);
  const secretB = 'b'.repeat(32);
  const first = await hmacIdentityKey('alice@example.com', secretA);
  const second = await hmacIdentityKey('alice@example.com', secretA);
  const other = await hmacIdentityKey('alice@example.com', secretB);
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^[0-9a-f]{64}$/);
  await assert.rejects(
    () => hmacIdentityKey('alice@example.com', 'too-short'),
    QuotaConfigError,
  );
});

test('stored identity keys are pseudonymous and never the raw subject', async () => {
  const { store, storage } = createStore();
  const limiter = new SqliteQuotaLimiter(store, (subject) =>
    hmacIdentityKey(subject, 's'.repeat(32)),
  );
  const subject = 'alice@example.com';
  assert.equal(
    (await limiter.admit({
      identity: subject,
      now: Date.UTC(2026, 10, 7, 12),
      reservationId: 'reservation-a',
      poolId: 'groq-free-primary',
      tokenReservation: tokenReservation(),
    })).status,
    'admitted',
  );
  const rows = [
    ...storage.all<{ identity_key: string }>(
      'SELECT identity_key FROM quota_identity_windows',
    ),
    ...storage.all<{ identity_key: string }>(
      'SELECT identity_key FROM quota_reservations',
    ),
  ];
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.notEqual(row.identity_key, subject);
    assert.match(row.identity_key, /^[0-9a-f]{64}$/);
  }
  const dump = JSON.stringify(rows);
  assert.equal(dump.includes('alice'), false);
  assert.equal(dump.includes('example.com'), false);
});

test('multiple simulated gateways sharing one store respect the same global cap', async () => {
  const { store } = createStore(
    quotaConfig({
      daily: {
        globalRequests: 1,
        identityRequests: 10,
        globalTokens: 10_000,
        identityTokens: 10_000,
      },
    }),
  );
  const limiterA = new SqliteQuotaLimiter(store, pseudonymize);
  const limiterB = new SqliteQuotaLimiter(store, pseudonymize);
  const context = (reservationId: string) => ({
    identity: `identity-${reservationId}`,
    now: Date.UTC(2026, 10, 7, 12, 0, 0),
    reservationId,
    poolId: 'groq-free-primary',
    tokenReservation: tokenReservation(),
  });

  const [a, b] = await Promise.all([
    limiterA.admit(context('a')),
    limiterB.admit(context('b')),
  ]);
  assert.equal([a, b].filter((result) => result.allowed).length, 1);
});

test('SqliteQuotaLimiter requires server reservation metadata', async () => {
  const { store } = createStore();
  const limiter = new SqliteQuotaLimiter(store, pseudonymize);
  assert.deepEqual(
    await limiter.admit({
      identity: 'identity-a',
      now: Date.UTC(2026, 10, 7, 12),
    }),
    { allowed: false, status: 'unavailable' },
  );
});

test('SqliteQuotaLimiter fails closed without safe pseudonymization', async () => {
  const { store, storage } = createStore();
  const context = {
    identity: 'alice',
    now: Date.UTC(2026, 10, 7, 12),
    reservationId: 'reservation-a',
    poolId: 'groq-free-primary',
    tokenReservation: tokenReservation(),
  };
  const unavailable = { allowed: false, status: 'unavailable' as const };
  assert.deepEqual(await new SqliteQuotaLimiter(store).admit(context), unavailable);
  assert.deepEqual(
    await new SqliteQuotaLimiter(store, () => 'bad key').admit(context),
    unavailable,
  );
  assert.deepEqual(
    await new SqliteQuotaLimiter(store, () => 'alice').admit(context),
    unavailable,
  );
  assert.deepEqual(
    await new SqliteQuotaLimiter(store, () => {
      throw new Error('pseudonymizer failed');
    }).admit(context),
    unavailable,
  );
  const rows = storage.all<{ count: number }>(
    'SELECT COUNT(*) AS count FROM quota_windows',
  );
  assert.equal(rows[0]?.count, 0);
});

test('handler integration admits once, rejects quota, and does not invoke provider twice', async () => {
  const { store } = createStore(
    quotaConfig({
      daily: {
        globalRequests: 1,
        identityRequests: 1,
        globalTokens: 10_000,
        identityTokens: 10_000,
      },
    }),
  );
  let providerCalls = 0;
  const requestBody = {
    version: 'online-intent-v1',
    message: 'Spent 50 on lunch from Food & drinks',
    todayDateKey: '2026-11-07',
    activeMonthKey: '2026-11',
    wallets: [
      { ref: 'w1', label: 'Cash', kind: 'cash' },
    ],
    containers: [
      { ref: 'c1', label: 'Food & drinks', kind: 'ordinary' },
    ],
  };
  const dependencies = {
    enabled: true,
    authenticator: new FakeAuthenticator(
      new Map([
        [
          'valid',
          {
            subject: 'identity-a',
            expiresAt: 4_000_000_000_000,
            attestation: 'not_verified' as const,
          },
        ],
      ]),
    ),
    rateLimiter: new SqliteQuotaLimiter(store, pseudonymize),
    provider: new FakeSemanticProvider(async () => {
      providerCalls += 1;
      return {
        version: 'online-intent-v1',
        kind: 'refusal',
        intent: 'unknown',
        reason: 'unsupported',
      };
    }),
    quotaReservation: {
      poolId: 'groq-free-primary',
      maxOutputTokens: 100,
      framingOverheadTokens: 10,
    },
  };
  const makeRequest = () =>
    new Request('https://gateway.test/v1/assistant/interpret', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid',
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

  const first = await handleGatewayRequest(makeRequest(), dependencies);
  const second = await handleGatewayRequest(makeRequest(), dependencies);
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(providerCalls, 1);
});

test('Durable Object quota adapter integrates with the gateway fail-closed path', async () => {
  const database = new DatabaseSync(':memory:');
  const store = new SqliteQuotaStore(
    createDurableObjectQuotaStorage(durableObjectRuntime(database)),
    quotaConfig({
      daily: {
        globalRequests: 1,
        identityRequests: 1,
        globalTokens: 10_000,
        identityTokens: 10_000,
      },
    }),
  );
  let providerCalls = 0;
  const gateway = createTestGateway(true, {
    authenticator: new FakeAuthenticator(
      new Map([
        [
          'valid',
          {
            subject: 'identity-a',
            expiresAt: 4_000_000_000_000,
            attestation: 'not_verified' as const,
          },
        ],
      ]),
    ),
    rateLimiter: new SqliteQuotaLimiter(store, pseudonymize),
    provider: new FakeSemanticProvider(async () => {
      providerCalls += 1;
      return {
        version: 'online-intent-v1' as const,
        kind: 'refusal' as const,
        intent: 'unknown' as const,
        reason: 'unsupported' as const,
      };
    }),
    quotaReservation: {
      poolId: 'groq-free-primary',
      maxOutputTokens: 100,
      framingOverheadTokens: 10,
    },
    now: () => Date.UTC(2026, 10, 7, 12),
  });
  const makeRequest = () =>
    new Request('https://gateway.test/v1/assistant/interpret', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        version: 'online-intent-v1',
        message: 'Spent 50 on lunch from Food & drinks',
        todayDateKey: '2026-11-07',
        activeMonthKey: '2026-11',
        wallets: [{ ref: 'w1', label: 'Cash', kind: 'cash' }],
        containers: [
          { ref: 'c1', label: 'Food & drinks', kind: 'ordinary' },
        ],
      }),
    });

  assert.equal((await gateway.fetch(makeRequest())).status, 200);
  assert.equal((await gateway.fetch(makeRequest())).status, 429);
  assert.equal(providerCalls, 1);
  const requests = database
    .prepare('SELECT global_requests AS n FROM quota_windows')
    .get() as { n: number };
  assert.equal(requests.n, 1);
  database.close();
});

test('handler supplies server reservation metadata and token budget to the limiter', async () => {
  let captured: RateLimitContext | undefined;
  const fixedNow = Date.UTC(2026, 10, 7, 12);
  const body = JSON.stringify({
    version: 'online-intent-v1',
    message: 'Spent 50 on lunch from Food & drinks',
    todayDateKey: '2026-11-07',
    activeMonthKey: '2026-11',
    wallets: [{ ref: 'w1', label: 'Cash', kind: 'cash' }],
    containers: [{ ref: 'c1', label: 'Food & drinks', kind: 'ordinary' }],
  });

  const response = await handleGatewayRequest(
    new Request('https://gateway.test/v1/assistant/interpret', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid',
        'content-type': 'application/json',
        'x-pocketa-quota-pool': 'attacker-pool',
        'x-pocketa-reservation-id': 'attacker-reservation',
      },
      body,
    }),
    {
      enabled: true,
      authenticator: new FakeAuthenticator(
        new Map([
          [
            'valid',
            {
              subject: 'identity-a',
              expiresAt: 4_000_000_000_000,
              attestation: 'not_verified' as const,
            },
          ],
        ]),
      ),
      rateLimiter: {
        async admit(context) {
          captured = context;
          return { allowed: true, status: 'admitted' };
        },
      },
      provider: new FakeSemanticProvider(async () => ({
        version: 'online-intent-v1' as const,
        kind: 'refusal' as const,
        intent: 'unknown' as const,
        reason: 'unsupported' as const,
      })),
      quotaReservation: {
        poolId: 'groq-free-primary',
        maxOutputTokens: 100,
        framingOverheadTokens: 10,
      },
      now: () => fixedNow,
    },
  );

  assert.equal(response.status, 200);
  assert.ok(captured);
  assert.equal(captured.identity, 'identity-a');
  assert.equal(captured.now, fixedNow);
  assert.equal(captured.poolId, 'groq-free-primary');
  assert.match(captured.reservationId ?? '', /^[0-9a-f-]{36}$/i);
  assert.notEqual(captured.reservationId, 'attacker-reservation');
  assert.deepEqual(captured.tokenReservation, {
    expectedInputTokens: new TextEncoder().encode(body).byteLength,
    maxOutputTokens: 100,
    framingOverheadTokens: 10,
  });
});

test('quota tables retain no request body or provider output values', async () => {
  const { store, storage } = createStore();
  const response = await handleGatewayRequest(
    new Request('https://gateway.test/v1/assistant/interpret', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        version: 'online-intent-v1',
        message: 'PRIVATE_BODY_MARKER_9f3',
        todayDateKey: '2026-11-07',
        activeMonthKey: '2026-11',
        wallets: [{ ref: 'w1', label: 'Cash', kind: 'cash' }],
        containers: [
          { ref: 'c1', label: 'Food & drinks', kind: 'ordinary' },
        ],
      }),
    }),
    {
      enabled: true,
      authenticator: new FakeAuthenticator(
        new Map([
          [
            'valid',
            {
              subject: 'identity-a',
              expiresAt: 4_000_000_000_000,
              attestation: 'not_verified' as const,
            },
          ],
        ]),
      ),
      rateLimiter: new SqliteQuotaLimiter(store, pseudonymize),
      provider: new FakeSemanticProvider(async () => ({
        version: 'online-intent-v1' as const,
        kind: 'proposal' as const,
        intent: 'expense' as const,
        action: 'expense' as const,
        amountText: '987654321',
        refs: { wallet: 'w1', container: 'c1' },
      })),
      quotaReservation: {
        poolId: 'groq-free-primary',
        maxOutputTokens: 100,
        framingOverheadTokens: 10,
      },
      now: () => Date.UTC(2026, 10, 7, 12),
    },
  );
  assert.equal(response.status, 200);

  const dump = JSON.stringify([
    storage.all<Record<string, unknown>>('SELECT * FROM quota_windows'),
    storage.all<Record<string, unknown>>(
      'SELECT * FROM quota_identity_windows',
    ),
    storage.all<Record<string, unknown>>(
      'SELECT * FROM quota_reservations',
    ),
  ]);
  assert.equal(dump.includes('PRIVATE_BODY_MARKER_9f3'), false);
  assert.equal(dump.includes('987654321'), false);
  assert.equal(dump.includes('Food & drinks'), false);
  assert.equal(dump.includes('Cash'), false);
});

function durableObjectRuntime(database: DatabaseSync): DurableObjectQuotaRuntime {
  return {
    transactionSync<T>(work: () => T): T {
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = work();
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    sql: {
      exec<T>(query: string, ...bindings: QuotaSqlValue[]) {
        if (/^\s*(SELECT|PRAGMA)\b/i.test(query)) {
          const rows = database
            .prepare(query)
            .all(...(bindings as SQLInputValue[])) as T[];
          return { toArray: () => rows };
        }
        if (bindings.length === 0) {
          database.exec(query);
        } else {
          database.prepare(query).run(...(bindings as SQLInputValue[]));
        }
        return { toArray: (): T[] => [] };
      },
    },
  };
}

test('quotaObjectName is deterministic and rejects invalid pool identifiers', () => {
  assert.equal(quotaObjectName('groq-free-primary'), 'quota-pool:groq-free-primary');
  assert.equal(quotaObjectName('groq-free-primary'), quotaObjectName('groq-free-primary'));
  assert.notEqual(quotaObjectName('pool-a'), quotaObjectName('pool-b'));
  for (const invalid of ['', 'bad pool', 'x'.repeat(129), 'pool/evil']) {
    assert.throws(() => quotaObjectName(invalid), QuotaConfigError);
  }
});

test('every request for a pool routes to one stable Durable Object stub', () => {
  const ids = new Map<string, { name: string; toString(): string }>();
  const namespace = {
    idFromName(name: string) {
      const existing = ids.get(name);
      if (existing) return existing;
      const id = { name, toString: () => `id:${name}` };
      ids.set(name, id);
      return id;
    },
    get(id: { name: string }) {
      return { name: id.name };
    },
  };

  const first = quotaObjectStub(namespace, 'pool-a');
  const second = quotaObjectStub(namespace, 'pool-a');
  assert.deepEqual(first, second);
  assert.equal(first.name, 'quota-pool:pool-a');
  assert.equal(
    quotaObjectId(namespace, 'pool-a').toString(),
    'id:quota-pool:pool-a',
  );
  assert.notDeepEqual(quotaObjectStub(namespace, 'pool-b'), first);
});

test('Durable Object adapter runs the store schema, admission, and rejection atomically', () => {
  const database = new DatabaseSync(':memory:');
  const storage = createDurableObjectQuotaStorage(durableObjectRuntime(database));
  const store = new SqliteQuotaStore(
    storage,
    quotaConfig({
      daily: {
        globalRequests: 1,
        identityRequests: 10,
        globalTokens: 10_000,
        identityTokens: 10_000,
      },
    }),
  );
  assert.deepEqual(store.admit(admission()), { status: 'admitted' });
  assert.deepEqual(store.admit(admission({ reservationId: 'reservation-b' })), {
    status: 'quota_exhausted',
    scope: 'global',
    window: 'daily',
    retryAfterSeconds: 43_200,
  });
  const requests = database
    .prepare('SELECT global_requests AS n FROM quota_windows')
    .get() as { n: number };
  assert.equal(requests.n, 1);
  const reservations = database
    .prepare('SELECT COUNT(*) AS n FROM quota_reservations')
    .get() as { n: number };
  assert.equal(reservations.n, 1);
  database.close();
});

test('Durable Object adapter keeps admission check-and-increment inside one transaction', () => {
  const database = new DatabaseSync(':memory:');
  const base = durableObjectRuntime(database);
  let transactions = 0;
  let sqlCallsOutsideTransaction = 0;
  let inTransaction = false;
  const runtime: DurableObjectQuotaRuntime = {
    transactionSync<T>(work: () => T): T {
      transactions += 1;
      inTransaction = true;
      try {
        return base.transactionSync(work);
      } finally {
        inTransaction = false;
      }
    },
    sql: {
      exec<T>(query: string, ...bindings: QuotaSqlValue[]) {
        if (!inTransaction) sqlCallsOutsideTransaction += 1;
        return base.sql.exec<T>(query, ...bindings);
      },
    },
  };
  const store = new SqliteQuotaStore(
    createDurableObjectQuotaStorage(runtime),
    quotaConfig({
      daily: {
        globalRequests: 1,
        identityRequests: 10,
        globalTokens: 10_000,
        identityTokens: 10_000,
      },
    }),
  );

  transactions = 0;
  sqlCallsOutsideTransaction = 0;
  assert.deepEqual(store.admit(admission()), { status: 'admitted' });
  assert.equal(transactions, 1);
  assert.equal(sqlCallsOutsideTransaction, 0);

  transactions = 0;
  sqlCallsOutsideTransaction = 0;
  assert.equal(
    store.admit(admission({ reservationId: 'reservation-b' })).status,
    'quota_exhausted',
  );
  assert.equal(transactions, 1);
  assert.equal(sqlCallsOutsideTransaction, 0);

  const requests = database
    .prepare('SELECT global_requests AS n FROM quota_windows')
    .get() as { n: number };
  assert.equal(requests.n, 1);
  database.close();
});

test('Durable Object adapter rejects async transactions before commit', () => {
  const database = new DatabaseSync(':memory:');
  const storage = createDurableObjectQuotaStorage(
    durableObjectRuntime(database),
  );
  storage.exec('CREATE TABLE async_probe (value INTEGER)');

  assert.throws(
    () =>
      storage.transaction(async () => {
        storage.run('INSERT INTO async_probe (value) VALUES (?)', [1]);
      }),
    /synchronous/,
  );

  const row = database
    .prepare('SELECT COUNT(*) AS n FROM async_probe')
    .get() as { n: number };
  assert.equal(row.n, 0);
  database.close();
});

test('quota adapter source contains no outbound network calls', () => {
  const files = [
    '../src/quota/durableObjectStorage.ts',
    '../src/quota/sqliteQuotaStore.ts',
    '../src/quota/sqliteQuotaLimiter.ts',
    '../src/quota/identityKey.ts',
    '../src/quota/routing.ts',
    '../src/quota/types.ts',
  ];
  const source = files
    .map((file) =>
      readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8'),
    )
    .join('\n');

  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\bWebSocket\b/);
  assert.doesNotMatch(source, /\bXMLHttpRequest\b/);
  assert.doesNotMatch(source, /https?:\/\//);
});

test('pools are isolated and do not share counters for the same identity', () => {
  const { store } = createStore(
    quotaConfig({
      daily: {
        globalRequests: 1,
        identityRequests: 1,
        globalTokens: 10_000,
        identityTokens: 10_000,
      },
    }),
  );
  assert.deepEqual(store.admit(admission({ poolId: 'pool-a' })), {
    status: 'admitted',
  });
  assert.deepEqual(
    store.admit(admission({ poolId: 'pool-b', reservationId: 'reservation-b' })),
    { status: 'admitted' },
  );
  assert.equal(
    store.admit(admission({ poolId: 'pool-a', reservationId: 'reservation-c' }))
      .status,
    'quota_exhausted',
  );
});

test('short window rejects inside its bucket and reopens at the boundary with exact Retry-After', () => {
  const { store } = createStore(
    quotaConfig({
      shortWindow: {
        seconds: 60,
        limits: {
          globalRequests: 1,
          identityRequests: 1,
          globalTokens: 10_000,
          identityTokens: 10_000,
        },
      },
    }),
  );
  const start = Date.UTC(2026, 10, 7, 12, 0, 0);
  assert.deepEqual(store.admit(admission({ now: start })), { status: 'admitted' });
  assert.deepEqual(
    store.admit(admission({ now: start + 30_000, reservationId: 'reservation-b' })),
    {
      status: 'quota_exhausted',
      scope: 'global',
      window: 'short',
      retryAfterSeconds: 30,
    },
  );
  assert.deepEqual(
    store.admit(admission({ now: start + 60_000, reservationId: 'reservation-c' })),
    { status: 'admitted' },
  );
});

test('invalid pool, identity, and reservation keys fail closed without writes', () => {
  const { store, storage } = createStore();
  for (const overrides of [
    { poolId: 'bad pool' },
    { identityKey: '' },
    { identityKey: 'user/evil' },
    { reservationId: 'x'.repeat(129) },
    { reservationId: 'bad id' },
  ]) {
    assert.deepEqual(store.admit(admission(overrides)), { status: 'unavailable' });
  }
  const rows = storage.all<{ count: number }>(
    'SELECT COUNT(*) AS count FROM quota_windows',
  );
  assert.equal(rows[0]?.count, 0);
});

test('cleanup does not reset an active daily window and prunes only expired windows', () => {
  const dayMs = 86_400_000;
  const config = quotaConfig({
    daily: {
      globalRequests: 2,
      identityRequests: 10,
      globalTokens: 10_000,
      identityTokens: 10_000,
    },
    reservationRetentionMs: 1_000,
    windowRetentionMs: dayMs,
  });
  const { store, storage } = createStore(config);
  const now = Date.UTC(2026, 10, 7, 12, 0, 0);
  assert.equal(store.admit(admission({ now })).status, 'admitted');
  assert.equal(
    store.admit(admission({ now, reservationId: 'reservation-b' })).status,
    'admitted',
  );
  store.cleanup(now + 1_000);
  assert.deepEqual(
    store.admit(admission({ now: now + 1_000, reservationId: 'reservation-c' })),
    {
      status: 'quota_exhausted',
      scope: 'global',
      window: 'daily',
      retryAfterSeconds: 43_200 - 1,
    },
  );

  store.cleanup(now + 3 * dayMs);
  const windows = storage.all<{ count: number }>(
    'SELECT COUNT(*) AS count FROM quota_windows',
  );
  assert.equal(windows[0]?.count, 0);
  assert.deepEqual(
    store.admit(admission({ now: now + 3 * dayMs, reservationId: 'reservation-d' })),
    { status: 'admitted' },
  );
});

test('SqliteQuotaLimiter maps duplicate and exhausted decisions without admitting twice', async () => {
  const { store } = createStore(
    quotaConfig({
      daily: {
        globalRequests: 1,
        identityRequests: 1,
        globalTokens: 10_000,
        identityTokens: 10_000,
      },
    }),
  );
  const limiter = new SqliteQuotaLimiter(store, pseudonymize);
  const context = {
    identity: 'identity-a',
    now: Date.UTC(2026, 10, 7, 12),
    reservationId: 'reservation-a',
    poolId: 'groq-free-primary',
    tokenReservation: tokenReservation(),
  };
  assert.deepEqual(await limiter.admit(context), {
    allowed: true,
    status: 'admitted',
  });
  assert.deepEqual(await limiter.admit(context), {
    allowed: false,
    status: 'duplicate',
    reason: 'identical',
  });
  assert.deepEqual(
    await limiter.admit({
      ...context,
      tokenReservation: tokenReservation({ expectedInputTokens: 101 }),
    }),
    {
      allowed: false,
      status: 'duplicate',
      reason: 'conflict',
    },
  );
  assert.deepEqual(
    await limiter.admit({ ...context, reservationId: 'reservation-b' }),
    {
      allowed: false,
      status: 'quota_exhausted',
      scope: 'global',
      window: 'daily',
      retryAfterSeconds: 43_200,
    },
  );
});

test('handler returns 429 with retry-after and never calls the provider when quota is exhausted', async () => {
  const { store } = createStore(
    quotaConfig({
      daily: {
        globalRequests: 1,
        identityRequests: 10,
        globalTokens: 10_000,
        identityTokens: 10_000,
      },
    }),
  );
  let providerCalls = 0;
  const fixedNow = Date.UTC(2026, 10, 7, 12, 0, 0);
  const dependencies = {
    enabled: true,
    authenticator: new FakeAuthenticator(
      new Map([
        ['valid-a', { subject: 'identity-a', expiresAt: 4_000_000_000_000, attestation: 'not_verified' as const }],
        ['valid-b', { subject: 'identity-b', expiresAt: 4_000_000_000_000, attestation: 'not_verified' as const }],
      ]),
    ),
    rateLimiter: new SqliteQuotaLimiter(store, pseudonymize),
    provider: new FakeSemanticProvider(async () => {
      providerCalls += 1;
      return {
        version: 'online-intent-v1' as const,
        kind: 'refusal' as const,
        intent: 'unknown' as const,
        reason: 'unsupported' as const,
      };
    }),
    quotaReservation: {
      poolId: 'groq-free-primary',
      maxOutputTokens: 100,
      framingOverheadTokens: 10,
    },
    now: () => fixedNow,
  };
  const body = JSON.stringify({
    version: 'online-intent-v1',
    message: 'Spent 50 on lunch from Food & drinks',
    todayDateKey: '2026-11-07',
    activeMonthKey: '2026-11',
    wallets: [{ ref: 'w1', label: 'Cash', kind: 'cash' }],
    containers: [{ ref: 'c1', label: 'Food & drinks', kind: 'ordinary' }],
  });
  const send = (token: string) =>
    handleGatewayRequest(
      new Request('https://gateway.test/v1/assistant/interpret', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body,
      }),
      dependencies,
    );

  assert.equal((await send('valid-a')).status, 200);
  const exhausted = await send('valid-b');
  assert.equal(exhausted.status, 429);
  assert.equal(exhausted.headers.get('retry-after'), '43200');
  assert.equal(providerCalls, 1);
});

test('handler reserves request bytes plus output and framing headroom', async () => {
  const { store, storage } = createStore();
  const body = JSON.stringify({
    version: 'online-intent-v1',
    message: 'Spent 50 on lunch from Food & drinks',
    todayDateKey: '2026-11-07',
    activeMonthKey: '2026-11',
    wallets: [{ ref: 'w1', label: 'Cash', kind: 'cash' }],
    containers: [{ ref: 'c1', label: 'Food & drinks', kind: 'ordinary' }],
  });
  const response = await handleGatewayRequest(
    new Request('https://gateway.test/v1/assistant/interpret', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid',
        'content-type': 'application/json',
      },
      body,
    }),
    {
      enabled: true,
      authenticator: new FakeAuthenticator(
        new Map([
          ['valid', { subject: 'identity-a', expiresAt: 4_000_000_000_000, attestation: 'not_verified' as const }],
        ]),
      ),
      rateLimiter: new SqliteQuotaLimiter(store, pseudonymize),
      provider: new FakeSemanticProvider(async () => ({
        version: 'online-intent-v1' as const,
        kind: 'refusal' as const,
        intent: 'unknown' as const,
        reason: 'unsupported' as const,
      })),
      quotaReservation: {
        poolId: 'groq-free-primary',
        maxOutputTokens: 100,
        framingOverheadTokens: 10,
      },
      now: () => Date.UTC(2026, 10, 7, 12),
    },
  );
  assert.equal(response.status, 200);
  const expected = new TextEncoder().encode(body).byteLength + 110;
  const global = storage.get<{ tokens: number }>(
    'SELECT global_tokens AS tokens FROM quota_windows',
  );
  const reservation = storage.get<{ tokens: number }>(
    'SELECT max_tokens AS tokens FROM quota_reservations',
  );
  assert.equal(global?.tokens, expected);
  assert.equal(reservation?.tokens, expected);
});

test('provider failures do not refund reserved tokens', async () => {
  const { store, storage } = createStore();
  const body = JSON.stringify({
    version: 'online-intent-v1',
    message: 'Spent 50 on lunch from Food & drinks',
    todayDateKey: '2026-11-07',
    activeMonthKey: '2026-11',
    wallets: [{ ref: 'w1', label: 'Cash', kind: 'cash' }],
    containers: [{ ref: 'c1', label: 'Food & drinks', kind: 'ordinary' }],
  });
  const response = await handleGatewayRequest(
    new Request('https://gateway.test/v1/assistant/interpret', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid',
        'content-type': 'application/json',
      },
      body,
    }),
    {
      enabled: true,
      authenticator: new FakeAuthenticator(
        new Map([
          ['valid', { subject: 'identity-a', expiresAt: 4_000_000_000_000, attestation: 'not_verified' as const }],
        ]),
      ),
      rateLimiter: new SqliteQuotaLimiter(store, pseudonymize),
      provider: new FakeSemanticProvider(async () => {
        throw new Error('provider failed');
      }),
      quotaReservation: {
        poolId: 'groq-free-primary',
        maxOutputTokens: 100,
        framingOverheadTokens: 10,
      },
      now: () => Date.UTC(2026, 10, 7, 12),
    },
  );
  assert.equal(response.status, 503);
  const expected = new TextEncoder().encode(body).byteLength + 110;
  const global = storage.get<{ tokens: number }>(
    'SELECT global_tokens AS tokens FROM quota_windows',
  );
  assert.equal(global?.tokens, expected);
});

test('createTestGateway rejects invalid quota reservation metadata at composition time', () => {
  const base = {
    authenticator: new FakeAuthenticator(new Map()),
    rateLimiter: new InMemoryRateLimiter({ perIdentityLimit: 1, globalLimit: 1 }),
    provider: new FakeSemanticProvider(async () => {
      throw new Error('not called');
    }),
  };
  assert.throws(
    () =>
      createTestGateway(true, {
        ...base,
        quotaReservation: {
          poolId: 'bad pool',
          maxOutputTokens: 100,
          framingOverheadTokens: 10,
        },
      }),
    QuotaConfigError,
  );
  assert.throws(
    () =>
      createTestGateway(true, {
        ...base,
        quotaReservation: {
          poolId: 'pool-a',
          maxOutputTokens: 0,
          framingOverheadTokens: 10,
        },
      }),
    QuotaConfigError,
  );
  assert.throws(
    () =>
      createTestGateway(true, {
        ...base,
        quotaReservation: {
          poolId: 'pool-a',
          maxOutputTokens: 1.5,
          framingOverheadTokens: 10,
        },
      }),
    QuotaConfigError,
  );
  assert.throws(
    () =>
      createTestGateway(true, {
        ...base,
        quotaReservation: {
          poolId: 'pool-a',
          maxOutputTokens: 100,
          framingOverheadTokens: 0,
        },
      }),
    QuotaConfigError,
  );
  assert.throws(
    () =>
      createTestGateway(true, {
        ...base,
        quotaReservation: {
          poolId: 'pool-a',
          maxOutputTokens: 100,
          framingOverheadTokens: -1,
        },
      }),
    QuotaConfigError,
  );
  assert.throws(
    () =>
      createTestGateway(true, {
        ...base,
        quotaReservation: {
          poolId: 'pool-a',
          maxOutputTokens: Number.POSITIVE_INFINITY,
          framingOverheadTokens: 10,
        },
      }),
    QuotaConfigError,
  );
  assert.doesNotThrow(() =>
    createTestGateway(true, {
      ...base,
      quotaReservation: {
        poolId: 'pool-a',
        maxOutputTokens: 100,
        framingOverheadTokens: 10,
      },
    }),
  );
});

test('client-supplied pool headers cannot change the server-selected pool', async () => {
  const { store, storage } = createStore();
  const dependencies = {
    enabled: true,
    authenticator: new FakeAuthenticator(
      new Map([
        ['valid', { subject: 'identity-a', expiresAt: 4_000_000_000_000, attestation: 'not_verified' as const }],
      ]),
    ),
    rateLimiter: new SqliteQuotaLimiter(store, pseudonymize),
    provider: new FakeSemanticProvider(async () => ({
      version: 'online-intent-v1' as const,
      kind: 'refusal' as const,
      intent: 'unknown' as const,
      reason: 'unsupported' as const,
    })),
    quotaReservation: {
      poolId: 'server-pool',
      maxOutputTokens: 100,
      framingOverheadTokens: 10,
    },
    now: () => Date.UTC(2026, 10, 7, 12),
  };
  const response = await handleGatewayRequest(
    new Request('https://gateway.test/v1/assistant/interpret', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid',
        'content-type': 'application/json',
        'x-pocketa-quota-pool': 'attacker-pool',
        'x-pocketa-reservation-id': 'attacker-reservation',
      },
      body: JSON.stringify({
        version: 'online-intent-v1',
        message: 'Spent 50 on lunch from Food & drinks',
        todayDateKey: '2026-11-07',
        activeMonthKey: '2026-11',
        wallets: [{ ref: 'w1', label: 'Cash', kind: 'cash' }],
        containers: [{ ref: 'c1', label: 'Food & drinks', kind: 'ordinary' }],
      }),
    }),
    dependencies,
  );
  assert.equal(response.status, 200);
  const rows = storage.all<{ pool_id: string }>(
    'SELECT DISTINCT pool_id FROM quota_windows',
  );
  assert.deepEqual(rows.map((row) => row.pool_id), ['server-pool']);
});

test('handler rejects duplicate admission without invoking the provider', async () => {
  let providerCalls = 0;
  const response = await handleGatewayRequest(
    new Request('https://gateway.test/v1/assistant/interpret', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        version: 'online-intent-v1',
        message: 'Spent 50 on lunch from Food & drinks',
        todayDateKey: '2026-11-07',
        activeMonthKey: '2026-11',
        wallets: [{ ref: 'w1', label: 'Cash', kind: 'cash' }],
        containers: [{ ref: 'c1', label: 'Food & drinks', kind: 'ordinary' }],
      }),
    }),
    {
      enabled: true,
      authenticator: new FakeAuthenticator(
        new Map([
          ['valid', { subject: 'identity-a', expiresAt: 4_000_000_000_000, attestation: 'not_verified' as const }],
        ]),
      ),
      rateLimiter: {
        async admit() {
          return {
            allowed: false,
            status: 'duplicate' as const,
            reason: 'conflict' as const,
          };
        },
      },
      provider: new FakeSemanticProvider(async () => {
        providerCalls += 1;
        return {
          version: 'online-intent-v1' as const,
          kind: 'refusal' as const,
          intent: 'unknown' as const,
          reason: 'unsupported' as const,
        };
      }),
      now: () => Date.UTC(2026, 10, 7, 12),
    },
  );
  assert.equal(response.status, 429);
  assert.equal(providerCalls, 0);
});

test('handler rejects an inconsistent limiter decision instead of bypassing quota', async () => {
  let providerCalls = 0;
  const response = await handleGatewayRequest(
    new Request('https://gateway.test/v1/assistant/interpret', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        version: 'online-intent-v1',
        message: 'Spent 50 on lunch from Food & drinks',
        todayDateKey: '2026-11-07',
        activeMonthKey: '2026-11',
        wallets: [{ ref: 'w1', label: 'Cash', kind: 'cash' }],
        containers: [{ ref: 'c1', label: 'Food & drinks', kind: 'ordinary' }],
      }),
    }),
    {
      enabled: true,
      authenticator: new FakeAuthenticator(
        new Map([
          ['valid', { subject: 'identity-a', expiresAt: 4_000_000_000_000, attestation: 'not_verified' as const }],
        ]),
      ),
      rateLimiter: {
        async admit() {
          return { allowed: true, status: 'quota_exhausted' as const };
        },
      },
      provider: new FakeSemanticProvider(async () => {
        providerCalls += 1;
        return {
          version: 'online-intent-v1' as const,
          kind: 'refusal' as const,
          intent: 'unknown' as const,
          reason: 'unsupported' as const,
        };
      }),
      now: () => Date.UTC(2026, 10, 7, 12),
    },
  );
  assert.equal(response.status, 429);
  assert.equal(providerCalls, 0);
});

function withSharedDatabase(
  run: (path: string, open: () => NodeQuotaStorage) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), 'pocketa-quota-'));
  const opened: NodeQuotaStorage[] = [];
  const open = (): NodeQuotaStorage => {
    const storage = new NodeQuotaStorage(join(directory, 'quota.db'));
    opened.push(storage);
    return storage;
  };
  try {
    run(join(directory, 'quota.db'), open);
  } finally {
    for (const storage of opened) storage.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
test('two connections to one database share global caps deterministically', () => {
  withSharedDatabase((path, open) => {
    const config = quotaConfig({
      daily: {
        globalRequests: 5,
        identityRequests: 100,
        globalTokens: 100_000,
        identityTokens: 100_000,
      },
    });
    const storageA = open();
    const storageB = open();
    const storeA = new SqliteQuotaStore(storageA, config);
    const storeB = new SqliteQuotaStore(storageB, config);

    const outcomes: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      const store = index % 2 === 0 ? storeA : storeB;
      outcomes.push(
        store.admit(admission({
          identityKey: `identity-${index}`,
          reservationId: `reservation-${index}`,
        })).status,
      );
    }
    assert.equal(outcomes.filter((status) => status === 'admitted').length, 5);
    assert.equal(outcomes.filter((status) => status === 'quota_exhausted').length, 15);
    const counter = storageA.get<{ n: number }>(
      'SELECT global_requests AS n FROM quota_windows',
    );
    assert.equal(counter?.n, 5);
  });
});

test('a connection holding the write lock makes competing admissions fail closed without writes', () => {
  withSharedDatabase((path, open) => {
    const config = quotaConfig({
      daily: {
        globalRequests: 10,
        identityRequests: 10,
        globalTokens: 100_000,
        identityTokens: 100_000,
      },
    });
    const storageA = open();
    const storeA = new SqliteQuotaStore(storageA, config);
    const storeB = new SqliteQuotaStore(open(), config);
    assert.deepEqual(storeA.admit(admission()), { status: 'admitted' });

    // Simulate a competing writer holding the database write lock.
    const holder = new DatabaseSync(path, { timeout: 0 });
    holder.exec('BEGIN IMMEDIATE');
    try {
      assert.deepEqual(
        storeB.admit(admission({ reservationId: 'reservation-locked' })),
        { status: 'unavailable' },
      );
    } finally {
      holder.exec('COMMIT');
      holder.close();
    }

    const counter = storageA.get<{ n: number; t: number }>(
      'SELECT global_requests AS n, global_tokens AS t FROM quota_windows',
    );
    assert.equal(counter?.n, 1);
    assert.equal(counter?.t, 100);
    assert.deepEqual(
      storeB.admit(admission({ reservationId: 'reservation-after-release' })),
      { status: 'admitted' },
    );
  });
});

test('a reservation admitted on one connection is a duplicate on another', () => {
  withSharedDatabase((path, open) => {
    const config = quotaConfig();
    const storeA = new SqliteQuotaStore(open(), config);
    const storeB = new SqliteQuotaStore(open(), config);
    assert.deepEqual(storeA.admit(admission()), { status: 'admitted' });
    assert.deepEqual(storeB.admit(admission()), {
      status: 'duplicate',
      reason: 'identical',
    });
  });
});

test('identity token caps hold across alternating connections', () => {
  withSharedDatabase((path, open) => {
    const config = quotaConfig({
      daily: {
        globalRequests: 100,
        identityRequests: 100,
        globalTokens: 100_000,
        identityTokens: 250,
      },
    });
    const storeA = new SqliteQuotaStore(open(), config);
    const storeB = new SqliteQuotaStore(open(), config);
    const results = [storeA, storeB, storeA, storeB].map((store, index) =>
      store.admit(admission({
        reservationId: `token-${index}`,
        maxTokens: 100,
      })).status,
    );
    assert.deepEqual(results, [
      'admitted',
      'admitted',
      'quota_exhausted',
      'quota_exhausted',
    ]);
  });
});
