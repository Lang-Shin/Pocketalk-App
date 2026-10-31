import { Ionicons } from '@expo/vector-icons';
import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import type { ContainerSnapshot } from '@/data/models';
import { formatPercent, formatPeso } from '@/lib/money';
import { useAppTheme, radii, spacing } from '@/theme';
import { AppText } from '../AppText';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';
import { ProgressBar } from '../ui/ProgressBar';

interface BudgetCardProps {
  container: ContainerSnapshot;
  compact?: boolean;
  onPress?: () => void;
}

type SpendingStatus =
  | 'archived'
  | 'no-limit'
  | 'on-track'
  | 'near-limit'
  | 'over-budget';

function getStatus(container: ContainerSnapshot): SpendingStatus {
  if (container.status === 'archived') return 'archived';
  if (container.limitMinor <= 0) return 'no-limit';
  const ratio = container.spentMinor / container.limitMinor;
  if (ratio > 1) return 'over-budget';
  if (ratio >= 0.85) return 'near-limit';
  return 'on-track';
}

export function BudgetCard({
  container,
  compact = false,
  onPress,
}: BudgetCardProps) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const narrow = width < 480 || compact;
  const ratio =
    container.limitMinor > 0
      ? container.spentMinor / container.limitMinor
      : 0;
  const status = getStatus(container);

  const statusPalette = {
    archived: {
      background: theme.colors.surfaceAlt,
      foreground: theme.colors.textSecondary,
      label: 'Archived',
      icon: 'archive-outline' as const,
      progress: 'primary' as const,
    },
    'no-limit': {
      background: theme.colors.surfaceAlt,
      foreground: theme.colors.textSecondary,
      label: 'No limit',
      icon: 'remove-circle-outline' as const,
      progress: 'primary' as const,
    },
    'on-track': {
      background: theme.colors.successSoft,
      foreground: theme.colors.success,
      label: 'On track',
      icon: 'checkmark-circle-outline' as const,
      progress: 'success' as const,
    },
    'near-limit': {
      background: theme.colors.warningSoft,
      foreground: theme.colors.warning,
      label: 'Near limit',
      icon: 'alert-circle-outline' as const,
      progress: 'warning' as const,
    },
    'over-budget': {
      background: theme.colors.dangerSoft,
      foreground: theme.colors.danger,
      label: 'Over budget',
      icon: 'warning-outline' as const,
      progress: 'danger' as const,
    },
  }[status];

  const planLabel =
    container.limitMinor > 0
      ? `${formatPeso(container.spentMinor)} of ${formatPeso(
          container.limitMinor,
        )} spent`
      : `${formatPeso(container.spentMinor)} spent · no monthly limit`;
  const remainingLabel =
    container.limitMinor <= 0
      ? 'Not budgeted'
      : container.remainingMinor >= 0
        ? `${formatPeso(container.remainingMinor)} left`
        : `${formatPeso(Math.abs(container.remainingMinor))} over`;

  const statusBadge = (
    <View
      style={[
        styles.statusPill,
        { backgroundColor: statusPalette.background },
      ]}
    >
      <Ionicons
        name={statusPalette.icon}
        size={13}
        color={statusPalette.foreground}
      />
      <AppText variant="micro" color={statusPalette.foreground}>
        {statusPalette.label.toUpperCase()}
      </AppText>
    </View>
  );

  const content = (
    <Card
      accessible={!onPress}
      accessibilityLabel={
        onPress
          ? undefined
          : `${container.name}. Actual balance ${formatPeso(
              container.balanceMinor,
            )}. ${planLabel}. ${remainingLabel}. ${statusPalette.label}.`
      }
      style={[styles.card, compact ? styles.compactCard : null]}
    >
      <View style={styles.header}>
        <IconBadge
          icon={container.icon}
          tone={container.tone}
          size={compact ? 36 : 44}
          iconSize={compact ? 17 : 20}
        />
        <View style={styles.titleCopy}>
          <AppText
            variant={compact ? 'label' : 'h3'}
            numberOfLines={narrow ? 2 : 1}
          >
            {container.name}
          </AppText>
          {!compact && container.description ? (
            <AppText
              variant="caption"
              color={theme.colors.textSecondary}
              numberOfLines={narrow ? 2 : 1}
            >
              {container.description}
            </AppText>
          ) : null}
        </View>
        {!narrow ? statusBadge : null}
        {onPress ? (
          <Ionicons
            name="chevron-forward"
            size={16}
            color={theme.colors.textTertiary}
          />
        ) : null}
      </View>

      {narrow ? <View style={styles.statusRow}>{statusBadge}</View> : null}

      <View style={styles.balanceRow}>
        <View style={styles.balanceCopy}>
          <AppText variant="micro" color={theme.colors.textTertiary}>
            ACTUAL BALANCE
          </AppText>
          <AppText
            variant={compact ? 'bodySmall' : 'h2'}
            weight="bold"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
          >
            {formatPeso(container.balanceMinor)}
          </AppText>
        </View>
        {!narrow ? (
          <View style={styles.planCopy}>
            <AppText
              variant="caption"
              color={theme.colors.textSecondary}
              align="right"
              numberOfLines={2}
            >
              {planLabel}
            </AppText>
            <AppText
              variant="caption"
              color={statusPalette.foreground}
              weight="semibold"
            >
              {remainingLabel}
            </AppText>
          </View>
        ) : null}
      </View>

      {narrow ? (
        <View style={styles.narrowPlanCopy}>
          <AppText variant="caption" color={theme.colors.textSecondary}>
            {planLabel}
          </AppText>
          <AppText
            variant="caption"
            color={statusPalette.foreground}
            weight="semibold"
          >
            {remainingLabel}
          </AppText>
        </View>
      ) : null}

      {container.limitMinor > 0 ? (
        <>
          <ProgressBar
            value={ratio}
            tone={statusPalette.progress}
            height={compact ? 6 : 8}
            accessibilityLabel={`${container.name} monthly spending progress`}
          />
          <View style={styles.footer}>
            <AppText variant="micro" color={theme.colors.textTertiary}>
              MONTHLY LIMIT
            </AppText>
            <AppText
              variant="micro"
              color={statusPalette.foreground}
              weight="semibold"
            >
              {formatPercent(ratio)} USED
            </AppText>
          </View>
        </>
      ) : (
        <View style={styles.footer}>
          <AppText variant="micro" color={theme.colors.textTertiary}>
            ACTUAL MONEY IS SEPARATE FROM MONTHLY LIMITS
          </AppText>
        </View>
      )}
    </Card>
  );

  if (!onPress) return content;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${container.name}, actual balance ${formatPeso(
        container.balanceMinor,
      )}, ${planLabel}, ${remainingLabel}`}
      onPress={onPress}
      style={({ pressed }) => [{ opacity: pressed ? 0.78 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    minHeight: 140,
  },
  compactCard: {
    padding: spacing.md,
    gap: spacing.sm,
    minHeight: 110,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  titleCopy: {
    flex: 1,
    gap: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusRow: {
    alignItems: 'flex-start',
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  balanceCopy: {
    flex: 1,
    gap: 1,
  },
  planCopy: {
    flexShrink: 1,
    alignItems: 'flex-end',
    gap: 2,
  },
  narrowPlanCopy: {
    gap: 1,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
});
