import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { preparePocketaDatabase } from '../src/db/databaseSetup';
import { FinanceEngine } from '../src/db/financeEngine';
import {
  SAVINGS_CONTAINER_ID,
  UNALLOCATED_CONTAINER_ID,
} from '../src/db/systemContainers';
import {
  FinanceSession,
  type FinanceStatus,
} from '../src/data/financeSession';
import { FinanceService, type MonthView } from '../src/data/financeService';
import { NodeSqlDatabase } from './helpers/nodeSqlDatabase';
import { createTestIdFactory, TestClock } from './helpers/financeTestHarness';

interface IntegrationHarness {
  database: NodeSqlDatabase;
  clock: TestClock;
  session: FinanceSession;
  service: FinanceService;
  openDatabaseCalls: () => number;
}

async function startSession(
  options: { path?: string; clock?: TestClock } = {},
): Promise<IntegrationHarness> {
  const clock = options.clock ?? new TestClock(2026, 9, 20, 12);
  const database = new NodeSqlDatabase(options.path);
  const idFactory = createTestIdFactory();
  let openDatabaseCalls = 0;

  const session = new FinanceSession({
    openDatabase: async () => {
      openDatabaseCalls += 1;
      return preparePocketaDatabase(database, {
        enableWal: Boolean(options.path),
      });
    },
    createService: (openedDatabase) =>
      new FinanceService(
        new FinanceEngine(openedDatabase, { now: clock.now, idFactory }),
        { now: clock.now },
      ),
    now: clock.now,
  });

  await session.start();

  const state = session.getState();
  assert.equal(state.status, 'ready');
  assert.ok(state.service);

  return {
    database,
    clock,
    session,
    service: state.service,
    openDatabaseCalls: () => openDatabaseCalls,
  };
}

