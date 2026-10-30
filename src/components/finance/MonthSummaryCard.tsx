import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import type { MonthSummary } from '@/data/models';
import { formatPeso } from '@/lib/money';
import { formatMonthKey, formatMonthPeriod } from '@/lib/period';
import { useAppTheme, radii, spacing } from '@/theme';
import { AppText } from '../AppText';
import { Card } from '../ui/Card';
import { ProgressBar } from '../ui/ProgressBar';

interface MonthSummaryCardProps {
  summary: MonthSummary;
  previous?: MonthSummary | null;
  showBudget?: boolean;
}

export function MonthSummaryCard({
  summary,
  previous = null,
  showBudget = true,
}: MonthSummaryCardProps) {
  const { theme } = useAppTheme();
  const positive = summary.netSavingsMinor >= 0;
  const netSavingsLabel = formatPeso(summary.netSavingsMinor, {
    showSign: true,
  });
  const compactNetAmount = netSavingsLabel.length > 12;
  const overallRatio =
    summary.totalLimitMinor > 0
      ? summary.totalSpentMinor / summary.totalLimitMinor
      : 0;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText variant="micro" color={theme.colors.textTertiary}>
            {summary.isCurrent ? 'THIS MONTH SO FAR' : 'MONTHLY RESULT'}
          </AppText>
          <AppText variant="h2">{formatMonthKey(summary.monthKey)}</AppText>
          <AppText variant="caption" color={theme.colors.textSecondary}>
            {formatMonthPeriod(summary.monthKey)}
          </AppText>
        </View>
        <View
          style={[
            styles.netPill,
            {
              backgroundColor: positive
                ? theme.colors.successSoft
                : theme.colors.dangerSoft,
            },
          ]}
        >
          <Ionicons
            name={positive ? 'trending-up-outline' : 'trending-down-outline'}
            size={14}
            color={positive ? theme.colors.success : theme.colors.danger}
          />
          <AppText
            variant="micro"
            color={positive ? theme.colors.success : theme.colors.danger}
          >
            NET SAVINGS
          </AppText>
        </View>
      </View>

      <View>
        <AppText
          variant={compactNetAmount ? 'amount' : 'amountLarge'}
          color={positive ? theme.colors.text : theme.colors.danger}
          numberOfLines={1}
        >
          {netSavingsLabel}
        </AppText>
        <AppText variant="caption" color={theme.colors.textSecondary}>
          Income minus expenses. Transfers and savings contributions are not
          counted.
        </AppText>
      </View>

      <View style={styles.metrics}>
        <Metric
          label="Income"
          value={formatPeso(summary.incomeMinor)}
          tone={theme.colors.success}
          icon="arrow-down-circle-outline"
        />
        <View
          style={[styles.rule, { backgroundColor: theme.colors.border }]}
        />
        <Metric
          label="Expenses"
          value={formatPeso(summary.expenseMinor)}
          tone={theme.colors.danger}
          icon="arrow-up-circle-outline"
        />
        <View
          style={[styles.rule, { backgroundColor: theme.colors.border }]}
        />
        <Metric
          label="Records"
          value={String(summary.postedTransactionCount)}
          tone={theme.colors.textSecondary}
          icon="receipt-outline"
        />
      </View>

      {showBudget ? (
        <View style={styles.budgetBlock}>
          <View style={styles.budgetHeader}>
            <View style={styles.budgetTitle}>
              <AppText variant="label" weight="semibold">
                Budget performance
              </AppText>
              <AppText variant="caption" color={theme.colors.textSecondary}>
                {formatPeso(summary.totalLimitMinor)} planned
              </AppText>
            </View>
            <View style={styles.budgetAmount}>
              <AppText
                variant="label"
                weight="bold"
                color={
                  summary.totalRemainingMinor >= 0
                    ? theme.colors.primary
                    : theme.colors.danger
                }
              >
                {summary.totalRemainingMinor >= 0
                  ? `${formatPeso(summary.totalRemainingMinor)} left`
                  : `${formatPeso(
                      Math.abs(summary.totalRemainingMinor),
                    )} over`}
              </AppText>
              <AppText variant="micro" color={theme.colors.textTertiary}>
                {formatPeso(summary.totalSpentMinor)} spent
              </AppText>
            </View>
          </View>
          <ProgressBar
            value={overallRatio}
            tone={
              overallRatio > 1
                ? 'danger'
                : overallRatio >= 0.85
                  ? 'warning'
                  : 'success'
            }
            accessibilityLabel="Budget spending compared with monthly limits"
          />
          <View style={styles.budgetNote}>
            <Ionicons
              name="information-circle-outline"
              size={14}
              color={theme.colors.textTertiary}
            />
            <AppText
              variant="micro"
              color={theme.colors.textTertiary}
              style={styles.flex}
            >
              Limits are plans, not balances. Unused limits never become money.
            </AppText>
          </View>
        </View>
      ) : null}

      <View style={styles.placementBlock}>
        <PlacementRow
          icon="layers-outline"
          label="Unallocated carry-in"
          caption="Carried from closed months, not new income"
          value={formatPeso(summary.unallocatedCarryoverMinor)}
        />
        <View style={[styles.placementRule, { backgroundColor: theme.colors.border }]} />
        <PlacementRow
          icon="wallet-outline"
          label="Available budget"
          caption="Active budget balances plus Unallocated; Savings stays separate"
          value={formatPeso(summary.availableBudgetMinor)}
        />
      </View>

      {previous ? (
        <Comparison current={summary} previous={previous} />
      ) : null}
    </Card>
  );
}

