import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BalanceCard } from '@/components/finance/BalanceCard';
import { MoneyEntryModal } from '@/components/finance/MoneyEntryModal';
import { TransactionRow } from '@/components/finance/TransactionRow';
import { WalletCard } from '@/components/finance/WalletCard';
import { AppButton } from '@/components/ui/AppButton';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { NoticeBanner } from '@/components/ui/NoticeBanner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorState, LoadingState } from '@/components/ui/QueryStates';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import {
  useFinanceWallets,
  type EntryMode,
} from '@/data/financeStore';
import { useAppTheme, radii, spacing } from '@/theme';

export function WalletScreen() {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const walletQuery = useFinanceWallets();
  const [entryMode, setEntryMode] = useState<EntryMode | null>(null);
  const stackActions = width < 400;

  if (walletQuery.status === 'loading') {
    return (
      <Screen>
        <PageHeader
          title="Virtual wallet"
          subtitle="Cash and a GCash balance you track yourself."
          preview={false}
        />
        <LoadingState label="Opening your saved wallet…" />
      </Screen>
    );
  }

  if (walletQuery.status === 'error' || !walletQuery.data) {
    return (
      <Screen>
        <PageHeader
          title="Virtual wallet"
          subtitle="Cash and a GCash balance you track yourself."
          preview={false}
        />
        <ErrorState
          message={walletQuery.error?.message ?? 'Please try again.'}
          onRetry={walletQuery.retry}
        />
      </Screen>
    );
  }

  const { wallets, totalBalanceMinor } = walletQuery.data;
  const walletIds = new Set(wallets.map((wallet) => wallet.id));
  const recentTransactions = walletQuery.data.recentTransactions
    .filter(
      (transaction) =>
        (transaction.sourceWalletId &&
          walletIds.has(transaction.sourceWalletId)) ||
        (transaction.destinationWalletId &&
          walletIds.has(transaction.destinationWalletId)),
    )
    .slice(0, 6);

  return (
    <Screen>
      <PageHeader
        title="Virtual wallet"
        subtitle="Cash and a GCash balance you track yourself."
        preview={false}
      />

      <BalanceCard
        label="Across your wallets"
        amountMinor={totalBalanceMinor}
        caption={`${wallets.length} wallets \u00B7 manually kept up to date`}
      />

      <View style={styles.notice}>
        <NoticeBanner
          title="No bank or GCash connection"
          message="Pocketa never asks for a GCash PIN, password, or OTP. You update this balance yourself."
          tone="warning"
          icon="shield-checkmark-outline"
        />
      </View>

      <View style={[styles.actions, stackActions ? styles.actionsStacked : null]}>
        <AppButton
          label="Move money"
          icon="swap-horizontal"
          onPress={() => setEntryMode('wallet_transfer')}
          style={styles.actionButton}
        />
        <AppButton
          label="Add funds"
          variant="secondary"
          icon="add"
          onPress={() => setEntryMode('income')}
          style={styles.actionButton}
        />
      </View>

      <View style={[styles.actions, stackActions ? styles.actionsStacked : null]}>
        <AppButton
          label="Record spending"
          variant="outline"
          icon="arrow-up"
          onPress={() => setEntryMode('expense')}
          style={styles.actionButton}
        />
        <AppButton
          label="Container transfer"
          variant="outline"
          icon="git-compare-outline"
          onPress={() => setEntryMode('container_transfer')}
          style={styles.actionButton}
        />
      </View>

      <View style={styles.section}>
        <SectionHeader
          title="Your wallets"
          subtitle="These balances are the wallet side of recorded funds."
        />
        {wallets.map((wallet) => (
          <WalletCard key={wallet.id} wallet={wallet} />
        ))}
      </View>

      <Card
        style={[
          styles.explainer,
          { backgroundColor: theme.colors.surfaceAlt },
        ]}
      >
        <View
          style={[
            styles.explainerIcon,
            { backgroundColor: theme.colors.surface },
          ]}
        >
          <Ionicons
            name="git-compare-outline"
            size={20}
            color={theme.colors.primary}
          />
        </View>
        <View style={styles.explainerCopy}>
          <AppText variant="h3">Transfers are not spending</AppText>
          <AppText variant="bodySmall" color={theme.colors.textSecondary}>
            Moving money between cash and virtual GCash changes where it sits,
            not total funds. Container transfers follow the same rule.
          </AppText>
        </View>
      </Card>

      <View style={styles.section}>
        <SectionHeader
          title="Recent wallet activity"
          actionLabel="Full history"
          onAction={() => router.push('/history')}
        />
        {recentTransactions.length === 0 ? (
          <Card>
            <AppText variant="bodySmall" color={theme.colors.textSecondary}>
              No wallet activity yet.
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
          onClose={() => setEntryMode(null)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionsStacked: {
    flexDirection: 'column',
  },
  actionButton: {
    flex: 1,
    width: '100%',
  },
  notice: {
    marginTop: spacing.lg,
  },
  section: {
    gap: spacing.md,
    marginTop: spacing.xxxl,
  },
  explainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginTop: spacing.xxxl,
  },
  explainerIcon: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explainerCopy: {
    flex: 1,
    gap: 4,
  },
  listCard: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
});
