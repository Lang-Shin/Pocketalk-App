import assert from 'node:assert/strict';
import test from 'node:test';

import { FinanceError } from '../src/db/errors';
import { FinanceEngine } from '../src/db/financeEngine';
import {
  SAVINGS_CONTAINER_ID,
  UNALLOCATED_CONTAINER_ID,
} from '../src/db/systemContainers';
import {
  createHarness,
  recordIncome,
  seedStandardAccounts,
  type AccountIds,
  type TestHarness,
} from './helpers/financeTestHarness';

async function setup(
  date = new Date(2026, 9, 20, 12),
): Promise<{ harness: TestHarness; accounts: AccountIds }> {
  const harness = await createHarness(date);
  const accounts = await seedStandardAccounts(harness.engine);
  return { harness, accounts };
}

function money(balances: Record<string, number>, id: string): number {
  return balances[id] ?? 0;
}

async function createBudgetContainer(
  engine: FinanceEngine,
  id: string,
  name: string,
  key: string,
): Promise<void> {
  await engine.createContainer({
    id,
    name,
    description: '',
    icon: 'school-outline',
    tone: 'blue',
    idempotencyKey: key,
  });
}

test('the system Savings account is stable and protected', async () => {
  const harness = await createHarness(new Date(2026, 9, 20, 12));
  try {
    await seedStandardAccounts(harness.engine);
    const savings = await harness.engine.getSavingsContainer();

    assert.equal(savings.id, SAVINGS_CONTAINER_ID);
    assert.equal(savings.systemKey, 'savings');
    assert.equal(savings.kind, 'savings');
    assert.equal(savings.status, 'active');

    const snapshot = await harness.engine.getSavingsSnapshot('2026-10');
    assert.equal(snapshot?.name, 'Savings');
    assert.equal(snapshot?.balanceMinor, 0);
    assert.equal(snapshot?.limitMinor, 0);

    await harness.engine.ensureSavingsContainer();
    await harness.engine.getSavingsContainer();
    const systems = await harness.engine.listContainers(false, true);
    assert.equal(
      systems.filter((container) => container.systemKey === 'savings').length,
      1,
    );
    assert.equal(
      systems.filter((container) => container.systemKey !== null).length,
      2,
    );
    assert.equal(
      (await harness.engine.listContainers(false, false)).some(
        (container) => container.systemKey !== null,
      ),
      false,
    );

    await assert.rejects(
      harness.engine.updateContainerMetadata({
        containerId: savings.id,
        name: 'Changed',
        icon: 'wallet-outline',
        tone: 'emerald',
        idempotencyKey: 'rename-system-savings',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'SYSTEM_CONTAINER',
    );
    await assert.rejects(
      harness.engine.archiveContainer({
        containerId: savings.id,
        idempotencyKey: 'archive-system-savings',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'SYSTEM_CONTAINER',
    );
    await assert.rejects(
      harness.engine.setBudgetLimit({
        containerId: savings.id,
        limitMinor: 1000,
        idempotencyKey: 'limit-system-savings',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'SYSTEM_CONTAINER',
    );
    await assert.rejects(
      harness.engine.deleteContainer({
        containerId: savings.id,
        idempotencyKey: 'delete-system-savings',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'SYSTEM_CONTAINER',
    );
    await assert.rejects(
      harness.engine.createContainer({
        id: SAVINGS_CONTAINER_ID,
        name: 'Duplicate',
        icon: 'wallet-outline',
        tone: 'emerald',
        idempotencyKey: 'create-duplicate-savings',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'SYSTEM_CONTAINER',
    );

    await assert.rejects(
      harness.database.runAsync(
        'UPDATE containers SET status = ? WHERE id = ?',
        ['archived', savings.id],
      ),
      /System container/,
    );
    await assert.rejects(
      harness.database.runAsync(
        `INSERT INTO budget_limits (container_id, month_key, limit_minor, updated_at)
         VALUES (?, ?, ?, ?)`,
        [savings.id, '2026-10', 1000, '2026-10-20T00:00:00.000Z'],
      ),
      /System container/,
    );
  } finally {
    harness.database.close();
  }
});

test('Savings contributions and withdrawals are transfers that accumulate across months', async () => {
  const { harness, accounts } = await setup();
  try {
    await recordIncome(harness.engine, accounts, 100_000);

    const contribution = await harness.engine.contributeToSavings({
      sourceContainerId: accounts.foodContainerId,
      amountMinor: 30_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'savings-contribution-oct',
    });
    const retry = await harness.engine.contributeToSavings({
      sourceContainerId: accounts.foodContainerId,
      amountMinor: 30_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'savings-contribution-oct',
    });
    assert.equal(retry.transactionId, contribution.transactionId);

    const october = await harness.engine.getContainerBalances('2026-10-20');
    assert.equal(money(october, accounts.foodContainerId), 70_000);
    assert.equal(money(october, SAVINGS_CONTAINER_ID), 30_000);
    assert.equal(money(october, UNALLOCATED_CONTAINER_ID), 0);
    assert.equal(money(october, accounts.savingsContainerId), 0);

    harness.clock.set(2026, 10, 15);
    const november = await harness.engine.getContainerBalances('2026-11-15');
    assert.equal(money(november, accounts.foodContainerId), 0);
    assert.equal(money(november, SAVINGS_CONTAINER_ID), 30_000);
    assert.equal(money(november, UNALLOCATED_CONTAINER_ID), 70_000);

    await harness.engine.contributeToSavings({
      sourceContainerId: UNALLOCATED_CONTAINER_ID,
      amountMinor: 10_000,
      effectiveDate: '2026-11-15',
      idempotencyKey: 'savings-contribution-nov',
    });

    harness.clock.set(2026, 11, 15);
    const december = await harness.engine.getContainerBalances('2026-12-15');
    assert.equal(money(december, SAVINGS_CONTAINER_ID), 40_000);
    assert.equal(money(december, UNALLOCATED_CONTAINER_ID), 60_000);
    assert.equal(money(december, accounts.foodContainerId), 0);

    const octoberSummary = await harness.engine.getMonthSummary(
      '2026-10',
      '2026-12',
    );
    assert.equal(octoberSummary.savingsContributionsMinor, 30_000);
    assert.equal(octoberSummary.savingsWithdrawalsMinor, 0);
    assert.equal(octoberSummary.systemSavingsEndingBalanceMinor, 30_000);
  } finally {
    harness.database.close();
  }
});

test('reports separate net savings, Savings balances, carryover, and available budget', async () => {
  const { harness, accounts } = await setup();
  try {
    await recordIncome(harness.engine, accounts, 100_000);
    await harness.engine.contributeToSavings({
      sourceContainerId: accounts.foodContainerId,
      amountMinor: 20_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'report-savings-in',
    });
    await harness.engine.withdrawFromSavings({
      destinationContainerId: accounts.foodContainerId,
      amountMinor: 5_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'report-savings-out',
    });
    await harness.engine.withdrawFromSavings({
      destinationContainerId: UNALLOCATED_CONTAINER_ID,
      amountMinor: 10_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'report-savings-unallocated',
    });

    const summary = await harness.engine.getMonthSummary('2026-10', '2026-10');
    assert.equal(summary.incomeMinor, 100_000);
    assert.equal(summary.expenseMinor, 0);
    assert.equal(summary.netSavingsMinor, 100_000);
    assert.equal(summary.savingsContributionsMinor, 20_000);
    assert.equal(summary.savingsWithdrawalsMinor, 15_000);
    assert.equal(summary.systemSavingsEndingBalanceMinor, 5_000);
    assert.equal(summary.savingsEndingBalanceMinor, 5_000);
    assert.equal(summary.unallocatedCarryoverMinor, 0);
    assert.equal(summary.unallocatedEndingBalanceMinor, 10_000);
    assert.equal(summary.availableBudgetMinor, 95_000);

    const balances = await harness.engine.getContainerBalances('2026-10-20');
    assert.equal(money(balances, accounts.foodContainerId), 85_000);
    assert.equal(money(balances, SAVINGS_CONTAINER_ID), 5_000);
    assert.equal(money(balances, UNALLOCATED_CONTAINER_ID), 10_000);
    const containerTotal = Object.values(balances).reduce(
      (total, amount) => total + amount,
      0,
    );
    assert.equal(containerTotal, 100_000);
    assert.equal(
      await harness.engine.repository.allWalletContainerTotalsMatch(
        '2026-10-20',
      ),
      true,
    );
  } finally {
    harness.database.close();
  }
});

test('monthly rollover sweeps ordinary and archived containers but not Savings', async () => {
  const { harness, accounts } = await setup();
  try {
    await createBudgetContainer(
      harness.engine,
      'container-school',
      'School',
      'create-school',
    );
    await recordIncome(harness.engine, accounts, 100_000);
    await harness.engine.transferBetweenContainers({
      sourceContainerId: accounts.foodContainerId,
      destinationContainerId: 'container-school',
      amountMinor: 40_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'food-to-school',
    });
    await harness.engine.contributeToSavings({
      sourceContainerId: accounts.foodContainerId,
      amountMinor: 20_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'food-to-system-savings',
    });
    await harness.engine.archiveContainer({
      containerId: 'container-school',
      idempotencyKey: 'archive-school',
    });

    harness.clock.set(2026, 10, 15);
    const summary = await harness.engine.getMonthSummary('2026-11', '2026-11');
    const balances = await harness.engine.getContainerBalances('2026-11-15');

    assert.equal(money(balances, accounts.foodContainerId), 0);
    assert.equal(money(balances, 'container-school'), 0);
    assert.equal(money(balances, SAVINGS_CONTAINER_ID), 20_000);
    assert.equal(money(balances, UNALLOCATED_CONTAINER_ID), 80_000);
    const wallets = await harness.engine.getWalletBalances('2026-11-15');
    assert.equal(money(wallets, accounts.cashWalletId), 100_000);

    assert.equal(summary.incomeMinor, 0);
    assert.equal(summary.expenseMinor, 0);
    assert.equal(summary.netSavingsMinor, 0);
    assert.equal(summary.savingsContributionsMinor, 0);
    assert.equal(summary.systemSavingsEndingBalanceMinor, 20_000);
    assert.equal(summary.unallocatedCarryoverMinor, 80_000);
    assert.equal(summary.unallocatedEndingBalanceMinor, 80_000);
    assert.equal(summary.availableBudgetMinor, 80_000);

    const rolloverTransactions = (
      await harness.engine.getTransactionsForMonth('2026-11')
    ).filter((transaction) => transaction.category === 'Monthly rollover');
    assert.equal(rolloverTransactions.length, 2);
    assert.ok(
      rolloverTransactions.every(
        (transaction) =>
          transaction.kind === 'container_transfer' &&
          transaction.destinationContainerId === UNALLOCATED_CONTAINER_ID &&
          transaction.effectiveDate === '2026-11-01',
      ),
    );

    const october = await harness.engine.getMonthSummary('2026-10', '2026-11');
    assert.equal(october.incomeMinor, 100_000);
    assert.equal(october.expenseMinor, 0);
    assert.equal(october.netSavingsMinor, 100_000);
  } finally {
    harness.database.close();
  }
});

test('missed rollovers are processed once in order and survive an engine restart', async () => {
  const { harness, accounts } = await setup();
  try {
    await recordIncome(harness.engine, accounts, 100_000);
    harness.clock.set(2027, 0, 15);

    const result = await harness.engine.processDueRollovers();
    assert.deepEqual(result.processedMonths, [
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    assert.equal(result.transactionIds.length, 1);

    const repeated = await harness.engine.processDueRollovers();
    assert.deepEqual(repeated.processedMonths, []);
    assert.deepEqual(repeated.transactionIds, []);

    const restarted = new FinanceEngine(harness.database, {
      now: harness.clock.now,
    });
    const afterRestart = await restarted.processDueRollovers();
    assert.deepEqual(afterRestart.processedMonths, []);

    const runs = await harness.database.getAllAsync<{ month_key: string }>(
      'SELECT month_key FROM month_rollover_runs ORDER BY month_key ASC',
    );
    assert.deepEqual(
      runs.map((run) => run.month_key),
      ['2026-09', '2026-10', '2026-11', '2026-12'],
    );
    const rolloverTransactions = await harness.database.getFirstAsync<{
      count: number;
    }>(
      `SELECT COUNT(*) AS count FROM transactions
       WHERE category = 'Monthly rollover'`,
    );
    assert.equal(rolloverTransactions?.count, 1);

    const balances = await harness.engine.getContainerBalances('2027-01-15');
    assert.equal(money(balances, accounts.foodContainerId), 0);
    assert.equal(money(balances, UNALLOCATED_CONTAINER_ID), 100_000);
  } finally {
    harness.database.close();
  }
});

test('rollover uses the first local day after leap-month and year boundaries', async () => {
  const leapHarness = await createHarness(new Date(2028, 1, 1, 12));
  try {
    const leapAccounts = await seedStandardAccounts(leapHarness.engine);
    leapHarness.clock.set(2028, 1, 29, 23);
    await recordIncome(leapHarness.engine, leapAccounts, 50_000, {
      effectiveDate: '2028-02-29',
    });
    leapHarness.clock.set(2028, 2, 1, 0);
    await leapHarness.engine.getMonthSummary('2028-03', '2028-03');

    const marchTransactions =
      await leapHarness.engine.getTransactionsForMonth('2028-03');
    assert.ok(
      marchTransactions.some(
        (transaction) =>
          transaction.category === 'Monthly rollover' &&
          transaction.effectiveDate === '2028-03-01',
      ),
    );
    const balances = await leapHarness.engine.getContainerBalances(
      '2028-03-01',
    );
    assert.equal(money(balances, leapAccounts.foodContainerId), 0);
    assert.equal(money(balances, UNALLOCATED_CONTAINER_ID), 50_000);
  } finally {
    leapHarness.database.close();
  }

  const yearHarness = await createHarness(new Date(2027, 11, 30, 12));
  try {
    const yearAccounts = await seedStandardAccounts(yearHarness.engine);
    yearHarness.clock.set(2027, 11, 31, 23);
    await recordIncome(yearHarness.engine, yearAccounts, 25_000, {
      effectiveDate: '2027-12-31',
    });
    yearHarness.clock.set(2028, 0, 1, 0);
    await yearHarness.engine.getMonthSummary('2028-01', '2028-01');

    const balances = await yearHarness.engine.getContainerBalances('2028-01-01');
    assert.equal(money(balances, yearAccounts.foodContainerId), 0);
    assert.equal(money(balances, UNALLOCATED_CONTAINER_ID), 25_000);
  } finally {
    yearHarness.database.close();
  }
});

test('a late entry replays closed-month sweeps without duplicating money', async () => {
  const { harness, accounts } = await setup();
  try {
    await recordIncome(harness.engine, accounts, 100_000);
    harness.clock.set(2026, 10, 15);
    await harness.engine.getMonthSummary('2026-11', '2026-11');
    const originalRun = await harness.engine.repository.getRolloverRun('2026-10');
    assert.ok(originalRun);
    const originalSweepId = originalRun.sweepTransactionIds[0];
    assert.ok(originalSweepId);

    await harness.engine.recordTransaction({
      kind: 'expense',
      title: 'Late October expense',
      amountMinor: 30_000,
      effectiveDate: '2026-10-25',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'late-october-expense',
    });

    const revisedRun = await harness.engine.repository.getRolloverRun('2026-10');
    assert.ok(revisedRun);
    assert.equal(revisedRun.revision, 2);
    assert.equal(revisedRun.sweepTransactionIds.length, 1);
    assert.notEqual(revisedRun.sweepTransactionIds[0], originalSweepId);
    const originalSweep = await harness.engine.getTransaction(originalSweepId);
    assert.equal(originalSweep?.status, 'reversed');

    const balances = await harness.engine.getContainerBalances('2026-11-15');
    assert.equal(money(balances, accounts.foodContainerId), 0);
    assert.equal(money(balances, UNALLOCATED_CONTAINER_ID), 70_000);
    const wallets = await harness.engine.getWalletBalances('2026-11-15');
    assert.equal(money(wallets, accounts.cashWalletId), 70_000);
    assert.equal(money(balances, SAVINGS_CONTAINER_ID), 0);

    const october = await harness.engine.getMonthSummary('2026-10', '2026-11');
    assert.equal(october.incomeMinor, 100_000);
    assert.equal(october.expenseMinor, 30_000);
    assert.equal(october.netSavingsMinor, 70_000);

    const november = await harness.engine.getMonthSummary('2026-11', '2026-11');
    assert.equal(november.incomeMinor, 0);
    assert.equal(november.expenseMinor, 0);
    assert.equal(november.unallocatedCarryoverMinor, 70_000);
    assert.equal(november.availableBudgetMinor, 70_000);

    await assert.rejects(
      harness.engine.reverseTransaction({
        transactionId: revisedRun.sweepTransactionIds[0] as string,
        idempotencyKey: 'reverse-rollover-directly',
      }),
      (error: unknown) =>
        error instanceof FinanceError &&
        error.code === 'INVALID_STATE',
    );
  } finally {
    harness.database.close();
  }
});

test('a late correction replays closed-month sweeps in the correct period', async () => {
  const { harness, accounts } = await setup();
  try {
    const originalId = await recordIncome(harness.engine, accounts, 100_000);
    harness.clock.set(2026, 10, 15);
    await harness.engine.getMonthSummary('2026-11', '2026-11');
    const originalRun = await harness.engine.repository.getRolloverRun('2026-10');
    assert.ok(originalRun);
    const originalSweepId = originalRun.sweepTransactionIds[0] as string;

    await harness.engine.correctTransaction({
      transactionId: originalId,
      reason: 'Allowance was entered incorrectly',
      replacement: {
        kind: 'income',
        title: 'Corrected allowance',
        amountMinor: 60_000,
        effectiveDate: '2026-10-20',
        walletId: accounts.cashWalletId,
        containerId: accounts.foodContainerId,
      },
      idempotencyKey: 'correct-october-income',
    });

    const revisedRun = await harness.engine.repository.getRolloverRun('2026-10');
    assert.ok(revisedRun);
    assert.equal(revisedRun.revision, 2);
    assert.equal(originalRun.sweepTransactionIds[0], originalSweepId);

    const balances = await harness.engine.getContainerBalances('2026-11-15');
    assert.equal(money(balances, accounts.foodContainerId), 0);
    assert.equal(money(balances, UNALLOCATED_CONTAINER_ID), 60_000);
    const wallets = await harness.engine.getWalletBalances('2026-11-15');
    assert.equal(money(wallets, accounts.cashWalletId), 60_000);

    const october = await harness.engine.getMonthSummary('2026-10', '2026-11');
    assert.equal(october.incomeMinor, 60_000);
    assert.equal(october.expenseMinor, 0);
    assert.equal(october.netSavingsMinor, 60_000);
    assert.equal(october.postedTransactionCount, 1);
  } finally {
    harness.database.close();
  }
});

test('moving the device clock backward does not undo a completed rollover', async () => {
  const { harness, accounts } = await setup();
  try {
    await recordIncome(harness.engine, accounts, 100_000);
    harness.clock.set(2026, 10, 15);
    await harness.engine.getMonthSummary('2026-11', '2026-11');
    const before = await harness.engine.getContainerBalances('2026-11-15');
    const runsBefore = await harness.database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM month_rollover_runs',
    );

    harness.clock.set(2026, 9, 15);
    await harness.engine.getMonthSummary('2026-10', '2026-10');
    const after = await harness.engine.getContainerBalances('2026-11-15');
    const runsAfter = await harness.database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM month_rollover_runs',
    );

    assert.deepEqual(after, before);
    assert.equal(runsAfter?.count, runsBefore?.count);
    assert.equal(money(after, accounts.foodContainerId), 0);
    assert.equal(money(after, UNALLOCATED_CONTAINER_ID), 100_000);
  } finally {
    harness.database.close();
  }
});

test('a late correction is rejected when replay would overdraw spent rollover funds', async () => {
  const { harness, accounts } = await setup();
  try {
    await recordIncome(harness.engine, accounts, 100_000);
    harness.clock.set(2026, 10, 15);
    await harness.engine.getMonthSummary('2026-11', '2026-11');

    await harness.engine.allocateToContainer({
      containerId: accounts.foodContainerId,
      amountMinor: 100_000,
      effectiveDate: '2026-11-02',
      idempotencyKey: 'november-allocation',
    });
    await harness.engine.recordTransaction({
      kind: 'expense',
      title: 'November groceries',
      amountMinor: 100_000,
      effectiveDate: '2026-11-05',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'november-groceries',
    });
    harness.clock.set(2026, 10, 21);
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'November allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-11-20',
      walletId: accounts.cashWalletId,
      idempotencyKey: 'november-allowance',
    });

    const before = await harness.engine.getContainerBalances('2026-11-20');
    const walletsBefore = await harness.engine.getWalletBalances('2026-11-20');
    assert.equal(money(before, UNALLOCATED_CONTAINER_ID), 100_000);
    assert.equal(money(walletsBefore, accounts.cashWalletId), 100_000);

    const runBefore = await harness.engine.repository.getRolloverRun('2026-10');
    assert.ok(runBefore);
    await assert.rejects(
      harness.engine.recordTransaction({
        kind: 'expense',
        title: 'Late October expense',
        amountMinor: 30_000,
        effectiveDate: '2026-10-25',
        walletId: accounts.cashWalletId,
        containerId: accounts.foodContainerId,
        idempotencyKey: 'late-october-overdraw',
      }),
      /already been used/,
    );

    const runAfter = await harness.engine.repository.getRolloverRun('2026-10');
    assert.deepEqual(runAfter, runBefore);
    const containers = await harness.engine.getContainerBalances('2026-11-20');
    const wallets = await harness.engine.getWalletBalances('2026-11-20');
    assert.equal(money(containers, accounts.foodContainerId), 0);
    assert.equal(money(containers, UNALLOCATED_CONTAINER_ID), 100_000);
    assert.equal(money(containers, SAVINGS_CONTAINER_ID), 0);
    assert.equal(money(wallets, accounts.cashWalletId), 100_000);
    const transaction = await harness.database.getFirstAsync<{
      count: number;
    }>(
      `SELECT COUNT(*) AS count FROM transactions WHERE idempotency_key = ?`,
      ['late-october-overdraw'],
    );
    assert.equal(transaction?.count, 0);
  } finally {
    harness.database.close();
  }
});

test('a failed rollover leaves balances and rollover records unchanged', async () => {
  const { harness, accounts } = await setup();
  try {
    await recordIncome(harness.engine, accounts, 100_000);
    harness.clock.set(2026, 10, 15);
    await harness.database.execAsync(`
      CREATE TRIGGER fail_rollover
      BEFORE INSERT ON transactions
      WHEN NEW.category = 'Monthly rollover'
      BEGIN
        SELECT RAISE(ABORT, 'forced rollover failure');
      END;
    `);

    await assert.rejects(
      harness.engine.getMonthSummary('2026-11', '2026-11'),
      /forced rollover failure/,
    );

    const failedRun =
      await harness.engine.repository.getRolloverRun('2026-10');
    assert.equal(failedRun, null);
    assert.equal(
      await harness.engine.repository.getContainerBalance(
        accounts.foodContainerId,
        '2026-11-15',
      ),
      100_000,
    );
    assert.equal(
      await harness.engine.repository.getContainerBalance(
        UNALLOCATED_CONTAINER_ID,
        '2026-11-15',
      ),
      0,
    );

    await harness.database.execAsync('DROP TRIGGER fail_rollover;');
    const result = await harness.engine.processDueRollovers();
    assert.deepEqual(result.processedMonths, ['2026-10']);
    assert.equal(result.transactionIds.length, 1);
    const balances = await harness.engine.getContainerBalances('2026-11-15');
    assert.equal(money(balances, accounts.foodContainerId), 0);
    assert.equal(money(balances, UNALLOCATED_CONTAINER_ID), 100_000);
  } finally {
    harness.database.close();
  }
});

test('Savings → ordinary container transfer moves money without affecting wallets or net savings', async () => {
  const { harness, accounts } = await setup();
  try {
    await recordIncome(harness.engine, accounts, 100_000);

    // Move money from Food into Savings first
    await harness.engine.contributeToSavings({
      sourceContainerId: accounts.foodContainerId,
      amountMinor: 40_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'food-to-savings',
    });

    const afterContribute = await harness.engine.getContainerBalances('2026-10-20');
    assert.equal(money(afterContribute, SAVINGS_CONTAINER_ID), 40_000);
    assert.equal(money(afterContribute, accounts.foodContainerId), 60_000);

    // Now withdraw from Savings directly into an ordinary budget container
    await harness.engine.withdrawFromSavings({
      destinationContainerId: accounts.foodContainerId,
      amountMinor: 15_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'savings-to-food',
    });

    const afterWithdraw = await harness.engine.getContainerBalances('2026-10-20');
    assert.equal(money(afterWithdraw, SAVINGS_CONTAINER_ID), 25_000);
    assert.equal(money(afterWithdraw, accounts.foodContainerId), 75_000);

    // Wallet balance must be unchanged — only containers shifted
    const wallets = await harness.engine.getWalletBalances('2026-10-20');
    assert.equal(money(wallets, accounts.cashWalletId), 100_000);

    // Net savings must not include savings transfers
    const summary = await harness.engine.getMonthSummary('2026-10', '2026-10');
    assert.equal(summary.incomeMinor, 100_000);
    assert.equal(summary.expenseMinor, 0);
    assert.equal(summary.netSavingsMinor, 100_000);
    assert.equal(summary.savingsContributionsMinor, 40_000);
    assert.equal(summary.savingsWithdrawalsMinor, 15_000);
    assert.equal(summary.systemSavingsEndingBalanceMinor, 25_000);

    // Ledger invariant must hold
    assert.ok(
      await harness.engine.repository.allWalletContainerTotalsMatch('2026-10-20'),
    );
  } finally {
    harness.database.close();
  }
});

test('new allowance recorded after rollover accumulates correctly with carryover', async () => {
  const { harness, accounts } = await setup();
  try {
    // Record October income — Food gets ₱100,000
    await recordIncome(harness.engine, accounts, 100_000);

    // Save ₱20,000 in October
    await harness.engine.contributeToSavings({
      sourceContainerId: accounts.foodContainerId,
      amountMinor: 20_000,
      effectiveDate: '2026-10-20',
      idempotencyKey: 'oct-savings',
    });

    // Advance to November 15; rollover sweeps Food (₱80,000) → Unallocated
    harness.clock.set(2026, 10, 15);
    await harness.engine.processDueRollovers();

    const afterRollover = await harness.engine.getContainerBalances('2026-11-01');
    assert.equal(money(afterRollover, accounts.foodContainerId), 0);
    assert.equal(money(afterRollover, UNALLOCATED_CONTAINER_ID), 80_000);
    assert.equal(money(afterRollover, SAVINGS_CONTAINER_ID), 20_000);

    // A November allowance on the first day lands in Unallocated.
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'November allowance',
      amountMinor: 10_000,
      effectiveDate: '2026-11-01',
      walletId: accounts.cashWalletId,
      idempotencyKey: 'nov-unallocated-allowance',
    });

    // Another allowance is assigned directly to Food.
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'November food allowance',
      amountMinor: 50_000,
      effectiveDate: '2026-11-15',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'nov-allowance',
    });

    const afterNovIncome = await harness.engine.getContainerBalances('2026-11-15');
    // Unallocated keeps its carryover plus the new allowance; Food gets its
    // directly assigned income.
    assert.equal(money(afterNovIncome, UNALLOCATED_CONTAINER_ID), 90_000);
    assert.equal(money(afterNovIncome, accounts.foodContainerId), 50_000);
    assert.equal(money(afterNovIncome, SAVINGS_CONTAINER_ID), 20_000);

    // Wallet balance = October income + November income
    const wallets = await harness.engine.getWalletBalances('2026-11-15');
    assert.equal(money(wallets, accounts.cashWalletId), 160_000);

    // November summary: new income only; carryover is not counted as income
    // and first-day allowance does not inflate Unallocated carryover.
    const novSummary = await harness.engine.getMonthSummary('2026-11', '2026-11');
    assert.equal(novSummary.incomeMinor, 60_000);
    assert.equal(novSummary.expenseMinor, 0);
    assert.equal(novSummary.netSavingsMinor, 60_000);
    assert.equal(novSummary.unallocatedCarryoverMinor, 80_000);
    assert.equal(novSummary.unallocatedEndingBalanceMinor, 90_000);
    assert.equal(novSummary.availableBudgetMinor, 140_000);
    assert.equal(novSummary.systemSavingsEndingBalanceMinor, 20_000);

    // October summary unchanged
    const octSummary = await harness.engine.getMonthSummary('2026-10', '2026-11');
    assert.equal(octSummary.incomeMinor, 100_000);
    assert.equal(octSummary.expenseMinor, 0);
    assert.equal(octSummary.netSavingsMinor, 100_000);
    assert.equal(octSummary.savingsContributionsMinor, 20_000);

    // Ledger invariant must hold
    assert.ok(
      await harness.engine.repository.allWalletContainerTotalsMatch('2026-11-15'),
    );
  } finally {
    harness.database.close();
  }
});

test('monthly rollover end-to-end example: October rollover, manual Savings transfer, and November allowance', async () => {
  const { harness, accounts } = await setup(new Date(2026, 9, 1, 12));
  try {
    await createBudgetContainer(
      harness.engine,
      'container-school-essentials',
      'School Essentials',
      'create-school-essentials',
    );

    // Set October budget limits to verify previous month spending limits are preserved
    await harness.engine.setBudgetLimit({
      containerId: accounts.foodContainerId,
      limitMinor: 50_000,
      monthKey: '2026-10',
      idempotencyKey: 'food-limit-oct',
    });

    // October setup:
    // User receives income of ₱3,300 into Cash wallet (unallocated)
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'October Allowance',
      amountMinor: 330_000,
      effectiveDate: '2026-10-01',
      walletId: accounts.cashWalletId,
      idempotencyKey: 'oct-income-3300',
    });

    harness.clock.set(2026, 9, 2, 12);

    // Allocate ₱180 to Food and ₱120 to School Essentials
    await harness.engine.allocateToContainer({
      containerId: accounts.foodContainerId,
      amountMinor: 18_000,
      effectiveDate: '2026-10-02',
      idempotencyKey: 'alloc-food-180',
    });
    await harness.engine.allocateToContainer({
      containerId: 'container-school-essentials',
      amountMinor: 12_000,
      effectiveDate: '2026-10-02',
      idempotencyKey: 'alloc-school-120',
    });

    harness.clock.set(2026, 9, 31, 23);

    // October ends with:
    // - Unallocated: ₱3,000 (300,000 centavos)
    // - Food: ₱180 (18,000 centavos)
    // - School Essentials: ₱120 (12,000 centavos)
    const octEndBalances = await harness.engine.getContainerBalances('2026-10-31');
    assert.equal(money(octEndBalances, UNALLOCATED_CONTAINER_ID), 300_000);
    assert.equal(money(octEndBalances, accounts.foodContainerId), 18_000);
    assert.equal(money(octEndBalances, 'container-school-essentials'), 12_000);
    assert.equal(money(octEndBalances, SAVINGS_CONTAINER_ID), 0);

    const octWallets = await harness.engine.getWalletBalances('2026-10-31');
    assert.equal(money(octWallets, accounts.cashWalletId), 330_000);

    // Advance clock to November 1
    harness.clock.set(2026, 10, 1, 9);

    // Automatic rollover occurs
    await harness.engine.processDueRollovers();

    // After October rollover:
    // - Unallocated: ₱3,300 (330,000 centavos)
    // - Food: ₱0
    // - School Essentials: ₱0
    const novStartBalances = await harness.engine.getContainerBalances('2026-11-01');
    assert.equal(money(novStartBalances, UNALLOCATED_CONTAINER_ID), 330_000);
    assert.equal(money(novStartBalances, accounts.foodContainerId), 0);
    assert.equal(money(novStartBalances, 'container-school-essentials'), 0);
    assert.equal(money(novStartBalances, SAVINGS_CONTAINER_ID), 0);

    // Wallets remain unchanged (₱3,300)
    const novStartWallets = await harness.engine.getWalletBalances('2026-11-01');
    assert.equal(money(novStartWallets, accounts.cashWalletId), 330_000);

    // Rollover sweeps are internal container transfers, not expense or income
    const novSummaryBeforeActivity = await harness.engine.getMonthSummary('2026-11', '2026-11');
    assert.equal(novSummaryBeforeActivity.incomeMinor, 0);
    assert.equal(novSummaryBeforeActivity.expenseMinor, 0);
    assert.equal(novSummaryBeforeActivity.netSavingsMinor, 0);
    assert.equal(novSummaryBeforeActivity.unallocatedCarryoverMinor, 330_000);

    // October reports and spending limits remain intact
    const octSummary = await harness.engine.getMonthSummary('2026-10', '2026-11');
    assert.equal(octSummary.incomeMinor, 330_000);
    assert.equal(octSummary.expenseMinor, 0);
    assert.equal(octSummary.netSavingsMinor, 330_000);

    const octFoodSnapshot = (await harness.engine.getContainerSnapshots('2026-10')).find(
      (c) => c.id === accounts.foodContainerId,
    );
    assert.equal(octFoodSnapshot?.limitMinor, 50_000);

    // The user can then manually transfer ₱3,000 from Unallocated to Savings,
    // leaving ₱300 available for November.
    await harness.engine.contributeToSavings({
      sourceContainerId: UNALLOCATED_CONTAINER_ID,
      amountMinor: 300_000,
      effectiveDate: '2026-11-01',
      idempotencyKey: 'manual-transfer-unallocated-to-savings',
    });

    const postSavingsBalances = await harness.engine.getContainerBalances('2026-11-01');
    assert.equal(money(postSavingsBalances, UNALLOCATED_CONTAINER_ID), 30_000); // ₱300 available
    assert.equal(money(postSavingsBalances, SAVINGS_CONTAINER_ID), 300_000); // ₱3,000 saved

    // If a new ₱10,000 allowance is recorded in November, Unallocated becomes ₱10,300.
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'November Allowance',
      amountMinor: 1_000_000, // ₱10,000
      effectiveDate: '2026-11-01',
      walletId: accounts.cashWalletId,
      idempotencyKey: 'nov-allowance-10000',
    });

    const finalBalances = await harness.engine.getContainerBalances('2026-11-01');
    assert.equal(money(finalBalances, UNALLOCATED_CONTAINER_ID), 1_030_000); // ₱10,300
    assert.equal(money(finalBalances, SAVINGS_CONTAINER_ID), 300_000); // ₱3,000
    assert.equal(money(finalBalances, accounts.foodContainerId), 0);
    assert.equal(money(finalBalances, 'container-school-essentials'), 0);

    // Total wallets = ₱3,300 + ₱10,000 = ₱13,300
    const finalWallets = await harness.engine.getWalletBalances('2026-11-01');
    assert.equal(money(finalWallets, accounts.cashWalletId), 1_330_000);

    // Invariant holds
    assert.ok(
      await harness.engine.repository.allWalletContainerTotalsMatch('2026-11-01'),
    );
  } finally {
    harness.database.close();
  }
});

