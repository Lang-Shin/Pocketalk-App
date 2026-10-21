import assert from 'node:assert/strict';
import test from 'node:test';

import { recordedDateKey } from '../src/lib/date';
import {
  createHarness,
  seedStandardAccounts,
} from './helpers/financeTestHarness';

test('net savings excludes wallet transfers, container transfers, and savings contributions', async () => {
  const harness = await createHarness();
  try {
    const accounts = await seedStandardAccounts(harness.engine);
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'Allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'income-1',
    });
    await harness.engine.recordTransaction({
      kind: 'expense',
      title: 'Lunch',
      amountMinor: 20_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'expense-1',
    });
    await harness.engine.recordTransaction({
      kind: 'wallet_transfer',
      title: 'Move to GCash',
      amountMinor: 10_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      destinationWalletId: accounts.gcashWalletId,
      idempotencyKey: 'wallet-transfer-1',
    });
    await harness.engine.recordTransaction({
      kind: 'container_transfer',
      title: 'Save for emergency',
      amountMinor: 30_000,
      effectiveDate: '2026-10-20',
      containerId: accounts.foodContainerId,
      destinationContainerId: accounts.savingsContainerId,
      idempotencyKey: 'savings-1',
    });

    const summary = await harness.engine.getMonthSummary('2026-10', '2026-10');

    assert.equal(summary.incomeMinor, 100_000);
    assert.equal(summary.expenseMinor, 20_000);
    assert.equal(summary.netSavingsMinor, 80_000);
    assert.equal(summary.savingsContributionsMinor, 30_000);
    assert.equal(summary.savingsEndingBalanceMinor, 30_000);
    assert.equal(summary.totalSpentMinor, 20_000);
    assert.equal(summary.totalRemainingMinor, 80_000);
  } finally {
    harness.database.close();
  }
});

test('late entries affect their effective month while entry order stays recent-first', async () => {
  const harness = await createHarness(new Date(2026, 8, 15, 12));
  try {
    const accounts = await seedStandardAccounts(harness.engine);
    harness.clock.set(2026, 9, 20);
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'September allowance',
      amountMinor: 50_000,
      effectiveDate: '2026-09-30',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'late-september',
    });
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'October allowance',
      amountMinor: 25_000,
      effectiveDate: '2026-10-01',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'october-income',
    });

    const september = await harness.engine.getMonthSummary('2026-09', '2026-10');
    const october = await harness.engine.getMonthSummary('2026-10', '2026-10');
    const recent = await harness.engine.getRecentTransactions(1);
    const septemberEnd = await harness.engine.getWalletBalances('2026-09-30');
    const octoberStart = await harness.engine.getWalletBalances('2026-10-01');

    assert.equal(september.incomeMinor, 50_000);
    assert.equal(october.incomeMinor, 25_000);
    assert.equal(septemberEnd[accounts.cashWalletId], 50_000);
    assert.equal(octoberStart[accounts.cashWalletId], 75_000);
    assert.equal(recent[0]?.title, 'October allowance');
  } finally {
    harness.database.close();
  }
});

test('leap-day and year-boundary reports use explicit calendar dates without resetting balances', async () => {
  const leapHarness = await createHarness(new Date(2024, 0, 15, 12));
  try {
    const accounts = await seedStandardAccounts(leapHarness.engine);
    leapHarness.clock.set(2024, 2, 1);
    await leapHarness.engine.recordTransaction({
      kind: 'income',
      title: 'Leap-day income',
      amountMinor: 10_000,
      effectiveDate: '2024-02-29',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'leap-income',
    });
    await leapHarness.engine.recordTransaction({
      kind: 'income',
      title: 'March income',
      amountMinor: 20_000,
      effectiveDate: '2024-03-01',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'march-income',
    });

    const february = await leapHarness.engine.getMonthSummary('2024-02', '2024-03');
    const march = await leapHarness.engine.getMonthSummary('2024-03', '2024-03');
    const februaryEnd = await leapHarness.engine.getWalletBalances('2024-02-29');
    const marchStart = await leapHarness.engine.getWalletBalances('2024-03-01');

    assert.equal(february.incomeMinor, 10_000);
    assert.equal(march.incomeMinor, 20_000);
    assert.equal(februaryEnd[accounts.cashWalletId], 10_000);
    assert.equal(marchStart[accounts.cashWalletId], 30_000);
  } finally {
    leapHarness.database.close();
  }

  const yearHarness = await createHarness(new Date(2025, 11, 15, 12));
  try {
    const accounts = await seedStandardAccounts(yearHarness.engine);
    yearHarness.clock.set(2026, 0, 5);
    await yearHarness.engine.recordTransaction({
      kind: 'income',
      title: 'December income',
      amountMinor: 40_000,
      effectiveDate: '2025-12-31',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'december-income',
    });
    await yearHarness.engine.recordTransaction({
      kind: 'income',
      title: 'January income',
      amountMinor: 60_000,
      effectiveDate: '2026-01-05',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'january-income',
    });

    const december = await yearHarness.engine.getMonthSummary('2025-12', '2026-01');
    const january = await yearHarness.engine.getMonthSummary('2026-01', '2026-01');
    const decemberEnd = await yearHarness.engine.getWalletBalances('2025-12-31');
    const januaryStart = await yearHarness.engine.getWalletBalances('2026-01-05');

    assert.equal(december.incomeMinor, 40_000);
    assert.equal(january.incomeMinor, 60_000);
    assert.equal(decemberEnd[accounts.cashWalletId], 40_000);
    assert.equal(januaryStart[accounts.cashWalletId], 100_000);
  } finally {
    yearHarness.database.close();
  }
});

