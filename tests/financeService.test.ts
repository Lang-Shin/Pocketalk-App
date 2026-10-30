import assert from 'node:assert/strict';
import test from 'node:test';

import { FinanceError } from '../src/db/errors';
import {
  SAVINGS_CONTAINER_ID,
  UNALLOCATED_CONTAINER_ID,
} from '../src/db/systemContainers';
import { FinanceService } from '../src/data/financeService';
import { createHarness } from './helpers/financeTestHarness';

async function setup(): Promise<{
  harness: Awaited<ReturnType<typeof createHarness>>;
  service: FinanceService;
}> {
  const harness = await createHarness(new Date(2026, 9, 20, 12));
  const service = new FinanceService(harness.engine, {
    now: harness.clock.now,
  });
  await service.initialize();
  return { harness, service };
}

function balanceOf(
  containers: { id: string; balanceMinor: number }[],
  id: string,
): number {
  return containers.find((container) => container.id === id)?.balanceMinor ?? 0;
}

test('the finance service creates default wallets only once', async () => {
  const { harness, service } = await setup();
  try {
    await service.initialize();

    const wallets = await harness.engine.listWallets();
    assert.deepEqual(
      wallets.map((wallet) => wallet.id),
      ['wallet-cash', 'wallet-gcash'],
    );
    assert.equal(service.activeMonthKey, '2026-10');
    assert.equal(service.todayDateKey, '2026-10-20');

    const walletView = await service.getWalletView();
    assert.equal(walletView.wallets.length, 2);
    assert.equal(walletView.totalBalanceMinor, 0);
    assert.equal(walletView.recentTransactions.length, 0);
  } finally {
    harness.database.close();
  }
});

test('income notes are optional and default to Unallocated', async () => {
  const { harness, service } = await setup();
  try {
    const result = await service.recordMoneyEntry({
      mode: 'income',
      amountMinor: 5_000,
      title: '   ',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
    });

    const month = await service.getMonthView('2026-10');
    const transaction = month.transactions.find(
      (candidate) => candidate.id === result.transactionId,
    );

    assert.equal(month.summary.incomeMinor, 5_000);
    assert.equal(
      balanceOf(month.containers, UNALLOCATED_CONTAINER_ID),
      5_000,
    );
    assert.equal(transaction?.title, 'Income');
    assert.equal(
      transaction?.destinationContainerId,
      UNALLOCATED_CONTAINER_ID,
    );
  } finally {
    harness.database.close();
  }
});

