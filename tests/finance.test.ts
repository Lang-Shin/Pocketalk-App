import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMockFinanceState } from '../src/data/mockFinance';
import {
  selectContainerSnapshots,
  selectMonthSummary,
  selectRecentTransactions,
  selectTotalContainerBalance,
  selectTotalWalletBalance,
  selectWalletSnapshots,
} from '../src/data/financeSelectors';
import type { FinanceState, Transaction } from '../src/data/models';
import { formatTime, recordedDateKey } from '../src/lib/date';
import {
  currentMonthKey,
  getCalendarMonth,
  getMonthKeysBack,
  shiftMonthKey,
} from '../src/lib/period';
import { formatPeso, parsePesoToMinor } from '../src/lib/money';

const now = new Date(2026, 9, 20, 12, 0, 0);
const activeMonthKey = currentMonthKey(now);
const todayDateKey = '2026-10-20';
const state = buildMockFinanceState(now);

test('calendar month helpers handle leap years, month ends, and year changes', () => {
  assert.equal(getCalendarMonth('2024-02').endDateKey, '2024-02-29');
  assert.equal(getCalendarMonth('2023-02').endDateKey, '2023-02-28');
  assert.equal(getCalendarMonth('2026-04').endDateKey, '2026-04-30');
  assert.equal(getCalendarMonth('2026-12').endDateKey, '2026-12-31');
  assert.equal(shiftMonthKey('2026-12', 1), '2027-01');
  assert.equal(shiftMonthKey('2026-01', -1), '2025-12');
});

test('peso parsing and formatting use integer centavos', () => {
  assert.equal(parsePesoToMinor('₱1,234.56'), 123456);
  assert.equal(parsePesoToMinor('1200.5'), 120050);
  assert.equal(parsePesoToMinor('1.234'), null);
  assert.equal(parsePesoToMinor('-10'), null);
  assert.equal(formatPeso(-123456), '-₱1,234.56');
});

test('wallet and container balances remain equal across seeded months', () => {
  assert.equal(
    selectTotalWalletBalance(state, todayDateKey),
    selectTotalContainerBalance(state, todayDateKey),
  );

  for (const monthKey of getMonthKeysBack(6, activeMonthKey)) {
    const endDateKey = getCalendarMonth(monthKey).endDateKey;
    assert.equal(
      selectTotalWalletBalance(state, endDateKey),
      selectTotalContainerBalance(state, endDateKey),
      `invariant failed for ${monthKey}`,
    );
  }

  for (const wallet of selectWalletSnapshots(state, todayDateKey)) {
    assert.ok(wallet.balanceMinor >= 0, `${wallet.name} is negative`);
  }
});

test('net savings excludes wallet and container transfers', () => {
  const before = selectMonthSummary(state, activeMonthKey, activeMonthKey);
  assert.equal(before.netSavingsMinor, before.incomeMinor - before.expenseMinor);
  assert.ok(before.savingsContributionsMinor > 0);

  const food = state.containers.find((item) => item.id === 'container-food');
  const savings = state.containers.find(
    (item) => item.id === 'container-savings',
  );
  const sourceWallet = state.wallets[0];
  const destinationWallet = state.wallets[1];
  assert.ok(food);
  assert.ok(savings);
  assert.ok(sourceWallet);
  assert.ok(destinationWallet);

  const internalTransfers: Transaction[] = [
    {
      id: 'check-wallet-transfer',
      title: 'Wallet transfer',
      category: 'Wallet transfer',
      kind: 'wallet_transfer',
      direction: 'neutral',
      amountMinor: 10_000,
      effectiveDate: todayDateKey,
      recordedAt: '2026-10-20T04:00:00.000Z',
      recordedTimeZone: 'Asia/Manila',
      recordedOffsetMinutes: 480,
      status: 'posted',
      sourceWalletId: sourceWallet.id,
      destinationWalletId: destinationWallet.id,
      icon: 'swap-horizontal-outline',
      tone: 'blue',
    },
    {
      id: 'check-container-transfer',
      title: 'Container transfer',
      category: 'Container transfer',
      kind: 'container_transfer',
      direction: 'neutral',
      amountMinor: 5_000,
      effectiveDate: todayDateKey,
      recordedAt: '2026-10-20T04:00:00.000Z',
      recordedTimeZone: 'Asia/Manila',
      recordedOffsetMinutes: 480,
      status: 'posted',
      sourceContainerId: food.id,
      destinationContainerId: savings.id,
      icon: 'swap-horizontal-outline',
      tone: 'violet',
    },
  ];
  const withTransfers: FinanceState = {
    ...state,
    transactions: [...state.transactions, ...internalTransfers],
  };
  const after = selectMonthSummary(
    withTransfers,
    activeMonthKey,
    activeMonthKey,
  );

  assert.equal(after.incomeMinor, before.incomeMinor);
  assert.equal(after.expenseMinor, before.expenseMinor);
  assert.equal(after.netSavingsMinor, before.netSavingsMinor);
  assert.equal(
    selectTotalWalletBalance(withTransfers, todayDateKey),
    selectTotalContainerBalance(withTransfers, todayDateKey),
  );
});

