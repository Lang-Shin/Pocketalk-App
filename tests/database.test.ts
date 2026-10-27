import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FinanceEngine } from '../src/db/financeEngine';
import { MIGRATIONS, migrateDatabase } from '../src/db/migrations';
import { ensureSystemSavingsContainer } from '../src/db/systemContainers';
import { NodeSqlDatabase } from './helpers/nodeSqlDatabase';
import {
  createTestIdFactory,
  seedStandardAccounts,
  TestClock,
} from './helpers/financeTestHarness';

test('fresh initialization creates the finance schema and enables foreign keys', async () => {
  const database = new NodeSqlDatabase();
  try {
    await migrateDatabase(database);

    const tables = await database.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name ASC`,
    );
    const names = tables.map((table) => table.name);
    for (const expected of [
      'app_meta',
      'budget_limits',
      'container_lifecycle_events',
      'container_metadata_history',
      'containers',
      'operation_receipts',
      'postings',
      'schema_migrations',
      'transactions',
      'wallets',
    ]) {
      assert.ok(names.includes(expected), `missing table ${expected}`);
    }

    const version = await database.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    const foreignKeys = await database.getFirstAsync<{ foreign_keys: number }>(
      'PRAGMA foreign_keys',
    );
    const migrations =
      await database.getAllAsync<{ version: number }>(
        'SELECT version FROM schema_migrations ORDER BY version ASC',
      );

    assert.equal(version?.user_version, 4);
    assert.equal(foreignKeys?.foreign_keys, 1);
    assert.deepEqual(
      migrations.map((row) => row.version),
      [1, 2, 3, 4],
    );
  } finally {
    database.close();
  }
});

test('repeated initialization preserves data and does not duplicate migration records', async () => {
  const database = new NodeSqlDatabase();
  try {
    await migrateDatabase(database);
    await database.runAsync(
      'INSERT INTO app_meta (key, value) VALUES (?, ?)',
      ['test-key', 'preserved'],
    );

    await migrateDatabase(database);
    await migrateDatabase(database);

    const value = await database.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_meta WHERE key = ?',
      ['test-key'],
    );
    const count = await database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM schema_migrations',
    );

    assert.equal(value?.value, 'preserved');
    assert.equal(count?.count, 4);
  } finally {
    database.close();
  }
});

test('a version 1 database upgrades to the full schema without losing records', async () => {
  const database = new NodeSqlDatabase();
  try {
    await migrateDatabase(database, MIGRATIONS.slice(0, 1));
    await database.runAsync(
      'INSERT INTO app_meta (key, value) VALUES (?, ?)',
      ['upgrade-key', 'kept'],
    );

    const before = await database.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    assert.equal(before?.user_version, 1);

    await migrateDatabase(database);

    const after = await database.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    const value = await database.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_meta WHERE key = ?',
      ['upgrade-key'],
    );
    const receipts = await database.getFirstAsync<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name = 'operation_receipts'`,
    );
    const columns = await database.getAllAsync<{ name: string }>(
      'PRAGMA table_info(containers)',
    );

    assert.equal(after?.user_version, 4);
    assert.equal(value?.value, 'kept');
    assert.equal(receipts?.name, 'operation_receipts');
    assert.ok(columns.some((column) => column.name === 'system_key'));
  } finally {
    database.close();
  }
});