test('expense notes are optional and overdrafts are rejected atomically', async () => {
  const { harness, service } = await setup();
  try {
    const container = await service.createContainer({
      name: 'Food & drinks',
      description: 'Meals and snacks',
      icon: 'restaurant-outline',
      tone: 'coral',
      limitMinor: 100_000,
      monthKey: '2026-10',
    });

    await service.recordMoneyEntry({
      mode: 'income',
      amountMinor: 10_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: UNALLOCATED_CONTAINER_ID,
    });
    await service.recordMoneyEntry({
      mode: 'container_transfer',
      amountMinor: 10_000,
      title: 'Allocate to food',
      effectiveDate: '2026-10-20',
      containerId: UNALLOCATED_CONTAINER_ID,
      destinationContainerId: container.containerId,
    });

    const expense = await service.recordMoneyEntry({
      mode: 'expense',
      amountMinor: 6_000,
      title: '   ',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: container.containerId,
    });

    const month = await service.getMonthView('2026-10');
    const walletView = await service.getWalletView();
    const wallet = walletView.wallets.find(
      (candidate) => candidate.id === 'wallet-cash',
    );
    const transaction = month.transactions.find(
      (candidate) => candidate.id === expense.transactionId,
    );

    assert.equal(wallet?.balanceMinor, 4_000);
    assert.equal(balanceOf(month.containers, container.containerId), 4_000);
    assert.equal(month.summary.expenseMinor, 6_000);
    assert.equal(month.summary.netSavingsMinor, 4_000);
    assert.equal(transaction?.title, 'Expense');
    assert.equal(transaction?.sourceContainerId, container.containerId);

    await assert.rejects(
      service.recordMoneyEntry({
        mode: 'expense',
        amountMinor: 4_001,
        title: 'Overdraft',
        effectiveDate: '2026-10-20',
        walletId: 'wallet-cash',
        containerId: container.containerId,
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'INSUFFICIENT_FUNDS',
    );

    const after = await service.getMonthView('2026-10');
    assert.equal(after.summary.expenseMinor, 6_000);
    assert.equal(
      balanceOf(after.containers, container.containerId),
      4_000,
    );
    assert.equal(after.transactions.length, month.transactions.length);
  } finally {
    harness.database.close();
  }
});

test('allocation and Savings transfers do not change net savings', async () => {
  const { harness, service } = await setup();
  try {
    const container = await service.createContainer({
      name: 'Food & drinks',
      description: 'Meals and snacks',
      icon: 'restaurant-outline',
      tone: 'coral',
      limitMinor: 100_000,
      monthKey: '2026-10',
    });

    const income = await service.recordMoneyEntry({
      mode: 'income',
      amountMinor: 100_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: UNALLOCATED_CONTAINER_ID,
    });
    assert.ok(income.transactionId);

    await service.recordMoneyEntry({
      mode: 'container_transfer',
      amountMinor: 60_000,
      title: 'Allocate to food',
      effectiveDate: '2026-10-20',
      containerId: UNALLOCATED_CONTAINER_ID,
      destinationContainerId: container.containerId,
    });
    await service.recordMoneyEntry({
      mode: 'container_transfer',
      amountMinor: 20_000,
      title: 'Save for later',
      effectiveDate: '2026-10-20',
      containerId: container.containerId,
      destinationContainerId: SAVINGS_CONTAINER_ID,
    });
    await service.recordMoneyEntry({
      mode: 'container_transfer',
      amountMinor: 10_000,
      title: 'Use some savings',
      effectiveDate: '2026-10-20',
      containerId: SAVINGS_CONTAINER_ID,
      destinationContainerId: UNALLOCATED_CONTAINER_ID,
    });

    const month = await service.getMonthView('2026-10');
    assert.equal(balanceOf(month.containers, container.containerId), 40_000);
    assert.equal(balanceOf(month.containers, SAVINGS_CONTAINER_ID), 10_000);
    assert.equal(balanceOf(month.containers, UNALLOCATED_CONTAINER_ID), 50_000);
    assert.equal(month.summary.incomeMinor, 100_000);
    assert.equal(month.summary.expenseMinor, 0);
    assert.equal(month.summary.netSavingsMinor, 100_000);
    assert.equal(month.summary.savingsContributionsMinor, 20_000);
    assert.equal(month.summary.savingsWithdrawalsMinor, 10_000);
    assert.equal(month.summary.savingsEndingBalanceMinor, 10_000);
    assert.equal(month.summary.unallocatedEndingBalanceMinor, 50_000);
    assert.equal(month.summary.availableBudgetMinor, 90_000);
  } finally {
    harness.database.close();
  }
});

test('all Savings and ordinary-container transfer routes preserve the ledger', async () => {
  const { harness, service } = await setup();
  try {
    const food = await service.createContainer({
      name: 'Food & drinks',
      description: '',
      icon: 'restaurant-outline',
      tone: 'coral',
      limitMinor: 0,
      monthKey: '2026-10',
    });
    const school = await service.createContainer({
      name: 'School',
      description: '',
      icon: 'book-outline',
      tone: 'blue',
      limitMinor: 0,
      monthKey: '2026-10',
    });

    await service.recordMoneyEntry({
      mode: 'income',
      amountMinor: 100_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: UNALLOCATED_CONTAINER_ID,
    });

    const move = (
      amountMinor: number,
      containerId: string,
      destinationContainerId: string,
      idempotencyKey: string,
    ) =>
      service.recordMoneyEntry({
        mode: 'container_transfer',
        amountMinor,
        title: 'Transfer',
        effectiveDate: '2026-10-20',
        containerId,
        destinationContainerId,
        idempotencyKey,
      });

    await move(10_000, UNALLOCATED_CONTAINER_ID, SAVINGS_CONTAINER_ID, 'u-s');
    await move(2_000, SAVINGS_CONTAINER_ID, UNALLOCATED_CONTAINER_ID, 's-u');
    await move(30_000, UNALLOCATED_CONTAINER_ID, food.containerId, 'u-food');
    await move(5_000, food.containerId, school.containerId, 'food-school');
    await move(5_000, food.containerId, SAVINGS_CONTAINER_ID, 'food-s');
    await move(4_000, school.containerId, UNALLOCATED_CONTAINER_ID, 'school-u');
    const first = await move(
      3_000,
      SAVINGS_CONTAINER_ID,
      food.containerId,
      's-food',
    );
    const repeated = await move(
      3_000,
      SAVINGS_CONTAINER_ID,
      food.containerId,
      's-food',
    );

    assert.equal(first.transactionId, repeated.transactionId);

    const month = await service.getMonthView('2026-10');
    const walletView = await service.getWalletView();
    const containerTotal = month.containers.reduce(
      (total, container) => total + container.balanceMinor,
      0,
    );

    assert.equal(balanceOf(month.containers, UNALLOCATED_CONTAINER_ID), 66_000);
    assert.equal(balanceOf(month.containers, food.containerId), 23_000);
    assert.equal(balanceOf(month.containers, school.containerId), 1_000);
    assert.equal(balanceOf(month.containers, SAVINGS_CONTAINER_ID), 10_000);
    assert.equal(containerTotal, 100_000);
    assert.equal(walletView.totalBalanceMinor, 100_000);
    assert.equal(month.summary.incomeMinor, 100_000);
    assert.equal(month.summary.expenseMinor, 0);
    assert.equal(month.summary.netSavingsMinor, 100_000);
    assert.equal(month.summary.savingsContributionsMinor, 15_000);
    assert.equal(month.summary.savingsWithdrawalsMinor, 5_000);
    assert.equal(month.summary.savingsEndingBalanceMinor, 10_000);
    assert.equal(month.transactions.length, 8);
  } finally {
    harness.database.close();
  }
});

test('a repeated request with the same idempotency key is not posted twice', async () => {
  const { harness, service } = await setup();
  try {
    const input = {
      mode: 'income' as const,
      amountMinor: 25_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: UNALLOCATED_CONTAINER_ID,
      idempotencyKey: 'service-idempotent-income',
    };

    const first = await service.recordMoneyEntry(input);
    const second = await service.recordMoneyEntry(input);

    assert.equal(first.transactionId, second.transactionId);
    const month = await service.getMonthView('2026-10');
    assert.equal(month.summary.incomeMinor, 25_000);
    assert.equal(month.transactions.length, 1);
  } finally {
    harness.database.close();
  }
});

test('system containers remain unique and protected from user edits', async () => {
  const { harness, service } = await setup();
  try {
    const month = await service.getMonthView('2026-10');
    const systemContainers = month.containers.filter(
      (container) => container.systemKey != null,
    );

    assert.deepEqual(
      systemContainers
        .map((container) => `${container.id}:${container.systemKey}`)
        .sort(),
      [
        `${SAVINGS_CONTAINER_ID}:savings`,
        `${UNALLOCATED_CONTAINER_ID}:unallocated`,
      ],
    );

    await assert.rejects(
      service.updateContainer({
        id: SAVINGS_CONTAINER_ID,
        name: 'Renamed savings',
        description: '',
        icon: 'wallet-outline',
        tone: 'emerald',
        limitMinor: 10_000,
        monthKey: '2026-10',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'SYSTEM_CONTAINER',
    );
    await assert.rejects(
      service.archiveContainer(UNALLOCATED_CONTAINER_ID),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'SYSTEM_CONTAINER',
    );
    await assert.rejects(
      service.deleteContainer(SAVINGS_CONTAINER_ID),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'SYSTEM_CONTAINER',
    );
  } finally {
    harness.database.close();
  }
});

test('empty archived containers stay visible for reactivation without changing identity', async () => {
  const { harness, service } = await setup();
  try {
    const created = await service.createContainer({
      name: 'Temporary',
      description: '',
      icon: 'flag-outline',
      tone: 'violet',
      limitMinor: 0,
      monthKey: '2026-10',
    });

    await service.archiveContainer(created.containerId);

    const archivedMonth = await service.getMonthView('2026-10');
    const archived = archivedMonth.containers.find(
      (container) => container.id === created.containerId,
    );
    assert.equal(archived?.status, 'archived');
    assert.equal(archived?.balanceMinor, 0);
    assert.equal(archived?.limitMinor, 0);

    await service.reactivateContainer(created.containerId);

    const reactivatedMonth = await service.getMonthView('2026-10');
    const reactivated = reactivatedMonth.containers.find(
      (container) => container.id === created.containerId,
    );
    assert.equal(reactivated?.id, created.containerId);
    assert.equal(reactivated?.status, 'active');
    assert.equal(reactivated?.createdMonthKey, '2026-10');
  } finally {
    harness.database.close();
  }
});

test('container settings update metadata and the current monthly limit', async () => {
  const { harness, service } = await setup();
  try {
    const created = await service.createContainer({
      name: 'School',
      description: '',
      icon: 'book-outline',
      tone: 'blue',
      limitMinor: 50_000,
      monthKey: '2026-10',
    });

    await service.updateContainer({
      id: created.containerId,
      name: 'School & supplies',
      description: 'Books and printing',
      icon: 'book-outline',
      tone: 'violet',
      limitMinor: 75_000,
      monthKey: '2026-10',
    });

    const month = await service.getMonthView('2026-10');
    const container = month.containers.find(
      (candidate) => candidate.id === created.containerId,
    );
    assert.equal(container?.name, 'School & supplies');
    assert.equal(container?.tone, 'violet');
    assert.equal(container?.limitMinor, 75_000);
  } finally {
    harness.database.close();
  }
});

test('past months cannot be edited through the service', async () => {
  const { harness, service } = await setup();
  try {
    const created = await service.createContainer({
      name: 'Food',
      description: '',
      icon: 'restaurant-outline',
      tone: 'coral',
      limitMinor: 0,
      monthKey: '2026-10',
    });

    await assert.rejects(
      service.updateContainer({
        id: created.containerId,
        name: 'Past food',
        description: '',
        icon: 'restaurant-outline',
        tone: 'coral',
        limitMinor: 10_000,
        monthKey: '2026-09',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'VALIDATION',
    );
  } finally {
    harness.database.close();
  }
});

test('monthly history exposes saved results and the previous month', async () => {
  const { harness, service } = await setup();
  try {
    await service.recordMoneyEntry({
      mode: 'income',
      amountMinor: 15_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: UNALLOCATED_CONTAINER_ID,
    });

    const history = await service.getHistoryView('2026-10');
    assert.equal(history.summary.netSavingsMinor, 15_000);
    assert.equal(history.previous.monthKey, '2026-09');
    assert.equal(history.previous.netSavingsMinor, 0);
    assert.ok(history.availableMonths.includes('2026-10'));
  } finally {
    harness.database.close();
  }
});

test('monthly history reports rollover sweeps and saved transactions', async () => {
  const { harness, service } = await setup();
  try {
    await service.recordMoneyEntry({
      mode: 'income',
      amountMinor: 100_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: UNALLOCATED_CONTAINER_ID,
    });
    const container = await service.createContainer({
      name: 'Food',
      description: '',
      icon: 'restaurant-outline',
      tone: 'coral',
      limitMinor: 60_000,
      monthKey: '2026-10',
    });
    await service.recordMoneyEntry({
      mode: 'container_transfer',
      amountMinor: 60_000,
      title: 'Allocate to food',
      effectiveDate: '2026-10-20',
      containerId: UNALLOCATED_CONTAINER_ID,
      destinationContainerId: container.containerId,
    });
    await service.recordMoneyEntry({
      mode: 'container_transfer',
      amountMinor: 10_000,
      title: 'Move to savings',
      effectiveDate: '2026-10-20',
      containerId: container.containerId,
      destinationContainerId: SAVINGS_CONTAINER_ID,
    });

    harness.clock.set(2026, 10, 15);
    const history = await service.getHistoryView('2026-10');

    assert.ok(history.rollover);
    assert.equal(history.rollover.monthKey, '2026-10');
    assert.equal(history.rollover.revision, 1);
    assert.equal(history.rollover.sweptTransactionCount, 1);
    assert.equal(history.rollover.sweptTotalMinor, 50_000);
    assert.equal(history.transactions.length, 3);
    assert.ok(
      history.transactions.some((transaction) => transaction.kind === 'income'),
    );
    assert.ok(
      history.transactions.some(
        (transaction) => transaction.kind === 'savings',
      ),
    );

    const nextMonth = await service.getHistoryView('2026-11');
    assert.ok(
      nextMonth.transactions.some(
        (transaction) => transaction.title === 'Rollover: Food',
      ),
    );
  } finally {
    harness.database.close();
  }
});

test('monthly history keeps open and pre-baseline months explicit', async () => {
  const { harness, service } = await setup();
  try {
    const openMonth = await service.getHistoryView('2026-10');
    assert.equal(openMonth.rollover, null);
    assert.deepEqual(openMonth.transactions, []);

    const beforeBaseline = await service.getHistoryView('2026-08');
    assert.equal(beforeBaseline.rollover, null);
    assert.deepEqual(beforeBaseline.transactions, []);
  } finally {
    harness.database.close();
  }
});

test('wallet support preserves existing records, displays correct balances, and maintains global containers without wallet ownership', async () => {
  const { harness, service } = await setup();
  try {
    const initialWallets = await harness.engine.listWallets();
    assert.deepEqual(
      initialWallets.map((w) => ({ id: w.id, name: w.name, kind: w.kind })),
      [
        { id: 'wallet-cash', name: 'Cash on hand', kind: 'cash' },
        { id: 'wallet-gcash', name: 'Virtual GCash', kind: 'virtual_gcash' },
      ],
    );

    const allowanceContainer = await service.createContainer({
      name: 'Allowance',
      description: 'Daily allowance',
      icon: 'fast-food-outline',
      tone: 'amber',
      limitMinor: 50_000,
      monthKey: '2026-10',
    });

    await service.recordMoneyEntry({
      mode: 'income',
      amountMinor: 30_000,
      title: 'Cash Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      containerId: allowanceContainer.containerId,
    });

    await service.recordMoneyEntry({
      mode: 'income',
      amountMinor: 20_000,
      title: 'GCash Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-gcash',
      containerId: allowanceContainer.containerId,
    });

    let walletView = await service.getWalletView();
    const cashWallet = walletView.wallets.find((w) => w.id === 'wallet-cash');
    const gcashWallet = walletView.wallets.find((w) => w.id === 'wallet-gcash');

    assert.equal(cashWallet?.balanceMinor, 30_000);
    assert.equal(gcashWallet?.balanceMinor, 20_000);
    assert.equal(walletView.totalBalanceMinor, 50_000);

    let monthView = await service.getMonthView('2026-10');
    assert.equal(
      balanceOf(monthView.containers, allowanceContainer.containerId),
      50_000,
    );
    assert.equal(monthView.summary.availableBudgetMinor, 50_000);
    assert.equal(monthView.summary.netSavingsMinor, 50_000);

    await service.recordMoneyEntry({
      mode: 'expense',
      amountMinor: 15_000,
      title: 'Online snack',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-gcash',
      containerId: allowanceContainer.containerId,
    });

    walletView = await service.getWalletView();
    assert.equal(
      walletView.wallets.find((w) => w.id === 'wallet-cash')?.balanceMinor,
      30_000,
    );
    assert.equal(
      walletView.wallets.find((w) => w.id === 'wallet-gcash')?.balanceMinor,
      5_000,
    );
    assert.equal(walletView.totalBalanceMinor, 35_000);

    monthView = await service.getMonthView('2026-10');
    assert.equal(
      balanceOf(monthView.containers, allowanceContainer.containerId),
      35_000,
    );
    assert.equal(monthView.summary.availableBudgetMinor, 35_000);
    assert.equal(monthView.summary.netSavingsMinor, 35_000);

    await assert.rejects(
      service.recordMoneyEntry({
        mode: 'expense',
        amountMinor: 10_000,
        title: 'Too much from GCash',
        effectiveDate: '2026-10-20',
        walletId: 'wallet-gcash',
        containerId: allowanceContainer.containerId,
      }),
      (error: unknown) =>
        error instanceof FinanceError &&
        error.code === 'INSUFFICIENT_FUNDS' &&
        error.message.includes('That wallet does not have enough money'),
    );

    await service.recordMoneyEntry({
      mode: 'wallet_transfer',
      amountMinor: 10_000,
      title: 'Transfer to GCash',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-cash',
      destinationWalletId: 'wallet-gcash',
    });

    walletView = await service.getWalletView();
    assert.equal(
      walletView.wallets.find((w) => w.id === 'wallet-cash')?.balanceMinor,
      20_000,
    );
    assert.equal(
      walletView.wallets.find((w) => w.id === 'wallet-gcash')?.balanceMinor,
      15_000,
    );
    assert.equal(walletView.totalBalanceMinor, 35_000);

    monthView = await service.getMonthView('2026-10');
    assert.equal(
      balanceOf(monthView.containers, allowanceContainer.containerId),
      35_000,
    );
    assert.equal(monthView.summary.availableBudgetMinor, 35_000);
    assert.equal(monthView.summary.netSavingsMinor, 35_000);

    const walletSnapshots =
      await harness.engine.getWalletSnapshots('2026-10-20');
    const containerSnapshots = await harness.engine.getContainerSnapshots(
      '2026-10',
      true,
    );
    const sumWallets = walletSnapshots.reduce(
      (acc, w) => acc + w.balanceMinor,
      0,
    );
    const sumContainers = containerSnapshots.reduce(
      (acc, c) => acc + c.balanceMinor,
      0,
    );
    assert.equal(sumWallets, 35_000);
    assert.equal(sumContainers, 35_000);
  } finally {
    harness.database.close();
  }
});