async function waitForStatus(
  session: FinanceSession,
  status: FinanceStatus,
  timeoutMs = 2_000,
): Promise<void> {
  if (session.getState().status === status) return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for status "${String(status)}".`));
    }, timeoutMs);
    const unsubscribe = session.subscribe(() => {
      if (session.getState().status === status) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

function money(
  containers: { id: string; balanceMinor: number }[],
  id: string,
): number {
  return containers.find((container) => container.id === id)?.balanceMinor ?? 0;
}

function containerTotal(view: MonthView): number {
  return view.containers.reduce(
    (total, container) => total + container.balanceMinor,
    0,
  );
}

async function createContainer(
  harness: IntegrationHarness,
  name: string,
  limitMinor = 0,
): Promise<string> {
  const result = await harness.session.createContainer({
    name,
    description: '',
    icon: 'restaurant-outline',
    tone: 'coral',
    limitMinor,
    monthKey: harness.session.getState().activeMonthKey,
  });
  assert.ok(result.ok, result.message ?? 'Expected the action to succeed.');

  const view = await harness.service.getMonthView(
    harness.session.getState().activeMonthKey,
  );
  const created = view.containers.find((container) => container.name === name);
  assert.ok(created, `Expected a container named ${name}.`);
  return created.id;
}

async function assertBalanced(
  service: FinanceService,
  dateKey: string,
): Promise<void> {
  assert.equal(
    await service.engine.repository.allWalletContainerTotalsMatch(dateKey),
    true,
  );
}

test('startup initializes a fresh database and exposes a ready session', async () => {
  const database = new NodeSqlDatabase();
  const clock = new TestClock(2026, 9, 20, 12);
  const idFactory = createTestIdFactory();
  let openCalls = 0;

  const session = new FinanceSession({
    openDatabase: async () => {
      openCalls += 1;
      return preparePocketaDatabase(database);
    },
    createService: (openedDatabase) =>
      new FinanceService(
        new FinanceEngine(openedDatabase, { now: clock.now, idFactory }),
        { now: clock.now },
      ),
    now: clock.now,
  });

  try {
    assert.equal(session.getState().status, 'loading');
    assert.equal(session.getState().service, null);

    await session.start();
    await session.start();

    assert.equal(openCalls, 1);
    assert.equal(session.getState().status, 'ready');
    assert.equal(session.getState().activeMonthKey, '2026-10');
    assert.equal(session.getState().todayDateKey, '2026-10-20');

    const version = await database.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    assert.equal(version?.user_version, 4);

    const service = session.getState().service;
    assert.ok(service);

    const wallets = await service.getWalletView();
    assert.deepEqual(
      wallets.wallets.map((wallet) => wallet.id),
      ['wallet-cash', 'wallet-gcash'],
    );

    const month = await service.getMonthView('2026-10');
    assert.equal(money(month.containers, UNALLOCATED_CONTAINER_ID), 0);
    assert.equal(money(month.containers, SAVINGS_CONTAINER_ID), 0);
    await assertBalanced(service, '2026-10-20');
  } finally {
    database.close();
  }
});

test('the session stays loading until the database opens, then becomes ready', async () => {
  const database = new NodeSqlDatabase();
  const clock = new TestClock(2026, 9, 20, 12);
  const idFactory = createTestIdFactory();

  let releaseOpen: (opened: NodeSqlDatabase) => void = () => undefined;
  const openPromise = new Promise<NodeSqlDatabase>((resolve) => {
    releaseOpen = resolve;
  });

  const session = new FinanceSession({
    openDatabase: () =>
      openPromise.then((opened) => preparePocketaDatabase(opened)),
    createService: (openedDatabase) =>
      new FinanceService(
        new FinanceEngine(openedDatabase, { now: clock.now, idFactory }),
        { now: clock.now },
      ),
    now: clock.now,
  });

  try {
    const starting = session.start();
    assert.equal(session.getState().status, 'loading');
    assert.equal(session.getState().service, null);

    releaseOpen(database);
    await starting;

    assert.equal(session.getState().status, 'ready');
    assert.ok(session.getState().service);
  } finally {
    database.close();
  }
});

test('startup errors surface through the session and retry recovers', async () => {
  const database = new NodeSqlDatabase();
  const clock = new TestClock(2026, 9, 20, 12);
  const idFactory = createTestIdFactory();
  const observed: string[] = [];
  let shouldFail = true;
  let openCalls = 0;

  const session = new FinanceSession({
    openDatabase: async () => {
      openCalls += 1;
      if (shouldFail) throw new Error('Local ledger unavailable.');
      return preparePocketaDatabase(database);
    },
    createService: (openedDatabase) =>
      new FinanceService(
        new FinanceEngine(openedDatabase, { now: clock.now, idFactory }),
        { now: clock.now },
      ),
    now: clock.now,
  });

  const unsubscribe = session.subscribe(() => {
    observed.push(session.getState().status);
  });

  try {
    await session.start();

    assert.equal(session.getState().status, 'error');
    assert.equal(session.getState().error, 'Local ledger unavailable.');
    assert.equal(session.getState().service, null);
    assert.deepEqual(observed, ['error']);

    shouldFail = false;
    session.retry();
    assert.equal(session.getState().status, 'loading');

    await waitForStatus(session, 'ready');

    assert.equal(session.getState().status, 'ready');
    assert.equal(session.getState().error, null);
    assert.ok(session.getState().service);
    assert.equal(openCalls, 2);
    assert.deepEqual(observed, ['error', 'loading', 'ready']);
  } finally {
    unsubscribe();
    database.close();
  }
});

test('income submitted through the session posts once and refreshes the view', async () => {
  const harness = await startSession();
  try {
    const revisionBefore = harness.session.getState().revision;

    const result = await harness.session.recordMoneyEntry({
      mode: 'income',
      amountMinor: 25_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
    });

    assert.ok(result.ok, result.message ?? 'Expected the action to succeed.');
    assert.equal(harness.session.getState().revision, revisionBefore + 1);

    const month = await harness.service.getMonthView('2026-10');
    assert.equal(month.summary.incomeMinor, 25_000);
    assert.equal(month.summary.expenseMinor, 0);
    assert.equal(month.summary.netSavingsMinor, 25_000);
    assert.equal(money(month.containers, UNALLOCATED_CONTAINER_ID), 25_000);
    assert.equal(month.transactions.length, 1);
    assert.equal(month.transactions[0]?.kind, 'income');

    const wallets = await harness.service.getWalletView();
    assert.equal(wallets.totalBalanceMinor, 25_000);
    assert.equal(
      wallets.wallets.find((wallet) => wallet.id === 'wallet-cash')
        ?.balanceMinor,
      25_000,
    );

    await assertBalanced(harness.service, '2026-10-20');
  } finally {
    harness.database.close();
  }
});

test('expense submission through the session reduces wallets and containers together', async () => {
  const harness = await startSession();
  try {
    const foodId = await createContainer(harness, 'Food & drinks', 100_000);

    await harness.session.recordMoneyEntry({
      mode: 'income',
      amountMinor: 10_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: foodId,
    });

    const result = await harness.session.recordMoneyEntry({
      mode: 'expense',
      amountMinor: 6_000,
      title: 'Lunch',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: foodId,
    });
    assert.ok(result.ok, result.message ?? 'Expected the action to succeed.');

    const month = await harness.service.getMonthView('2026-10');
    assert.equal(month.summary.incomeMinor, 10_000);
    assert.equal(month.summary.expenseMinor, 6_000);
    assert.equal(month.summary.netSavingsMinor, 4_000);
    assert.equal(money(month.containers, foodId), 4_000);

    const food = month.containers.find((container) => container.id === foodId);
    assert.equal(food?.spentMinor, 6_000);
    assert.equal(food?.limitMinor, 100_000);
    assert.equal(food?.remainingMinor, 94_000);

    const wallets = await harness.service.getWalletView();
    assert.equal(wallets.totalBalanceMinor, 4_000);
    assert.equal(
      wallets.wallets.find((wallet) => wallet.id === 'wallet-cash')
        ?.balanceMinor,
      4_000,
    );

    await assertBalanced(harness.service, '2026-10-20');
  } finally {
    harness.database.close();
  }
});

test('wallet and container transfers preserve totals without creating income', async () => {
  const harness = await startSession();
  try {
    const foodId = await createContainer(harness, 'Food & drinks', 100_000);

    await harness.session.recordMoneyEntry({
      mode: 'income',
      amountMinor: 10_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
    });

    const walletTransfer = await harness.session.recordMoneyEntry({
      mode: 'wallet_transfer',
      amountMinor: 4_000,
      title: 'Move to GCash',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      destinationWalletId: 'wallet-gcash',
    });
    assert.ok(walletTransfer.ok, walletTransfer.message ?? 'Expected the action to succeed.');

    const containerTransfer = await harness.session.recordMoneyEntry({
      mode: 'container_transfer',
      amountMinor: 3_000,
      title: 'Allocate to food',
      effectiveDate: '2026-10-20',
      containerId: UNALLOCATED_CONTAINER_ID,
      destinationContainerId: foodId,
    });
    assert.ok(containerTransfer.ok, containerTransfer.message ?? 'Expected the action to succeed.');

    const wallets = await harness.service.getWalletView();
    assert.equal(wallets.totalBalanceMinor, 10_000);
    assert.equal(
      wallets.wallets.find((wallet) => wallet.id === 'wallet-cash')
        ?.balanceMinor,
      6_000,
    );
    assert.equal(
      wallets.wallets.find((wallet) => wallet.id === 'wallet-gcash')
        ?.balanceMinor,
      4_000,
    );

    const month = await harness.service.getMonthView('2026-10');
    assert.equal(month.summary.incomeMinor, 10_000);
    assert.equal(month.summary.expenseMinor, 0);
    assert.equal(month.summary.netSavingsMinor, 10_000);
    assert.equal(money(month.containers, UNALLOCATED_CONTAINER_ID), 7_000);
    assert.equal(money(month.containers, foodId), 3_000);
    assert.equal(containerTotal(month), 10_000);

    const kinds = month.transactions.map((transaction) => transaction.kind);
    assert.ok(kinds.includes('wallet_transfer'));
    assert.ok(kinds.includes('container_transfer'));

    await assertBalanced(harness.service, '2026-10-20');
  } finally {
    harness.database.close();
  }
});

test('Savings contributions and withdrawals move money without affecting net savings', async () => {
  const harness = await startSession();
  try {
    const foodId = await createContainer(harness, 'Food & drinks');

    await harness.session.recordMoneyEntry({
      mode: 'income',
      amountMinor: 10_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
    });
    await harness.session.recordMoneyEntry({
      mode: 'container_transfer',
      amountMinor: 4_000,
      title: 'Allocate to food',
      effectiveDate: '2026-10-20',
      containerId: UNALLOCATED_CONTAINER_ID,
      destinationContainerId: foodId,
    });

    const contribution = await harness.session.recordMoneyEntry({
      mode: 'container_transfer',
      amountMinor: 2_500,
      title: 'Save for emergencies',
      effectiveDate: '2026-10-20',
      containerId: foodId,
      destinationContainerId: SAVINGS_CONTAINER_ID,
    });
    assert.ok(contribution.ok, contribution.message ?? 'Expected the action to succeed.');

    const withdrawal = await harness.session.recordMoneyEntry({
      mode: 'container_transfer',
      amountMinor: 1_000,
      title: 'Pull back from savings',
      effectiveDate: '2026-10-20',
      containerId: SAVINGS_CONTAINER_ID,
      destinationContainerId: foodId,
    });
    assert.ok(withdrawal.ok, withdrawal.message ?? 'Expected the action to succeed.');

    const month = await harness.service.getMonthView('2026-10');
    assert.equal(month.summary.incomeMinor, 10_000);
    assert.equal(month.summary.expenseMinor, 0);
    assert.equal(month.summary.netSavingsMinor, 10_000);
    assert.equal(month.summary.savingsContributionsMinor, 2_500);
    assert.equal(month.summary.savingsWithdrawalsMinor, 1_000);
    assert.equal(month.summary.systemSavingsEndingBalanceMinor, 1_500);
    assert.equal(money(month.containers, SAVINGS_CONTAINER_ID), 1_500);
    assert.equal(money(month.containers, foodId), 2_500);
    assert.equal(money(month.containers, UNALLOCATED_CONTAINER_ID), 6_000);
    assert.equal(containerTotal(month), 10_000);

    await assertBalanced(harness.service, '2026-10-20');
  } finally {
    harness.database.close();
  }
});

test('container lifecycle keeps balances and blocks unsafe deletion', async () => {
  const harness = await startSession();
  try {
    const containerId = await createContainer(harness, 'School', 5_000);

    await harness.session.recordMoneyEntry({
      mode: 'income',
      amountMinor: 8_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId,
    });

    const update = await harness.session.updateContainer({
      id: containerId,
      name: 'School supplies',
      description: 'Books and materials',
      icon: 'book-outline',
      tone: 'blue',
      limitMinor: 7_000,
      monthKey: '2026-10',
    });
    assert.ok(update.ok, update.message ?? 'Expected the action to succeed.');

    const updated = await harness.service.getMonthView('2026-10');
    const updatedContainer = updated.containers.find(
      (container) => container.id === containerId,
    );
    assert.equal(updatedContainer?.name, 'School supplies');
    assert.equal(updatedContainer?.limitMinor, 7_000);
    assert.equal(updatedContainer?.balanceMinor, 8_000);

    const archived = await harness.session.archiveContainer(containerId);
    assert.ok(archived.ok, archived.message ?? 'Expected the action to succeed.');

    const afterArchive = await harness.service.getMonthView('2026-10');
    const archivedResult = afterArchive.results.find(
      (container) => container.containerId === containerId,
    );
    assert.equal(archivedResult?.status, 'archived');
    assert.equal(money(afterArchive.containers, containerId), 8_000);

    const blockedDelete = await harness.session.deleteContainer(containerId);
    assert.equal(blockedDelete.ok, false);
    assert.match(blockedDelete.message ?? '', /balance|history|transfer/i);

    const reactivated = await harness.session.reactivateContainer(containerId);
    assert.ok(reactivated.ok, reactivated.message ?? 'Expected the action to succeed.');
    const afterReactivate = await harness.service.getMonthView('2026-10');
    assert.equal(
      afterReactivate.containers.find(
        (container) => container.id === containerId,
      )?.status,
      'active',
    );

    const unusedName = 'Temporary';
    const unusedId = await createContainer(harness, unusedName);
    const deleted = await harness.session.deleteContainer(unusedId);
    assert.ok(deleted.ok, deleted.message ?? 'Expected the action to succeed.');

    const tombstone = await harness.database.getFirstAsync<{
      deleted_at: string | null;
    }>('SELECT deleted_at FROM containers WHERE id = ?', [unusedId]);
    assert.ok(tombstone?.deleted_at);

    await assertBalanced(harness.service, '2026-10-20');
  } finally {
    harness.database.close();
  }
});

test('duplicate submissions are idempotent and conflicting retries are rejected', async () => {
  const harness = await startSession();
  try {
    const input = {
      mode: 'income' as const,
      amountMinor: 5_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      idempotencyKey: 'integration-income-1',
    };

    const first = await harness.session.recordMoneyEntry(input);
    const retry = await harness.session.recordMoneyEntry(input);
    assert.ok(first.ok, first.message ?? 'Expected the action to succeed.');
    assert.ok(retry.ok, retry.message ?? 'Expected the action to succeed.');

    const afterRetry = await harness.service.getMonthView('2026-10');
    assert.equal(afterRetry.summary.incomeMinor, 5_000);
    assert.equal(afterRetry.transactions.length, 1);

    const conflicting = await harness.session.recordMoneyEntry({
      ...input,
      amountMinor: 9_000,
    });
    assert.equal(conflicting.ok, false);

    const afterConflict = await harness.service.getMonthView('2026-10');
    assert.equal(afterConflict.summary.incomeMinor, 5_000);
    assert.equal(afterConflict.transactions.length, 1);

    await assertBalanced(harness.service, '2026-10-20');
  } finally {
    harness.database.close();
  }
});

test('screen queries refresh from the session revision after a transaction', async () => {
  const harness = await startSession();
  try {
    const before = await harness.service.getMonthView('2026-10');
    assert.equal(before.summary.incomeMinor, 0);

    let notifications = 0;
    const unsubscribe = harness.session.subscribe(() => {
      notifications += 1;
    });

    try {
      const result = await harness.session.recordMoneyEntry({
        mode: 'income',
        amountMinor: 7_500,
        title: 'Allowance',
        effectiveDate: '2026-10-20',
        walletId: 'wallet-cash',
      });
      assert.ok(result.ok, result.message ?? 'Expected the action to succeed.');
    } finally {
      unsubscribe();
    }

    assert.ok(notifications >= 1);
    assert.equal(harness.session.getState().revision, 1);

    const after = await harness.service.getMonthView('2026-10');
    assert.equal(after.summary.incomeMinor, 7_500);
    assert.equal(money(after.containers, UNALLOCATED_CONTAINER_ID), 7_500);

    assert.equal(harness.session.refreshDate(), false);
    assert.equal(harness.session.getState().revision, 1);

    harness.clock.set(2026, 10, 1);
    assert.equal(harness.session.refreshDate(), true);
    assert.equal(harness.session.getState().revision, 2);
    assert.equal(harness.session.getState().activeMonthKey, '2026-11');
  } finally {
    harness.database.close();
  }
});

test('monthly rollover integration sweeps ordinary containers but preserves Savings', async () => {
  const harness = await startSession();
  try {
    const foodId = await createContainer(harness, 'Food & drinks');

    await harness.session.recordMoneyEntry({
      mode: 'income',
      amountMinor: 10_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
    });
    await harness.session.recordMoneyEntry({
      mode: 'container_transfer',
      amountMinor: 6_000,
      title: 'Allocate to food',
      effectiveDate: '2026-10-20',
      containerId: UNALLOCATED_CONTAINER_ID,
      destinationContainerId: foodId,
    });
    await harness.session.recordMoneyEntry({
      mode: 'container_transfer',
      amountMinor: 2_000,
      title: 'Save for emergencies',
      effectiveDate: '2026-10-20',
      containerId: UNALLOCATED_CONTAINER_ID,
      destinationContainerId: SAVINGS_CONTAINER_ID,
    });

    const october = await harness.service.getMonthView('2026-10');
    assert.equal(money(october.containers, foodId), 6_000);
    assert.equal(money(october.containers, UNALLOCATED_CONTAINER_ID), 2_000);
    assert.equal(money(october.containers, SAVINGS_CONTAINER_ID), 2_000);

    harness.clock.set(2026, 10, 1);
    assert.equal(harness.session.refreshDate(), true);

    const november = await harness.service.getMonthView('2026-11');
    assert.equal(money(november.containers, foodId), 0);
    assert.equal(money(november.containers, UNALLOCATED_CONTAINER_ID), 8_000);
    assert.equal(money(november.containers, SAVINGS_CONTAINER_ID), 2_000);
    assert.equal(november.summary.incomeMinor, 0);
    assert.equal(november.summary.expenseMinor, 0);
    assert.equal(november.summary.netSavingsMinor, 0);

    const wallets = await harness.service.getWalletView();
    assert.equal(wallets.totalBalanceMinor, 10_000);

    const octoberHistory = await harness.service.getHistoryView('2026-10');
    assert.equal(octoberHistory.rollover?.sweptTotalMinor, 6_000);
    assert.equal(octoberHistory.rollover?.sweptTransactionCount, 1);

    await assertBalanced(harness.service, '2026-11-01');
  } finally {
    harness.database.close();
  }
});

test('historical reporting keeps closed-month results and comparison intact', async () => {
  const harness = await startSession();
  try {
    const foodId = await createContainer(harness, 'Food & drinks');

    await harness.session.recordMoneyEntry({
      mode: 'income',
      amountMinor: 12_000,
      title: 'Allowance',
      effectiveDate: '2026-10-05',
      walletId: 'wallet-cash',
      containerId: foodId,
    });
    await harness.session.recordMoneyEntry({
      mode: 'expense',
      amountMinor: 4_000,
      title: 'Lunch',
      effectiveDate: '2026-10-06',
      walletId: 'wallet-cash',
      containerId: foodId,
    });
    await harness.session.recordMoneyEntry({
      mode: 'container_transfer',
      amountMinor: 2_000,
      title: 'Allocate to savings',
      effectiveDate: '2026-10-07',
      containerId: foodId,
      destinationContainerId: SAVINGS_CONTAINER_ID,
    });

    harness.clock.set(2026, 10, 1);
    harness.session.refreshDate();

    const history = await harness.service.getHistoryView('2026-10');
    assert.equal(history.summary.monthKey, '2026-10');
    assert.equal(history.summary.incomeMinor, 12_000);
    assert.equal(history.summary.expenseMinor, 4_000);
    assert.equal(history.summary.netSavingsMinor, 8_000);
    assert.equal(history.summary.savingsContributionsMinor, 2_000);
    assert.equal(history.summary.systemSavingsEndingBalanceMinor, 2_000);
    assert.equal(history.previous.monthKey, '2026-09');
    assert.equal(history.previous.incomeMinor, 0);
    assert.equal(history.transactions.length, 3);
    assert.ok(history.availableMonths.includes('2026-10'));
    assert.equal(history.rollover?.sweptTotalMinor, 6_000);

    const november = await harness.service.getMonthView('2026-11');
    assert.equal(money(november.containers, foodId), 0);
    assert.equal(money(november.containers, UNALLOCATED_CONTAINER_ID), 6_000);
    assert.equal(money(november.containers, SAVINGS_CONTAINER_ID), 2_000);
    assert.equal(november.summary.incomeMinor, 0);
    assert.equal(november.summary.netSavingsMinor, 0);

    await assertBalanced(harness.service, '2026-11-01');
  } finally {
    harness.database.close();
  }
});

test('file-backed data and idempotency survive a session restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pocketa-integration-'));
  const databasePath = join(directory, 'pocketa.db');
  const clock = new TestClock(2026, 9, 20, 12);

  try {
    const first = await startSession({ path: databasePath, clock });
    let transactionId = '';
    try {
      const result = await first.session.recordMoneyEntry({
        mode: 'income',
        amountMinor: 7_000,
        title: 'Allowance',
        effectiveDate: '2026-10-20',
        walletId: 'wallet-cash',
        idempotencyKey: 'restart-income-1',
      });
      assert.ok(result.ok, result.message ?? 'Expected the action to succeed.');
      const view = await first.service.getMonthView('2026-10');
      transactionId = view.transactions[0]?.id ?? '';
      assert.ok(transactionId);
    } finally {
      first.database.close();
    }

    const second = await startSession({ path: databasePath, clock });
    try {
      assert.equal(second.openDatabaseCalls(), 1);

      const wallets = await second.service.getWalletView();
      assert.equal(wallets.totalBalanceMinor, 7_000);

      const month = await second.service.getMonthView('2026-10');
      assert.equal(month.summary.incomeMinor, 7_000);
      assert.equal(month.transactions.length, 1);
      assert.equal(month.transactions[0]?.id, transactionId);
      assert.equal(money(month.containers, UNALLOCATED_CONTAINER_ID), 7_000);

      const retry = await second.session.recordMoneyEntry({
        mode: 'income',
        amountMinor: 7_000,
        title: 'Allowance',
        effectiveDate: '2026-10-20',
        walletId: 'wallet-cash',
        idempotencyKey: 'restart-income-1',
      });
      assert.ok(retry.ok, retry.message ?? 'Expected the action to succeed.');

      const afterRetry = await second.service.getMonthView('2026-10');
      assert.equal(afterRetry.summary.incomeMinor, 7_000);
      assert.equal(afterRetry.transactions.length, 1);

      await assertBalanced(second.service, '2026-10-20');
    } finally {
      second.database.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
