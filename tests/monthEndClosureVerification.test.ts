import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { FinanceError } from '../src/db/errors';
import { FinanceEngine } from '../src/db/financeEngine';
import { MIGRATIONS, migrateDatabase } from '../src/db/migrations';
import {
  SAVINGS_CONTAINER_ID,
  UNALLOCATED_CONTAINER_ID,
} from '../src/db/systemContainers';
import {
  createHarness,
  type TestHarness,
} from './helpers/financeTestHarness';
import { NodeSqlDatabase } from './helpers/nodeSqlDatabase';

const CASH_WALLET_ID = 'wallet-verification-cash';

async function createWallet(engine: FinanceEngine): Promise<void> {
  await engine.createWallet({
    id: CASH_WALLET_ID,
    name: 'Verification cash',
    kind: 'cash',
    icon: 'cash-outline',
    tone: 'amber',
    idempotencyKey: 'verification-wallet',
  });
}

async function createBudget(
  engine: FinanceEngine,
  id: string,
  name: string,
  options: { limitMinor?: number } = {},
): Promise<void> {
  await engine.createContainer({
    id,
    name,
    description: '',
    icon: 'wallet-outline',
    tone: 'blue',
    ...(options.limitMinor === undefined
      ? {}
      : { limitMinor: options.limitMinor }),
    idempotencyKey: `create-${id}`,
  });
}

async function findContainer(engine: FinanceEngine, id: string) {
  const containers = await engine.listContainers(true, true);
  return containers.find((container) => container.id === id) ?? null;
}

function money(balances: Record<string, number>, id: string): number {
  return balances[id] ?? 0;
}

async function recordIncome(
  engine: FinanceEngine,
  containerId: string,
  amountMinor: number,
  effectiveDate: string,
  idempotencyKey: string,
): Promise<string> {
  const result = await engine.recordTransaction({
    kind: 'income',
    title: 'Verification income',
    amountMinor,
    effectiveDate,
    walletId: CASH_WALLET_ID,
    containerId,
    idempotencyKey,
  });
  return result.transactionId;
}

async function lifeEvents(
  engine: FinanceEngine,
  containerId: string,
): Promise<{ eventType: string; detailsJson: string }[]> {
  return engine.getLifecycleEvents(containerId);
}

async function countTransactions(
  harness: TestHarness,
  category: string,
): Promise<number> {
  const row = await harness.database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM transactions WHERE category = ?',
    [category],
  );
  return row?.count ?? 0;
}

async function insertNegativeFixture(
  harness: TestHarness,
  sourceContainerId: string,
): Promise<void> {
  const transactionId = 'txn-negative-verification';
  await harness.database.runAsync(
    `INSERT INTO transactions (
       id, idempotency_key, request_fingerprint, kind, title, category,
       direction, amount_minor, effective_date, effective_month_key,
       recorded_at, recorded_time_zone, recorded_offset_minutes, status,
       source_container_id, destination_container_id, source_container_name,
       destination_container_name, icon, tone, created_at
     ) VALUES (?, ?, ?, 'container_transfer', 'Fixture transfer', 'Fixture',
               'neutral', ?, '2026-11-15', '2026-11', ?, 'UTC', 0, 'posted',
               ?, ?, 'Bills', 'Savings', 'swap-horizontal-outline',
               'violet', ?)`,
    [
      transactionId,
      'fixture-negative-verification',
      'fixture-negative-fingerprint',
      8_000,
      '2026-11-15T12:00:00.000Z',
      sourceContainerId,
      SAVINGS_CONTAINER_ID,
      '2026-11-15T12:00:00.000Z',
    ],
  );
  await harness.database.runAsync(
    `INSERT INTO postings (
       transaction_id, account_type, account_id, container_id,
       amount_minor, recorded_at
     ) VALUES (?, 'container', ?, ?, ?, ?), (?, 'container', ?, ?, ?, ?)`,
    [
      transactionId,
      sourceContainerId,
      sourceContainerId,
      -8_000,
      '2026-11-15T12:00:00.000Z',
      transactionId,
      SAVINGS_CONTAINER_ID,
      SAVINGS_CONTAINER_ID,
      8_000,
      '2026-11-15T12:00:00.000Z',
    ],
  );
}

