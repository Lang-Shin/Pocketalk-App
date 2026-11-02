import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type {
  AssistantContext,
  AssistantProposal,
} from '../src/ai/localAssistant';
import {
  createAssistantProvider,
  type AssistantProvider,
} from '../src/ai/providers';
import { executeConfirmedAssistantProposal } from '../src/application/assistantExecution';
import {
  claimExecution,
  createPendingConfirmation,
  releaseExecution,
} from '../src/features/assistant/confirmationState';
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
import {
  FinanceService,
  type MoneyEntryInput,
  type MonthView,
  type WalletView,
} from '../src/data/financeService';
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

function toAssistantContext(
  month: MonthView,
  wallets: WalletView,
  todayDateKey: string,
): AssistantContext {
  return {
    todayDateKey,
    activeMonthKey: month.monthKey,
    wallets: wallets.wallets.map((wallet) => ({
      id: wallet.id,
      name: wallet.name,
      kind: wallet.kind,
      balanceMinor: wallet.balanceMinor,
    })),
    containers: month.containers.map((container) => ({
      id: container.id,
      name: container.name,
      status: container.status,
      systemKey: container.systemKey,
      balanceMinor: container.balanceMinor,
      limitMinor: container.limitMinor,
      spentMinor: container.spentMinor,
      remainingMinor: container.remainingMinor,
    })),
    summary: {
      monthKey: month.summary.monthKey,
      incomeMinor: month.summary.incomeMinor,
      expenseMinor: month.summary.expenseMinor,
      netSavingsMinor: month.summary.netSavingsMinor,
      totalLimitMinor: month.summary.totalLimitMinor,
      totalSpentMinor: month.summary.totalSpentMinor,
      totalRemainingMinor: month.summary.totalRemainingMinor,
      savingsContributionsMinor: month.summary.savingsContributionsMinor,
      savingsWithdrawalsMinor: month.summary.savingsWithdrawalsMinor,
      savingsEndingBalanceMinor: month.summary.savingsEndingBalanceMinor,
      unallocatedEndingBalanceMinor:
        month.summary.unallocatedEndingBalanceMinor,
    },
  };
}

