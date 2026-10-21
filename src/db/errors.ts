export type FinanceErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'ARCHIVED_CONTAINER'
  | 'INSUFFICIENT_FUNDS'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_STATE'
  | 'SCHEMA_VERSION'
  | 'DATABASE';

export class FinanceError extends Error {
  readonly code: FinanceErrorCode;

  constructor(
    code: FinanceErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'FinanceError';
    this.code = code;
  }
}
