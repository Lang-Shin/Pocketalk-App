import {
  QuotaConfigError,
  tokenReservationTotal,
  validateQuotaConfig,
  validateQuotaKey,
  type QuotaAdmissionInput,
  type QuotaConfig,
  type QuotaDecision,
  type QuotaScope,
  type QuotaWindowKind,
  type QuotaWindowLimits,
} from './types';

export type QuotaSqlValue = string | number | null;

export interface QuotaSqlStorage {
  transaction<T>(work: () => T): T;
  exec(sql: string): void;
  get<T>(sql: string, params?: readonly QuotaSqlValue[]): T | undefined;
  run(sql: string, params?: readonly QuotaSqlValue[]): void;
}

interface WindowRow {
  global_requests: number;
  global_tokens: number;
}

interface IdentityWindowRow {
  requests: number;
  tokens: number;
}

interface ReservationRow {
  reservation_id: string;
  pool_id: string;
  identity_key: string;
  max_tokens: number;
}

interface QuotaWindow {
  kind: QuotaWindowKind;
  key: string;
  startMs: number;
  endMs: number;
}

const DAY_MS = 86_400_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS quota_windows (
  pool_id TEXT NOT NULL,
  window_kind TEXT NOT NULL,
  window_key TEXT NOT NULL,
  window_start_ms INTEGER NOT NULL,
  window_end_ms INTEGER NOT NULL,
  global_requests INTEGER NOT NULL DEFAULT 0,
  global_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pool_id, window_kind, window_key)
);
CREATE TABLE IF NOT EXISTS quota_identity_windows (
  pool_id TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  window_kind TEXT NOT NULL,
  window_key TEXT NOT NULL,
  window_start_ms INTEGER NOT NULL,
  window_end_ms INTEGER NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pool_id, identity_key, window_kind, window_key)
);
CREATE TABLE IF NOT EXISTS quota_reservations (
  reservation_id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  window_key TEXT NOT NULL,
  max_tokens INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS quota_windows_end_idx
  ON quota_windows (pool_id, window_end_ms);
CREATE INDEX IF NOT EXISTS quota_identity_windows_end_idx
  ON quota_identity_windows (pool_id, identity_key, window_end_ms);
CREATE INDEX IF NOT EXISTS quota_reservations_expiry_idx
  ON quota_reservations (expires_at_ms);
`;

export class SqliteQuotaStore {
  constructor(
    private readonly storage: QuotaSqlStorage,
    private readonly config: QuotaConfig,
  ) {
    validateQuotaConfig(config);
    this.storage.transaction(() => {
      this.storage.exec(SCHEMA);
      const hasMaxTokens = this.storage.get<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM pragma_table_info('quota_reservations')
          WHERE name = 'max_tokens'`,
      );
      if (!hasMaxTokens || hasMaxTokens.count === 0) {
        this.storage.run(
          `ALTER TABLE quota_reservations
             ADD COLUMN max_tokens INTEGER NOT NULL DEFAULT 0`,
        );
      }
    });
  }

  admit(input: QuotaAdmissionInput): QuotaDecision {
    try {
      const reservedTokens = validateAdmissionInput(input);
      return this.storage.transaction(() =>
        this.admitInTransaction(input, reservedTokens),
      );
    } catch {
      return { status: 'unavailable' };
    }
  }

  cleanup(now: number): void {
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new QuotaConfigError('Cleanup time must be a safe integer.');
    }
    this.storage.transaction(() => {
      this.storage.run(
        'DELETE FROM quota_reservations WHERE expires_at_ms < ?',
        [now],
      );
      this.storage.run(
        'DELETE FROM quota_windows WHERE window_end_ms < ?',
        [now - this.config.windowRetentionMs],
      );
      this.storage.run(
        'DELETE FROM quota_identity_windows WHERE window_end_ms < ?',
        [now - this.config.windowRetentionMs],
      );
    });
  }

  private admitInTransaction(
    input: QuotaAdmissionInput,
    reservedTokens: number,
  ): QuotaDecision {
    const windows = this.windowsFor(input.now);
    const existing = this.storage.get<ReservationRow>(
      `SELECT reservation_id, pool_id, identity_key, max_tokens
         FROM quota_reservations
        WHERE reservation_id = ?`,
      [input.reservationId],
    );
    if (existing) {
      const identical =
        existing.pool_id === input.poolId &&
        existing.identity_key === input.identityKey &&
        existing.max_tokens === reservedTokens;
      return {
        status: 'duplicate',
        reason: identical ? 'identical' : 'conflict',
      };
    }

    for (const window of windows) {
      const limits = this.limitsFor(window.kind);
      const global = this.storage.get<WindowRow>(
        `SELECT global_requests, global_tokens
           FROM quota_windows
          WHERE pool_id = ? AND window_kind = ? AND window_key = ?`,
        [input.poolId, window.kind, window.key],
      ) ?? { global_requests: 0, global_tokens: 0 };
      const identity = this.storage.get<IdentityWindowRow>(
        `SELECT requests, tokens
           FROM quota_identity_windows
          WHERE pool_id = ? AND identity_key = ?
            AND window_kind = ? AND window_key = ?`,
        [input.poolId, input.identityKey, window.kind, window.key],
      ) ?? { requests: 0, tokens: 0 };

      const denied = this.deniedScope(
        reservedTokens,
        global,
        identity,
        limits,
      );
      if (denied) {
        return {
          status: 'quota_exhausted',
          scope: denied,
          window: window.kind,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((window.endMs - input.now) / 1000),
          ),
        };
      }
    }

    for (const window of windows) {
      this.storage.run(
        `INSERT INTO quota_windows
          (pool_id, window_kind, window_key, window_start_ms, window_end_ms,
           global_requests, global_tokens)
         VALUES (?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(pool_id, window_kind, window_key) DO UPDATE SET
           global_requests = global_requests + 1,
           global_tokens = global_tokens + excluded.global_tokens`,
        [
          input.poolId,
          window.kind,
          window.key,
          window.startMs,
          window.endMs,
          reservedTokens,
        ],
      );
      this.storage.run(
        `INSERT INTO quota_identity_windows
          (pool_id, identity_key, window_kind, window_key, window_start_ms,
           window_end_ms, requests, tokens)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(pool_id, identity_key, window_kind, window_key)
         DO UPDATE SET
           requests = requests + 1,
           tokens = tokens + excluded.tokens`,
        [
          input.poolId,
          input.identityKey,
          window.kind,
          window.key,
          window.startMs,
          window.endMs,
          reservedTokens,
        ],
      );
    }

    this.storage.run(
      `INSERT INTO quota_reservations
        (reservation_id, pool_id, identity_key, window_key, max_tokens,
         created_at_ms, expires_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.reservationId,
        input.poolId,
        input.identityKey,
        windows[0]?.key ?? '',
        reservedTokens,
        input.now,
        input.now + this.config.reservationRetentionMs,
      ],
    );

    return { status: 'admitted' };
  }

  private deniedScope(
    reservedTokens: number,
    global: WindowRow,
    identity: IdentityWindowRow,
    limits: QuotaWindowLimits,
  ): QuotaScope | null {
    if (
      global.global_requests + 1 > limits.globalRequests ||
      global.global_tokens + reservedTokens > limits.globalTokens
    ) {
      return 'global';
    }
    if (
      identity.requests + 1 > limits.identityRequests ||
      identity.tokens + reservedTokens > limits.identityTokens
    ) {
      return 'identity';
    }
    return null;
  }

  private limitsFor(kind: QuotaWindowKind): QuotaWindowLimits {
    return kind === 'daily'
      ? this.config.daily
      : this.config.shortWindow?.limits ?? this.config.daily;
  }

  private windowsFor(now: number): QuotaWindow[] {
    const dailyStart = Math.floor(now / DAY_MS) * DAY_MS;
    const daily: QuotaWindow = {
      kind: 'daily',
      key: `${dailyStart}`,
      startMs: dailyStart,
      endMs: dailyStart + DAY_MS,
    };
    if (!this.config.shortWindow) return [daily];
    const size = this.config.shortWindow.seconds * 1000;
    const shortStart = Math.floor(now / size) * size;
    return [
      daily,
      {
        kind: 'short',
        key: `${shortStart}`,
        startMs: shortStart,
        endMs: shortStart + size,
      },
    ];
  }
}

function validateAdmissionInput(input: QuotaAdmissionInput): number {
  validateQuotaKey(input.poolId, 'poolId');
  validateQuotaKey(input.identityKey, 'identityKey');
  validateQuotaKey(input.reservationId, 'reservationId');
  if (!Number.isSafeInteger(input.now) || input.now < 0) {
    throw new QuotaConfigError('admission time must be a safe integer.');
  }
  return tokenReservationTotal(input.tokens);
}