test('a version 2 database upgrades to version 4 without losing financial records', async () => {
  const database = new NodeSqlDatabase();
  try {
    await migrateDatabase(database, MIGRATIONS.slice(0, 2));
    await database.runAsync(
      `INSERT INTO wallets (id, name, kind, icon, tone, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['wallet-cash', 'Cash', 'cash', 'wallet-outline', 'emerald', 1, '2026-10-20T00:00:00.000Z'],
    );
    await database.runAsync(
      `INSERT INTO containers (
         id, kind, status, sort_order, created_month_key, created_at,
         archived_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['container-food', 'budget', 'active', 1, '2026-10', '2026-10-20T00:00:00.000Z', null, null],
    );
    await database.runAsync(
      `INSERT INTO container_metadata_history (
         container_id, effective_month_key, name, description, icon, tone,
         recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['container-food', '2026-10', 'Food', '', 'fast-food-outline', 'amber', '2026-10-20T00:00:00.000Z'],
    );
    await database.runAsync(
      `INSERT INTO transactions (
         id, idempotency_key, request_fingerprint, kind, title, category,
         direction, amount_minor, effective_date, effective_month_key,
         recorded_at, recorded_time_zone, recorded_offset_minutes, status,
         source_wallet_id, destination_wallet_id, source_container_id,
         destination_container_id, source_wallet_name, destination_wallet_name,
         source_container_name, destination_container_name, icon, tone,
         reversal_of_id, correction_of_id, created_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?
       )`,
      [
        'txn-legacy',
        'legacy-income',
        '{"legacy":true}',
        'income',
        'Allowance',
        'Food',
        'in',
        100_000,
        '2026-10-20',
        '2026-10',
        '2026-10-20T00:00:00.000Z',
        'Asia/Manila',
        480,
        'posted',
        null,
        'wallet-cash',
        null,
        'container-food',
        null,
        'Cash',
        null,
        'Food',
        'arrow-down',
        'emerald',
        null,
        null,
        '2026-10-20T00:00:00.000Z',
      ],
    );
    await database.runAsync(
      `INSERT INTO postings (
         transaction_id, account_type, account_id, wallet_id, container_id,
         amount_minor, recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['txn-legacy', 'wallet', 'wallet-cash', 'wallet-cash', null, 100_000, '2026-10-20T00:00:00.000Z'],
    );
    await database.runAsync(
      `INSERT INTO postings (
         transaction_id, account_type, account_id, wallet_id, container_id,
         amount_minor, recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['txn-legacy', 'container', 'container-food', null, 'container-food', 100_000, '2026-10-20T00:00:00.000Z'],
    );

    const before = await database.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    assert.equal(before?.user_version, 2);

    await migrateDatabase(database);

    const after = await database.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    const container = await database.getFirstAsync<{
      id: string;
      system_key: string | null;
    }>('SELECT id, system_key FROM containers WHERE id = ?', ['container-food']);
    const transactionCount = await database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM transactions',
    );
    const postingCount = await database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM postings',
    );

    assert.equal(after?.user_version, 4);
    assert.equal(container?.id, 'container-food');
    assert.equal(container?.system_key, null);
    assert.equal(transactionCount?.count, 1);
    assert.equal(postingCount?.count, 2);
  } finally {
    database.close();
  }
});

test('a version 3 database upgrades to version 4 and preserves container history', async () => {
  const database = new NodeSqlDatabase();
  try {
    await migrateDatabase(database, MIGRATIONS.slice(0, 3));
    await database.runAsync(
      `INSERT INTO containers (
         id, kind, status, sort_order, created_month_key, created_at,
         archived_at, deleted_at, system_key
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'container-food',
        'budget',
        'active',
        1,
        '2026-10',
        '2026-10-20T00:00:00.000Z',
        null,
        null,
        null,
      ],
    );
    await database.runAsync(
      `INSERT INTO container_metadata_history (
         container_id, effective_month_key, name, description, icon, tone,
         recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        'container-food',
        '2026-10',
        'Food',
        '',
        'fast-food-outline',
        'amber',
        '2026-10-20T00:00:00.000Z',
      ],
    );

    await migrateDatabase(database);
    const container = await database.getFirstAsync<{
      id: string;
      system_key: string | null;
    }>('SELECT id, system_key FROM containers WHERE id = ?', [
      'container-food',
    ]);
    const schema = await database.getFirstAsync<{ sql: string }>(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'containers'`,
    );
    const violations = await database.getAllAsync<{ table: string }>(
      'PRAGMA foreign_key_check',
    );

    assert.equal(container?.id, 'container-food');
    assert.equal(container?.system_key, null);
    assert.match(schema?.sql ?? '', /'unallocated', 'savings'/);
    assert.deepEqual(violations, []);

    await assert.rejects(
      database.runAsync(
        `INSERT INTO containers (
           id, kind, status, sort_order, created_month_key, created_at,
           archived_at, deleted_at, system_key
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'system-savings',
          'budget',
          'active',
          2,
          '1970-01',
          '2026-10-20T00:00:00.000Z',
          null,
          null,
          'unallocated',
        ],
      ),
      /reserved/i,
    );

    const savings = await ensureSystemSavingsContainer(database, {
      recordedAt: '2026-10-20T00:00:00.000Z',
    });
    const savingsRow = await database.getFirstAsync<{
      kind: string;
      system_key: string;
    }>('SELECT kind, system_key FROM containers WHERE id = ?', [
      savings.containerId,
    ]);
    assert.equal(savingsRow?.kind, 'savings');
    assert.equal(savingsRow?.system_key, 'savings');
  } finally {
    database.close();
  }
});

test('file-backed databases enable write-ahead logging', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pocketa-wal-'));
  const databasePath = join(directory, 'pocketa.db');
  const database = new NodeSqlDatabase(databasePath);

  try {
    const mode = await database.getFirstAsync<{ journal_mode: string }>(
      'PRAGMA journal_mode',
    );
    assert.equal(mode?.journal_mode, 'wal');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('foreign key constraints reject orphaned rows', async () => {
  const database = new NodeSqlDatabase();
  try {
    await migrateDatabase(database);
    await assert.rejects(
      database.runAsync(
        `INSERT INTO container_metadata_history (
           container_id, effective_month_key, name, description, icon, tone,
           recorded_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          'missing-container',
          '2026-10',
          'Orphan',
          '',
          'wallet-outline',
          'blue',
          '2026-10-20T00:00:00.000Z',
        ],
      ),
      /FOREIGN KEY/i,
    );
  } finally {
    database.close();
  }
});

test('transactions roll back completely when a task fails', async () => {
  const database = new NodeSqlDatabase();
  try {
    await migrateDatabase(database);
    await assert.rejects(
      database.withTransactionAsync(async () => {
        await database.runAsync(
          'INSERT INTO app_meta (key, value) VALUES (?, ?)',
          ['rollback-key', 'should-not-survive'],
        );
        throw new Error('forced failure');
      }),
      /forced failure/,
    );

    const row = await database.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_meta WHERE key = ?',
      ['rollback-key'],
    );
    assert.equal(row, null);
  } finally {
    database.close();
  }
});

test('data and idempotency receipts survive closing and reopening the database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pocketa-phase3-'));
  const databasePath = join(directory, 'pocketa.db');

  try {
    const firstDatabase = new NodeSqlDatabase(databasePath);
    const clock = new TestClock(2026, 9, 20);
    const firstEngine = new FinanceEngine(firstDatabase, {
      now: clock.now,
      idFactory: createTestIdFactory(),
    });
    await migrateDatabase(firstDatabase);
    const accounts = await seedStandardAccounts(firstEngine);
    const firstTransaction = await firstEngine.recordTransaction({
      kind: 'income',
      title: 'Allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'persisted-income',
    });
    firstDatabase.close();

    const secondDatabase = new NodeSqlDatabase(databasePath);
    try {
      await migrateDatabase(secondDatabase);
      const secondEngine = new FinanceEngine(secondDatabase, {
        now: clock.now,
        idFactory: createTestIdFactory(),
      });
      const balances = await secondEngine.getWalletBalances('2026-10-20');
      const summary = await secondEngine.getMonthSummary('2026-10', '2026-10');
      const retry = await secondEngine.recordTransaction({
        kind: 'income',
        title: 'Allowance',
        amountMinor: 100_000,
        effectiveDate: '2026-10-20',
        walletId: accounts.cashWalletId,
        containerId: accounts.foodContainerId,
        idempotencyKey: 'persisted-income',
      });
      const rows = await secondDatabase.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM transactions',
      );

      assert.equal(balances['wallet-cash'], 100_000);
      assert.equal(summary.incomeMinor, 100_000);
      assert.equal(retry.transactionId, firstTransaction.transactionId);
      assert.equal(rows?.count, 1);
    } finally {
      secondDatabase.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