test('Scenario A: positive archived balance settles once and closes', async () => {
  const harness = await createHarness(new Date(2026, 10, 15, 12));
  try {
    await createWallet(harness.engine);
    await createBudget(harness.engine, 'container-food', 'Food');
    const incomeId = await recordIncome(
      harness.engine,
      'container-food',
      35_000,
      '2026-11-15',
      'food-income',
    );

    await harness.engine.archiveContainer({
      containerId: 'container-food',
      idempotencyKey: 'archive-food',
    });
    let food = await findContainer(harness.engine, 'container-food');
    assert.equal(food?.status, 'archived');
    assert.equal(food?.archiveMonthKey, '2026-11');
    assert.equal(food?.closedAt, null);

    await harness.engine.reactivateContainer({
      containerId: 'container-food',
      idempotencyKey: 'restore-food-before-month-end',
    });
    food = await findContainer(harness.engine, 'container-food');
    assert.equal(food?.status, 'active');
    assert.equal(food?.archiveMonthKey, null);

    await harness.engine.archiveContainer({
      containerId: 'container-food',
      idempotencyKey: 'rearchive-food',
    });

    const beforeContainers =
      await harness.engine.getContainerBalances('2026-11-30');
    const beforeWallets = await harness.engine.getWalletBalances('2026-11-30');
    assert.equal(money(beforeContainers, 'container-food'), 35_000);
    assert.equal(money(beforeContainers, UNALLOCATED_CONTAINER_ID), 0);
    assert.equal(money(beforeWallets, CASH_WALLET_ID), 35_000);

    harness.clock.set(2026, 11, 1, 0, 5);
    const rollover = await harness.engine.processDueRollovers();
    assert.deepEqual(rollover.processedMonths, ['2026-11']);
    assert.deepEqual(rollover.closedContainerIds, ['container-food']);

    const afterContainers =
      await harness.engine.getContainerBalances('2026-12-01');
    const afterWallets = await harness.engine.getWalletBalances('2026-12-01');
    assert.equal(money(afterContainers, 'container-food'), 0);
    assert.equal(money(afterContainers, UNALLOCATED_CONTAINER_ID), 35_000);
    assert.equal(money(afterWallets, CASH_WALLET_ID), 35_000);

    food = await findContainer(harness.engine, 'container-food');
    assert.equal(food?.status, 'closed');
    assert.ok(food?.closedAt);

    const rolloverRows = await harness.database.getAllAsync<{
      id: string;
      kind: string;
      direction: string;
      amount_minor: number;
      effective_date: string;
      source_container_id: string;
      destination_container_id: string;
      source_container_name: string;
      destination_container_name: string;
      status: string;
    }>(
      `SELECT id, kind, direction, amount_minor, effective_date,
              source_container_id, destination_container_id,
              source_container_name, destination_container_name, status
       FROM transactions
       WHERE category = 'Monthly rollover'
       ORDER BY effective_date ASC`,
    );
    assert.equal(rolloverRows.length, 1);
    assert.deepEqual(
      {
        kind: rolloverRows[0]?.kind,
        direction: rolloverRows[0]?.direction,
        amountMinor: rolloverRows[0]?.amount_minor,
        effectiveDate: rolloverRows[0]?.effective_date,
        source: rolloverRows[0]?.source_container_id,
        destination: rolloverRows[0]?.destination_container_id,
        sourceName: rolloverRows[0]?.source_container_name,
        destinationName: rolloverRows[0]?.destination_container_name,
        status: rolloverRows[0]?.status,
      },
      {
        kind: 'container_transfer',
        direction: 'neutral',
        amountMinor: 35_000,
        effectiveDate: '2026-12-01',
        source: 'container-food',
        destination: UNALLOCATED_CONTAINER_ID,
        sourceName: 'Food',
        destinationName: 'Unallocated',
        status: 'posted',
      },
    );

    const closedEvents = (await lifeEvents(harness.engine, 'container-food'))
      .filter((event) => event.eventType === 'closed');
    assert.equal(closedEvents.length, 1);
    const closedDetails = JSON.parse(closedEvents[0]?.detailsJson ?? '{}') as {
      returnedMinor?: number;
    };
    assert.equal(closedDetails.returnedMinor, 35_000);

    const historicalIncome = await harness.engine.getTransaction(incomeId);
    assert.equal(historicalIncome?.destinationContainerName, 'Food');
    const historicalSnapshot = await harness.engine.getContainerSnapshots(
      '2026-11',
      true,
    );
    const historicalFood = historicalSnapshot.find(
      (container) => container.id === 'container-food',
    );
    assert.equal(historicalFood?.name, 'Food');
    assert.equal(historicalFood?.status, 'closed');

    const currentSnapshots = await harness.engine.getContainerSnapshots(
      '2026-12',
      true,
    );
    const managed = currentSnapshots.filter(
      (container) =>
        container.id === 'container-food' &&
        (container.status === 'active' || container.status === 'archived'),
    );
    assert.deepEqual(managed, []);

    await assert.rejects(
      harness.engine.allocateToContainer({
        containerId: 'container-food',
        amountMinor: 100,
        effectiveDate: '2026-12-01',
        idempotencyKey: 'closed-allocation',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'ARCHIVED_CONTAINER',
    );
    await assert.rejects(
      harness.engine.reactivateContainer({
        containerId: 'container-food',
        idempotencyKey: 'closed-restore',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'INVALID_STATE',
    );
    await assert.rejects(
      harness.engine.deleteContainer({
        containerId: 'container-food',
        idempotencyKey: 'closed-delete',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'INVALID_STATE',
    );

    const repeated = await harness.engine.processDueRollovers();
    assert.deepEqual(repeated.processedMonths, []);
    assert.deepEqual(repeated.closedContainerIds, []);
    assert.equal(
      await countTransactions(harness, 'Monthly rollover'),
      1,
    );
    assert.equal(
      (await lifeEvents(harness.engine, 'container-food')).filter(
        (event) => event.eventType === 'closed',
      ).length,
      1,
    );
    const finalContainers =
      await harness.engine.getContainerBalances('2026-12-01');
    assert.equal(money(finalContainers, UNALLOCATED_CONTAINER_ID), 35_000);

    const december = await harness.engine.getMonthSummary(
      '2026-12',
      '2026-12',
    );
    assert.equal(december.incomeMinor, 0);
    assert.equal(december.expenseMinor, 0);
    assert.equal(december.netSavingsMinor, 0);
    assert.equal(december.unallocatedCarryoverMinor, 35_000);
  } finally {
    harness.database.close();
  }
});

test('Scenario B: zero archived balance closes without a transfer', async () => {
  const harness = await createHarness(new Date(2026, 10, 15, 12));
  try {
    await createWallet(harness.engine);
    await createBudget(harness.engine, 'container-school', 'School', {
      limitMinor: 10_000,
    });
    const incomeId = await recordIncome(
      harness.engine,
      'container-school',
      5_000,
      '2026-11-15',
      'school-income',
    );
    const expense = await harness.engine.recordTransaction({
      kind: 'expense',
      title: 'School supplies',
      amountMinor: 5_000,
      effectiveDate: '2026-11-15',
      walletId: CASH_WALLET_ID,
      containerId: 'container-school',
      idempotencyKey: 'school-expense',
    });
    await harness.engine.archiveContainer({
      containerId: 'container-school',
      idempotencyKey: 'archive-school',
    });

    const beforeContainers =
      await harness.engine.getContainerBalances('2026-11-30');
    assert.equal(money(beforeContainers, 'container-school'), 0);

    harness.clock.set(2026, 11, 1, 0, 5);
    const rollover = await harness.engine.processDueRollovers();
    assert.deepEqual(rollover.closedContainerIds, ['container-school']);
    assert.deepEqual(rollover.transactionIds, []);

    const school = await findContainer(harness.engine, 'container-school');
    assert.equal(school?.status, 'closed');
    const containers = await harness.engine.getContainerBalances('2026-12-01');
    const wallets = await harness.engine.getWalletBalances('2026-12-01');
    assert.equal(money(containers, 'container-school'), 0);
    assert.equal(money(containers, UNALLOCATED_CONTAINER_ID), 0);
    assert.equal(money(wallets, CASH_WALLET_ID), 0);
    assert.equal(await countTransactions(harness, 'Monthly rollover'), 0);
    assert.equal(await countTransactions(harness, 'Container closure'), 0);

    const closedEvents = (await lifeEvents(harness.engine, 'container-school'))
      .filter((event) => event.eventType === 'closed');
    assert.equal(closedEvents.length, 1);
    const details = JSON.parse(closedEvents[0]?.detailsJson ?? '{}') as {
      returnedMinor?: number;
      settlementTransactionId?: string;
    };
    assert.equal(details.returnedMinor, 0);
    assert.equal(details.settlementTransactionId, undefined);

    assert.equal(
      (await harness.engine.getTransaction(incomeId))
        ?.destinationContainerName,
      'School',
    );
    assert.equal(
      (await harness.engine.getTransaction(expense.transactionId))
        ?.sourceContainerName,
      'School',
    );
  } finally {
    harness.database.close();
  }
});

test('Scenario C: negative archived balance is not erased or closed', async () => {
  const harness = await createHarness(new Date(2026, 10, 15, 12));
  try {
    await createWallet(harness.engine);
    await createBudget(harness.engine, 'container-bills', 'Bills');
    await recordIncome(
      harness.engine,
      'container-bills',
      5_000,
      '2026-11-15',
      'bills-income',
    );
    await harness.engine.ensureSavingsContainer();
    await insertNegativeFixture(harness, 'container-bills');
    await harness.engine.archiveContainer({
      containerId: 'container-bills',
      idempotencyKey: 'archive-bills',
    });

    const beforeContainers =
      await harness.engine.getContainerBalances('2026-11-30');
    const beforeWallets = await harness.engine.getWalletBalances('2026-11-30');
    assert.equal(money(beforeContainers, 'container-bills'), -3_000);
    assert.equal(money(beforeContainers, SAVINGS_CONTAINER_ID), 8_000);
    assert.equal(money(beforeContainers, UNALLOCATED_CONTAINER_ID), 0);
    assert.equal(money(beforeWallets, CASH_WALLET_ID), 5_000);
    assert.equal(
      await harness.engine.repository.allWalletContainerTotalsMatch(
        '2026-11-30',
      ),
      true,
    );

    harness.clock.set(2026, 11, 1, 0, 5);
    const rollover = await harness.engine.processDueRollovers();
    assert.deepEqual(rollover.closedContainerIds, []);

    const bills = await findContainer(harness.engine, 'container-bills');
    assert.equal(bills?.status, 'archived');
    assert.equal(bills?.closedAt, null);
    const afterContainers =
      await harness.engine.getContainerBalances('2026-12-01');
    const afterWallets = await harness.engine.getWalletBalances('2026-12-01');
    assert.equal(money(afterContainers, 'container-bills'), -3_000);
    assert.equal(money(afterContainers, SAVINGS_CONTAINER_ID), 8_000);
    assert.equal(money(afterContainers, UNALLOCATED_CONTAINER_ID), 0);
    assert.equal(money(afterWallets, CASH_WALLET_ID), 5_000);
    assert.equal(
      await harness.engine.repository.allWalletContainerTotalsMatch(
        '2026-12-01',
      ),
      true,
    );
    assert.equal(await countTransactions(harness, 'Monthly rollover'), 0);
    assert.equal(await countTransactions(harness, 'Container closure'), 0);

    const failures = (await lifeEvents(harness.engine, 'container-bills'))
      .filter((event) => event.eventType === 'closure_failed');
    assert.equal(failures.length, 1);
    const failureDetails = JSON.parse(failures[0]?.detailsJson ?? '{}') as {
      reason?: string;
      balanceMinor?: number;
    };
    assert.equal(failureDetails.reason, 'negative_balance');
    assert.equal(failureDetails.balanceMinor, -3_000);

    await harness.engine.processDueRollovers();
    assert.equal(
      (await lifeEvents(harness.engine, 'container-bills')).filter(
        (event) => event.eventType === 'closure_failed',
      ).length,
      1,
    );
  } finally {
    harness.database.close();
  }
});

test('Scenario D: active container follows normal rollover and stays active', async () => {
  const harness = await createHarness(new Date(2026, 10, 15, 12));
  try {
    await createWallet(harness.engine);
    await createBudget(harness.engine, 'container-allowance', 'Allowance');
    await recordIncome(
      harness.engine,
      'container-allowance',
      50_000,
      '2026-11-15',
      'allowance-income',
    );

    harness.clock.set(2026, 11, 1, 0, 5);
    const rollover = await harness.engine.processDueRollovers();
    assert.deepEqual(rollover.closedContainerIds, []);

    const allowance = await findContainer(
      harness.engine,
      'container-allowance',
    );
    assert.equal(allowance?.status, 'active');
    assert.equal(allowance?.closedAt, null);
    const containers = await harness.engine.getContainerBalances('2026-12-01');
    const wallets = await harness.engine.getWalletBalances('2026-12-01');
    assert.equal(money(containers, 'container-allowance'), 0);
    assert.equal(money(containers, UNALLOCATED_CONTAINER_ID), 50_000);
    assert.equal(money(wallets, CASH_WALLET_ID), 50_000);
    assert.equal(await countTransactions(harness, 'Monthly rollover'), 1);
    assert.equal(
      (await lifeEvents(harness.engine, 'container-allowance')).filter(
        (event) =>
          event.eventType === 'closed' ||
          event.eventType === 'closure_failed',
      ).length,
      0,
    );
  } finally {
    harness.database.close();
  }
});

const monthEndBoundaries = [
  {
    name: 'November 30 to December 1',
    setup: [2026, 10, 30, 23, 59] as const,
    rollover: [2026, 11, 1, 0, 0] as const,
    monthKey: '2026-11',
    effectiveDate: '2026-12-01',
  },
  {
    name: 'December 31 to January 1',
    setup: [2026, 11, 31, 23, 59] as const,
    rollover: [2027, 0, 1, 0, 0] as const,
    monthKey: '2026-12',
    effectiveDate: '2027-01-01',
  },
  {
    name: 'February 28 to March 1 in a non-leap year',
    setup: [2027, 1, 28, 23, 59] as const,
    rollover: [2027, 2, 1, 0, 0] as const,
    monthKey: '2027-02',
    effectiveDate: '2027-03-01',
  },
  {
    name: 'February 29 to March 1 in a leap year',
    setup: [2028, 1, 29, 23, 59] as const,
    rollover: [2028, 2, 1, 0, 0] as const,
    monthKey: '2028-02',
    effectiveDate: '2028-03-01',
  },
];

for (const boundary of monthEndBoundaries) {
  test(`boundary: ${boundary.name}`, async () => {
    const harness = await createHarness();
    try {
      await createWallet(harness.engine);
      await createBudget(harness.engine, 'container-boundary', 'Boundary');
      harness.clock.set(
        boundary.setup[0],
        boundary.setup[1],
        boundary.setup[2],
        boundary.setup[3],
        boundary.setup[4],
      );
      const lastDate = `${boundary.monthKey}-${String(
        boundary.setup[2],
      ).padStart(2, '0')}`;
      await recordIncome(
        harness.engine,
        'container-boundary',
        10_000,
        lastDate,
        `boundary-income-${boundary.monthKey}`,
      );
      await harness.engine.archiveContainer({
        containerId: 'container-boundary',
        idempotencyKey: `boundary-archive-${boundary.monthKey}`,
      });

      harness.clock.set(
        boundary.rollover[0],
        boundary.rollover[1],
        boundary.rollover[2],
        boundary.rollover[3],
        boundary.rollover[4],
      );
      const result = await harness.engine.processDueRollovers();
      assert.deepEqual(result.closedContainerIds, ['container-boundary']);
      assert.equal(
        (await findContainer(harness.engine, 'container-boundary'))?.status,
        'closed',
      );
      const row = await harness.database.getFirstAsync<{
        amount_minor: number;
        effective_date: string;
      }>(
        `SELECT amount_minor, effective_date FROM transactions
         WHERE category = 'Monthly rollover' AND source_container_id = ?`,
        ['container-boundary'],
      );
      assert.equal(row?.amount_minor, 10_000);
      assert.equal(row?.effective_date, boundary.effectiveDate);
      const containers =
        await harness.engine.getContainerBalances(boundary.effectiveDate);
      assert.equal(money(containers, UNALLOCATED_CONTAINER_ID), 10_000);
    } finally {
      harness.database.close();
    }
  });
}

test('reopening after missed months settles and closes in order', async () => {
  const harness = await createHarness(new Date(2026, 8, 15, 12));
  try {
    await createWallet(harness.engine);
    await createBudget(harness.engine, 'container-missed', 'Missed');
    await recordIncome(
      harness.engine,
      'container-missed',
      10_000,
      '2026-09-15',
      'missed-income',
    );
    harness.clock.set(2026, 9, 1, 0, 5);
    await harness.engine.processDueRollovers();
    await harness.engine.allocateToContainer({
      containerId: 'container-missed',
      amountMinor: 5_000,
      effectiveDate: '2026-10-01',
      idempotencyKey: 'missed-allocation',
    });
    harness.clock.set(2026, 9, 15, 12);
    await harness.engine.archiveContainer({
      containerId: 'container-missed',
      idempotencyKey: 'archive-missed',
    });

    harness.clock.set(2027, 0, 15, 12);
    const result = await harness.engine.processDueRollovers();
    assert.deepEqual(result.processedMonths, [
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    assert.deepEqual(result.closedContainerIds, ['container-missed']);
    const containers = await harness.engine.getContainerBalances('2027-01-15');
    assert.equal(money(containers, 'container-missed'), 0);
    assert.equal(money(containers, UNALLOCATED_CONTAINER_ID), 10_000);
    assert.equal(
      (await findContainer(harness.engine, 'container-missed'))?.status,
      'closed',
    );
  } finally {
    harness.database.close();
  }
});

test('legacy archived container without archive-month metadata remains archived', async () => {
  const harness = await createHarness(new Date(2026, 10, 15, 12));
  try {
    await createWallet(harness.engine);
    await createBudget(harness.engine, 'container-legacy', 'Legacy');
    await recordIncome(
      harness.engine,
      'container-legacy',
      1_000,
      '2026-11-15',
      'legacy-income',
    );
    await harness.engine.archiveContainer({
      containerId: 'container-legacy',
      idempotencyKey: 'archive-legacy',
    });
    await harness.database.runAsync(
      'UPDATE containers SET archive_month_key = NULL WHERE id = ?',
      ['container-legacy'],
    );

    harness.clock.set(2026, 11, 1, 0, 5);
    const result = await harness.engine.processDueRollovers();
    assert.deepEqual(result.closedContainerIds, []);
    const legacy = await findContainer(harness.engine, 'container-legacy');
    assert.equal(legacy?.status, 'archived');
    assert.equal(legacy?.archiveMonthKey, null);
    assert.equal(legacy?.closedAt, null);
    const containers = await harness.engine.getContainerBalances('2026-12-01');
    assert.equal(money(containers, 'container-legacy'), 0);
    assert.equal(money(containers, UNALLOCATED_CONTAINER_ID), 1_000);
  } finally {
    harness.database.close();
  }
});

test('concurrent rollover requests settle and close exactly once', async () => {
  const harness = await createHarness(new Date(2026, 10, 15, 12));
  try {
    await createWallet(harness.engine);
    await createBudget(harness.engine, 'container-concurrent', 'Concurrent');
    await recordIncome(
      harness.engine,
      'container-concurrent',
      30_000,
      '2026-11-15',
      'concurrent-income',
    );
    await harness.engine.archiveContainer({
      containerId: 'container-concurrent',
      idempotencyKey: 'archive-concurrent',
    });

    harness.clock.set(2026, 11, 1, 0, 5);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => harness.engine.processDueRollovers()),
    );
    for (const result of results) {
      assert.deepEqual(result.closedContainerIds, ['container-concurrent']);
    }
    assert.equal(await countTransactions(harness, 'Monthly rollover'), 1);
    assert.equal(
      (await lifeEvents(harness.engine, 'container-concurrent')).filter(
        (event) => event.eventType === 'closed',
      ).length,
      1,
    );
    const containers = await harness.engine.getContainerBalances('2026-12-01');
    assert.equal(money(containers, UNALLOCATED_CONTAINER_ID), 30_000);
  } finally {
    harness.database.close();
  }
});

test('failure during settlement rolls back the whole month-end transaction', async () => {
  const harness = await createHarness(new Date(2026, 10, 15, 12));
  try {
    await createWallet(harness.engine);
    await createBudget(harness.engine, 'container-failure', 'Failure');
    await recordIncome(
      harness.engine,
      'container-failure',
      7_000,
      '2026-11-15',
      'failure-income',
    );
    await harness.engine.archiveContainer({
      containerId: 'container-failure',
      idempotencyKey: 'archive-failure',
    });
    await harness.database.execAsync(`
      CREATE TRIGGER fail_month_end_settlement
      BEFORE INSERT ON transactions
      WHEN NEW.category = 'Monthly rollover'
      BEGIN
        SELECT RAISE(ABORT, 'forced settlement failure');
      END;
    `);

    harness.clock.set(2026, 11, 1, 0, 5);
    await assert.rejects(
      harness.engine.processDueRollovers(),
      /forced settlement failure/,
    );
    assert.equal(
      await harness.engine.repository.getRolloverRun('2026-11'),
      null,
    );
    assert.equal(
      (await findContainer(harness.engine, 'container-failure'))?.status,
      'archived',
    );
    const failedContainerBalance =
      await harness.engine.repository.getContainerBalance(
        'container-failure',
        '2026-12-01',
      );
    const failedUnallocatedBalance =
      await harness.engine.repository.getContainerBalance(
        UNALLOCATED_CONTAINER_ID,
        '2026-12-01',
      );
    assert.equal(failedContainerBalance, 7_000);
    assert.equal(failedUnallocatedBalance, 0);
    assert.equal(await countTransactions(harness, 'Monthly rollover'), 0);
    assert.equal(
      (await lifeEvents(harness.engine, 'container-failure')).filter(
        (event) => event.eventType === 'closed',
      ).length,
      0,
    );

    await harness.database.execAsync('DROP TRIGGER fail_month_end_settlement;');
    const retry = await harness.engine.processDueRollovers();
    assert.deepEqual(retry.closedContainerIds, ['container-failure']);
    const retriedContainers =
      await harness.engine.getContainerBalances('2026-12-01');
    assert.equal(money(retriedContainers, 'container-failure'), 0);
    assert.equal(money(retriedContainers, UNALLOCATED_CONTAINER_ID), 7_000);
    assert.equal(await countTransactions(harness, 'Monthly rollover'), 1);
  } finally {
    harness.database.close();
  }
});

test('failure before closure commit rolls back settlement and closure state', async () => {
  const harness = await createHarness(new Date(2026, 10, 15, 12));
  try {
    await createWallet(harness.engine);
    await createBudget(harness.engine, 'container-commit', 'Commit');
    await recordIncome(
      harness.engine,
      'container-commit',
      7_000,
      '2026-11-15',
      'commit-income',
    );
    await harness.engine.archiveContainer({
      containerId: 'container-commit',
      idempotencyKey: 'archive-commit',
    });
    await harness.database.execAsync(`
      CREATE TRIGGER fail_closure_event
      BEFORE INSERT ON container_lifecycle_events
      WHEN NEW.event_type = 'closed'
      BEGIN
        SELECT RAISE(ABORT, 'forced closure commit failure');
      END;
    `);

    harness.clock.set(2026, 11, 1, 0, 5);
    await assert.rejects(
      harness.engine.processDueRollovers(),
      /forced closure commit failure/,
    );
    assert.equal(
      await harness.engine.repository.getRolloverRun('2026-11'),
      null,
    );
    const failed = await findContainer(harness.engine, 'container-commit');
    assert.equal(failed?.status, 'archived');
    assert.equal(failed?.closedAt, null);
    const failedContainerBalance =
      await harness.engine.repository.getContainerBalance(
        'container-commit',
        '2026-12-01',
      );
    const failedUnallocatedBalance =
      await harness.engine.repository.getContainerBalance(
        UNALLOCATED_CONTAINER_ID,
        '2026-12-01',
      );
    assert.equal(failedContainerBalance, 7_000);
    assert.equal(failedUnallocatedBalance, 0);
    assert.equal(await countTransactions(harness, 'Monthly rollover'), 0);
    assert.equal(
      (await lifeEvents(harness.engine, 'container-commit')).filter(
        (event) => event.eventType === 'closed',
      ).length,
      0,
    );

    await harness.database.execAsync('DROP TRIGGER fail_closure_event;');
    const retry = await harness.engine.processDueRollovers();
    assert.deepEqual(retry.closedContainerIds, ['container-commit']);
    const completed = await findContainer(harness.engine, 'container-commit');
    assert.equal(completed?.status, 'closed');
    assert.ok(completed?.closedAt);
    const completedContainers =
      await harness.engine.getContainerBalances('2026-12-01');
    assert.equal(money(completedContainers, UNALLOCATED_CONTAINER_ID), 7_000);
    assert.equal(await countTransactions(harness, 'Monthly rollover'), 1);
  } finally {
    harness.database.close();
  }
});

test('migration v4 to v5 preserves wallets, containers, ledger, and lifecycle history', async () => {
  const database = new NodeSqlDatabase();
  try {
    await migrateDatabase(database, MIGRATIONS.slice(0, 4));
    await database.runAsync(
      `INSERT INTO wallets (
         id, name, kind, icon, tone, sort_order, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        CASH_WALLET_ID,
        'Migration cash',
        'cash',
        'cash-outline',
        'amber',
        0,
        '2026-10-20T00:00:00.000Z',
      ],
    );
    await database.runAsync(
      `INSERT INTO containers (
         id, kind, status, sort_order, created_month_key, created_at,
         archived_at, deleted_at, system_key
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'container-migrated',
        'budget',
        'archived',
        0,
        '2026-10',
        '2026-10-20T00:00:00.000Z',
        '2026-11-15T00:00:00.000Z',
        null,
        null,
      ],
    );
    await database.runAsync(
      `INSERT INTO transactions (
         id, idempotency_key, request_fingerprint, kind, title, category,
         direction, amount_minor, effective_date, effective_month_key,
         recorded_at, recorded_time_zone, recorded_offset_minutes, status,
         destination_wallet_id, destination_container_id,
         destination_wallet_name, destination_container_name,
         icon, tone, created_at
       ) VALUES (?, ?, ?, 'income', 'Migration income', 'Migrated',
                 'in', ?, '2026-10-20', '2026-10', ?, 'UTC', 0, 'posted',
                 ?, ?, 'Migration cash', 'Migrated', 'cash-outline',
                 'amber', ?)`,
      [
        'txn-migrated',
        'migration-income',
        'migration-fingerprint',
        10_000,
        '2026-10-20T00:00:00.000Z',
        CASH_WALLET_ID,
        'container-migrated',
        '2026-10-20T00:00:00.000Z',
      ],
    );
    await database.runAsync(
      `INSERT INTO postings (
         transaction_id, account_type, account_id, wallet_id, container_id,
         amount_minor, recorded_at
       ) VALUES (?, 'wallet', ?, ?, NULL, ?, ?),
                (?, 'container', ?, NULL, ?, ?, ?)`,
      [
        'txn-migrated',
        CASH_WALLET_ID,
        CASH_WALLET_ID,
        10_000,
        '2026-10-20T00:00:00.000Z',
        'txn-migrated',
        'container-migrated',
        'container-migrated',
        10_000,
        '2026-10-20T00:00:00.000Z',
      ],
    );
    await database.runAsync(
      `INSERT INTO container_lifecycle_events (
         container_id, event_type, effective_month_key, recorded_at, details_json
       ) VALUES (?, 'archived', '2026-11', ?, ?)`,
      [
        'container-migrated',
        '2026-11-15T00:00:00.000Z',
        '{"source":"migration-fixture"}',
      ],
    );

    const beforeWallet = await database.getFirstAsync<{ total: number }>(
      `SELECT COALESCE(SUM(amount_minor), 0) AS total FROM postings
       WHERE account_type = 'wallet' AND account_id = ?`,
      [CASH_WALLET_ID],
    );
    const beforeContainer = await database.getFirstAsync<{ total: number }>(
      `SELECT COALESCE(SUM(amount_minor), 0) AS total FROM postings
       WHERE account_type = 'container' AND account_id = ?`,
      ['container-migrated'],
    );

    await migrateDatabase(database);
    await migrateDatabase(database);

    const version = await database.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    const archiveColumns = await database.getFirstAsync<{
      status: string;
      archive_month_key: string | null;
      closed_at: string | null;
    }>(
      `SELECT status, archive_month_key, closed_at
       FROM containers WHERE id = ?`,
      ['container-migrated'],
    );
    const afterWallet = await database.getFirstAsync<{ total: number }>(
      `SELECT COALESCE(SUM(amount_minor), 0) AS total FROM postings
       WHERE account_type = 'wallet' AND account_id = ?`,
      [CASH_WALLET_ID],
    );
    const afterContainer = await database.getFirstAsync<{ total: number }>(
      `SELECT COALESCE(SUM(amount_minor), 0) AS total FROM postings
       WHERE account_type = 'container' AND account_id = ?`,
      ['container-migrated'],
    );
    const lifecycle = await database.getAllAsync<{
      event_type: string;
      details_json: string;
    }>(
      `SELECT event_type, details_json FROM container_lifecycle_events
       WHERE container_id = ?`,
      ['container-migrated'],
    );
    const counts = await database.getFirstAsync<{
      wallets: number;
      containers: number;
      transactions: number;
      postings: number;
      migrations: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM wallets) AS wallets,
         (SELECT COUNT(*) FROM containers) AS containers,
         (SELECT COUNT(*) FROM transactions) AS transactions,
         (SELECT COUNT(*) FROM postings) AS postings,
         (SELECT COUNT(*) FROM schema_migrations) AS migrations`,
    );

    assert.equal(version?.user_version, 5);
    assert.equal(archiveColumns?.status, 'archived');
    assert.equal(archiveColumns?.archive_month_key, null);
    assert.equal(archiveColumns?.closed_at, null);
    assert.equal(afterWallet?.total, beforeWallet?.total);
    assert.equal(afterContainer?.total, beforeContainer?.total);
    assert.equal(afterWallet?.total, 10_000);
    assert.equal(afterContainer?.total, 10_000);
    assert.equal(lifecycle.length, 1);
    assert.equal(lifecycle[0]?.details_json, '{"source":"migration-fixture"}');
    assert.deepEqual({ ...counts }, {
      wallets: 1,
      containers: 1,
      transactions: 1,
      postings: 2,
      migrations: 5,
    });
  } finally {
    database.close();
  }
});

test('historical Closed section has no mutation handler', () => {
  const source = readFileSync(
    'src/features/budgets/BudgetsScreen.tsx',
    'utf8',
  );
  const start = source.indexOf('title="Closed containers"');
  const end = source.indexOf('<Card style={styles.footerCard}>', start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const section = source.slice(start, end);
  assert.match(
    section,
    /<BudgetCard key=\{container\.id\} container=\{container\} \/>/,
  );
  assert.equal(section.includes('onPress'), false);
});
