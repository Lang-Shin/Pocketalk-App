import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FinanceError } from '../src/db/errors';
import { FinanceEngine } from '../src/db/financeEngine';
import { migrateDatabase } from '../src/db/migrations';
import {
  UNALLOCATED_CONTAINER_ID,
  UNALLOCATED_SYSTEM_KEY,
} from '../src/db/systemContainers';
import {
  createHarness,
  createTestIdFactory,
  seedStandardAccounts,
  TestClock,
} from './helpers/financeTestHarness';
import { NodeSqlDatabase } from './helpers/nodeSqlDatabase';

function isFinanceError(code: string) {
  return (error: unknown): boolean =>
    error instanceof FinanceError && error.code === code;
}

test('income without a container is held in the system Unallocated account', async () => {
  const harness = await createHarness();
  try {
    const accounts = await seedStandardAccounts(harness.engine);
    const result = await harness.engine.recordIncome({
      title: 'Allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      idempotencyKey: 'income-unallocated',
    });

    const transaction = await harness.engine.getTransaction(result.transactionId);
    const snapshot = await harness.engine.getUnallocatedSnapshot('2026-10');

    assert.equal(transaction?.destinationContainerId, UNALLOCATED_CONTAINER_ID);
    assert.equal(snapshot?.id, UNALLOCATED_CONTAINER_ID);
    assert.equal(snapshot?.systemKey, UNALLOCATED_SYSTEM_KEY);
    assert.equal(snapshot?.name, 'Unallocated');
    assert.equal(snapshot?.balanceMinor, 100_000);
    assert.equal(snapshot?.limitMinor, 0);
  } finally {
    harness.database.close();
  }
});

test('the Unallocated account is created once with stable metadata and no transactions', async () => {
  const harness = await createHarness();
  try {
    await harness.engine.ensureUnallocatedContainer();
    await harness.engine.ensureUnallocatedContainer();
    await harness.engine.ensureUnallocatedContainer();

    const containers = await harness.engine.listContainers(true, true);
    const systemContainers = containers.filter(
      (container) => container.systemKey === UNALLOCATED_SYSTEM_KEY,
    );
    const metadata = await harness.engine.getMetadataHistory(
      UNALLOCATED_CONTAINER_ID,
    );
    const lifecycle = await harness.engine.getLifecycleEvents(
      UNALLOCATED_CONTAINER_ID,
    );
    const transactions = await harness.engine.getTransactionsForMonth('2026-10');

    assert.equal(systemContainers.length, 1);
    assert.equal(systemContainers[0]?.id, UNALLOCATED_CONTAINER_ID);
    assert.equal(systemContainers[0]?.status, 'active');
    assert.equal(metadata.length, 1);
    assert.equal(metadata[0]?.label.name, 'Unallocated');
    assert.ok(lifecycle.some((event) => event.eventType === 'created'));
    assert.equal(transactions.length, 0);
  } finally {
    harness.database.close();
  }
});

test('ordinary container listing hides Unallocated unless explicitly requested', async () => {
  const harness = await createHarness();
  try {
    await harness.engine.ensureUnallocatedContainer();

    const visible = await harness.engine.listContainers();
    const all = await harness.engine.listContainers(false, true);
    const deleted = await harness.engine.listContainers(true, true);

    assert.ok(
      !visible.some((container) => container.id === UNALLOCATED_CONTAINER_ID),
    );
    assert.ok(
      all.some(
        (container) =>
          container.id === UNALLOCATED_CONTAINER_ID &&
          container.systemKey === UNALLOCATED_SYSTEM_KEY,
      ),
    );
    assert.ok(
      deleted.some((container) => container.id === UNALLOCATED_CONTAINER_ID),
    );
  } finally {
    harness.database.close();
  }
});

