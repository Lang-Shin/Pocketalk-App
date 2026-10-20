import type {
  BudgetContainer,
  ContainerLabel,
  ContainerMonthResult,
  ContainerSnapshot,
  FinanceState,
  MonthSummary,
  Transaction,
  WalletSnapshot,
} from './models';
import { getCalendarMonth, monthKeyForDateKey } from '@/lib/period';

export function isAppliedTransaction(transaction: Transaction): boolean {
  return transaction.status === 'posted';
}

function asOfDateForMonth(monthKey: string): string {
  return getCalendarMonth(monthKey).endDateKey;
}

export function selectWalletBalances(
  state: FinanceState,
  asOfDateKey: string,
): Record<string, number> {
  const balances = Object.fromEntries(
    state.wallets.map((wallet) => [wallet.id, 0]),
  );

  for (const transaction of state.transactions) {
    if (!isAppliedTransaction(transaction)) continue;
    if (transaction.effectiveDate > asOfDateKey) continue;

    if (transaction.kind === 'income') {
      addTo(balances, transaction.destinationWalletId, transaction.amountMinor);
    } else if (transaction.kind === 'expense') {
      addTo(balances, transaction.sourceWalletId, -transaction.amountMinor);
    } else if (transaction.kind === 'wallet_transfer') {
      addTo(balances, transaction.sourceWalletId, -transaction.amountMinor);
      addTo(
        balances,
        transaction.destinationWalletId,
        transaction.amountMinor,
      );
    }
  }

  return balances;
}

export function selectWalletSnapshots(
  state: FinanceState,
  asOfDateKey: string,
): WalletSnapshot[] {
  const balances = selectWalletBalances(state, asOfDateKey);
  return state.wallets.map((wallet) => ({
    ...wallet,
    balanceMinor: balances[wallet.id] ?? 0,
  }));
}

export function selectContainerBalances(
  state: FinanceState,
  asOfDateKey: string,
): Record<string, number> {
  const balances = Object.fromEntries(
    state.containers.map((container) => [container.id, 0]),
  );

  for (const transaction of state.transactions) {
    if (!isAppliedTransaction(transaction)) continue;
    if (transaction.effectiveDate > asOfDateKey) continue;

    if (transaction.kind === 'income') {
      addTo(
        balances,
        transaction.destinationContainerId,
        transaction.amountMinor,
      );
    } else if (transaction.kind === 'expense') {
      addTo(
        balances,
        transaction.sourceContainerId,
        -transaction.amountMinor,
      );
    } else if (
      transaction.kind === 'container_transfer' ||
      transaction.kind === 'savings'
    ) {
      addTo(
        balances,
        transaction.sourceContainerId,
        -transaction.amountMinor,
      );
      addTo(
        balances,
        transaction.destinationContainerId,
        transaction.amountMinor,
      );
    }
  }

  return balances;
}

export function selectContainerSnapshots(
  state: FinanceState,
  monthKey: string,
): ContainerSnapshot[] {
  const asOfDateKey = asOfDateForMonth(monthKey);
  const balances = selectContainerBalances(state, asOfDateKey);
  const spending = selectSpendingByContainer(state, monthKey);

  return state.containers
    .filter((container) => {
      if (container.createdMonthKey > monthKey) return false;
      const limit = container.limitsByMonth[monthKey] ?? 0;
      const spent = spending[container.id] ?? 0;
      const balance = balances[container.id] ?? 0;
      return limit > 0 || spent > 0 || balance !== 0;
    })
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((container) => {
      const limitMinor = container.limitsByMonth[monthKey] ?? 0;
      const spentMinor = spending[container.id] ?? 0;
      const balanceMinor = balances[container.id] ?? 0;
      const label = selectContainerLabelAsOf(container, monthKey);
      return {
        ...container,
        ...(label ?? {}),
        balanceMinor,
        limitMinor,
        spentMinor,
        remainingMinor: limitMinor - spentMinor,
        hasActivity: spentMinor > 0 || limitMinor > 0,
      };
    });
}

export function selectSpendingByContainer(
  state: FinanceState,
  monthKey: string,
): Record<string, number> {
  const spending: Record<string, number> = {};

  for (const transaction of state.transactions) {
    if (!isAppliedTransaction(transaction)) continue;
    if (transaction.kind !== 'expense') continue;
    if (monthKeyForDateKey(transaction.effectiveDate) !== monthKey) continue;
    addTo(
      spending,
      transaction.sourceContainerId,
      transaction.amountMinor,
    );
  }

  return spending;
}

