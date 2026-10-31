import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppText } from '@/components/AppText';
import { BudgetCard } from '@/components/finance/BudgetCard';
import { BalanceCard } from '@/components/finance/BalanceCard';
import { MoneyEntryModal } from '@/components/finance/MoneyEntryModal';
import { MonthSummaryCard } from '@/components/finance/MonthSummaryCard';
import { TransactionRow } from '@/components/finance/TransactionRow';
import { AppButton } from '@/components/ui/AppButton';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { IconBadge } from '@/components/ui/IconBadge';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorState, LoadingState } from '@/components/ui/QueryStates';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import {
  useFinance,
  useFinanceMonth,
  useFinanceWallets,
  type EntryMode,
} from '@/data/financeStore';
import type { ContainerSnapshot } from '@/data/models';
import { formatLongDate } from '@/lib/date';
import type { IconName } from '@/lib/icons';
import { formatPeso } from '@/lib/money';
import { formatMonthKey, formatMonthPeriod } from '@/lib/period';
import { getGridLayout, useAppTheme, radii, spacing } from '@/theme';

export function HomeScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { activeMonthKey } = useFinance();
  const monthQuery = useFinanceMonth(activeMonthKey);
  const walletQuery = useFinanceWallets();
  const [entryMode, setEntryMode] = useState<EntryMode | null>(null);

  if (monthQuery.status === 'loading' || walletQuery.status === 'loading') {
    return (
      <Screen wide>
        <PageHeader
          eyebrow={formatLongDate()}
          title="Welcome back, Alex"
          subtitle="Opening this month from your saved ledger."
          preview={false}
        />
        <LoadingState label="Opening this month…" />
      </Screen>
    );
  }

  if (monthQuery.status === 'error' || walletQuery.status === 'error') {
    return (
      <Screen wide>
        <PageHeader
          eyebrow={formatLongDate()}
          title="Welcome back, Alex"
          subtitle="Your saved ledger could not be opened."
          preview={false}
        />
        <ErrorState
          message={
            monthQuery.error?.message ??
            walletQuery.error?.message ??
            'Please try again.'
          }
          onRetry={() => {
            monthQuery.retry();
            walletQuery.retry();
          }}
        />
      </Screen>
    );
  }

  if (!monthQuery.data || !walletQuery.data) {
    return (
      <Screen wide>
        <PageHeader
          eyebrow={formatLongDate()}
          title="Welcome back, Alex"
          preview={false}
        />
        <ErrorState
          message="This month could not be loaded."
          onRetry={() => {
            monthQuery.retry();
            walletQuery.retry();
          }}
        />
      </Screen>
    );
  }

  const wallets = walletQuery.data.wallets;
  const containers = monthQuery.data.containers;
  const activeContainers = containers.filter(
    (container) =>
      container.status === 'active' && container.systemKey == null,
  );
  const budgetContainers = activeContainers
    .filter((container) => container.kind === 'budget')
    .slice(0, 4);
  const summary = monthQuery.data.summary;
  const recentTransactions = walletQuery.data.recentTransactions.slice(0, 4);
  const totalBalanceMinor = walletQuery.data.totalBalanceMinor;
  const savingsContainer = containers.find(
    (container) => container.systemKey === 'savings',
  );
  const grid = getGridLayout(width, true);
  const cardWidth = grid.cardWidth;

  return (
    <Screen wide>
      <PageHeader
        eyebrow={formatLongDate()}
        title={`Welcome back, Alex`}
        subtitle={`${formatMonthKey(
          activeMonthKey,
        )} \u00B7 ${formatMonthPeriod(activeMonthKey)} is the active calendar month.`}
        preview={false}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open profile and settings"
            onPress={() => router.push('/profile')}
            style={({ pressed }) => [
              styles.avatar,
              {
                backgroundColor: theme.colors.primarySoft,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <AppText variant="h3" color={theme.colors.primarySoftText}>
              A
            </AppText>
          </Pressable>
        }
      />

      <BalanceCard
        label="Total recorded funds"
        amountMinor={totalBalanceMinor}
        caption={`${wallets.length} wallets \u00B7 ${activeContainers.length} active containers`}
        wallets={wallets}
      />

      <View style={styles.quickActions}>
        <QuickAction
          icon="arrow-up"
          label="Spend"
          tone="coral"
          onPress={() => setEntryMode('expense')}
        />
        <QuickAction
          icon="arrow-down"
          label="Add income"
          tone="emerald"
          onPress={() => setEntryMode('income')}
        />
        <QuickAction
          icon="swap-horizontal"
          label="Move money"
          tone="blue"
          onPress={() => setEntryMode('wallet_transfer')}
        />
        <QuickAction
          icon="sparkles"
          label="Ask Pocketa"
          tone="violet"
          onPress={() => router.push('/assistant')}
        />
      </View>

      <View style={styles.section}>
        <SectionHeader
          title="This month"
          subtitle="Income, expenses, and budget usage are separate measures."
          actionLabel="Monthly history"
          onAction={() => router.push('/monthly-history')}
        />
        <MonthSummaryCard summary={summary} />
      </View>

      <View style={styles.section}>
        <SectionHeader
          title="Budget containers"
          subtitle="Actual balances stay separate from monthly limits."
          actionLabel="Manage"
          onAction={() => router.push('/budgets')}
        />
        {budgetContainers.length === 0 ? (
          <Card>
            <AppText variant="bodySmall" color={theme.colors.textSecondary}>
              No active budget containers yet. Create one in Budgets.
            </AppText>
          </Card>
        ) : (
          <View style={styles.grid}>
            {budgetContainers.map((container) => (
              <View key={container.id} style={{ width: cardWidth }}>
                <BudgetCard
                  container={container}
                  compact
                  onPress={() => router.push('/budgets')}
                />
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <SectionHeader
          title="Savings"
          subtitle="Savings contributions are transfers, not expenses."
          actionLabel="Review"
          onAction={() => router.push('/budgets')}
        />
        <SavingsCard container={savingsContainer} />
      </View>

      <View style={styles.section}>
        <SectionHeader
          title="Recent activity"
          actionLabel="See all"
          onAction={() => router.push('/history')}
        />
        {recentTransactions.length === 0 ? (
          <Card>
            <AppText variant="bodySmall" color={theme.colors.textSecondary}>
              No transactions yet. Your activity will appear here.
            </AppText>
          </Card>
        ) : (
          <Card padded={false} style={styles.listCard}>
            {recentTransactions.map((transaction, index) => (
              <View key={transaction.id}>
                <TransactionRow transaction={transaction} />
                {index < recentTransactions.length - 1 ? <Divider /> : null}
              </View>
            ))}
          </Card>
        )}
      </View>

      <Card
        style={[
          styles.assistantCard,
          {
            backgroundColor: theme.colors.primarySoft,
            borderColor: theme.colors.primarySoft,
          },
        ]}
      >
        <View style={styles.assistantHeader}>
          <IconBadge icon="sparkles" tone="emerald" size={42} />
          <View style={styles.assistantCopy}>
            <AppText variant="h3" color={theme.colors.primarySoftText}>
              Just say what happened
            </AppText>
            <AppText
              variant="bodySmall"
              color={theme.colors.primarySoftText}
            >
              Try {'\u201CI spent \u20B1120 on lunch.\u201D'} Pocketa prepares a
              draft, then you confirm it.
            </AppText>
          </View>
        </View>
        <AppButton
          label="Open assistant preview"
          icon="chatbubble-ellipses-outline"
          onPress={() => router.push('/assistant')}
          fullWidth
        />
      </Card>

      {entryMode ? (
        <MoneyEntryModal
          visible
          mode={entryMode}
          onClose={() => setEntryMode(null)}
        />
      ) : null}
    </Screen>
  );
}

function SavingsCard({
  container,
}: {
  container: ContainerSnapshot | undefined;
}) {
  const { theme } = useAppTheme();
  const savedMinor = container?.balanceMinor ?? 0;

  return (
    <Card style={styles.goalCard}>
      <View style={styles.goalHeader}>
        <IconBadge
          icon={container?.icon ?? 'wallet-outline'}
          tone={container?.tone ?? 'emerald'}
          size={44}
        />
        <View style={styles.goalCopy}>
          <AppText variant="h3">{container?.name ?? 'Savings'}</AppText>
          <AppText variant="caption" color={theme.colors.textSecondary}>
            Permanent savings balance
          </AppText>
        </View>
        <AppText
          variant="h3"
          color={theme.colors.success}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          style={styles.goalAmount}
        >
          {formatPeso(savedMinor)}
        </AppText>
      </View>
      <AppText variant="caption" color={theme.colors.textSecondary}>
        This balance carries forward and stays separate from monthly net
        savings.
      </AppText>
    </Card>
  );
}

interface QuickActionProps {
  icon: IconName;
  label: string;
  tone: 'coral' | 'emerald' | 'blue' | 'violet';
  onPress: () => void;
}

function QuickAction({ icon, label, tone, onPress }: QuickActionProps) {
  const { theme } = useAppTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickAction,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <IconBadge icon={icon} tone={tone} size={38} iconSize={18} />
      <AppText
        variant="micro"
        color={theme.colors.textSecondary}
        align="center"
        numberOfLines={2}
      >
        {label.toUpperCase()}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  quickAction: {
    flex: 1,
    minHeight: 84,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: 4,
  },
  section: {
    gap: spacing.md,
    marginTop: spacing.xxxl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  listCard: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  goalCard: {
    gap: spacing.md,
  },
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  goalCopy: {
    flex: 1,
    gap: 2,
  },
  goalAmount: {
    flexShrink: 1,
    maxWidth: '45%',
    textAlign: 'right',
  },
  assistantCard: {
    gap: spacing.lg,
    marginTop: spacing.xxxl,
  },
  assistantHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  assistantCopy: {
    flex: 1,
    gap: 4,
  },
});