test('allocating from Unallocated changes only container balances', async () => {
  const harness = await createHarness();
  try {
    const accounts = await seedStandardAccounts(harness.engine);
    await harness.engine.recordIncome({
      title: 'Allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      idempotencyKey: 'income-allocation',
    });
    const allocation = await harness.engine.allocateToContainer({
      containerId: accounts.foodContainerId,
      amountMinor: 30_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'allocate-food',
    });

    const transaction = await harness.engine.getTransaction(
      allocation.transactionId,
    );
    const summary = await harness.engine.getMonthSummary('2026-10', '2026-10');
    const walletBalances = await harness.engine.getWalletBalances('2026-10-20');
    const containerBalances =
      await harness.engine.getContainerBalances('2026-10-20');
    const invariant = await harness.engine.repository.allWalletContainerTotalsMatch(
      '9999-12-31',
    );

    assert.equal(transaction?.kind, 'container_transfer');
    assert.equal(transaction?.direction, 'neutral');
    assert.equal(transaction?.sourceWalletId, null);
    assert.equal(transaction?.destinationWalletId, null);
    assert.equal(walletBalances[accounts.cashWalletId], 100_000);
    assert.equal(containerBalances[UNALLOCATED_CONTAINER_ID], 70_000);
    assert.equal(containerBalances[accounts.foodContainerId], 30_000);
    assert.equal(summary.incomeMinor, 100_000);
    assert.equal(summary.expenseMinor, 0);
    assert.equal(summary.netSavingsMinor, 100_000);
    assert.equal(summary.savingsContributionsMinor, 0);
    assert.equal(invariant, true);
  } finally {
    harness.database.close();
  }
});

test('returning funds to Unallocated preserves income, wallets, and the ledger invariant', async () => {
  const harness = await createHarness();
  try {
    const accounts = await seedStandardAccounts(harness.engine);
    await harness.engine.recordIncome({
      title: 'Allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      idempotencyKey: 'income-return',
    });
    await harness.engine.allocateToContainer({
      containerId: accounts.foodContainerId,
      amountMinor: 40_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'allocate-return',
    });
    await harness.engine.returnToUnallocated({
      containerId: accounts.foodContainerId,
      amountMinor: 15_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'return-food',
    });

    const summary = await harness.engine.getMonthSummary('2026-10', '2026-10');
    const walletBalances = await harness.engine.getWalletBalances('2026-10-20');
    const containerBalances =
      await harness.engine.getContainerBalances('2026-10-20');

    assert.equal(summary.incomeMinor, 100_000);
    assert.equal(summary.expenseMinor, 0);
    assert.equal(summary.netSavingsMinor, 100_000);
    assert.equal(walletBalances[accounts.cashWalletId], 100_000);
    assert.equal(containerBalances[UNALLOCATED_CONTAINER_ID], 75_000);
    assert.equal(containerBalances[accounts.foodContainerId], 25_000);
    assert.equal(
      await harness.engine.repository.allWalletContainerTotalsMatch(
        '9999-12-31',
      ),
      true,
    );
  } finally {
    harness.database.close();
  }
});

test('transfers between user containers do not change wallets or savings totals', async () => {
  const harness = await createHarness();
  try {
    const accounts = await seedStandardAccounts(harness.engine);
    await harness.engine.createContainer({
      id: 'container-transport',
      name: 'Transport',
      description: '',
      icon: 'bus-outline',
      tone: 'blue',
      idempotencyKey: 'create-transport',
    });
    await harness.engine.recordIncome({
      title: 'Allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      idempotencyKey: 'income-user-transfer',
    });
    await harness.engine.allocateToContainer({
      containerId: accounts.foodContainerId,
      amountMinor: 50_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'allocate-user-transfer',
    });
    await harness.engine.transferBetweenContainers({
      sourceContainerId: accounts.foodContainerId,
      destinationContainerId: 'container-transport',
      amountMinor: 20_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'transfer-food-transport',
    });

    const summary = await harness.engine.getMonthSummary('2026-10', '2026-10');
    const walletBalances = await harness.engine.getWalletBalances('2026-10-20');
    const containerBalances =
      await harness.engine.getContainerBalances('2026-10-20');

    assert.equal(summary.incomeMinor, 100_000);
    assert.equal(summary.expenseMinor, 0);
    assert.equal(summary.netSavingsMinor, 100_000);
    assert.equal(summary.savingsContributionsMinor, 0);
    assert.equal(walletBalances[accounts.cashWalletId], 100_000);
    assert.equal(containerBalances[accounts.foodContainerId], 30_000);
    assert.equal(containerBalances['container-transport'], 20_000);
    assert.equal(containerBalances[UNALLOCATED_CONTAINER_ID], 50_000);
    assert.equal(
      await harness.engine.repository.allWalletContainerTotalsMatch(
        '9999-12-31',
      ),
      true,
    );
  } finally {
    harness.database.close();
  }
});

