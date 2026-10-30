import type { Transaction } from '@/data/models';

export type HistoryTypeFilter = 'all' | 'expenses' | 'income' | 'transfers';

export interface TransactionFilters {
  type: HistoryTypeFilter;
  effectiveDate: string | null;
  containerId: string | null;
  walletId: string | null;
}

export interface TransactionFilterOption {
  id: string;
  label: string;
}

export const EMPTY_TRANSACTION_FILTERS: TransactionFilters = {
  type: 'all',
  effectiveDate: null,
  containerId: null,
  walletId: null,
};

export function filterTransactions(
  transactions: Transaction[],
  filters: TransactionFilters,
): Transaction[] {
  return transactions.filter((transaction) => {
    if (filters.type === 'expenses' && transaction.kind !== 'expense') {
      return false;
    }
    if (filters.type === 'income' && transaction.kind !== 'income') {
      return false;
    }
    if (
      filters.type === 'transfers' &&
      transaction.kind !== 'wallet_transfer' &&
      transaction.kind !== 'container_transfer' &&
      transaction.kind !== 'savings'
    ) {
      return false;
    }
    if (
      filters.effectiveDate &&
      transaction.effectiveDate !== filters.effectiveDate
    ) {
      return false;
    }
    if (
      filters.containerId &&
      transaction.sourceContainerId !== filters.containerId &&
      transaction.destinationContainerId !== filters.containerId
    ) {
      return false;
    }
    if (
      filters.walletId &&
      transaction.sourceWalletId !== filters.walletId &&
      transaction.destinationWalletId !== filters.walletId
    ) {
      return false;
    }
    return true;
  });
}

export function getTransactionDateOptions(
  transactions: Transaction[],
): string[] {
  return Array.from(
    new Set(transactions.map((transaction) => transaction.effectiveDate)),
  ).sort((left, right) => right.localeCompare(left));
}

export function getContainerFilterOptions(
  transactions: Transaction[],
): TransactionFilterOption[] {
  return collectOptions(
    transactions,
    (transaction) => [
      {
        id: transaction.sourceContainerId,
        label: transaction.sourceContainerName,
      },
      {
        id: transaction.destinationContainerId,
        label: transaction.destinationContainerName,
      },
    ],
    'Container',
  );
}

export function getWalletFilterOptions(
  transactions: Transaction[],
): TransactionFilterOption[] {
  return collectOptions(
    transactions,
    (transaction) => [
      {
        id: transaction.sourceWalletId,
        label: transaction.sourceWalletName,
      },
      {
        id: transaction.destinationWalletId,
        label: transaction.destinationWalletName,
      },
    ],
    'Wallet',
  );
}

function collectOptions(
  transactions: Transaction[],
  references: (
    transaction: Transaction,
  ) => { id?: string; label?: string }[],
  fallbackLabel: string,
): TransactionFilterOption[] {
  const options = new Map<string, string>();

  for (const transaction of transactions) {
    for (const reference of references(transaction)) {
      if (!reference.id || options.has(reference.id)) continue;
      options.set(reference.id, reference.label?.trim() || fallbackLabel);
    }
  }

  return Array.from(options, ([id, label]) => ({ id, label })).sort(
    (left, right) => left.label.localeCompare(right.label),
  );
}
