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
