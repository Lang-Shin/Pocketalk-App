import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  compareMonthKeys,
  formatMonthKey,
  formatMonthPeriod,
  shiftMonthKey,
} from '@/lib/period';
import { useAppTheme, radii, spacing } from '@/theme';
import { AppText } from '../AppText';
import { IconButton } from './IconButton';

interface MonthNavigatorProps {
  monthKey: string;
  activeMonthKey: string;
  onChange: (monthKey: string) => void;
  label?: string;
}

export function MonthNavigator({
  monthKey,
  activeMonthKey,
  onChange,
  label = 'Budget month',
}: MonthNavigatorProps) {
  const { theme } = useAppTheme();
  const isCurrent = monthKey === activeMonthKey;
  const canMoveForward =
    compareMonthKeys(monthKey, activeMonthKey) < 0;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
      accessibilityLabel={label}
    >
      <IconButton
        icon="chevron-back"
        accessibilityLabel="View previous month"
        variant="ghost"
        size={40}
        onPress={() => onChange(shiftMonthKey(monthKey, -1))}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${formatMonthKey(
          monthKey,
        )}. ${formatMonthPeriod(monthKey)}. ${
          isCurrent ? 'Current month' : 'Tap to return to current month'
        }`}
        disabled={isCurrent}
        onPress={() => onChange(activeMonthKey)}
        style={styles.label}
      >
        <View style={styles.labelRow}>
          <Ionicons
            name="calendar-outline"
            size={15}
            color={theme.colors.primary}
          />
          <AppText variant="h3">{formatMonthKey(monthKey)}</AppText>
          {isCurrent ? (
            <View
              style={[
                styles.currentPill,
                { backgroundColor: theme.colors.primarySoft },
              ]}
            >
              <AppText variant="micro" color={theme.colors.primarySoftText}>
                CURRENT
              </AppText>
            </View>
          ) : null}
        </View>
        <AppText
          variant="caption"
          color={theme.colors.textSecondary}
          align="center"
        >
          {formatMonthPeriod(monthKey)}
        </AppText>
      </Pressable>
      <IconButton
        icon="chevron-forward"
        accessibilityLabel="View next month"
        variant="ghost"
        size={40}
        disabled={!canMoveForward}
        onPress={() => onChange(shiftMonthKey(monthKey, 1))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  label: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.xs,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  currentPill: {
    borderRadius: radii.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
});