export function selectTransactionsForMonth(
  state: FinanceState,
  monthKey: string,
): Transaction[] {
  return state.transactions
    .filter(
      (transaction) =>
        monthKeyForDateKey(transaction.effectiveDate) === monthKey,
    )
    .sort((left, right) => {
      const byDate = right.effectiveDate.localeCompare(left.effectiveDate);
      if (byDate !== 0) return byDate;
      return right.recordedAt.localeCompare(left.recordedAt);
    });
}

export function selectRecentTransactions(
  state: FinanceState,
  limit = 4,
): Transaction[] {
  return [...state.transactions]
    .sort((left, right) => {
      const byRecordedAt = right.recordedAt.localeCompare(left.recordedAt);
      if (byRecordedAt !== 0) return byRecordedAt;
      return right.effectiveDate.localeCompare(left.effectiveDate);
    })
    .slice(0, limit);
}

export function selectMonthSummary(
  state: FinanceState,
  monthKey: string,
  activeMonthKey: string,
): MonthSummary {
  const monthTransactions = state.transactions.filter(
    (transaction) =>
      isAppliedTransaction(transaction) &&
      monthKeyForDateKey(transaction.effectiveDate) === monthKey,
  );
  const incomeMinor = sumByKind(monthTransactions, 'income');
  const expenseMinor = sumByKind(monthTransactions, 'expense');
  const savingsContributionsMinor = sumByKind(monthTransactions, 'savings');
  const snapshots = selectContainerSnapshots(state, monthKey);
  const totalLimitMinor = snapshots.reduce(
    (total, container) => total + container.limitMinor,
    0,
  );
  const totalSpentMinor = snapshots.reduce(
    (total, container) => total + container.spentMinor,
    0,
  );
  const savingsEndingBalanceMinor = snapshots
    .filter((container) => container.kind === 'savings')
    .reduce((total, container) => total + container.balanceMinor, 0);

  return {
    monthKey,
    isCurrent: monthKey === activeMonthKey,
    incomeMinor,
    expenseMinor,
    netSavingsMinor: incomeMinor - expenseMinor,
    totalLimitMinor,
    totalSpentMinor,
    totalRemainingMinor: totalLimitMinor - totalSpentMinor,
    savingsContributionsMinor,
    savingsEndingBalanceMinor,
    postedTransactionCount: monthTransactions.length,
    hasActivity: monthTransactions.length > 0 || totalLimitMinor > 0,
  };
}

export function selectContainerMonthResults(
  state: FinanceState,
  monthKey: string,
): ContainerMonthResult[] {
  const snapshots = selectContainerSnapshots(state, monthKey);

  return snapshots.map((container) => {
    return {
      containerId: container.id,
      name: container.name,
      icon: container.icon,
      tone: container.tone,
      kind: container.kind,
      status: container.status,
      limitMinor: container.limitMinor,
      spentMinor: container.spentMinor,
      remainingMinor: container.remainingMinor,
      endingBalanceMinor: container.balanceMinor,
      hasActivity: container.hasActivity,
    };
  });
}

export function selectTotalWalletBalance(
  state: FinanceState,
  asOfDateKey: string,
): number {
  return selectWalletSnapshots(state, asOfDateKey).reduce(
    (total, wallet) => total + wallet.balanceMinor,
    0,
  );
}

export function selectTotalContainerBalance(
  state: FinanceState,
  asOfDateKey: string,
): number {
  return Object.values(selectContainerBalances(state, asOfDateKey)).reduce(
    (total, balance) => total + balance,
    0,
  );
}

export function selectWalletBalanceById(
  state: FinanceState,
  walletId: string,
  asOfDateKey: string,
): number {
  return selectWalletBalances(state, asOfDateKey)[walletId] ?? 0;
}

export function selectContainerBalanceById(
  state: FinanceState,
  containerId: string,
  asOfDateKey: string,
): number {
  return selectContainerBalances(state, asOfDateKey)[containerId] ?? 0;
}

function sumByKind(
  transactions: Transaction[],
  kind: Transaction['kind'],
): number {
  return transactions
    .filter((transaction) => transaction.kind === kind)
    .reduce((total, transaction) => total + transaction.amountMinor, 0);
}

function addTo(
  balances: Record<string, number>,
  id: string | undefined,
  amountMinor: number,
): void {
  if (!id) return;
  balances[id] = (balances[id] ?? 0) + amountMinor;
}

function selectContainerLabelAsOf(
  container: BudgetContainer,
  monthKey: string,
): ContainerLabel | null {
  const effectiveMonth = Object.keys(container.labelsByMonth)
    .filter((candidate) => candidate <= monthKey)
    .sort()
    .pop();

  if (!effectiveMonth) return null;
  return container.labelsByMonth[effectiveMonth] ?? null;
}