test('monthly limits are historical and an empty month reports explicit zero activity', async () => {
  const harness = await createHarness(new Date(2026, 8, 15, 12));
  try {
    const accounts = await seedStandardAccounts(harness.engine);
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'September allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-09-10',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'september-income',
    });
    harness.clock.set(2026, 9, 20);
    await harness.engine.setBudgetLimit({
      containerId: accounts.foodContainerId,
      limitMinor: 200_000,
      idempotencyKey: 'october-limit',
    });

    const september = await harness.engine.getMonthSummary('2026-09', '2026-10');
    const october = await harness.engine.getMonthSummary('2026-10', '2026-10');
    const november = await harness.engine.getMonthSummary('2026-11', '2026-10');
    const balances = await harness.engine.getWalletBalances('2026-10-20');

    assert.equal(september.totalLimitMinor, 100_000);
    assert.equal(october.totalLimitMinor, 200_000);
    assert.equal(november.totalLimitMinor, 0);
    assert.equal(november.postedTransactionCount, 0);
    assert.equal(november.netSavingsMinor, 0);
    assert.equal(november.hasActivity, false);
    assert.equal(balances[accounts.cashWalletId], 100_000);
  } finally {
    harness.database.close();
  }
});

test('empty active containers stay visible while inactive archived containers leave reports', async () => {
  const harness = await createHarness(new Date(2026, 9, 15, 12));
  try {
    const container = await harness.engine.createContainer({
      name: 'Unused container',
      icon: 'leaf-outline',
      tone: 'amber',
      idempotencyKey: 'unused-container',
    });

    const active = await harness.engine.getContainerSnapshots('2026-10');
    assert.equal(
      active.some((snapshot) => snapshot.id === container.containerId),
      true,
    );

    await harness.engine.archiveContainer({
      containerId: container.containerId,
      idempotencyKey: 'archive-unused',
    });

    const archived = await harness.engine.getContainerSnapshots('2026-10');
    assert.equal(
      archived.some((snapshot) => snapshot.id === container.containerId),
      false,
    );
  } finally {
    harness.database.close();
  }
});

test('effective local dates remain stable even when recorded near midnight', async () => {
  const harness = await createHarness(new Date(2026, 9, 20, 23));
  try {
    const accounts = await seedStandardAccounts(harness.engine);
    const transactionId = (
      await harness.engine.recordTransaction({
        kind: 'income',
        title: 'Late receipt',
        amountMinor: 5_000,
        effectiveDate: '2026-10-19',
        walletId: accounts.cashWalletId,
        containerId: accounts.foodContainerId,
        idempotencyKey: 'late-night-income',
      })
    ).transactionId;

    const transaction = await harness.engine.getTransaction(transactionId);
    const october = await harness.engine.getMonthSummary('2026-10', '2026-10');
    const september = await harness.engine.getMonthSummary('2026-09', '2026-10');

    assert.ok(transaction);
    assert.ok(transaction.recordedTimeZone.length > 0);
    assert.ok(Number.isInteger(transaction.recordedOffsetMinutes));
    assert.equal(
      recordedDateKey(
        transaction.recordedAt,
        transaction.recordedOffsetMinutes,
      ),
      '2026-10-20',
    );
    assert.equal(transaction.effectiveDate, '2026-10-19');
    assert.equal(october.incomeMinor, 5_000);
    assert.equal(september.incomeMinor, 0);
  } finally {
    harness.database.close();
  }
});