test('offline-first rollover: unopened app across 6 missed months sweeps ordinary containers but preserves Savings', async () => {
  // App used in May 2026
  const harness = await createHarness(new Date(2026, 4, 15, 12));
  try {
    const accounts = await seedStandardAccounts(harness.engine);

    // Record income into Cash wallet (₱100,000)
    await recordIncome(harness.engine, accounts, 100_000, {
      effectiveDate: '2026-05-15',
    });

    // Move ₱40,000 to Savings in May
    await harness.engine.contributeToSavings({
      sourceContainerId: accounts.foodContainerId,
      amountMinor: 40_000,
      effectiveDate: '2026-05-15',
      idempotencyKey: 'may-savings',
    });

    // Food has ₱60,000, Savings has ₱40,000
    const mayBalances = await harness.engine.getContainerBalances('2026-05-15');
    assert.equal(money(mayBalances, accounts.foodContainerId), 60_000);
    assert.equal(money(mayBalances, SAVINGS_CONTAINER_ID), 40_000);

    // App is closed and unopened for 6 months until November 2026
    harness.clock.set(2026, 10, 10, 10);

    // Reading wallet balances or containers triggers rollover for all missed months
    const wallets = await harness.engine.getWalletBalances('2026-11-10');
    assert.equal(money(wallets, accounts.cashWalletId), 100_000);

    const novBalances = await harness.engine.getContainerBalances('2026-11-10');
    assert.equal(money(novBalances, accounts.foodContainerId), 0);
    assert.equal(money(novBalances, UNALLOCATED_CONTAINER_ID), 60_000);
    assert.equal(money(novBalances, SAVINGS_CONTAINER_ID), 40_000); // Savings was never swept!

    // Verify all missed months were recorded in order
    const runs = await harness.database.getAllAsync<{ month_key: string }>(
      'SELECT month_key FROM month_rollover_runs ORDER BY month_key ASC',
    );
    assert.deepEqual(
      runs.map((r) => r.month_key),
      ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
    );

    // Ledger invariant holds across the entire timeline
    assert.ok(
      await harness.engine.repository.allWalletContainerTotalsMatch('2026-11-10'),
    );
  } finally {
    harness.database.close();
  }
});

