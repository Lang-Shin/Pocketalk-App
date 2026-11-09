import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { TransactionDetailModal } from '@/components/finance/TransactionDetailModal';
import { TransactionRow } from '@/components/finance/TransactionRow';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { MonthNavigator } from '@/components/ui/MonthNavigator';
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
import { useAppTheme, radii, spacing } from '@/theme';

const FILTERS: { value: HistoryTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'income', label: 'Income' },
  { value: 'transfers', label: 'Transfers' },
];

type FilterKey = 'type' | 'date' | 'container' | 'wallet';
type SelectOption = { value: string | null; label: string };

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
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
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
  const selectors: {
    key: FilterKey;
    label: string;
    value: string | null;
    options: SelectOption[];
    onSelect: (value: string | null) => void;
  }[] = [
    {
      key: 'type', label: 'Transaction type', value: filters.type,
      options: FILTERS.map((item) => ({ value: item.value, label: item.label })),
      onSelect: (value) => {
        const type = FILTERS.find((item) => item.value === value);
        if (type) updateFilters({ type: type.value });
      },
    },
    {
      key: 'date', label: 'Date', value: filters.effectiveDate,
      options: [{ value: null, label: 'All dates' }, ...dateOptions.map((date) => ({ value: date, label: formatDateKey(date) }))],
      onSelect: (value) => updateFilters({ effectiveDate: value }),
    },
    {
      key: 'container', label: 'Container', value: filters.containerId,
      options: [{ value: null, label: 'All containers' }, ...containerOptions.map((item) => ({ value: item.id, label: item.label }))],
      onSelect: (value) => updateFilters({ containerId: value }),
    },
    {
      key: 'wallet', label: 'Wallet', value: filters.walletId,
      options: [{ value: null, label: 'All wallets' }, ...walletOptions.map((item) => ({ value: item.id, label: item.label }))],
      onSelect: (value) => updateFilters({ walletId: value }),
    },
  ];
  const activeSelector = selectors.find((selector) => selector.key === openFilter);
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
    <Screen decoration="history">
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
        <View style={styles.summaryCard}>
          <AppText variant="micro" color={theme.colors.textTertiary}>
            {hasFilters ? 'MATCHING RECORDS' : 'RECORDS'}
          </AppText>
          <AppText variant="h2">{filtered.length}</AppText>
          <AppText variant="caption" color={theme.colors.textSecondary}>
            {hasFilters
              ? `of ${data.length} in ${formatMonthKey(monthKey)}`
              : `in ${formatMonthKey(monthKey)}`}
          </AppText>
        </View>
        <View style={styles.summaryCard}>
          <AppText variant="micro" color={theme.colors.textTertiary}>
            REVERSED
          </AppText>
          <AppText variant="h2">{reversedCount}</AppText>
          <AppText variant="caption" color={theme.colors.textSecondary}>
            kept for history
          </AppText>
        </View>
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

        <View style={styles.filterGrid}>
          {selectors.map((selector) => {
            const selected = selector.options.find((option) => option.value === selector.value);
            return (
              <Pressable
                key={selector.key}
                accessibilityRole="button"
                accessibilityLabel={`${selector.label}: ${selected?.label ?? selector.value}`}
                accessibilityHint="Opens filter options"
                onPress={() => setOpenFilter(selector.key)}
                style={[styles.filterSelect, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
              >
                <View style={styles.filterCopy}>
                  <AppText variant="micro" color={theme.colors.textTertiary}>{selector.label.toUpperCase()}</AppText>
                  <AppText variant="caption" weight="semibold" numberOfLines={1}>{selected?.label ?? selector.value}</AppText>
                </View>
                <Ionicons name="chevron-down" size={18} color={theme.colors.textSecondary} />
              </Pressable>
            );
          })}
        </View>
      </View>

      <Modal visible={activeSelector !== undefined} transparent animationType="fade" onRequestClose={() => setOpenFilter(null)}>
        <SafeAreaView style={styles.modalOverlay}>
          <View accessibilityViewIsModal style={[styles.modalCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <View style={styles.modalHeader}>
              <AppText variant="h3" style={styles.filterCopy}>Select {activeSelector?.label.toLowerCase()}</AppText>
              <IconButton icon="close" accessibilityLabel="Close filter options" onPress={() => setOpenFilter(null)} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              {activeSelector?.options.map((option) => {
                const selected = option.value === activeSelector.value;
                return (
                  <Pressable
                    key={option.value ?? '__all__'}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => { activeSelector.onSelect(option.value); setOpenFilter(null); }}
                    style={[styles.modalOption, { borderColor: theme.colors.border }]}
                  >
                    <AppText variant="bodySmall" style={styles.filterCopy}>{option.label}</AppText>
                    {selected ? <Ionicons name="checkmark-circle" size={22} color={theme.colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>

      <AppText variant="caption" color={theme.colors.textSecondary}>
        Transfers are not spending. Reversed records remain visible.
      </AppText>

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
  filterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  filterSelect: {
    flexBasis: 150,
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  filterCopy: {
    flex: 1,
    minWidth: 0,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '80%',
    alignSelf: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
