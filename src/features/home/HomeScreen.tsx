import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Image,
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
import { useProfileData } from '@/data/hooks';
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
  const profileQuery = useProfileData();
  const greeting = profileQuery.data?.firstName
    ? `Welcome back, ${profileQuery.data.firstName}`
    : 'Welcome back';
  const [entryMode, setEntryMode] = useState<EntryMode | null>(null);
  const [containerTransferPreset, setContainerTransferPreset] = useState<
    { sourceContainerId?: string; destinationContainerId?: string } | undefined
  >(undefined);

  const openEntry = (
    mode: EntryMode,
    preset?: { sourceContainerId?: string; destinationContainerId?: string },
  ) => {
    setEntryMode(mode);
    setContainerTransferPreset(preset);
  };

  const closeEntry = () => {
    setEntryMode(null);
    setContainerTransferPreset(undefined);
  };

  if (monthQuery.status === 'loading' || walletQuery.status === 'loading') {
    return (
      <Screen wide>
        <PageHeader
          eyebrow={formatLongDate()}
          title={greeting}
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
          title={greeting}
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
          title={greeting}
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
        title={greeting}
        subtitle={`${formatMonthKey(activeMonthKey)} · ${formatMonthPeriod(activeMonthKey)}${profileQuery.data ? ' · Sample profile' : ''}`}
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
            <Image
              source={require('../../../assets/branding/pocketa-header-208.png')}
              style={styles.brandImage}
              resizeMode="contain"
              accessible={false}
            />
          </Pressable>
        }
      />

      <BalanceCard
        label="Total recorded funds"
        amountMinor={totalBalanceMinor}
        headingImage={require('../../../assets/illustrations/wallet.png')}
        caption={`${wallets.length} wallets \u00B7 ${activeContainers.length} active containers`}
        wallets={wallets}
      />

      <View style={styles.quickActions}>
        <QuickAction
          icon="arrow-up"
          label="Spend"
          tone="coral"
          onPress={() => openEntry('expense')}
        />
        <QuickAction
          icon="arrow-down"
          label="Add income"
          tone="emerald"
          onPress={() => openEntry('income')}
        />
        <QuickAction
          icon="swap-horizontal"
          label="Move money"
          tone="blue"
          onPress={() => openEntry('wallet_transfer')}
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
        <SavingsCard
          container={savingsContainer}
          onAddToSavings={() =>
            openEntry('container_transfer', {
              destinationContainerId: savingsContainer?.id,
            })
          }
          onWithdrawFromSavings={() =>
            openEntry('container_transfer', {
              sourceContainerId: savingsContainer?.id,
            })
          }
        />
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

      {entryMode ? (
        <MoneyEntryModal
          visible
          mode={entryMode}
          containerTransferPreset={containerTransferPreset}
          onClose={closeEntry}
        />
      ) : null}
    </Screen>
  );
}

function SavingsCard({
  container,
  onAddToSavings,
  onWithdrawFromSavings,
}: {
  container: ContainerSnapshot | undefined;
  onAddToSavings: () => void;
  onWithdrawFromSavings: () => void;
}) {
  const { theme } = useAppTheme();
  const savedMinor = container?.balanceMinor ?? 0;

  return (
    <Card style={styles.goalCard}>
      <View style={styles.goalHeader}>
        <Image
          source={require('../../../assets/decorations/shinecoin.png')}
          style={styles.savingsDecoration}
          resizeMode="contain"
          accessible={false}
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
      <View style={styles.savingsActions}>
        <AppButton
          label="Add to Savings"
          variant="secondary"
          icon="arrow-down-circle-outline"
          onPress={onAddToSavings}
          style={styles.savingsAction}
        />
        <AppButton
          label="Withdraw from Savings"
          variant="outline"
          icon="arrow-up-circle-outline"
          onPress={onWithdrawFromSavings}
          style={styles.savingsAction}
        />
      </View>
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
        !theme.isDark && {
          backgroundColor: theme.colors.background,
          borderRadius: radii.md,
        },
        {
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      {theme.isDark ? (
        <IconBadge icon={icon} tone={tone} size={38} iconSize={20} />
      ) : (
        <View style={[styles.quickActionIcon, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name={icon} size={20} color={theme.colors.text} />
        </View>
      )}
      <AppText
        variant="micro"
        color={theme.isDark ? theme.colors.textSecondary : theme.colors.text}
        align="center"
        numberOfLines={2}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 46,
    height: 46,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandImage: {
    width: '100%',
    height: '100%',
  },
  quickActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  quickAction: {
    flex: 1,
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: 4,
  },
  quickActionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
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
  savingsDecoration: {
    width: 40,
    height: 40,
    opacity: 0.72,
    flexShrink: 0,
  },
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  goalCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  goalAmount: {
    flexShrink: 1,
    maxWidth: '45%',
    textAlign: 'right',
  },
  savingsActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  savingsAction: {
    flexGrow: 1,
    flexBasis: 140,
  },
});
