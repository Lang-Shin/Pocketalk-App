import type { ChallengeSqlStorage } from './challengeStorageAdapter';
import {
  ChallengeIssuanceLimitError,
  hashChallengeValue,
  type ChallengeConsumeInput,
  type ChallengeConsumeResult,
  type ChallengeInspectInput,
  type ChallengeInspectResult,
  type ChallengeIssue,
  type ChallengeIssueInput,
  type ChallengeIssuanceLimiter,
  type ChallengeStore,
} from './challengeStore';

export interface SqliteChallengeStoreConfig {
  retentionMs: number;
  issuanceLimiter?: ChallengeIssuanceLimiter;
}

interface ChallengeRow {
  challenge_id: string;
  challenge_hash: string;
  key_id: string;
  subject: string;
  issued_at_ms: number;
  expires_at_ms: number;
  consumed_at_ms: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS auth_challenges (
  challenge_id TEXT PRIMARY KEY,
  challenge_hash TEXT NOT NULL,
  key_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER,
  CHECK (expires_at_ms > issued_at_ms),
  CHECK (consumed_at_ms IS NULL OR consumed_at_ms >= issued_at_ms)
);
CREATE INDEX IF NOT EXISTS auth_challenges_expiry_idx
  ON auth_challenges (expires_at_ms);
CREATE INDEX IF NOT EXISTS auth_challenges_binding_idx
  ON auth_challenges (key_id, subject);
`;

export class SqliteChallengeStore implements ChallengeStore {
  constructor(
    private readonly storage: ChallengeSqlStorage,
    private readonly config: SqliteChallengeStoreConfig,
  ) {
    if (
      !Number.isSafeInteger(config.retentionMs) ||
      config.retentionMs < 0
    ) {
      throw new RangeError(
        'Challenge retention must be a non-negative safe integer.',
      );
    }
    this.storage.transaction(() => {
      this.storage.exec(SCHEMA);
    });
  }

  async issue(input: ChallengeIssueInput): Promise<ChallengeIssue> {
    validateIdentifier(input.keyId, 'keyId');
    validateIdentifier(input.subject, 'subject');
    validateTtl(input.ttlMs);
    const nowMs = input.nowMs ?? Date.now();
    validateNow(nowMs);
    const expiresAtMs = nowMs + input.ttlMs;
    if (!Number.isSafeInteger(expiresAtMs)) {
      throw new RangeError('Challenge expiry must be a safe integer.');
    }
    if (this.config.issuanceLimiter) {
      const permit = await this.config.issuanceLimiter.checkAndRecord({
        keyId: input.keyId,
        subject: input.subject,
        nowMs,
      });
      if (!permit.allowed) {
        throw new ChallengeIssuanceLimitError();
      }
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const challengeId = createToken(16);
      const challenge = createToken(32);
      const challengeHash = await hashChallengeValue(challenge);
      try {
        this.storage.transaction(() => {
          this.storage.run(
            `INSERT INTO auth_challenges
              (challenge_id, challenge_hash, key_id, subject, issued_at_ms,
               expires_at_ms, consumed_at_ms)
             VALUES (?, ?, ?, ?, ?, ?, NULL)`,
            [
              challengeId,
              challengeHash,
              input.keyId,
              input.subject,
              nowMs,
              expiresAtMs,
            ],
          );
        });
        return { challengeId, challenge, expiresAtMs };
      } catch (error) {
        if (!isUniqueConstraintError(error) || attempt === 2) {
          throw error;
        }
      }
    }
    throw new Error('Challenge ID generation failed.');
  }

  async inspect(
    input: ChallengeInspectInput,
  ): Promise<ChallengeInspectResult> {
    validateInspectInput(input);
    const challengeHash = await hashChallengeValue(input.challenge);
    return this.storage.transaction(() => {
      const row = this.readRow(input.challengeId);
      const invalid = classifyRow(row, input, challengeHash);
      if (invalid) return invalid;
      return {
        status: 'active',
        expiresAtMs: (row as ChallengeRow).expires_at_ms,
      };
    });
  }

  async consume(
    input: ChallengeConsumeInput,
  ): Promise<ChallengeConsumeResult> {
    validateInspectInput(input);
    const challengeHash = await hashChallengeValue(input.challenge);
    return this.storage.transaction(() => {
      const params: (string | number | null)[] = [
        input.nowMs,
        input.challengeId,
        input.nowMs,
        input.keyId,
        challengeHash,
      ];
      let sql = `UPDATE auth_challenges
          SET consumed_at_ms = ?
        WHERE challenge_id = ?
          AND consumed_at_ms IS NULL
          AND expires_at_ms > ?
          AND key_id = ?
          AND challenge_hash = ?`;
      if (input.subject !== undefined) {
        sql += ' AND subject = ?';
        params.push(input.subject);
      }
      this.storage.run(sql, params);
      const changes = this.storage.get<{ changes: number }>(
        'SELECT changes() AS changes',
      )?.changes;
      if (changes === 1) return { status: 'consumed' };

      const current = this.readRow(input.challengeId);
      if (!current) return { status: 'unknown' };
      if (current.consumed_at_ms !== null) {
        return { status: 'already_consumed' };
      }
      if (
        current.key_id !== input.keyId ||
        (input.subject !== undefined &&
          current.subject !== input.subject) ||
        !constantTimeEqualString(current.challenge_hash, challengeHash)
      ) {
        return { status: 'binding_mismatch' };
      }
      if (input.nowMs >= current.expires_at_ms) {
        return { status: 'expired' };
      }
      return { status: 'binding_mismatch' };
    });
  }

  async cleanup(nowMs: number): Promise<number> {
    validateNow(nowMs);
    const threshold =
      nowMs > this.config.retentionMs
        ? nowMs - this.config.retentionMs
        : 0;
    return this.storage.transaction(() => {
      this.storage.run(
        'DELETE FROM auth_challenges WHERE expires_at_ms < ?',
        [threshold],
      );
      return (
        this.storage.get<{ changes: number }>(
          'SELECT changes() AS changes',
        )?.changes ?? 0
      );
    });
  }

  private readRow(challengeId: string): ChallengeRow | undefined {
    return this.storage.get<ChallengeRow>(
      `SELECT challenge_id, challenge_hash, key_id, subject, issued_at_ms,
              expires_at_ms, consumed_at_ms
         FROM auth_challenges
        WHERE challenge_id = ?`,
      [challengeId],
    );
  }
}

function classifyRow(
  row: ChallengeRow | undefined,
  input: ChallengeInspectInput,
  challengeHash: string,
):
  | { status: 'unknown' }
  | { status: 'expired' }
  | { status: 'consumed' }
  | { status: 'binding_mismatch' }
  | null {
  if (!row) return { status: 'unknown' };
  if (
    row.key_id !== input.keyId ||
    (input.subject !== undefined && row.subject !== input.subject)
  ) {
    return { status: 'binding_mismatch' };
  }
  if (!constantTimeEqualString(row.challenge_hash, challengeHash)) {
    return { status: 'binding_mismatch' };
  }
  if (row.consumed_at_ms !== null) {
    return { status: 'consumed' };
  }
  if (input.nowMs >= row.expires_at_ms) {
    return { status: 'expired' };
  }
  return null;
}

function validateInspectInput(
  input: ChallengeInspectInput | ChallengeConsumeInput,
): void {
  validateIdentifier(input.challengeId, 'challengeId');
  validateIdentifier(input.keyId, 'keyId');
  if (input.subject !== undefined) {
    validateIdentifier(input.subject, 'subject');
  }
  validateToken(input.challenge, 'challenge');
  validateNow(input.nowMs);
}

function validateIdentifier(value: string, label: string): void {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(value)
  ) {
    throw new RangeError(`${label} is invalid.`);
  }
}

function validateToken(value: string, label: string): void {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value)
  ) {
    throw new RangeError(`${label} is invalid.`);
  }
}

function validateTtl(ttlMs: number): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new RangeError('Challenge TTL must be a positive safe integer.');
  }
}

function validateNow(nowMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new RangeError('Challenge time must be a safe integer.');
  }
}

function createToken(bytes: number): string {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
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

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /unique|constraint/i.test(error.message)
  );
}
