export interface QuotaWindowLimits {
  globalRequests: number;
  identityRequests: number;
  globalTokens: number;
  identityTokens: number;
}

export interface QuotaShortWindowLimits {
  seconds: number;
  limits: QuotaWindowLimits;
}

export interface QuotaConfig {
  daily: QuotaWindowLimits;
  shortWindow?: QuotaShortWindowLimits;
  reservationRetentionMs: number;
  windowRetentionMs: number;
}

export interface QuotaTokenReservation {
  expectedInputTokens: number;
  maxOutputTokens: number;
  framingOverheadTokens: number;
}

export interface QuotaAdmissionInput {
  poolId: string;
  identityKey: string;
  reservationId: string;
  now: number;
  tokens: QuotaTokenReservation;
}

export type QuotaScope = 'global' | 'identity';
export type QuotaWindowKind = 'daily' | 'short';
export type QuotaDuplicateReason = 'identical' | 'conflict';

export type QuotaDecision =
  | {
      status: 'admitted';
    }
  | {
      status: 'quota_exhausted';
      scope: QuotaScope;
      window: QuotaWindowKind;
      retryAfterSeconds?: number;
    }
  | {
      status: 'duplicate';
      reason: QuotaDuplicateReason;
    }
  | {
      status: 'unavailable';
    };

export class QuotaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaConfigError';
  }
}

export function validateQuotaConfig(config: QuotaConfig): void {
  if (config === null || typeof config !== 'object') {
    throw new QuotaConfigError('Quota configuration is required.');
  }
  validateLimits(config.daily, 'daily');
  if (config.shortWindow !== undefined) {
    const shortWindow = config.shortWindow;
    if (shortWindow === null || typeof shortWindow !== 'object') {
      throw new QuotaConfigError('shortWindow must be an object.');
    }
    if (
      !Number.isSafeInteger(shortWindow.seconds) ||
      shortWindow.seconds <= 0
    ) {
      throw new QuotaConfigError(
        'shortWindow.seconds must be a positive safe integer.',
      );
    }
    validateLimits(shortWindow.limits, 'shortWindow.limits');
  }
  validatePositiveSafeInteger(
    config.reservationRetentionMs,
    'reservationRetentionMs',
  );
  validatePositiveSafeInteger(config.windowRetentionMs, 'windowRetentionMs');
  if (config.windowRetentionMs <= (config.shortWindow?.seconds ?? 0) * 1000) {
    throw new QuotaConfigError(
      'windowRetentionMs must exceed the short-window duration.',
    );
  }
}

function validateLimits(limits: QuotaWindowLimits, label: string): void {
  if (limits === null || typeof limits !== 'object') {
    throw new QuotaConfigError(`${label} limits are required.`);
  }
  validatePositiveSafeInteger(limits.globalRequests, `${label}.globalRequests`);
  validatePositiveSafeInteger(
    limits.identityRequests,
    `${label}.identityRequests`,
  );
  validatePositiveSafeInteger(limits.globalTokens, `${label}.globalTokens`);
  validatePositiveSafeInteger(
    limits.identityTokens,
    `${label}.identityTokens`,
  );
}

const QUOTA_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function validateQuotaKey(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !QUOTA_KEY_PATTERN.test(value)) {
    throw new QuotaConfigError(`${label} is invalid.`);
  }
}

export function tokenReservationTotal(tokens: QuotaTokenReservation): number {
  if (tokens === null || typeof tokens !== 'object') {
    throw new QuotaConfigError('Token reservation is required.');
  }
  validateNonNegativeSafeInteger(
    tokens.expectedInputTokens,
    'expectedInputTokens',
  );
  validateNonNegativeSafeInteger(tokens.maxOutputTokens, 'maxOutputTokens');
  validateNonNegativeSafeInteger(
    tokens.framingOverheadTokens,
    'framingOverheadTokens',
  );
  const total =
    tokens.expectedInputTokens +
    tokens.maxOutputTokens +
    tokens.framingOverheadTokens;
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new QuotaConfigError(
      'Token reservation total must be a positive safe integer.',
    );
  }
  return total;
}

export function validateQuotaReservation(reservation: {
  poolId: unknown;
  maxOutputTokens: unknown;
  framingOverheadTokens: unknown;
}): void {
  validateQuotaKey(reservation.poolId, 'poolId');
  validatePositiveSafeInteger(
    reservation.maxOutputTokens,
    'maxOutputTokens',
  );
  validatePositiveSafeInteger(
    reservation.framingOverheadTokens,
    'framingOverheadTokens',
  );
}

function validatePositiveSafeInteger(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new QuotaConfigError(
      `${label} must be a positive safe integer.`,
    );
  }
}

function validateNonNegativeSafeInteger(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new QuotaConfigError(
      `${label} must be a non-negative safe integer.`,
    );
  }
}
