import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { Transaction } from '@/data/models';
import { formatTime, recordedDateKey } from '@/lib/date';
import { formatPeso } from '@/lib/money';
import { formatDateKey } from '@/lib/period';
import { useAppTheme, radii, spacing } from '@/theme';
import { AppText } from '../AppText';
import { IconBadge } from '../ui/IconBadge';

interface TransactionDetailModalProps {
  transaction: Transaction | null;
  onClose: () => void;
}

interface TransferCopy {
  label: string;
  message: string;
  icon: 'swap-horizontal-outline' | 'layers-outline' | 'flag-outline';
}

export function TransactionDetailModal({
  transaction,
  onClose,
}: TransactionDetailModalProps) {
  const { theme } = useAppTheme();

  if (!transaction) return null;

  const isReversed = transaction.status === 'reversed';
  const isPending = transaction.status === 'pending';
  const amountPrefix =
    transaction.direction === 'in'
      ? '+'
      : transaction.direction === 'out'
        ? '-'
        : '';
  const amountColor =
    transaction.direction === 'in'
      ? theme.colors.success
      : transaction.direction === 'out'
        ? theme.colors.text
        : theme.colors.textSecondary;
  const effectiveDateLabel = formatDateKey(transaction.effectiveDate);
  const recordedDate = recordedDateKey(
    transaction.recordedAt,
    transaction.recordedOffsetMinutes,
  );
  const recordedDateLabel = formatDateKey(recordedDate);
  const recordedTimeLabel = formatTime(
    transaction.recordedAt,
    transaction.recordedOffsetMinutes,
  );
  const enteredLate = recordedDate !== transaction.effectiveDate;
  const statusLabel = isReversed
    ? 'Reversed'
    : isPending
      ? 'Pending'
      : 'Posted';
  const typeLabel = getTypeLabel(transaction);
  const transferCopy = getTransferCopy(transaction);

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close transaction details"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              ...theme.shadows.floating,
            },
          ]}
        >
          <View style={styles.header}>
            <IconBadge
              icon={transaction.icon}
              tone={transaction.tone}
              size={48}
            />
            <View style={styles.headerCopy}>
              <AppText variant="micro" color={theme.colors.textTertiary}>
                {typeLabel.toUpperCase()}
              </AppText>
              <AppText variant="h2" numberOfLines={2}>
                {transaction.title}
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close transaction details"
              onPress={onClose}
              style={styles.close}
            >
              <Ionicons
                name="close"
                size={22}
                color={theme.colors.textSecondary}
              />
            </Pressable>
          </View>

          <ScrollView
            style={styles.contentScroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <View style={styles.amountBlock}>
              <AppText
                variant="amountLarge"
                color={amountColor}
                style={isReversed ? styles.struck : undefined}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.55}
              >
                {amountPrefix}
                {formatPeso(transaction.amountMinor)}
              </AppText>
              <View style={styles.badges}>
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: theme.colors.surfaceMuted },
                  ]}
                >
                  <AppText variant="micro" color={theme.colors.textSecondary}>
                    {statusLabel.toUpperCase()}
                  </AppText>
                </View>
                {transaction.direction === 'neutral' ? (
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: theme.colors.primarySoft },
                    ]}
                  >
                    <AppText variant="micro" color={theme.colors.primarySoftText}>
                      INTERNAL TRANSFER
                    </AppText>
                  </View>
                ) : null}
              </View>
            </View>

            {transferCopy ? (
              <View
                style={[
                  styles.transferNote,
                  {
                    backgroundColor: theme.colors.primarySoft,
                    borderColor: theme.colors.border,
                  },
                ]}
              >
                <Ionicons
                  name={transferCopy.icon}
                  size={20}
                  color={theme.colors.primarySoftText}
                />
                <View style={styles.transferCopy}>
                  <AppText
                    variant="label"
                    weight="semibold"
                    color={theme.colors.primarySoftText}
                  >
                    {transferCopy.label}
                  </AppText>
                  <AppText variant="caption" color={theme.colors.textSecondary}>
                    {transferCopy.message}
                  </AppText>
                </View>
              </View>
            ) : null}

            <View
              style={[styles.details, { borderColor: theme.colors.border }]}
            >
              <DetailRow label="Type" value={typeLabel} />
              <DetailRow label="Category" value={transaction.category} />
              <DetailRow
                label="Effective date"
                value={effectiveDateLabel}
              />
              <DetailRow
                label="Recorded"
                value={`${recordedDateLabel} at ${recordedTimeLabel}`}
              />
              {enteredLate ? (
                <AppText
                  variant="caption"
                  color={theme.colors.warning}
                  style={styles.lateNote}
                >
                  Entered after the effective date. It still belongs to{' '}
                  {effectiveDateLabel}.
                </AppText>
              ) : null}
              {transaction.sourceWalletName ? (
                <DetailRow
                  label="From wallet"
                  value={transaction.sourceWalletName}
                />
              ) : null}
              {transaction.destinationWalletName ? (
                <DetailRow
                  label="To wallet"
                  value={transaction.destinationWalletName}
                />
              ) : null}
              {transaction.sourceContainerName ? (
                <DetailRow
                  label="From container"
                  value={transaction.sourceContainerName}
                />
              ) : null}
              {transaction.destinationContainerName ? (
                <DetailRow
                  label="To container"
                  value={transaction.destinationContainerName}
                />
              ) : null}
              <DetailRow label="Status" value={statusLabel} />
            </View>

            {transaction.reversalOfId ? (
              <AppText
                variant="caption"
                color={theme.colors.textSecondary}
              >
                This record reverses an earlier transaction. The original stays
                in the ledger for audit, and balances already reflect both
                entries.
              </AppText>
            ) : null}

            <AppText variant="micro" color={theme.colors.textTertiary}>
              SAVED IN YOUR LOCAL LEDGER
            </AppText>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const { theme } = useAppTheme();

  return (
    <View style={styles.detailRow}>
      <AppText variant="caption" color={theme.colors.textSecondary}>
        {label}
      </AppText>
      <AppText
        variant="caption"
        weight="semibold"
        style={styles.detailValue}
        numberOfLines={3}
      >
        {value}
      </AppText>
    </View>
  );
}