test('historical container labels stay fixed when a later month is renamed', () => {
  const food = state.containers.find((item) => item.id === 'container-food');
  assert.ok(food);

  const renamed: FinanceState = {
    ...state,
    containers: state.containers.map((container) =>
      container.id === food.id
        ? {
            ...container,
            name: 'Renamed this month',
            labelsByMonth: {
              ...container.labelsByMonth,
              [activeMonthKey]: {
                name: 'Renamed this month',
                description: 'Renamed description',
                icon: container.icon,
                tone: container.tone,
              },
            },
          }
        : container,
    ),
  };

  const previousMonthKey = shiftMonthKey(activeMonthKey, -1);
  const previousFood = selectContainerSnapshots(
    renamed,
    previousMonthKey,
  ).find((container) => container.id === food.id);
  const currentFood = selectContainerSnapshots(renamed, activeMonthKey).find(
    (container) => container.id === food.id,
  );

  assert.equal(previousFood?.name, food.name);
  assert.equal(currentFood?.name, 'Renamed this month');
});

test('archived containers remain visible in historical reports', () => {
  const previousMonthKey = shiftMonthKey(activeMonthKey, -1);
  const snapshots = selectContainerSnapshots(state, previousMonthKey);
  const archived = snapshots.find(
    (container) => container.id === 'container-bills',
  );

  assert.ok(archived);
  assert.equal(archived.status, 'archived');
  assert.ok(archived.spentMinor > 0);
  assert.ok(archived.limitMinor > 0);
});

test('recorded timestamps keep their original local date and clock time', () => {
  const recordedAt = '2026-10-19T16:30:00.000Z';

  assert.equal(recordedDateKey(recordedAt, 480), '2026-10-20');
  assert.equal(formatTime(recordedAt, 480), '12:30 AM');
  assert.notEqual(recordedDateKey(recordedAt, 480), recordedAt.slice(0, 10));
});

test('recent activity follows entry time and late entries update the prior month', () => {
  const previousMonthKey = shiftMonthKey(activeMonthKey, -1);
  const food = state.containers.find((item) => item.id === 'container-food');
  const wallet = state.wallets[0];
  assert.ok(food);
  assert.ok(wallet);

  const lateEntry: Transaction = {
    id: 'late-prior-month-entry',
    title: 'Late lunch receipt',
    category: food.name,
    kind: 'expense',
    direction: 'out',
    amountMinor: 1_000,
    effectiveDate: `${previousMonthKey}-03`,
    recordedAt: '2026-10-20T05:00:00.000Z',
    recordedTimeZone: 'Asia/Manila',
    recordedOffsetMinutes: 480,
    status: 'posted',
    sourceWalletId: wallet.id,
    sourceWalletName: wallet.name,
    sourceContainerId: food.id,
    sourceContainerName: food.name,
    icon: 'restaurant-outline',
    tone: 'coral',
  };
  const withLateEntry: FinanceState = {
    ...state,
    transactions: [...state.transactions, lateEntry],
  };
  const baseline = selectMonthSummary(
    state,
    previousMonthKey,
    activeMonthKey,
  );
  const updated = selectMonthSummary(
    withLateEntry,
    previousMonthKey,
    activeMonthKey,
  );

  assert.equal(
    selectRecentTransactions(withLateEntry, 1)[0]?.id,
    lateEntry.id,
  );
  assert.equal(updated.expenseMinor, baseline.expenseMinor + 1_000);
  assert.equal(
    updated.netSavingsMinor,
    baseline.netSavingsMinor - 1_000,
  );
});