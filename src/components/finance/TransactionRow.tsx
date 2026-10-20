import { Pressable, StyleSheet, View } from 'react-native';

import type { Transaction } from '@/data/models';
import { formatTime, recordedDateKey } from '@/lib/date';
import { formatPeso } from '@/lib/money';
import { formatDateKey } from '@/lib/period';
import { useAppTheme, radii, spacing } from '@/theme';
import { AppText } from '../AppText';
import { IconBadge } from '../ui/IconBadge';

interface TransactionRowProps {
  transaction: Transaction;
  showDate?: boolean;
  onPress?: () => void;
}

export function TransactionRow({
  transaction,
  showDate = true,
  onPress,
}: TransactionRowProps) {
  const { theme } = useAppTheme();
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
      : transaction.direction === 'neutral'
        ? theme.colors.textSecondary
        : theme.colors.text;
  const dateLabel = formatDateKey(transaction.effectiveDate);
  const recordedDate = recordedDateKey(
    transaction.recordedAt,
    transaction.recordedOffsetMinutes,
  );
  const recordedTimeLabel = formatTime(
    transaction.recordedAt,
    transaction.recordedOffsetMinutes,
  );
  const recordedDateLabel = formatDateKey(recordedDate);
  const enteredLate = recordedDate !== transaction.effectiveDate;
  const enteredNote = enteredLate ? ` \u00B7 entered ${recordedDateLabel}` : '';
  const subtitle = showDate
    ? `${transaction.category} \u00B7 ${dateLabel}${enteredNote}`
    : `${transaction.category} \u00B7 ${recordedTimeLabel}${enteredNote}`;

  const row = (
    <>
      <IconBadge icon={transaction.icon} tone={transaction.tone} size={42} />
      <View style={styles.copy}>
        <AppText
          variant="bodySmall"
          weight="semibold"
          numberOfLines={1}
          style={isReversed ? styles.struck : undefined}
        >
          {transaction.title}
        </AppText>
        <AppText
          variant="caption"
          color={theme.colors.textSecondary}
          numberOfLines={2}
        >
          {subtitle}
        </AppText>
      </View>
      <View style={styles.amountCopy}>
        <AppText
          variant="bodySmall"
          weight="bold"
          color={amountColor}
          style={isReversed ? styles.struck : undefined}
        >
          {amountPrefix}
          {formatPeso(transaction.amountMinor)}
        </AppText>
        {isReversed || isPending ? (
          <View
            style={[
              styles.status,
              {
                backgroundColor: isReversed
                  ? theme.colors.dangerSoft
                  : theme.colors.warningSoft,
              },
            ]}
          >
            <AppText
              variant="micro"
              color={isReversed ? theme.colors.danger : theme.colors.warning}
            >
              {isReversed ? 'REVERSED' : 'PENDING'}
            </AppText>
          </View>
        ) : null}
      </View>
    </>
  );

  const accessibilityLabel = `${transaction.title}, ${
    transaction.category
  }, ${
    transaction.direction === 'in'
      ? 'received'
      : transaction.direction === 'out'
        ? 'spent'
        : 'moved'
  } ${formatPeso(transaction.amountMinor)}, effective ${dateLabel}${
    enteredLate ? `, entered ${recordedDateLabel} at ${recordedTimeLabel}` : ''
  }${isReversed ? ', reversed' : ''}`;

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel} style={styles.row}>
        {row}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed ? { backgroundColor: theme.colors.surfaceMuted } : null,
      ]}
    >
      {row}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 62,
    paddingVertical: spacing.sm,
    marginHorizontal: -spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  amountCopy: {
    alignItems: 'flex-end',
    gap: 3,
  },
  struck: {
    textDecorationLine: 'line-through',
    opacity: 0.7,
  },
  status: {
    borderRadius: radii.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
});
