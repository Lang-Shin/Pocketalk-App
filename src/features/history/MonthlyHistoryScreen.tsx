import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppText } from '@/components/AppText';
import { MonthSummaryCard } from '@/components/finance/MonthSummaryCard';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconBadge } from '@/components/ui/IconBadge';
import { MonthNavigator } from '@/components/ui/MonthNavigator';
import { NoticeBanner } from '@/components/ui/NoticeBanner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Screen } from '@/components/ui/Screen';
import {
  selectContainerMonthResults,
  selectContainerSnapshots,
  selectMonthSummary,
} from '@/data/financeSelectors';
import { useMockFinance } from '@/data/financeStore';
import type { ContainerMonthResult } from '@/data/models';
import { formatPeso } from '@/lib/money';
import {
  formatMonthKey,
  formatMonthKeyShort,
  getMonthKeysBack,
  shiftMonthKey,
} from '@/lib/period';
import { useAppTheme, layout, radii, spacing } from '@/theme';

export function MonthlyHistoryScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { state, activeMonthKey } = useMockFinance();
  const [selectedMonthKey, setSelectedMonthKey] = useState(activeMonthKey);
  const monthKey =
    selectedMonthKey > activeMonthKey ? activeMonthKey : selectedMonthKey;
  const previousMonthKey = shiftMonthKey(monthKey, -1);
  const summary = selectMonthSummary(state, monthKey, activeMonthKey);
  const previous = selectMonthSummary(
    state,
    previousMonthKey,
    activeMonthKey,
  );
  const results = selectContainerMonthResults(state, monthKey);
  const resultsWithActivity = results.filter(
    (result) =>
      result.hasActivity ||
      result.endingBalanceMinor !== 0 ||
      result.status === 'archived',
  );
  const availableMonths = getMonthKeysBack(6, activeMonthKey)
    .filter((candidate) => {
      const candidateSummary = selectMonthSummary(
        state,
        candidate,
        activeMonthKey,
      );
      return (
        candidateSummary.hasActivity ||
        candidateSummary.savingsEndingBalanceMinor !== 0 ||
        selectContainerSnapshots(state, candidate).length > 0
      );
    })
    .reverse();
  const hasReportContent =
    summary.hasActivity || resultsWithActivity.length > 0;

  return (
    <Screen edges={['top', 'bottom']}>
      <PageHeader
        title="Monthly history"
        subtitle="Past months stay inspectable and comparable offline."
        onBack={() => router.back()}
      />

      <MonthNavigator
        monthKey={monthKey}
        activeMonthKey={activeMonthKey}
        onChange={setSelectedMonthKey}
        label="History month"
      />

      {availableMonths.length > 0 ? (
        <View style={styles.monthStripSection}>
          <AppText variant="micro" color={theme.colors.textTertiary}>
            MONTHS WITH ACTIVITY OR A PLAN
          </AppText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.monthStrip}
          >
            {availableMonths.map((candidate) => {
              const selected = candidate === monthKey;
              return (
                <Pressable
                  key={candidate}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${formatMonthKey(candidate)}`}
                  accessibilityState={{ selected }}
                  onPress={() => setSelectedMonthKey(candidate)}
                  style={({ pressed }) => [
                    styles.monthChip,
                    {
                      backgroundColor: selected
                        ? theme.colors.primary
                        : theme.colors.surface,
                      borderColor: selected
                        ? theme.colors.primary
                        : theme.colors.border,
                      opacity: pressed ? 0.76 : 1,
                    },
                  ]}
                >
                  <AppText
                    variant="caption"
                    weight="semibold"
                    color={
                      selected
                        ? theme.colors.onPrimary
                        : theme.colors.textSecondary
                    }
                  >
                    {formatMonthKeyShort(candidate)}
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.section}>
        <MonthSummaryCard summary={summary} previous={previous} />
      </View>

      {!hasReportContent ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="calendar-clear-outline"
            title={`No recorded activity in ${formatMonthKey(monthKey)}`}
            description="The month is still available, and totals remain zero. Use the month arrows to inspect another period."
          />
        </View>
      ) : (
        <>
          <View style={styles.section}>
            <View style={styles.sectionTitle}>
              <AppText variant="h3">Container results</AppText>
              <AppText variant="caption" color={theme.colors.textSecondary}>
                Historical labels stay fixed for the months they describe.
              </AppText>
            </View>
            {resultsWithActivity.length === 0 ? (
              <Card>
                <AppText
                  variant="bodySmall"
                  color={theme.colors.textSecondary}
                >
                  No container had a limit, spending, or balance this month.
                </AppText>
              </Card>
            ) : (
              <View style={styles.results}>
                {resultsWithActivity.map((result) => (
                  <ContainerResultRow
                    key={result.containerId}
                    result={result}
                    stacked={width < 420}
                  />
                ))}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionTitle}>
              <AppText variant="h3">Savings and ending balances</AppText>
              <AppText variant="caption" color={theme.colors.textSecondary}>
                A stock balance, separate from monthly net savings.
              </AppText>
            </View>
            <Card style={styles.savingsCard}>
              <View style={styles.savingsRow}>
                <View style={styles.savingsIcon}>
                  <Ionicons
                    name="flag-outline"
                    size={19}
                    color={theme.colors.success}
                  />
                </View>
                <View style={styles.savingsCopy}>
                  <AppText variant="label" weight="semibold">
                    Savings contributions
                  </AppText>
                  <AppText
                    variant="caption"
                    color={theme.colors.textSecondary}
                  >
                    Transfers into savings containers
                  </AppText>
                </View>
                <AppText variant="h3" color={theme.colors.success}>
                  {formatPeso(summary.savingsContributionsMinor)}
                </AppText>
              </View>
              <View
                style={[styles.rule, { backgroundColor: theme.colors.border }]}
              />
              <View style={styles.savingsRow}>
                <View style={styles.savingsIcon}>
                  <Ionicons
                    name="wallet-outline"
                    size={19}
                    color={theme.colors.primary}
                  />
                </View>
                <View style={styles.savingsCopy}>
                  <AppText variant="label" weight="semibold">
                    Savings ending balance
                  </AppText>
                  <AppText
                    variant="caption"
                    color={theme.colors.textSecondary}
                  >
                    Money held at the end of the month
                  </AppText>
                </View>
                <AppText variant="h3">
                  {formatPeso(summary.savingsEndingBalanceMinor)}
                </AppText>
              </View>
            </Card>
            <NoticeBanner
              title="Do not add these numbers together"
              message="Net savings measures money in minus money out. Savings contributions are internal transfers, and the ending balance is what remains in savings containers."
              icon="information-circle-outline"
            />
          </View>
        </>
      )}

      <View style={styles.section}>
        <NoticeBanner
          title="Mock-backed history"
          message="These months are sample records for the Phase 2 interface. Changes are kept only for this app session and are not saved to a database."
          icon="flask-outline"
        />
      </View>
    </Screen>
  );
}

function ContainerResultRow({
  result,
  stacked,
}: {
  result: ContainerMonthResult;
  stacked: boolean;
}) {
  const { theme } = useAppTheme();
  const hasLimit = result.limitMinor > 0;
  const ratio = hasLimit ? result.spentMinor / result.limitMinor : 0;

  return (
    <Card style={styles.resultCard}>
      <View style={styles.resultHeader}>
        <IconBadge icon={result.icon} tone={result.tone} size={40} />
        <View style={styles.resultCopy}>
          <View style={styles.resultName}>
            <AppText
              variant="bodySmall"
              weight="semibold"
              numberOfLines={stacked ? 2 : 1}
              style={styles.resultNameText}
            >
              {result.name}
            </AppText>
            {result.kind === 'savings' ? (
              <View
                style={[
                  styles.tag,
                  { backgroundColor: theme.colors.successSoft },
                ]}
              >
                <AppText variant="micro" color={theme.colors.success}>
                  SAVINGS
                </AppText>
              </View>
            ) : null}
            {result.status === 'archived' ? (
              <View
                style={[
                  styles.tag,
                  { backgroundColor: theme.colors.surfaceAlt },
                ]}
              >
                <AppText variant="micro" color={theme.colors.textSecondary}>
                  ARCHIVED
                </AppText>
              </View>
            ) : null}
          </View>
          <AppText variant="caption" color={theme.colors.textSecondary}>
            {hasLimit
              ? `${formatPeso(result.spentMinor)} of ${formatPeso(
                  result.limitMinor,
                )} spent`
              : `${formatPeso(result.spentMinor)} spent · no monthly limit`}
          </AppText>
        </View>
        {!stacked ? (
          <View style={styles.resultAmount}>
            <AppText variant="micro" color={theme.colors.textTertiary}>
              ENDING BALANCE
            </AppText>
            <AppText variant="bodySmall" weight="bold">
              {formatPeso(result.endingBalanceMinor)}
            </AppText>
          </View>
        ) : null}
      </View>

      {stacked ? (
        <View style={styles.resultAmountRow}>
          <AppText variant="micro" color={theme.colors.textTertiary}>
            ENDING BALANCE
          </AppText>
          <AppText variant="bodySmall" weight="bold">
            {formatPeso(result.endingBalanceMinor)}
          </AppText>
        </View>
      ) : null}

      {hasLimit ? (
        <View style={styles.resultFooter}>
          <AppText
            variant="caption"
            color={
              result.remainingMinor >= 0
                ? theme.colors.success
                : theme.colors.danger
            }
            weight="semibold"
          >
            {result.remainingMinor >= 0
              ? `${formatPeso(result.remainingMinor)} left`
              : `${formatPeso(Math.abs(result.remainingMinor))} over`}
          </AppText>
          <AppText variant="micro" color={theme.colors.textTertiary}>
            {Math.round(ratio * 100)}% OF LIMIT
          </AppText>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
    marginTop: spacing.xxxl,
  },
  monthStripSection: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  monthStrip: {
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  monthChip: {
    minHeight: layout.touchTarget,
    minWidth: 58,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sectionTitle: {
    gap: 2,
  },
  emptyWrap: {
    marginTop: spacing.xxxl,
  },
  results: {
    gap: spacing.md,
  },
  resultCard: {
    gap: spacing.sm,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  resultCopy: {
    flex: 1,
    gap: 2,
  },
  resultName: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  resultNameText: {
    flexShrink: 1,
  },
  tag: {
    borderRadius: radii.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  resultAmount: {
    alignItems: 'flex-end',
    gap: 1,
  },
  resultAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  resultFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  savingsCard: {
    gap: spacing.md,
  },
  savingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  savingsIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  savingsCopy: {
    flex: 1,
    gap: 1,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
  },
});