test('concurrent and recursive rollover invocations are deduplicated without duplicate sweeps', async () => {
  const { harness, accounts } = await setup(new Date(2026, 9, 20, 12));
  try {
    await recordIncome(harness.engine, accounts, 50_000);
    harness.clock.set(2026, 10, 2, 8);

    // Launch multiple concurrent reads that all trigger rollover
    const [b1, b2, w1, summary] = await Promise.all([
      harness.engine.getContainerBalances('2026-11-02'),
      harness.engine.getContainerBalances('2026-11-02'),
      harness.engine.getWalletBalances('2026-11-02'),
      harness.engine.getMonthSummary('2026-11', '2026-11'),
    ]);

    assert.equal(money(b1, accounts.foodContainerId), 0);
    assert.equal(money(b2, accounts.foodContainerId), 0);
    assert.equal(money(w1, accounts.cashWalletId), 50_000);
    assert.equal(summary.unallocatedCarryoverMinor, 50_000);

    // Ensure only 1 rollover transaction was created for October
    const rolloverTxns = await harness.database.getAllAsync<{ id: string }>(
      `SELECT id FROM transactions WHERE category = 'Monthly rollover'`,
    );
    assert.equal(rolloverTxns.length, 1);
  } finally {
    harness.database.close();
  }
});

