import {
  type ReplayProtectionContext,
  type ReplayProtectionDecision,
  type ReplayProtector,
} from '../auth';
import type { PublicKeyRegistry } from './publicKeyRegistry';
import { base64UrlEncode } from './requestProof';

export interface ChallengeIssueInput {
  keyId: string;
  subject: string;
  ttlMs: number;
  nowMs?: number;
}

export interface ChallengeIssue {
  challengeId: string;
  challenge: string;
  expiresAtMs: number;
}

export interface ChallengeInspectInput {
  challengeId: string;
  challenge: string;
  keyId: string;
  subject?: string;
  nowMs: number;
}

export interface ChallengeConsumeInput {
  challengeId: string;
  challenge: string;
  keyId: string;
  subject?: string;
  nowMs: number;
}

export type ChallengeInspectResult =
  | {
      status: 'active';
      expiresAtMs: number;
    }
  | {
      status:
        | 'unknown'
        | 'expired'
        | 'consumed'
        | 'binding_mismatch';
    };

export type ChallengeConsumeResult =
  | {
      status: 'consumed';
    }
  | {
      status:
        | 'unknown'
        | 'expired'
        | 'already_consumed'
        | 'binding_mismatch';
    };

export interface ChallengeStore {
  issue(input: ChallengeIssueInput): Promise<ChallengeIssue>;
  inspect(input: ChallengeInspectInput): Promise<ChallengeInspectResult>;
  consume(input: ChallengeConsumeInput): Promise<ChallengeConsumeResult>;
  cleanup(nowMs: number): Promise<number>;
}

export interface ChallengeIssuanceLimiterInput {
  keyId: string;
  subject: string;
  nowMs: number;
}

export interface ChallengeIssuanceLimiterResult {
  allowed: boolean;
  reason?: string;
}

export interface ChallengeIssuanceLimiter {
  checkAndRecord(
    input: ChallengeIssuanceLimiterInput,
  ):
    | ChallengeIssuanceLimiterResult
    | Promise<ChallengeIssuanceLimiterResult>;
}

export class ChallengeIssuanceLimitError extends Error {
  constructor() {
    super('Challenge issuance limit exceeded.');
    this.name = 'ChallengeIssuanceLimitError';
  }
}

export class InMemoryChallengeIssuanceLimiter
  implements ChallengeIssuanceLimiter
{
  private readonly windows = new Map<
    string,
    { windowStartMs: number; count: number }
  >();

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number,
  ) {
    if (
      !Number.isSafeInteger(maxPerWindow) ||
      maxPerWindow <= 0 ||
      !Number.isSafeInteger(windowMs) ||
      windowMs <= 0
    ) {
      throw new RangeError(
        'Challenge issuance limits must be positive safe integers.',
      );
    }
  }

  checkAndRecord(
    input: ChallengeIssuanceLimiterInput,
  ): ChallengeIssuanceLimiterResult {
    validateKey(input.keyId, 'keyId');
    validateKey(input.subject, 'subject');
    validateNow(input.nowMs);
    const key = `${input.keyId}\u0000${input.subject}`;
    const windowStartMs =
      Math.floor(input.nowMs / this.windowMs) * this.windowMs;
    const existing = this.windows.get(key);
    const count =
      existing?.windowStartMs === windowStartMs
        ? existing.count
        : 0;
    if (count >= this.maxPerWindow) {
      return { allowed: false, reason: 'issuance_limit' };
    }
    this.windows.set(key, {
      windowStartMs,
      count: count + 1,
    });
    return { allowed: true };
  }
}

interface ChallengeRecord {
  challengeHash: string;
  keyId: string;
  subject: string;
  expiresAtMs: number;
  consumedAtMs?: number;
}

export class InMemoryChallengeStore implements ChallengeStore {
  private readonly records = new Map<string, ChallengeRecord>();

