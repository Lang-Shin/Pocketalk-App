import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BudgetCard } from '@/components/finance/BudgetCard';
import { ContainerEditorModal } from '@/components/finance/ContainerEditorModal';
import { AppButton } from '@/components/ui/AppButton';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { MonthNavigator } from '@/components/ui/MonthNavigator';
import { NoticeBanner } from '@/components/ui/NoticeBanner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import {
  selectContainerSnapshots,
  selectMonthSummary,
} from '@/data/financeSelectors';
import { useMockFinance } from '@/data/financeStore';
import type { BudgetContainer, ContainerSnapshot } from '@/data/models';
import { formatMonthKey, isPastMonth } from '@/lib/period';
import { formatPeso } from '@/lib/money';
import { getContentWidth, useAppTheme, spacing } from '@/theme';

type StatusFilter = 'all' | 'on-track' | 'attention';
type EditorState = BudgetContainer | 'new' | null;

function needsAttention(container: ContainerSnapshot): boolean {
  if (container.limitMinor <= 0) return true;
  return container.spentMinor / container.limitMinor >= 0.85;
}

export function BudgetsScreen() {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { state, activeMonthKey } = useMockFinance();
  const [selectedMonthKey, setSelectedMonthKey] = useState(activeMonthKey);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [editor, setEditor] = useState<EditorState>(null);

  const monthKey =
    selectedMonthKey > activeMonthKey ? activeMonthKey : selectedMonthKey;
  const isHistorical = isPastMonth(monthKey, activeMonthKey);
  const snapshots = selectContainerSnapshots(state, monthKey);
  const activeContainers = snapshots.filter(
    (container) => container.status === 'active',
  );
  const archivedContainers = snapshots.filter(
    (container) => container.status === 'archived',
  );
  const summary = selectMonthSummary(state, monthKey, activeMonthKey);
  const filtered = activeContainers.filter((container) => {
    if (filter === 'all') return true;
    if (filter === 'attention') return needsAttention(container);
    return !needsAttention(container);
  });
  const overallRatio =
    summary.totalLimitMinor > 0
      ? summary.totalSpentMinor / summary.totalLimitMinor
      : 0;
  const useTwoColumns = getContentWidth(width, true) >= 680;
  const archivedBalance = archivedContainers.reduce(
    (total, container) => total + container.balanceMinor,
    0,
  );

  return (
    <Screen wide>
      <PageHeader
        title="Budget containers"
        subtitle="Give every peso a purpose without confusing plans with balances."
        right={
          <IconButton
            icon="add"
            accessibilityLabel="Create a budget container"
            variant="primary"
            disabled={isHistorical}
            onPress={() => setEditor('new')}
          />
        }
      />

      <MonthNavigator
        monthKey={monthKey}
        activeMonthKey={activeMonthKey}
        onChange={(nextMonthKey) => {
          setEditor(null);
          setSelectedMonthKey(nextMonthKey);
        }}
      />

      {isHistorical ? (
        <NoticeBanner
          title={`Viewing ${formatMonthKey(monthKey)}`}
          message="Historical limits and spending are read-only in this preview. Switch to the current month to edit or add containers."
          icon="time-outline"
        />
      ) : null}

      <Card style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <View style={styles.summaryCopy}>
            <AppText variant="micro" color={theme.colors.textTertiary}>
              {formatMonthKey(monthKey).toUpperCase()}
            </AppText>
            <AppText variant="h2">Monthly plan</AppText>
          </View>
          <AppText variant="h3" color={theme.colors.primary}>
            {Math.round(overallRatio * 100)}% used
          </AppText>
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
          accessibilityLabel="Overall budget usage"
        />
        <View style={styles.summaryStats}>
          <SummaryStat
            label="Planned"
            value={formatPeso(summary.totalLimitMinor)}
          />
          <View
            style={[styles.summaryRule, { backgroundColor: theme.colors.border }]}
          />
          <SummaryStat
            label="Spent"
            value={formatPeso(summary.totalSpentMinor)}
          />
          <View
            style={[styles.summaryRule, { backgroundColor: theme.colors.border }]}
          />
          <SummaryStat
            label={summary.totalRemainingMinor >= 0 ? 'Remaining' : 'Over'}
            value={formatPeso(Math.abs(summary.totalRemainingMinor))}
            highlight
          />
        </View>
      </Card>

      <View style={styles.notice}>
        <NoticeBanner
          title="A limit is not money"
          message="Monthly limits guide spending. Actual container balances are the money currently assigned to each container."
          icon="leaf-outline"
        />
      </View>

      <View style={styles.filters}>
        <Chip
          label={`Active (${activeContainers.length})`}
          selected={filter === 'all'}
          onPress={() => setFilter('all')}
        />
        <Chip
          label="On track"
          selected={filter === 'on-track'}
          onPress={() => setFilter('on-track')}
        />
        <Chip
          label="Needs attention"
          selected={filter === 'attention'}
          onPress={() => setFilter('attention')}
        />
      </View>

      {filtered.length === 0 ? (
        <EmptyState
          icon="checkmark-done-outline"
          title={
            activeContainers.length === 0
              ? 'No active containers'
              : 'Nothing in this filter'
          }
          description={
            activeContainers.length === 0
              ? 'Create a container for the current month to start planning.'
              : 'Containers in this filter will appear here when their progress changes.'
          }
          actionLabel={
            filter === 'all'
              ? isHistorical
                ? undefined
                : 'Create container'
              : 'Show all'
          }
          onAction={
            filter === 'all'
              ? isHistorical
                ? undefined
                : () => setEditor('new')
              : () => setFilter('all')
          }
        />
      ) : (
        <View
          style={[styles.grid, useTwoColumns ? styles.gridTwoColumns : null]}
        >
          {filtered.map((container) => (
            <View
              key={container.id}
              style={useTwoColumns ? styles.gridItem : undefined}
            >
              <BudgetCard
                container={container}
                onPress={
                  isHistorical ? undefined : () => setEditor(container)
                }
              />
            </View>
          ))}
        </View>
      )}

      {archivedContainers.length > 0 ? (
        <View style={styles.archivedSection}>
          <SectionHeader
            title="Archived containers"
            subtitle={`${formatPeso(
              archivedBalance,
            )} still held · included in recorded funds`}
          />
          <NoticeBanner
            title="Archived money does not disappear"
            message="Archived containers stay out of new active planning, but their balances and history remain visible."
            icon="archive-outline"
          />
          <View style={styles.grid}>
            {archivedContainers.map((container) => (
              <BudgetCard
                key={container.id}
                container={container}
                onPress={
                  isHistorical ? undefined : () => setEditor(container)
                }
              />
            ))}
          </View>
        </View>
      ) : null}

      <Card style={styles.footerCard}>
        <AppText variant="h3">Plan with room to change</AppText>
        <AppText variant="bodySmall" color={theme.colors.textSecondary}>
          Rename, recolor, archive, or safely retire a container without
          rewriting its past labels or deleting money history.
        </AppText>
        <AppButton
          label="Review monthly history"
          variant="ghost"
          icon="calendar-outline"
          onPress={() => router.push('/monthly-history')}
        />
      </Card>

      {editor ? (
        <ContainerEditorModal
          key={editor === 'new' ? `new-${monthKey}` : editor.id}
          visible
          monthKey={monthKey}
          activeMonthKey={activeMonthKey}
          container={editor === 'new' ? undefined : editor}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </Screen>
  );
}

function SummaryStat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  const { theme } = useAppTheme();

  return (
    <View style={styles.stat}>
      <AppText variant="micro" color={theme.colors.textTertiary}>
        {label.toUpperCase()}
      </AppText>
      <AppText
        variant="bodySmall"
        weight="bold"
        color={highlight ? theme.colors.primary : theme.colors.text}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  summaryCopy: {
    gap: 2,
  },
  summaryStats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.md,
  },
  summaryRule: {
    width: StyleSheet.hairlineWidth,
  },
  stat: {
    flex: 1,
    gap: 2,
  },
  notice: {
    marginTop: spacing.lg,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  grid: {
    gap: spacing.md,
  },
  gridTwoColumns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridItem: {
    width: '48%',
    flexGrow: 1,
  },
  archivedSection: {
    gap: spacing.md,
    marginTop: spacing.xxxl,
  },
  footerCard: {
    gap: spacing.sm,
    marginTop: spacing.xxxl,
  },
});