test('monthly reporting clearly distinguishes income, expenses, net savings, Savings balances/transfers, unallocated carryover, and available budget', async () => {
  // Setup app starting in September 2026
  const harness = await createHarness(new Date(2026, 8, 15, 12));
  try {
    const accounts = await seedStandardAccounts(harness.engine);

    // September: User records initial income of ₱20,000 into Cash wallet
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'September Salary',
      amountMinor: 200_000,
      effectiveDate: '2026-09-15',
      walletId: accounts.cashWalletId,
      idempotencyKey: 'sep-income-200k',
    });

    // Advance clock to October 2026
    harness.clock.set(2026, 9, 20, 12);

    // Rollover sweeps September funds into Unallocated carryover (₱20,000)
    await harness.engine.processDueRollovers();

    // In October:
    // 1. October income: ₱10,000 allowance into Cash wallet
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'October Allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-10-05',
      walletId: accounts.cashWalletId,
      idempotencyKey: 'oct-income-100k',
    });

    // Allocate ₱5,000 from Unallocated to Food
    await harness.engine.allocateToContainer({
      containerId: accounts.foodContainerId,
      amountMinor: 50_000,
      effectiveDate: '2026-10-06',
      idempotencyKey: 'oct-alloc-food-50k',
    });

    // 2. October expenses: ₱3,000 spent on Food from Cash wallet
    await harness.engine.recordTransaction({
      kind: 'expense',
      title: 'Groceries',
      amountMinor: 30_000,
      effectiveDate: '2026-10-10',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'oct-expense-30k',
    });

    // 3. October contributions to Savings: User transfers ₱5,000 to Savings
    // Must NOT be counted as an expense or decrease net savings
    await harness.engine.contributeToSavings({
      sourceContainerId: UNALLOCATED_CONTAINER_ID,
      amountMinor: 50_000,
      effectiveDate: '2026-10-12',
      idempotencyKey: 'oct-savings-contrib-50k',
    });

    // 4. October withdrawals from Savings: User withdraws ₱1,000 from Savings to Food
    // Must NOT be counted as income or increase net savings
    await harness.engine.withdrawFromSavings({
      destinationContainerId: accounts.foodContainerId,
      amountMinor: 10_000,
      effectiveDate: '2026-10-15',
      idempotencyKey: 'oct-savings-withdraw-10k',
    });

    // Fetch October MonthSummary
    const summary = await harness.engine.getMonthSummary('2026-10', '2026-10');

    // Verify all distinguished metrics:
    // - Monthly income: strictly external income = ₱10,000
    assert.equal(summary.incomeMinor, 100_000);

    // - Monthly expenses: strictly external expenses = ₱3,000 (transfers to savings are NOT expenses)
    assert.equal(summary.expenseMinor, 30_000);

    // - Monthly net savings = income minus expenses = ₱10,000 - ₱3,000 = ₱7,000
    assert.equal(summary.netSavingsMinor, 70_000);

    // - Monthly contributions to Savings: ₱5,000
    assert.equal(summary.savingsContributionsMinor, 50_000);

    // - Monthly withdrawals from Savings: ₱1,000
    assert.equal(summary.savingsWithdrawalsMinor, 10_000);

    // - Current Savings container balance: ₱5,000 - ₱1,000 = ₱4,000
    assert.equal(summary.systemSavingsEndingBalanceMinor, 40_000);
    assert.equal(summary.savingsEndingBalanceMinor, 40_000);

    // - Unallocated carryover from previous month (September): ₱20,000
    assert.equal(summary.unallocatedCarryoverMinor, 200_000);

    // - Unallocated ending balance:
    // September carryover (₱20,000) + October income (₱10,000) - allocated to Food (₱5,000) - contributed to Savings (₱5,000) = ₱20,000
    assert.equal(summary.unallocatedEndingBalanceMinor, 200_000);

    // - Food ending balance: allocated (₱5,000) - expense (₱3,000) + withdrawn from Savings (₱1,000) = ₱3,000
    const foodBalance = await harness.engine.repository.getContainerBalance(
      accounts.foodContainerId,
      '2026-10-31',
    );
    assert.equal(foodBalance, 30_000);

    // - Current available budget: Unallocated ending (₱20,000) + Food ending (₱3,000) = ₱23,000
    assert.equal(summary.availableBudgetMinor, 230_000);

    // Ending wallet balance: September (₱20,000) + October income (₱10,000) - October expense (₱3,000) = ₱27,000
    const wallets = await harness.engine.getWalletBalances('2026-10-31');
    assert.equal(money(wallets, accounts.cashWalletId), 270_000);

    // CRITICAL: A month's ending wallet balance (₱27,000) does NOT equal that month's net savings (₱7,000)
    assert.notEqual(wallets[accounts.cashWalletId], summary.netSavingsMinor);
    assert.equal(wallets[accounts.cashWalletId], 270_000);
    assert.equal(summary.netSavingsMinor, 70_000);

    // Invariant check: total wallets (₱27,000) = total containers (₱4,000 Savings + ₱23,000 Available Budget)
    const containerBalances = await harness.engine.getContainerBalances('2026-10-31');
    const totalContainers = Object.values(containerBalances).reduce((a, b) => a + b, 0);
    assert.equal(totalContainers, 270_000);
    assert.ok(
      await harness.engine.repository.allWalletContainerTotalsMatch('2026-10-31'),
    );
  } finally {
    harness.database.close();
  }
});