async function runConfirmedAssistantText(
  harness: IntegrationHarness,
  provider: AssistantProvider,
  text: string,
): Promise<{ proposal: AssistantProposal; transactionId: string }> {
  const month = await harness.service.getMonthView(
    harness.session.getState().activeMonthKey,
  );
  const wallets = await harness.service.getWalletView();
  const context = toAssistantContext(
    month,
    wallets,
    harness.session.getState().todayDateKey,
  );
  const interpretation = await provider.interpret(text, context);
  if (interpretation.kind !== 'proposal') {
    throw new Error(
      `Expected a proposal, received ${interpretation.kind}: ${interpretation.message}`,
    );
  }

  const pending = createPendingConfirmation({
    id: `assistant-e2e-${interpretation.proposal.id}`,
    proposal: interpretation.proposal,
  });
  if (!pending) throw new Error('Expected a pending confirmation.');

  const activeExecutions = new Set<string>();
  assert.equal(
    claimExecution(activeExecutions, pending.proposal.id),
    true,
  );
  try {
    const execution = await executeConfirmedAssistantProposal(
      {
        proposal: pending.proposal,
        context,
        confirmed: true,
      },
      {
        executeMoneyEntry: (input: MoneyEntryInput) =>
          harness.session.executeMoneyEntry(input),
      },
    );
    if (!execution.ok) throw new Error(execution.message);
    return {
      proposal: pending.proposal,
      transactionId: execution.transactionId,
    };
  } finally {
    releaseExecution(activeExecutions, pending.proposal.id);
  }
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

test('session execution returns transaction IDs and refreshes the revision', async () => {
  const harness = await startSession();
  try {
    const foodId = await createContainer(harness, 'Food & drinks', 100_000);
    const revision = harness.session.getState().revision;

    const income = await harness.session.executeMoneyEntry({
      mode: 'income',
      amountMinor: 10_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: foodId,
      idempotencyKey: 'assistant:income-1',
    });
    assert.ok(income.ok, income.ok ? '' : income.message);
    if (!income.ok) return;
    assert.ok(income.transactionId);
    assert.equal(harness.session.getState().revision, revision + 1);

    const expense = await harness.session.executeMoneyEntry({
      mode: 'expense',
      amountMinor: 2_500,
      title: 'Lunch',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: foodId,
      idempotencyKey: 'assistant:expense-1',
    });
    assert.ok(expense.ok, expense.ok ? '' : expense.message);
    if (!expense.ok) return;
    assert.ok(expense.transactionId);
    assert.notEqual(expense.transactionId, income.transactionId);
    assert.equal(harness.session.getState().revision, revision + 2);

    const month = await harness.service.getMonthView('2026-10');
    assert.equal(month.summary.incomeMinor, 10_000);
    assert.equal(month.summary.expenseMinor, 2_500);
    await assertBalanced(harness.service, '2026-10-20');
  } finally {
    harness.database.close();
  }
});

test('failed session execution does not refresh the revision', async () => {
  const harness = await startSession();
  try {
    const revision = harness.session.getState().revision;

    const failed = await harness.session.executeMoneyEntry({
      mode: 'expense',
      amountMinor: 2_500,
      title: 'Lunch',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: 'container-missing',
      idempotencyKey: 'assistant:failed-expense',
    });

    assert.equal(failed.ok, false);
    assert.equal(harness.session.getState().revision, revision);
  } finally {
    harness.database.close();
  }
});

test('unconfirmed assistant execution produces no write or revision change', async () => {
  const harness = await startSession();
  try {
    const foodId = await createContainer(harness, 'Food & drinks', 100_000);
    const month = await harness.service.getMonthView('2026-10');
    const wallets = await harness.service.getWalletView();
    const context = toAssistantContext(
      month,
      wallets,
      harness.session.getState().todayDateKey,
    );
    const revision = harness.session.getState().revision;
    const proposal: AssistantProposal = {
      id: 'assistant-unconfirmed-1',
      action: 'income',
      title: 'Allowance',
      amountMinor: 10_000,
      effectiveDate: '2026-10-20',
      monthKey: '2026-10',
      walletId: 'wallet-cash',
      destinationContainerId: foodId,
    };
    const executor = {
      executeMoneyEntry: (input: MoneyEntryInput) =>
        harness.session.executeMoneyEntry(input),
    };

    const result = await executeConfirmedAssistantProposal(
      { proposal, context, confirmed: false },
      executor,
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /confirmation/i);
    assert.equal(harness.session.getState().revision, revision);

    const after = await harness.service.getMonthView('2026-10');
    const afterWallets = await harness.service.getWalletView();
    assert.equal(after.summary.incomeMinor, 0);
    assert.equal(after.transactions.length, 0);
    assert.equal(afterWallets.totalBalanceMinor, 0);
    await assertBalanced(harness.service, '2026-10-20');
  } finally {
    harness.database.close();
  }
});

test('stale assistant proposal fails without writing when the balance changed', async () => {
  const harness = await startSession();
  try {
    const foodId = await createContainer(harness, 'Food & drinks', 100_000);
    const fund = await harness.session.executeMoneyEntry({
      mode: 'income',
      amountMinor: 10_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: foodId,
      idempotencyKey: 'assistant:stale-fund',
    });
    assert.ok(fund.ok);

    const staleMonth = await harness.service.getMonthView('2026-10');
    const staleWallets = await harness.service.getWalletView();
    const staleContext = toAssistantContext(
      staleMonth,
      staleWallets,
      harness.session.getState().todayDateKey,
    );

    const spend = await harness.session.executeMoneyEntry({
      mode: 'expense',
      amountMinor: 9_500,
      title: 'Books',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: foodId,
      idempotencyKey: 'assistant:stale-spend',
    });
    assert.ok(spend.ok);

    const proposal: AssistantProposal = {
      id: 'assistant-stale-balance',
      action: 'expense',
      title: 'Lunch',
      amountMinor: 5_000,
      effectiveDate: '2026-10-20',
      monthKey: '2026-10',
      walletId: 'wallet-cash',
      containerId: foodId,
    };
    const executor = {
      executeMoneyEntry: (input: MoneyEntryInput) =>
        harness.session.executeMoneyEntry(input),
    };
    const revision = harness.session.getState().revision;
    const before = await harness.service.getMonthView('2026-10');

    const result = await executeConfirmedAssistantProposal(
      { proposal, context: staleContext, confirmed: true },
      executor,
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /enough money/i);
    assert.equal(harness.session.getState().revision, revision);

    const after = await harness.service.getMonthView('2026-10');
    assert.equal(after.summary.expenseMinor, 9_500);
    assert.equal(after.transactions.length, before.transactions.length);
    assert.equal(money(after.containers, foodId), 500);
    await assertBalanced(harness.service, '2026-10-20');
  } finally {
    harness.database.close();
  }
});

test('stale assistant proposal fails without writing when its container was archived', async () => {
  const harness = await startSession();
  try {
    const foodId = await createContainer(harness, 'Food & drinks', 100_000);
    const fund = await harness.session.executeMoneyEntry({
      mode: 'income',
      amountMinor: 10_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: foodId,
      idempotencyKey: 'assistant:archived-fund',
    });
    assert.ok(fund.ok);

    const proposal: AssistantProposal = {
      id: 'assistant-stale-archive',
      action: 'expense',
      title: 'Lunch',
      amountMinor: 2_500,
      effectiveDate: '2026-10-20',
      monthKey: '2026-10',
      walletId: 'wallet-cash',
      containerId: foodId,
    };

    const archived = await harness.session.archiveContainer(foodId);
    assert.ok(archived.ok);

    const month = await harness.service.getMonthView('2026-10');
    const wallets = await harness.service.getWalletView();
    const context = toAssistantContext(
      month,
      wallets,
      harness.session.getState().todayDateKey,
    );
    const executor = {
      executeMoneyEntry: (input: MoneyEntryInput) =>
        harness.session.executeMoneyEntry(input),
    };
    const revision = harness.session.getState().revision;
    const before = await harness.service.getMonthView('2026-10');

    const result = await executeConfirmedAssistantProposal(
      { proposal, context, confirmed: true },
      executor,
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /archived/i);
    assert.equal(harness.session.getState().revision, revision);

    const after = await harness.service.getMonthView('2026-10');
    assert.equal(after.summary.expenseMinor, 0);
    assert.equal(after.transactions.length, before.transactions.length);
    await assertBalanced(harness.service, '2026-10-20');
  } finally {
    harness.database.close();
  }
});

test('confirmed assistant execution increments revision and refreshes finance views', async () => {
  const harness = await startSession();
  let unsubscribe = () => {};
  try {
    const foodId = await createContainer(harness, 'Food & drinks', 100_000);
    const income = await harness.session.executeMoneyEntry({
      mode: 'income',
      amountMinor: 10_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: foodId,
      idempotencyKey: 'assistant:fund-food-success',
    });
    assert.ok(income.ok);

    const month = await harness.service.getMonthView('2026-10');
    const wallets = await harness.service.getWalletView();
    const context = toAssistantContext(
      month,
      wallets,
      harness.session.getState().todayDateKey,
    );
    const proposal: AssistantProposal = {
      id: 'assistant-success-1',
      action: 'expense',
      title: 'Lunch',
      amountMinor: 2_500,
      effectiveDate: '2026-10-20',
      monthKey: '2026-10',
      walletId: 'wallet-cash',
      containerId: foodId,
    };
    const executor = {
      executeMoneyEntry: (input: MoneyEntryInput) =>
        harness.session.executeMoneyEntry(input),
    };
    const revision = harness.session.getState().revision;
    let notifications = 0;
    unsubscribe = harness.session.subscribe(() => {
      notifications += 1;
    });

    const result = await executeConfirmedAssistantProposal(
      { proposal, context, confirmed: true },
      executor,
    );

    assert.ok(result.ok, result.ok ? '' : result.message);
    if (!result.ok) return;
    assert.ok(result.transactionId);
    assert.equal(harness.session.getState().revision, revision + 1);
    assert.ok(notifications > 0);

    const after = await harness.service.getMonthView('2026-10');
    const afterWallets = await harness.service.getWalletView();
    const history = await harness.service.getHistoryView('2026-10');
    assert.equal(after.summary.expenseMinor, 2_500);
    assert.equal(money(after.containers, foodId), 7_500);
    assert.equal(afterWallets.totalBalanceMinor, 7_500);
    assert.ok(
      history.transactions.some(
        (transaction) => transaction.id === result.transactionId,
      ),
    );
    assert.ok(
      after.transactions.some(
        (transaction) => transaction.id === result.transactionId,
      ),
    );
    await assertBalanced(harness.service, '2026-10-20');
  } finally {
    unsubscribe();
    harness.database.close();
  }
});

test('end-to-end confirmed assistant expense posts one transaction and updates History', async () => {
  const harness = await startSession();
  try {
    const allowanceId = await createContainer(harness, 'Allowance', 100_000);
    const funding = await harness.session.executeMoneyEntry({
      mode: 'income',
      amountMinor: 100_000,
      title: 'Allowance funding',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-gcash',
      containerId: allowanceId,
      idempotencyKey: 'e2e-allowance-funding',
    });
    assert.ok(funding.ok, funding.ok ? '' : funding.message);

    const draftMonth = await harness.service.getMonthView('2026-10');
    const wallets = await harness.service.getWalletView();
    const context = toAssistantContext(
      draftMonth,
      wallets,
      harness.session.getState().todayDateKey,
    );
    const revision = harness.session.getState().revision;
    const provider = createAssistantProvider();

    const interpretation = await provider.interpret(
      'I spend \u20B1300 on lunch.',
      context,
    );
    assert.equal(interpretation.kind, 'proposal');
    if (interpretation.kind !== 'proposal') return;

    const { proposal } = interpretation;
    assert.equal(proposal.action, 'expense');
    assert.equal(proposal.amountMinor, 30_000);
    assert.equal(proposal.containerId, allowanceId);
    assert.equal(proposal.walletId, 'wallet-gcash');
    assert.equal(harness.session.getState().revision, revision);

    const afterInterpretation = await harness.service.getMonthView('2026-10');
    assert.equal(afterInterpretation.summary.expenseMinor, 0);
    assert.equal(
      afterInterpretation.transactions.filter(
        (transaction) => transaction.kind === 'expense',
      ).length,
      0,
    );
    assert.equal(money(afterInterpretation.containers, allowanceId), 100_000);

    const pending = createPendingConfirmation({
      id: 'e2e-assistant-message',
      proposal,
    });
    assert.ok(pending);
    if (!pending) return;

    const executor = {
      executeMoneyEntry: (input: MoneyEntryInput) =>
        harness.session.executeMoneyEntry(input),
    };
    const activeExecutions = new Set<string>();
    assert.equal(
      claimExecution(activeExecutions, pending.proposal.id),
      true,
    );
    const execution = await executeConfirmedAssistantProposal(
      {
        proposal: pending.proposal,
        context,
        confirmed: true,
      },
      executor,
    );
    releaseExecution(activeExecutions, pending.proposal.id);

    assert.ok(execution.ok, execution.ok ? '' : execution.message);
    if (!execution.ok) return;
    assert.ok(execution.transactionId);
    assert.equal(harness.session.getState().revision, revision + 1);

    const after = await harness.service.getMonthView('2026-10');
    const afterWallets = await harness.service.getWalletView();
    const history = await harness.service.getHistoryView('2026-10');
    assert.equal(after.summary.expenseMinor, 30_000);
    assert.equal(money(after.containers, allowanceId), 70_000);
    assert.equal(
      afterWallets.wallets.find((wallet) => wallet.id === 'wallet-gcash')
        ?.balanceMinor,
      70_000,
    );
    assert.equal(afterWallets.totalBalanceMinor, 70_000);

    const expenses = history.transactions.filter(
      (transaction) => transaction.kind === 'expense',
    );
    assert.equal(expenses.length, 1);
    const [expense] = expenses;
    assert.ok(expense);
    assert.equal(expense.amountMinor, 30_000);
    assert.equal(expense.id, execution.transactionId);
    assert.equal(history.summary.expenseMinor, 30_000);
    await assertBalanced(harness.service, '2026-10-20');
  } finally {
    harness.database.close();
  }
});

test('assistant execution supports income, transfers, and Savings without inflating net savings', async () => {
  const harness = await startSession();
  try {
    const foodId = await createContainer(harness, 'Food & drinks', 100_000);
    const transportId = await createContainer(harness, 'Transport', 100_000);
    const provider = createAssistantProvider();

    const foodSeed = await harness.session.executeMoneyEntry({
      mode: 'income',
      amountMinor: 100_000,
      title: 'Food funding',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: foodId,
      idempotencyKey: 'e2e-multi-food',
    });
    assert.ok(foodSeed.ok);
    const transportSeed = await harness.session.executeMoneyEntry({
      mode: 'income',
      amountMinor: 100_000,
      title: 'Transport funding',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-gcash',
      containerId: transportId,
      idempotencyKey: 'e2e-multi-transport',
    });
    assert.ok(transportSeed.ok);

    const income = await runConfirmedAssistantText(
      harness,
      provider,
      'Received \u20B1500 allowance',
    );
    assert.equal(income.proposal.action, 'income');
    assert.equal(income.proposal.amountMinor, 50_000);
    assert.equal(
      income.proposal.destinationContainerId,
      UNALLOCATED_CONTAINER_ID,
    );
    const afterIncome = await harness.service.getMonthView('2026-10');
    assert.equal(afterIncome.summary.incomeMinor, 250_000);
    assert.equal(afterIncome.summary.expenseMinor, 0);
    assert.equal(afterIncome.summary.netSavingsMinor, 250_000);

    const assertInternalTransferIsNeutral = async (
      text: string,
      expectedAction: AssistantProposal['action'],
    ): Promise<{ transactionId: string }> => {
      const before = await harness.service.getMonthView('2026-10');
      const result = await runConfirmedAssistantText(harness, provider, text);
      const after = await harness.service.getMonthView('2026-10');

      assert.equal(result.proposal.action, expectedAction);
      assert.equal(after.summary.incomeMinor, before.summary.incomeMinor);
      assert.equal(after.summary.expenseMinor, before.summary.expenseMinor);
      assert.equal(
        after.summary.netSavingsMinor,
        before.summary.netSavingsMinor,
      );
      assert.ok(
        after.transactions.some(
          (transaction) => transaction.id === result.transactionId,
        ),
      );
      return { transactionId: result.transactionId };
    };

    const walletTransfer = await assertInternalTransferIsNeutral(
      'Transfer \u20B1100 from Cash to GCash',
      'wallet_transfer',
    );
    const containerTransfer = await assertInternalTransferIsNeutral(
      'Move \u20B1100 from Food & drinks to Transport',
      'container_transfer',
    );
    const savingsContribution = await assertInternalTransferIsNeutral(
      'Move \u20B1300 from Food & drinks to savings',
      'savings_contribution',
    );
    const savingsWithdrawal = await assertInternalTransferIsNeutral(
      'Withdraw \u20B1100 from savings to Transport',
      'savings_withdrawal',
    );

    const finalMonth = await harness.service.getMonthView('2026-10');
    const finalWallets = await harness.service.getWalletView();
    const history = await harness.service.getHistoryView('2026-10');
    assert.equal(finalMonth.summary.incomeMinor, 250_000);
    assert.equal(finalMonth.summary.expenseMinor, 0);
    assert.equal(finalMonth.summary.netSavingsMinor, 250_000);
    assert.equal(finalMonth.summary.savingsContributionsMinor, 30_000);
    assert.equal(finalMonth.summary.savingsWithdrawalsMinor, 10_000);
    assert.equal(finalMonth.summary.savingsEndingBalanceMinor, 20_000);
    assert.equal(money(finalMonth.containers, foodId), 60_000);
    assert.equal(money(finalMonth.containers, transportId), 120_000);
    assert.equal(money(finalMonth.containers, SAVINGS_CONTAINER_ID), 20_000);
    assert.equal(
      money(finalMonth.containers, UNALLOCATED_CONTAINER_ID),
      50_000,
    );
    assert.equal(
      finalWallets.wallets.find((wallet) => wallet.id === 'wallet-cash')
        ?.balanceMinor,
      90_000,
    );
    assert.equal(
      finalWallets.wallets.find((wallet) => wallet.id === 'wallet-gcash')
        ?.balanceMinor,
      160_000,
    );
    assert.equal(finalWallets.totalBalanceMinor, 250_000);

    assert.equal(
      history.transactions.find(
        (transaction) => transaction.id === walletTransfer.transactionId,
      )?.kind,
      'wallet_transfer',
    );
    assert.equal(
      history.transactions.find(
        (transaction) => transaction.id === containerTransfer.transactionId,
      )?.kind,
      'container_transfer',
    );
    assert.equal(
      history.transactions.find(
        (transaction) => transaction.id === savingsContribution.transactionId,
      )?.kind,
      'savings',
    );
    assert.equal(
      history.transactions.find(
        (transaction) => transaction.id === savingsWithdrawal.transactionId,
      )?.kind,
      'savings',
    );
    assert.equal(
      history.transactions.filter((transaction) => transaction.kind === 'expense')
        .length,
      0,
    );
    await assertBalanced(harness.service, '2026-10-20');
  } finally {
    harness.database.close();
  }
});

test('concurrent assistant confirmations post exactly one transaction', async () => {
  const harness = await startSession();
  try {
    const foodId = await createContainer(harness, 'Food & drinks', 100_000);
    const income = await harness.session.executeMoneyEntry({
      mode: 'income',
      amountMinor: 10_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: foodId,
      idempotencyKey: 'assistant:concurrent-fund',
    });
    assert.ok(income.ok);

    const month = await harness.service.getMonthView('2026-10');
    const wallets = await harness.service.getWalletView();
    const context = toAssistantContext(
      month,
      wallets,
      harness.session.getState().todayDateKey,
    );
    const proposal: AssistantProposal = {
      id: 'assistant-concurrent-1',
      action: 'expense',
      title: 'Lunch',
      amountMinor: 2_500,
      effectiveDate: '2026-10-20',
      monthKey: '2026-10',
      walletId: 'wallet-cash',
      containerId: foodId,
    };
    const executor = {
      executeMoneyEntry: (input: MoneyEntryInput) =>
        harness.session.executeMoneyEntry(input),
    };
    const revision = harness.session.getState().revision;

    const [first, second] = await Promise.all([
      executeConfirmedAssistantProposal(
        { proposal, context, confirmed: true },
        executor,
      ),
      executeConfirmedAssistantProposal(
        { proposal, context, confirmed: true },
        executor,
      ),
    ]);

    assert.ok(first.ok, first.ok ? '' : first.message);
    assert.ok(second.ok, second.ok ? '' : second.message);
    if (!first.ok || !second.ok) return;
    assert.equal(first.transactionId, second.transactionId);
    assert.equal(harness.session.getState().revision, revision + 1);

    const after = await harness.service.getMonthView('2026-10');
    assert.equal(
      after.transactions.filter((transaction) => transaction.kind === 'expense')
        .length,
      1,
    );
    assert.equal(after.summary.expenseMinor, 2_500);
    assert.equal(money(after.containers, foodId), 7_500);
    await assertBalanced(harness.service, '2026-10-20');
  } finally {
    harness.database.close();
  }
});

test('assistant execution reuses the transaction ID on retry without duplicating the expense', async () => {
  const harness = await startSession();
  try {
    const foodId = await createContainer(harness, 'Food & drinks', 100_000);
    const income = await harness.session.executeMoneyEntry({
      mode: 'income',
      amountMinor: 10_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: foodId,
      idempotencyKey: 'assistant:fund-food',
    });
    assert.ok(income.ok);

    const month = await harness.service.getMonthView('2026-10');
    const wallets = await harness.service.getWalletView();
    const context = toAssistantContext(
      month,
      wallets,
      harness.session.getState().todayDateKey,
    );
    const proposal: AssistantProposal = {
      id: 'assistant-integration-1',
      action: 'expense',
      title: 'Lunch',
      amountMinor: 2_500,
      effectiveDate: '2026-10-20',
      monthKey: '2026-10',
      walletId: 'wallet-cash',
      containerId: foodId,
    };
    const executor = {
      executeMoneyEntry: (input: MoneyEntryInput) =>
        harness.session.executeMoneyEntry(input),
    };

    const first = await executeConfirmedAssistantProposal(
      { proposal, context, confirmed: true },
      executor,
    );
    const retry = await executeConfirmedAssistantProposal(
      { proposal, context, confirmed: true },
      executor,
    );

    assert.ok(first.ok, first.ok ? '' : first.message);
    assert.ok(retry.ok, retry.ok ? '' : retry.message);
    if (!first.ok || !retry.ok) return;
    assert.equal(first.transactionId, retry.transactionId);

    const afterRetry = await harness.service.getMonthView('2026-10');
    const expenses = afterRetry.transactions.filter(
      (transaction) => transaction.kind === 'expense',
    );
    assert.equal(expenses.length, 1);
    assert.equal(afterRetry.summary.expenseMinor, 2_500);
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

test('assistant proposal idempotency survives coordinator reset and session restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pocketa-assistant-idempotency-'));
  const databasePath = join(directory, 'pocketa.db');
  const clock = new TestClock(2026, 9, 20, 12);
  let proposal: AssistantProposal | undefined;
  let transactionId = '';

  try {
    const first = await startSession({ path: databasePath, clock });
    try {
      const foodId = await createContainer(first, 'Food & drinks', 100_000);
      const income = await first.session.executeMoneyEntry({
        mode: 'income',
        amountMinor: 10_000,
        title: 'Allowance',
        effectiveDate: '2026-10-20',
        walletId: 'wallet-cash',
        containerId: foodId,
        idempotencyKey: 'assistant:restart-fund',
      });
      assert.ok(income.ok);

      const month = await first.service.getMonthView('2026-10');
      const wallets = await first.service.getWalletView();
      const context = toAssistantContext(
        month,
        wallets,
        first.session.getState().todayDateKey,
      );
      proposal = {
        id: 'assistant-restart-1',
        action: 'expense',
        title: 'Lunch',
        amountMinor: 2_500,
        effectiveDate: '2026-10-20',
        monthKey: '2026-10',
        walletId: 'wallet-cash',
        containerId: foodId,
      };

      const firstExecution = await executeConfirmedAssistantProposal(
        { proposal, context, confirmed: true },
        {
          executeMoneyEntry: (input: MoneyEntryInput) =>
            first.session.executeMoneyEntry(input),
        },
      );
      assert.ok(firstExecution.ok, firstExecution.ok ? '' : firstExecution.message);
      if (!firstExecution.ok) return;
      transactionId = firstExecution.transactionId;

      const remountRetry = await executeConfirmedAssistantProposal(
        { proposal, context, confirmed: true },
        {
          executeMoneyEntry: (input: MoneyEntryInput) =>
            first.session.executeMoneyEntry(input),
        },
      );
      assert.ok(remountRetry.ok, remountRetry.ok ? '' : remountRetry.message);
      if (!remountRetry.ok) return;
      assert.equal(remountRetry.transactionId, transactionId);

      const afterRemount = await first.service.getMonthView('2026-10');
      assert.equal(
        afterRemount.transactions.filter(
          (transaction) => transaction.kind === 'expense',
        ).length,
        1,
      );
    } finally {
      first.database.close();
    }

    assert.ok(proposal);
    if (!proposal) return;

    const second = await startSession({ path: databasePath, clock });
    try {
      const month = await second.service.getMonthView('2026-10');
      const wallets = await second.service.getWalletView();
      const context = toAssistantContext(
        month,
        wallets,
        second.session.getState().todayDateKey,
      );
      const restartRetry = await executeConfirmedAssistantProposal(
        { proposal, context, confirmed: true },
        {
          executeMoneyEntry: (input: MoneyEntryInput) =>
            second.session.executeMoneyEntry(input),
        },
      );
      assert.ok(restartRetry.ok, restartRetry.ok ? '' : restartRetry.message);
      if (!restartRetry.ok) return;
      assert.equal(restartRetry.transactionId, transactionId);

      const history = await second.service.getHistoryView('2026-10');
      const expenses = history.transactions.filter(
        (transaction) => transaction.kind === 'expense',
      );
      assert.equal(expenses.length, 1);
      assert.equal(expenses[0]?.id, transactionId);
      assert.equal(money(month.containers, proposal.containerId ?? ''), 7_500);
      await assertBalanced(second.service, '2026-10-20');
    } finally {
      second.database.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
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
