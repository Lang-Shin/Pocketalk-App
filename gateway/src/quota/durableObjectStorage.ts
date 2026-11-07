import type {
  QuotaSqlStorage,
  QuotaSqlValue,
} from './sqliteQuotaStore';
export interface DurableObjectSqlCursor<T> {
  toArray(): T[];
}

export interface DurableObjectSqlStorage {
  exec<T>(
    query: string,
    ...bindings: QuotaSqlValue[]
  ): DurableObjectSqlCursor<T>;
}

export interface DurableObjectQuotaRuntime {
  transactionSync<T>(work: () => T): T;
  sql: DurableObjectSqlStorage;
}

export function createDurableObjectQuotaStorage(
  runtime: DurableObjectQuotaRuntime,
): QuotaSqlStorage {
  return {
    transaction: <T>(work: () => T): T =>
      runtime.transactionSync(() => {
        const result = work();
        if (isPromiseLike(result)) {
          throw new Error(
            'Durable Object quota transaction callbacks must be synchronous.',
          );
        }
        return result;
      }),
    exec: (sql: string): void => {
      runtime.sql.exec(sql).toArray();
    },
    get: <T>(
      sql: string,
      params: readonly QuotaSqlValue[] = [],
    ): T | undefined =>
      runtime.sql.exec<T>(sql, ...params).toArray()[0],
    run: (sql: string, params: readonly QuotaSqlValue[] = []): void => {
      runtime.sql.exec(sql, ...params).toArray();
    },
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null
  ) {
    return false;
  }
  return typeof (value as { then?: unknown }).then === 'function';
}