function Metric({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: string;
  icon: 'arrow-down-circle-outline' | 'arrow-up-circle-outline' | 'receipt-outline';
}) {
  return (
    <View style={styles.metric}>
      <View style={styles.metricLabel}>
        <Ionicons name={icon} size={14} color={tone} />
        <AppText variant="micro" color={tone}>
          {label.toUpperCase()}
        </AppText>
      </View>
      <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

function PlacementRow({
  icon,
  label,
  caption,
  value,
}: {
  icon: 'layers-outline' | 'wallet-outline';
  label: string;
  caption: string;
  value: string;
}) {
  const { theme } = useAppTheme();

  return (
    <View style={styles.placementRow}>
      <View
        style={[
          styles.placementIcon,
          { backgroundColor: theme.colors.surfaceMuted },
        ]}
      >
        <Ionicons name={icon} size={16} color={theme.colors.primary} />
      </View>
      <View style={styles.placementCopy}>
        <AppText variant="caption" weight="semibold">
          {label}
        </AppText>
        <AppText variant="micro" color={theme.colors.textSecondary}>
          {caption}
        </AppText>
      </View>
      <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

function Comparison({
  current,
  previous,
}: {
  current: MonthSummary;
  previous: MonthSummary;
}) {
  const { theme } = useAppTheme();
  const netDelta = current.netSavingsMinor - previous.netSavingsMinor;
  const expenseDelta = current.expenseMinor - previous.expenseMinor;

  return (
    <View
      style={[
        styles.comparison,
        {
          backgroundColor: theme.colors.surfaceMuted,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <View style={styles.comparisonHeader}>
        <Ionicons
          name="git-compare-outline"
          size={16}
          color={theme.colors.primary}
        />
        <AppText variant="label" weight="semibold" style={styles.flex}>
          Compared with {formatMonthKey(previous.monthKey)}
        </AppText>
      </View>
      <ComparisonRow
        label="Net savings change"
        value={`${netDelta >= 0 ? '+' : '-'}${formatPeso(
          Math.abs(netDelta),
        )}`}
        favorable={netDelta >= 0}
      />
      <ComparisonRow
        label="Expenses"
        value={`${expenseDelta >= 0 ? '+' : '-'}${formatPeso(
          Math.abs(expenseDelta),
        )}`}
        favorable={expenseDelta <= 0}
      />
    </View>
  );
}

function ComparisonRow({
  label,
  value,
  favorable,
}: {
  label: string;
  value: string;
  favorable: boolean;
}) {
  const { theme } = useAppTheme();

  return (
    <View style={styles.comparisonRow}>
      <AppText variant="caption" color={theme.colors.textSecondary}>
        {label}
      </AppText>
      <AppText
        variant="caption"
        weight="semibold"
        color={favorable ? theme.colors.success : theme.colors.danger}
      >
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.lg,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  netPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  metrics: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  metric: {
    flex: 1,
    gap: 3,
  },
  metricLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rule: {
    width: StyleSheet.hairlineWidth,
  },
  budgetBlock: {
    gap: spacing.sm,
  },
  budgetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  budgetTitle: {
    flex: 1,
    gap: 1,
  },
  budgetAmount: {
    alignItems: 'flex-end',
    gap: 1,
  },
  budgetNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  placementBlock: {
    gap: spacing.sm,
  },
  placementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  placementIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placementCopy: {
    flex: 1,
    gap: 1,
  },
  placementRule: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 42,
  },
  comparison: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.sm,
  },
  comparisonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  comparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
});
