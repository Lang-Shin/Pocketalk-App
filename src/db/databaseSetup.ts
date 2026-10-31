import { migrateDatabase } from './migrations';
import type { SqlDatabase } from './sqlDatabase';

export interface DatabaseSetupOptions {
  enableWal?: boolean;
}

export async function preparePocketaDatabase(
  database: SqlDatabase,
  options: DatabaseSetupOptions = {},
): Promise<SqlDatabase> {
  await database.execAsync(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    ${options.enableWal ? 'PRAGMA journal_mode = WAL;' : ''}
  `);
  await migrateDatabase(database);
  return database;
}
