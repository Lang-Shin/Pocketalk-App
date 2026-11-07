import type { RateLimiter, RateLimitContext } from '../rateLimit';
import type { QuotaIdentityPseudonymizer } from './identityKey';
import type { SqliteQuotaStore } from './sqliteQuotaStore';
import { validateQuotaKey } from './types';

export class SqliteQuotaLimiter implements RateLimiter {
  constructor(
    private readonly store: SqliteQuotaStore,
    private readonly pseudonymize?: QuotaIdentityPseudonymizer,
  ) {}

  async admit(context: RateLimitContext) {
    if (
      !context.poolId ||
      !context.reservationId ||
      !context.tokenReservation
    ) {
      return { allowed: false, status: 'unavailable' as const };
    }
    const identityKey = await this.resolveIdentityKey(context.identity);
    if (!identityKey) {
      return { allowed: false, status: 'unavailable' as const };
    }
    const decision = this.store.admit({
      poolId: context.poolId,
      identityKey,
      reservationId: context.reservationId,
      now: context.now,
      tokens: context.tokenReservation,
    });
    if (decision.status === 'admitted') {
      return { allowed: true, status: 'admitted' as const };
    }
    if (decision.status === 'duplicate') {
      return {
        allowed: false,
        status: 'duplicate' as const,
        reason: decision.reason,
      };
    }
    if (decision.status === 'quota_exhausted') {
      return {
        allowed: false,
        status: 'quota_exhausted' as const,
        scope: decision.scope,
        window: decision.window,
        retryAfterSeconds: decision.retryAfterSeconds,
      };
    }
    return { allowed: false, status: 'unavailable' as const };
  }

  private async resolveIdentityKey(
    subject: string,
  ): Promise<string | undefined> {
    if (!this.pseudonymize) return undefined;
    try {
      const identityKey = await this.pseudonymize(subject);
      validateQuotaKey(identityKey, 'identityKey');
      if (identityKey === subject) return undefined;
      return identityKey;
    } catch {
      return undefined;
    }
  }
}