function getTypeLabel(transaction: Transaction): string {
  if (transaction.kind === 'income') return 'External income';
  if (transaction.kind === 'expense') return 'External expense';
  if (transaction.kind === 'wallet_transfer') return 'Wallet transfer';
  if (transaction.kind === 'savings') {
    return transaction.destinationContainerName === 'Savings'
      ? 'Savings contribution'
      : 'Savings withdrawal';
  }
  if (transaction.category === 'Monthly rollover') return 'Month-end rollover';
  if (transaction.sourceContainerName === 'Unallocated') {
    return 'Allocation from Unallocated';
  }
  if (transaction.destinationContainerName === 'Unallocated') {
    return 'Return to Unallocated';
  }
  return 'Container transfer';
}

function getTransferCopy(transaction: Transaction): TransferCopy | null {
  if (transaction.direction !== 'neutral') return null;
  if (transaction.kind === 'wallet_transfer') {
    return {
      label: 'Wallet transfer',
      message:
        'Money moved between your wallets. It was not spent and does not change income, expenses, or net savings.',
      icon: 'swap-horizontal-outline',
    };
  }
  if (transaction.kind === 'savings') {
    const contribution =
      transaction.destinationContainerName === 'Savings';
    return {
      label: contribution ? 'Savings contribution' : 'Savings withdrawal',
      message: contribution
        ? 'Money moved into Savings. It is a transfer, not an expense.'
        : 'Money moved out of Savings. It is a transfer, not income.',
      icon: 'flag-outline',
    };
  }
  if (transaction.category === 'Monthly rollover') {
    return {
      label: 'Month-end rollover',
      message:
        'Leftover ordinary-container money moved to Unallocated automatically. It is not income or an expense.',
      icon: 'layers-outline',
    };
  }
  if (transaction.sourceContainerName === 'Unallocated') {
    return {
      label: 'Allocation',
      message:
        'Money moved from Unallocated into a purpose container. It was not spent and is not new income.',
      icon: 'layers-outline',
    };
  }
  if (transaction.destinationContainerName === 'Unallocated') {
    return {
      label: 'Return to Unallocated',
      message:
        'Money moved back to Unallocated. It is not income and does not change net savings.',
      icon: 'layers-outline',
    };
  }
  return {
    label: 'Container transfer',
    message:
      'Money moved between containers without being spent. Income, expenses, and net savings are unchanged.',
    icon: 'swap-horizontal-outline',
  };
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '90%',
    borderRadius: radii.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentScroll: {
    flexShrink: 1,
  },
  content: {
    gap: spacing.lg,
    paddingBottom: spacing.xs,
  },
  amountBlock: {
    gap: spacing.sm,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  badge: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  transferNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  transferCopy: {
    flex: 1,
    gap: 2,
  },
  details: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  detailValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
  lateNote: {
    paddingLeft: spacing.xs,
  },
  struck: {
    textDecorationLine: 'line-through',
    opacity: 0.7,
  },
});
