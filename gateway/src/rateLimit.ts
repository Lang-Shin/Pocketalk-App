export interface RateLimitTokenReservation {
  expectedInputTokens: number;
  maxOutputTokens: number;
  framingOverheadTokens: number;
}

export interface RateLimitContext {
  identity: string;
  now: number;
  reservationId?: string;
  poolId?: string;
  tokenReservation?: RateLimitTokenReservation;
}

export interface RateLimitDecision {
  allowed: boolean;
  scope?: 'identity' | 'global';
  retryAfterSeconds?: number;
  status?: 'admitted' | 'quota_exhausted' | 'duplicate' | 'unavailable';
  window?: 'daily' | 'short';
  reason?: 'identical' | 'conflict';
}

export interface RateLimiter {
  admit(context: RateLimitContext): Promise<RateLimitDecision>;
}

export interface InMemoryRateLimiterOptions {
  perIdentityLimit: number;
  globalLimit: number;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly perIdentityLimit: number;
  private readonly globalLimit: number;
  private readonly identityCounts = new Map<string, number>();
  private globalCount = 0;

  constructor(options: InMemoryRateLimiterOptions) {
    if (
      !Number.isInteger(options.perIdentityLimit) ||
      options.perIdentityLimit <= 0
    ) {
      throw new RangeError('perIdentityLimit must be a positive integer.');
    }
    if (
      !Number.isInteger(options.globalLimit) ||
      options.globalLimit <= 0
    ) {
      throw new RangeError('globalLimit must be a positive integer.');
    }
    this.perIdentityLimit = options.perIdentityLimit;
    this.globalLimit = options.globalLimit;
  }

  async admit(context: RateLimitContext): Promise<RateLimitDecision> {
    const identityCount = this.identityCounts.get(context.identity) ?? 0;
    if (identityCount >= this.perIdentityLimit) {
      return {
        allowed: false,
        scope: 'identity',
        status: 'quota_exhausted',
      };
    }
    if (this.globalCount >= this.globalLimit) {
      return {
        allowed: false,
        scope: 'global',
        status: 'quota_exhausted',
      };
    }
    this.identityCounts.set(context.identity, identityCount + 1);
    this.globalCount += 1;
    return { allowed: true, status: 'admitted' };
  }
}

export function unavailableRateLimiter(): RateLimiter {
  return {
    async admit() {
      throw new Error('Rate limiter unavailable.');
    },
  };
}