  async issue(input: ChallengeIssueInput): Promise<ChallengeIssue> {
    validateKey(input.keyId, 'keyId');
    validateKey(input.subject, 'subject');
    if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs <= 0) {
      throw new RangeError('Challenge TTL must be a positive safe integer.');
    }
    const nowMs = input.nowMs ?? Date.now();
    validateNow(nowMs);
    const expiresAtMs = nowMs + input.ttlMs;
    if (!Number.isSafeInteger(expiresAtMs)) {
      throw new RangeError('Challenge expiry must be a safe integer.');
    }
    const challengeId = base64UrlEncode(
      crypto.getRandomValues(new Uint8Array(16)),
    );
    const challenge = base64UrlEncode(
      crypto.getRandomValues(new Uint8Array(32)),
    );
    const challengeHash = await hashChallengeValue(challenge);
    this.records.set(challengeId, {
      challengeHash,
      keyId: input.keyId,
      subject: input.subject,
      expiresAtMs,
    });
    return { challengeId, challenge, expiresAtMs };
  }

  async inspect(
    input: ChallengeInspectInput,
  ): Promise<ChallengeInspectResult> {
    validateNow(input.nowMs);
    const record = this.records.get(input.challengeId);
    if (!record) return { status: 'unknown' };
    if (
      record.keyId !== input.keyId ||
      (input.subject !== undefined && record.subject !== input.subject)
    ) {
      return { status: 'binding_mismatch' };
    }
    if (
      !constantTimeEqualString(
        record.challengeHash,
        await hashChallengeValue(input.challenge),
      )
    ) {
      return { status: 'binding_mismatch' };
    }
    if (record.consumedAtMs !== undefined) {
      return { status: 'consumed' };
    }
    if (input.nowMs >= record.expiresAtMs) {
      return { status: 'expired' };
    }
    return { status: 'active', expiresAtMs: record.expiresAtMs };
  }

  async consume(
    input: ChallengeConsumeInput,
  ): Promise<ChallengeConsumeResult> {
    validateNow(input.nowMs);
    const record = this.records.get(input.challengeId);
    if (!record) return { status: 'unknown' };
    if (
      record.keyId !== input.keyId ||
      (input.subject !== undefined && record.subject !== input.subject)
    ) {
      return { status: 'binding_mismatch' };
    }
    if (
      !constantTimeEqualString(
        record.challengeHash,
        await hashChallengeValue(input.challenge),
      )
    ) {
      return { status: 'binding_mismatch' };
    }
    if (record.consumedAtMs !== undefined) {
      return { status: 'already_consumed' };
    }
    if (input.nowMs >= record.expiresAtMs) {
      return { status: 'expired' };
    }
    record.consumedAtMs = input.nowMs;
    return { status: 'consumed' };
  }

  async cleanup(nowMs: number): Promise<number> {
    validateNow(nowMs);
    let removed = 0;
    for (const [id, record] of this.records) {
      if (nowMs >= record.expiresAtMs) {
        this.records.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}

export interface ChallengeReplayProtectorOptions {
  now?: () => number;
  registry?: PublicKeyRegistry;
}

export class ChallengeReplayProtector implements ReplayProtector {
  private readonly now: () => number;

  constructor(
    private readonly challenges: ChallengeStore,
    private readonly options: ChallengeReplayProtectorOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  async consume(
    context: ReplayProtectionContext,
  ): Promise<ReplayProtectionDecision> {
    if (
      !context.challenge ||
      !context.challengeId ||
      !context.keyId
    ) {
      return {
        accepted: false,
        reason: 'missing_challenge_metadata',
      };
    }
    let subject: string | undefined;
    if (this.options.registry) {
      const registered = this.options.registry.get(context.keyId);
      if (!registered) {
        return { accepted: false, reason: 'unknown_key' };
      }
      subject = registered.subject;
    }
    const result = await this.challenges.consume({
      challengeId: context.challengeId,
      challenge: context.challenge,
      keyId: context.keyId,
      subject,
      nowMs: this.now(),
    });
    if (result.status === 'consumed') {
      return { accepted: true };
    }
    return { accepted: false, reason: result.status };
  }
}

export async function hashChallengeValue(challenge: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(challenge),
  );
  return base64UrlEncode(new Uint8Array(digest));
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

function validateKey(value: string, label: string): void {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(value)
  ) {
    throw new RangeError(`${label} is invalid.`);
  }
}

function validateNow(nowMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new RangeError('Challenge time must be a safe integer.');
  }
}
