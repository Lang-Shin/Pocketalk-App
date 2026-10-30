import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
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
import { formatDateKey, formatMonthKey } from '@/lib/period';
import { useAppTheme, spacing } from '@/theme';

type HistoryFilter = 'all' | 'expenses' | 'income' | 'transfers';

const FILTERS: { value: HistoryFilter; label: string }[] = [
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
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const monthKey =
    selectedMonthKey && selectedMonthKey < activeMonthKey
      ? selectedMonthKey
      : activeMonthKey;
  const monthQuery = useFinanceMonth(monthKey);

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

  const filtered = data.filter((transaction) => {
    if (filter === 'all') return true;
    if (filter === 'expenses') return transaction.kind === 'expense';
    if (filter === 'income') return transaction.kind === 'income';
    return (
      transaction.kind === 'wallet_transfer' ||
      transaction.kind === 'container_transfer' ||
      transaction.kind === 'savings'
    );
  });

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
        onChange={(nextMonthKey) =>
          setSelectedMonthKey(
            nextMonthKey === activeMonthKey ? null : nextMonthKey,
          )
        }
      />

      <View style={styles.summaryRow}>
        <Card style={styles.summaryCard}>
          <AppText variant="micro" color={theme.colors.textTertiary}>
            RECORDS
          </AppText>
          <AppText variant="h2">{data.length}</AppText>
          <AppText variant="caption" color={theme.colors.textSecondary}>
            in {formatMonthKey(monthKey)}
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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
      >
        {FILTERS.map((item) => (
          <Chip
            key={item.value}
            label={item.label}
            selected={filter === item.value}
            onPress={() => setFilter(item.value)}
          />
        ))}
      </ScrollView>

      <NoticeBanner
        title="History is never silently deleted"
        message="A reversed transaction stays visible with its status intact. Effective dates stay fixed when the device time zone changes."
        icon="time-outline"
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
            actionLabel={filter === 'all' ? undefined : 'Show all'}
            onAction={filter === 'all' ? undefined : () => setFilter('all')}
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
                    />
                    {index < transactions.length - 1 ? <Divider /> : null}
                  </View>
                ))}
              </Card>
            </View>
          ))
        )}
      </View>
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
  filters: {
    gap: spacing.sm,
    paddingVertical: spacing.lg,
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
