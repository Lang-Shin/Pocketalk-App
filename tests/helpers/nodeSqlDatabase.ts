import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type {
  SqlDatabase,
  SqlRunResult,
  SqlValue,
} from '../../src/db/sqlDatabase';

export class NodeSqlDatabase implements SqlDatabase {
  private readonly database: DatabaseSync;
  private inTransaction = false;

  constructor(path = ':memory:') {
    this.database = new DatabaseSync(path);
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (path !== ':memory:') {
      this.database.exec('PRAGMA journal_mode = WAL;');
    }
  }

  async execAsync(source: string): Promise<void> {
    this.database.exec(source);
  }

  async runAsync(
    source: string,
    params: SqlValue[] = [],
  ): Promise<SqlRunResult> {
    const result = this.database
      .prepare(source)
      .run(...(params as SQLInputValue[]));
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  async getAllAsync<T>(source: string, params: SqlValue[] = []): Promise<T[]> {
    return this.database
      .prepare(source)
      .all(...(params as SQLInputValue[])) as T[];
  }

  async getFirstAsync<T>(
    source: string,
    params: SqlValue[] = [],
  ): Promise<T | null> {
    const row = this.database
      .prepare(source)
      .get(...(params as SQLInputValue[]));
    return (row as T | undefined) ?? null;
  }

  async withTransactionAsync<T>(task: () => Promise<T>): Promise<T> {
    if (this.inTransaction) {
      throw new Error('Nested test transactions are not supported.');
    }
    this.inTransaction = true;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = await task();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  close(): void {
    this.database.close();
  }
}
