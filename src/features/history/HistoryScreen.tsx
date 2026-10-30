import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { TransactionDetailModal } from '@/components/finance/TransactionDetailModal';
import { TransactionRow } from '@/components/finance/TransactionRow';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Divider } from '@/components/ui/Divider';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { MonthNavigator } from '@/components/ui/MonthNavigator';
import { NoticeBanner } from '@/components/ui/NoticeBanner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorState, LoadingState } from '@/components/ui/QueryStates';
import { Screen } from '@/components/ui/Screen';
import { useFinance, useFinanceMonth } from '@/data/financeStore';
import type { Transaction } from '@/data/models';
import {
  EMPTY_TRANSACTION_FILTERS,
  filterTransactions,
  getContainerFilterOptions,
  getTransactionDateOptions,
  getWalletFilterOptions,
  type HistoryTypeFilter,
  type TransactionFilters,
} from '@/features/history/transactionFilters';
import { formatDateKey, formatMonthKey } from '@/lib/period';
import { useAppTheme, spacing } from '@/theme';

const FILTERS: { value: HistoryTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'income', label: 'Income' },
  { value: 'transfers', label: 'Transfers' },
];

export function HistoryScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const { activeMonthKey } = useFinance();
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);
  const [filters, setFilters] = useState<TransactionFilters>({
    ...EMPTY_TRANSACTION_FILTERS,
  });
  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);
  const monthKey =
    selectedMonthKey && selectedMonthKey < activeMonthKey
      ? selectedMonthKey
      : activeMonthKey;
  const monthQuery = useFinanceMonth(monthKey);

  const updateFilters = (patch: Partial<TransactionFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
  };

  const clearFilters = () => {
    setFilters({ ...EMPTY_TRANSACTION_FILTERS });
  };

  const handleMonthChange = (nextMonthKey: string) => {
    setSelectedMonthKey(
      nextMonthKey === activeMonthKey ? null : nextMonthKey,
    );
    setFilters({ ...EMPTY_TRANSACTION_FILTERS });
    setSelectedTransaction(null);
  };

  if (monthQuery.status === 'loading') {
    return (
      <Screen>
        <PageHeader
          title="Transaction history"
          subtitle="Activity is grouped by the date it actually happened."
          preview={false}
        />
        <LoadingState label="Opening saved transactions…" />
      </Screen>
    );
  }

  if (monthQuery.status === 'error' || !monthQuery.data) {
    return (
      <Screen>
        <PageHeader
          title="Transaction history"
          subtitle="Activity is grouped by the date it actually happened."
          preview={false}
        />
        <ErrorState
          message={monthQuery.error?.message ?? 'Please try again.'}
          onRetry={monthQuery.retry}
        />
      </Screen>
    );
  }

  const data = monthQuery.data.transactions;
  const dateOptions = getTransactionDateOptions(data);
  const containerOptions = getContainerFilterOptions(data);
  const walletOptions = getWalletFilterOptions(data);
  const filtered = filterTransactions(data, filters);
  const hasFilters =
    filters.type !== 'all' ||
    filters.effectiveDate !== null ||
    filters.containerId !== null ||
    filters.walletId !== null;

  const groups = new Map<string, Transaction[]>();
  for (const transaction of filtered) {
    const existing = groups.get(transaction.effectiveDate);
    if (existing) {
      existing.push(transaction);
    } else {
      groups.set(transaction.effectiveDate, [transaction]);
    }
  }

  const reversedCount = data.filter(
    (transaction) => transaction.status === 'reversed',
  ).length;

  return (
    <Screen>
      <PageHeader
        title="Transaction history"
        subtitle="Activity is grouped by the date it actually happened."
        preview={false}
        right={
          <IconButton
            icon="calendar-outline"
            accessibilityLabel="Open monthly savings history"
            variant="surface"
            onPress={() => router.push('/monthly-history')}
          />
        }
      />

      <MonthNavigator
        monthKey={monthKey}
        activeMonthKey={activeMonthKey}
        onChange={handleMonthChange}
      />

      <View style={styles.summaryRow}>
        <Card style={styles.summaryCard}>
          <AppText variant="micro" color={theme.colors.textTertiary}>
            {hasFilters ? 'MATCHING RECORDS' : 'RECORDS'}
          </AppText>
          <AppText variant="h2">{filtered.length}</AppText>
          <AppText variant="caption" color={theme.colors.textSecondary}>
            {hasFilters
              ? `of ${data.length} in ${formatMonthKey(monthKey)}`
              : `in ${formatMonthKey(monthKey)}`}
          </AppText>
        </Card>
        <Card style={styles.summaryCard}>
          <AppText variant="micro" color={theme.colors.textTertiary}>
            REVERSED
          </AppText>
          <AppText variant="h2">{reversedCount}</AppText>
          <AppText variant="caption" color={theme.colors.textSecondary}>
            kept for history
          </AppText>
        </Card>
      </View>

      <View style={styles.filterBlock}>
        <View style={styles.filterHeader}>
          <AppText variant="micro" color={theme.colors.textTertiary}>
            FILTERS
          </AppText>
          {hasFilters ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear all transaction filters"
              onPress={clearFilters}
              style={styles.clearFilters}
            >
              <AppText
                variant="caption"
                weight="semibold"
                color={theme.colors.primary}
              >
                Clear all
              </AppText>
            </Pressable>
          ) : null}
        </View>

        <FilterRow label="Type">
          {FILTERS.map((item) => (
            <Chip
              key={item.value}
              label={item.label}
              selected={filters.type === item.value}
              onPress={() => updateFilters({ type: item.value })}
            />
          ))}
        </FilterRow>

        {dateOptions.length > 0 ? (
          <FilterRow label="Date">
            <Chip
              label="All dates"
              selected={filters.effectiveDate === null}
              onPress={() => updateFilters({ effectiveDate: null })}
            />
            {dateOptions.map((dateKey) => (
              <Chip
                key={dateKey}
                label={formatDateKey(dateKey)}
                selected={filters.effectiveDate === dateKey}
                onPress={() => updateFilters({ effectiveDate: dateKey })}
              />
            ))}
          </FilterRow>
        ) : null}

        {containerOptions.length > 0 ? (
          <FilterRow label="Container">
            <Chip
              label="All containers"
              selected={filters.containerId === null}
              onPress={() => updateFilters({ containerId: null })}
            />
            {containerOptions.map((option) => (
              <Chip
                key={option.id}
                label={option.label}
                selected={filters.containerId === option.id}
                onPress={() => updateFilters({ containerId: option.id })}
              />
            ))}
          </FilterRow>
        ) : null}

        {walletOptions.length > 0 ? (
          <FilterRow label="Wallet">
            <Chip
              label="All wallets"
              selected={filters.walletId === null}
              onPress={() => updateFilters({ walletId: null })}
            />
            {walletOptions.map((option) => (
              <Chip
                key={option.id}
                label={option.label}
                selected={filters.walletId === option.id}
                onPress={() => updateFilters({ walletId: option.id })}
              />
            ))}
          </FilterRow>
        ) : null}
      </View>

      <NoticeBanner
        title="Transfers are not spending"
        message="Internal transfers carry a TRANSFER label and never count as income, expenses, or net savings. Reversed records stay visible with their status intact."
        icon="git-compare-outline"
      />

      <View style={styles.groups}>
        {groups.size === 0 ? (
          <EmptyState
            icon="receipt-outline"
            title={
              data.length === 0
                ? 'No activity this month'
                : 'No matching transactions'
            }
            description={
              data.length === 0
                ? 'Try an earlier month. Empty months are valid and remain available in monthly history.'
                : 'Try another filter. Matching activity will appear here.'
            }
            actionLabel={hasFilters ? 'Clear filters' : undefined}
            onAction={hasFilters ? clearFilters : undefined}
          />
        ) : (
          Array.from(groups.entries()).map(([dateKey, transactions]) => (
            <View key={dateKey} style={styles.group}>
              <View style={styles.groupHeader}>
                <AppText variant="label" color={theme.colors.textSecondary}>
                  {formatDateKey(dateKey)}
                </AppText>
                <AppText variant="micro" color={theme.colors.textTertiary}>
                  {transactions.length}{' '}
                  {transactions.length === 1 ? 'RECORD' : 'RECORDS'}
                </AppText>
              </View>
              <Card padded={false} style={styles.listCard}>
                {transactions.map((transaction, index) => (
                  <View key={transaction.id}>
                    <TransactionRow
                      transaction={transaction}
                      showDate={false}
                      onPress={() => setSelectedTransaction(transaction)}
                    />
                    {index < transactions.length - 1 ? <Divider /> : null}
                  </View>
                ))}
              </Card>
            </View>
          ))
        )}
      </View>

      <TransactionDetailModal
        transaction={selectedTransaction}
        onClose={() => setSelectedTransaction(null)}
      />
    </Screen>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const { theme } = useAppTheme();

  return (
    <View style={styles.filterRow}>
      <AppText
        variant="caption"
        color={theme.colors.textSecondary}
        style={styles.filterLabel}
      >
        {label}
      </AppText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterOptions}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  summaryCard: {
    flex: 1,
    gap: 2,
  },
  filterBlock: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  filterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  clearFilters: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  filterLabel: {
    width: 72,
  },
  filterOptions: {
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  groups: {
    gap: spacing.xl,
    marginTop: spacing.xl,
  },
  group: {
    gap: spacing.sm,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listCard: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
});
