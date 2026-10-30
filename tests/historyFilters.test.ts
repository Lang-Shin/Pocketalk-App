import assert from 'node:assert/strict';
import test from 'node:test';

import type { Transaction } from '../src/data/models';
import {
  EMPTY_TRANSACTION_FILTERS,
  filterTransactions,
  getContainerFilterOptions,
  getTransactionDateOptions,
  getWalletFilterOptions,
} from '../src/features/history/transactionFilters';

function makeTransaction(
  overrides: Partial<Transaction> & Pick<Transaction, 'id'>,
): Transaction {
  return {
    title: 'Test record',
    category: 'Category',
    kind: 'expense',
    direction: 'out',
    amountMinor: 10_000,
    effectiveDate: '2026-10-20',
    recordedAt: '2026-10-20T04:00:00.000Z',
    recordedTimeZone: 'Asia/Manila',
    recordedOffsetMinutes: 480,
    status: 'posted',
    icon: 'restaurant-outline',
    tone: 'coral',
    ...overrides,
  };
}

const income = makeTransaction({
  id: 'income',
  kind: 'income',
  direction: 'in',
  effectiveDate: '2026-10-25',
  destinationWalletId: 'wallet-cash',
  destinationWalletName: 'Cash on hand',
  destinationContainerId: 'container-unallocated',
  destinationContainerName: 'Unallocated',
});

const expense = makeTransaction({
  id: 'expense',
  effectiveDate: '2026-10-20',
  sourceWalletId: 'wallet-cash',
  sourceWalletName: 'Cash on hand',
  sourceContainerId: 'container-food',
  sourceContainerName: 'Food',
});

const walletTransfer = makeTransaction({
  id: 'wallet-transfer',
  kind: 'wallet_transfer',
  direction: 'neutral',
  effectiveDate: '2026-10-18',
  sourceWalletId: 'wallet-cash',
  sourceWalletName: 'Cash on hand',
  destinationWalletId: 'wallet-gcash',
  destinationWalletName: 'Virtual GCash',
});

const containerTransfer = makeTransaction({
  id: 'container-transfer',
  kind: 'savings',
  direction: 'neutral',
  effectiveDate: '2026-10-15',
  sourceContainerId: 'container-food',
  sourceContainerName: 'Food',
  destinationContainerId: 'container-savings',
  destinationContainerName: 'Savings',
});

const transactions = [income, expense, walletTransfer, containerTransfer];

test('history filters separate income, expenses, and internal transfers', () => {
  assert.equal(
    filterTransactions(transactions, EMPTY_TRANSACTION_FILTERS).length,
    4,
  );
  assert.deepEqual(
    filterTransactions(transactions, {
      ...EMPTY_TRANSACTION_FILTERS,
      type: 'expenses',
    }).map((transaction) => transaction.id),
    ['expense'],
  );
  assert.deepEqual(
    filterTransactions(transactions, {
      ...EMPTY_TRANSACTION_FILTERS,
      type: 'income',
    }).map((transaction) => transaction.id),
    ['income'],
  );
  assert.deepEqual(
    filterTransactions(transactions, {
      ...EMPTY_TRANSACTION_FILTERS,
      type: 'transfers',
    }).map((transaction) => transaction.id),
    ['wallet-transfer', 'container-transfer'],
  );
});

test('history filters match both sides of a transfer and combine with type and date', () => {
  assert.deepEqual(
    filterTransactions(transactions, {
      ...EMPTY_TRANSACTION_FILTERS,
      containerId: 'container-food',
    }).map((transaction) => transaction.id),
    ['expense', 'container-transfer'],
  );
  assert.deepEqual(
    filterTransactions(transactions, {
      ...EMPTY_TRANSACTION_FILTERS,
      walletId: 'wallet-cash',
    }).map((transaction) => transaction.id),
    ['income', 'expense', 'wallet-transfer'],
  );
  assert.deepEqual(
    filterTransactions(transactions, {
      ...EMPTY_TRANSACTION_FILTERS,
      type: 'transfers',
      containerId: 'container-food',
    }).map((transaction) => transaction.id),
    ['container-transfer'],
  );
  assert.deepEqual(
    filterTransactions(transactions, {
      ...EMPTY_TRANSACTION_FILTERS,
      effectiveDate: '2026-10-20',
      containerId: 'container-food',
    }).map((transaction) => transaction.id),
    ['expense'],
  );
});

test('history filter options use stable ids and user-facing labels', () => {
  assert.deepEqual(getTransactionDateOptions(transactions), [
    '2026-10-25',
    '2026-10-20',
    '2026-10-18',
    '2026-10-15',
  ]);
  assert.deepEqual(getContainerFilterOptions(transactions), [
    { id: 'container-food', label: 'Food' },
    { id: 'container-savings', label: 'Savings' },
    { id: 'container-unallocated', label: 'Unallocated' },
  ]);
  assert.deepEqual(getWalletFilterOptions(transactions), [
    { id: 'wallet-cash', label: 'Cash on hand' },
    { id: 'wallet-gcash', label: 'Virtual GCash' },
  ]);
});
