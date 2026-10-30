import {
  openDatabaseAsync,
  type SQLiteBindValue,
  type SQLiteDatabase,
} from 'expo-sqlite';
import { Platform } from 'react-native';

import { migrateDatabase } from './migrations';
import type { SqlDatabase, SqlValue } from './sqlDatabase';

export const POCKETA_DATABASE_NAME = 'pocketa.db';

let databasePromise: Promise<SqlDatabase> | null = null;

export function createExpoSqlDatabase(database: SQLiteDatabase): SqlDatabase {
  let transactionTail: Promise<void> = Promise.resolve();

  return {
    execAsync: (source) => database.execAsync(source),
    runAsync: async (source, params = []) => {
      const result = await database.runAsync(
        source,
        params as SQLiteBindValue[],
      );
      return {
        changes: result.changes,
        lastInsertRowId: result.lastInsertRowId,
      };
    },
    getAllAsync: <T>(source: string, params: SqlValue[] = []) =>
      database.getAllAsync<T>(source, params as SQLiteBindValue[]),
    getFirstAsync: <T>(source: string, params: SqlValue[] = []) =>
      database.getFirstAsync<T>(source, params as SQLiteBindValue[]),
    withTransactionAsync: async <T>(task: () => Promise<T>) => {
      const previous = transactionTail;
      let release: () => void = () => undefined;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        let result: T | undefined;
        await database.withTransactionAsync(async () => {
          result = await task();
        });
        return result as T;
      } finally {
        release();
      }
    },
  };
}

export async function openPocketaDatabase(): Promise<SqlDatabase> {
  if (!databasePromise) {
    databasePromise = initializeDatabase().catch((error) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

async function initializeDatabase(): Promise<SqlDatabase> {
  const database = await openDatabaseAsync(POCKETA_DATABASE_NAME);
  await database.execAsync(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    ${Platform.OS === 'web' ? '' : 'PRAGMA journal_mode = WAL;'}
  `);
  const adapter = createExpoSqlDatabase(database);
  await migrateDatabase(adapter);
  return adapter;
}