test('Unallocated rejects user lifecycle, metadata, limit, and creation operations', async () => {
  const harness = await createHarness();
  try {
    await harness.engine.ensureUnallocatedContainer();

    await assert.rejects(
      harness.engine.updateContainerMetadata({
        containerId: UNALLOCATED_CONTAINER_ID,
        name: 'Renamed',
        icon: 'wallet-outline',
        tone: 'emerald',
        idempotencyKey: 'rename-unallocated',
      }),
      isFinanceError('SYSTEM_CONTAINER'),
    );
    await assert.rejects(
      harness.engine.setBudgetLimit({
        containerId: UNALLOCATED_CONTAINER_ID,
        limitMinor: 10_000,
        idempotencyKey: 'limit-unallocated',
      }),
      isFinanceError('SYSTEM_CONTAINER'),
    );
    await assert.rejects(
      harness.engine.archiveContainer({
        containerId: UNALLOCATED_CONTAINER_ID,
        idempotencyKey: 'archive-unallocated',
      }),
      isFinanceError('SYSTEM_CONTAINER'),
    );
    await assert.rejects(
      harness.engine.reactivateContainer({
        containerId: UNALLOCATED_CONTAINER_ID,
        idempotencyKey: 'reactivate-unallocated',
      }),
      isFinanceError('SYSTEM_CONTAINER'),
    );
    await assert.rejects(
      harness.engine.deleteContainer({
        containerId: UNALLOCATED_CONTAINER_ID,
        idempotencyKey: 'delete-unallocated',
      }),
      isFinanceError('SYSTEM_CONTAINER'),
    );
    await assert.rejects(
      harness.engine.createContainer({
        id: UNALLOCATED_CONTAINER_ID,
        name: 'Impostor',
        icon: 'wallet-outline',
        tone: 'blue',
        idempotencyKey: 'create-unallocated',
      }),
      isFinanceError('SYSTEM_CONTAINER'),
    );

    await assert.rejects(
      harness.database.runAsync(
        'UPDATE containers SET status = ?, archived_at = ? WHERE id = ?',
        ['archived', '2026-10-20T00:00:00.000Z', UNALLOCATED_CONTAINER_ID],
      ),
      /System container cannot be archived or deleted/,
    );
    await assert.rejects(
      harness.database.runAsync('DELETE FROM containers WHERE id = ?', [
        UNALLOCATED_CONTAINER_ID,
      ]),
      /System container cannot be deleted/,
    );
    await assert.rejects(
      harness.database.runAsync(
        `INSERT INTO containers (
           id, kind, status, sort_order, created_month_key, created_at,
           archived_at, deleted_at, system_key
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'system-other',
          'budget',
          'active',
          9,
          '2026-10',
          '2026-10-20T00:00:00.000Z',
          null,
          null,
          'unallocated',
        ],
      ),
      /System container must use the reserved ID/,
    );

    const container = await harness.engine.getUnallocatedContainer();
    assert.equal(container.status, 'active');
  } finally {
    harness.database.close();
  }
});

test('expenses cannot spend directly from Unallocated but allocations can be spent', async () => {
  const harness = await createHarness();
  try {
    const accounts = await seedStandardAccounts(harness.engine);
    await harness.engine.recordIncome({
      title: 'Allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      idempotencyKey: 'income-expense-guard',
    });

    await assert.rejects(
      harness.engine.recordTransaction({
        kind: 'expense',
        title: 'Direct unallocated expense',
        amountMinor: 5_000,
        effectiveDate: '2026-10-20',
        walletId: accounts.cashWalletId,
        containerId: UNALLOCATED_CONTAINER_ID,
        idempotencyKey: 'expense-from-unallocated',
      }),
      isFinanceError('SYSTEM_CONTAINER'),
    );

    await harness.engine.allocateToContainer({
      containerId: accounts.foodContainerId,
      amountMinor: 20_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'allocate-before-expense',
    });
    await harness.engine.recordTransaction({
      kind: 'expense',
      title: 'Lunch',
      amountMinor: 5_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'food-expense',
    });

    const summary = await harness.engine.getMonthSummary('2026-10', '2026-10');
    const containerBalances =
      await harness.engine.getContainerBalances('2026-10-20');

    assert.equal(summary.incomeMinor, 100_000);
    assert.equal(summary.expenseMinor, 5_000);
    assert.equal(summary.netSavingsMinor, 95_000);
    assert.equal(containerBalances[UNALLOCATED_CONTAINER_ID], 80_000);
    assert.equal(containerBalances[accounts.foodContainerId], 15_000);
  } finally {
    harness.database.close();
  }
});

test('allocation and return operations enforce available container balances', async () => {
  const harness = await createHarness();
  try {
    const accounts = await seedStandardAccounts(harness.engine);
    await harness.engine.recordIncome({
      title: 'Allowance',
      amountMinor: 10_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      idempotencyKey: 'income-insufficient',
    });

    await assert.rejects(
      harness.engine.allocateToContainer({
        containerId: accounts.foodContainerId,
        amountMinor: 11_000,
        effectiveDate: '2026-10-20',
        idempotencyKey: 'over-allocate',
      }),
      isFinanceError('INSUFFICIENT_FUNDS'),
    );
    await harness.engine.allocateToContainer({
      containerId: accounts.foodContainerId,
      amountMinor: 10_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'full-allocate',
    });
    await assert.rejects(
      harness.engine.returnToUnallocated({
        containerId: accounts.foodContainerId,
        amountMinor: 11_000,
        effectiveDate: '2026-10-20',
        idempotencyKey: 'over-return',
      }),
      isFinanceError('INSUFFICIENT_FUNDS'),
    );

    const containerBalances =
      await harness.engine.getContainerBalances('2026-10-20');
    assert.equal(containerBalances[UNALLOCATED_CONTAINER_ID], 0);
    assert.equal(containerBalances[accounts.foodContainerId], 10_000);
  } finally {
    harness.database.close();
  }
});

test('allocation rejects missing, archived, and system targets', async () => {
  const harness = await createHarness();
  try {
    const accounts = await seedStandardAccounts(harness.engine);
    await harness.engine.recordIncome({
      title: 'Allowance',
      amountMinor: 50_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      idempotencyKey: 'income-invalid-target',
    });
    await harness.engine.archiveContainer({
      containerId: accounts.foodContainerId,
      idempotencyKey: 'archive-empty-food',
    });

    await assert.rejects(
      harness.engine.allocateToContainer({
        containerId: accounts.foodContainerId,
        amountMinor: 10_000,
        effectiveDate: '2026-10-20',
        idempotencyKey: 'allocate-archived',
      }),
      isFinanceError('ARCHIVED_CONTAINER'),
    );
    await assert.rejects(
      harness.engine.allocateToContainer({
        containerId: 'container-missing',
        amountMinor: 10_000,
        effectiveDate: '2026-10-20',
        idempotencyKey: 'allocate-missing',
      }),
      isFinanceError('NOT_FOUND'),
    );
    await assert.rejects(
      harness.engine.allocateToContainer({
        containerId: UNALLOCATED_CONTAINER_ID,
        amountMinor: 10_000,
        effectiveDate: '2026-10-20',
        idempotencyKey: 'allocate-to-system',
      }),
      isFinanceError('VALIDATION'),
    );
    await assert.rejects(
      harness.engine.returnToUnallocated({
        containerId: UNALLOCATED_CONTAINER_ID,
        amountMinor: 10_000,
        effectiveDate: '2026-10-20',
        idempotencyKey: 'return-from-system',
      }),
      isFinanceError('VALIDATION'),
    );
    await assert.rejects(
      harness.engine.allocateToContainer({
        containerId: accounts.savingsContainerId,
        amountMinor: 10_000,
        effectiveDate: '2026-10-20',
        idempotencyKey: 'allocate-to-savings',
      }),
      isFinanceError('VALIDATION'),
    );
    await assert.rejects(
      harness.engine.transferBetweenContainers({
        sourceContainerId: UNALLOCATED_CONTAINER_ID,
        destinationContainerId: accounts.foodContainerId,
        amountMinor: 10_000,
        effectiveDate: '2026-10-20',
        idempotencyKey: 'generic-system-transfer',
      }),
      isFinanceError('VALIDATION'),
    );

    const containerBalances =
      await harness.engine.getContainerBalances('2026-10-20');
    assert.equal(containerBalances[UNALLOCATED_CONTAINER_ID], 50_000);
    assert.equal(containerBalances[accounts.foodContainerId], 0);
  } finally {
    harness.database.close();
  }
});

test('allocation retries are idempotent and conflicting retries are rejected', async () => {
  const harness = await createHarness();
  try {
    const accounts = await seedStandardAccounts(harness.engine);
    await harness.engine.recordIncome({
      title: 'Allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      idempotencyKey: 'income-idempotent',
    });

    const first = await harness.engine.allocateToContainer({
      containerId: accounts.foodContainerId,
      amountMinor: 10_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'allocate-idempotent',
    });
    const retry = await harness.engine.allocateToContainer({
      containerId: accounts.foodContainerId,
      amountMinor: 10_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'allocate-idempotent',
    });

    assert.equal(retry.transactionId, first.transactionId);
    await assert.rejects(
      harness.engine.allocateToContainer({
        containerId: accounts.foodContainerId,
        amountMinor: 11_000,
        effectiveDate: '2026-10-20',
        idempotencyKey: 'allocate-idempotent',
      }),
      isFinanceError('IDEMPOTENCY_CONFLICT'),
    );

    const transactions = await harness.engine.getTransactionsForMonth('2026-10');
    const containerBalances =
      await harness.engine.getContainerBalances('2026-10-20');
    assert.equal(transactions.length, 2);
    assert.equal(containerBalances[UNALLOCATED_CONTAINER_ID], 90_000);
    assert.equal(containerBalances[accounts.foodContainerId], 10_000);
  } finally {
    harness.database.close();
  }
});

test('Unallocated and its balance survive closing, reopening, and re-migration', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pocketa-unallocated-'));
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
    await firstEngine.recordIncome({
      title: 'Allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      idempotencyKey: 'persisted-income',
    });
    const allocation = await firstEngine.allocateToContainer({
      containerId: accounts.foodContainerId,
      amountMinor: 30_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'persisted-allocation',
    });
    firstDatabase.close();

    const secondDatabase = new NodeSqlDatabase(databasePath);
    try {
      await migrateDatabase(secondDatabase);
      const secondEngine = new FinanceEngine(secondDatabase, {
        now: clock.now,
        idFactory: createTestIdFactory(),
      });
      await secondEngine.ensureUnallocatedContainer();
      const containers = await secondEngine.listContainers(true, true);
      const systemContainers = containers.filter(
        (container) => container.systemKey === UNALLOCATED_SYSTEM_KEY,
      );
      const snapshot = await secondEngine.getUnallocatedSnapshot('2026-10');
      const summary = await secondEngine.getMonthSummary('2026-10', '2026-10');
      const retry = await secondEngine.allocateToContainer({
        containerId: accounts.foodContainerId,
        amountMinor: 30_000,
        effectiveDate: '2026-10-20',
        idempotencyKey: 'persisted-allocation',
      });
      const transactionCount = await secondDatabase.getFirstAsync<{
        count: number;
      }>('SELECT COUNT(*) AS count FROM transactions');

      assert.equal(systemContainers.length, 1);
      assert.equal(snapshot?.balanceMinor, 70_000);
      assert.equal(snapshot?.limitMinor, 0);
      assert.equal(summary.netSavingsMinor, 100_000);
      assert.equal(retry.transactionId, allocation.transactionId);
      assert.equal(transactionCount?.count, 2);
    } finally {
      secondDatabase.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
