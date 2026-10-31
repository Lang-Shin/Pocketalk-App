import { StyleSheet, View } from 'react-native';

import type { WalletSnapshot } from '@/data/models';
import { formatPeso } from '@/lib/money';
import { useAppTheme, radii, spacing } from '@/theme';
import { AppText } from '../AppText';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';

interface WalletCardProps {
  wallet: WalletSnapshot;
}

export function WalletCard({ wallet }: WalletCardProps) {
  const { theme } = useAppTheme();
  const isManual = wallet.kind === 'virtual_gcash';

  return (
    <Card
      accessible
      accessibilityLabel={`${wallet.name}, balance ${formatPeso(
        wallet.balanceMinor,
      )}. ${isManual ? 'Manually tracked.' : 'Cash wallet.'}`}
      style={styles.card}
    >
      <View style={styles.row}>
        <IconBadge icon={wallet.icon} tone={wallet.tone} size={46} />
        <View style={styles.copy}>
          <View style={styles.nameRow}>
            <AppText variant="h3" numberOfLines={1} style={styles.name}>
              {wallet.name}
            </AppText>
            {isManual ? (
              <View
                style={[
                  styles.badge,
                  { backgroundColor: theme.colors.background },
                ]}
              >
                <AppText
                  variant="micro"
                  color={theme.colors.textSecondary}
                >
                  MANUAL
                </AppText>
              </View>
            ) : null}
          </View>
          <AppText
            variant="caption"
            color={theme.colors.textSecondary}
            numberOfLines={2}
          >
            {isManual
              ? 'Updated by you. Not connected to GCash.'
              : 'Cash you can spend today.'}
          </AppText>
        </View>
      </View>

      <AppText
        variant="amount"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {formatPeso(wallet.balanceMinor)}
      </AppText>
      <View
        style={[styles.rule, { backgroundColor: theme.colors.border }]}
      />
      <View style={styles.footer}>
        <AppText variant="micro" color={theme.colors.textTertiary}>
          AVAILABLE BALANCE
        </AppText>
        <View style={styles.manualNote}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: isManual
                  ? theme.colors.warning
                  : theme.colors.success,
              },
            ]}
          />
          <AppText variant="micro" color={theme.colors.textSecondary}>
            {isManual ? 'MANUAL TRACKING' : 'CASH'}
          </AppText>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    flexShrink: 1,
  },
  badge: {
    borderRadius: radii.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  manualNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
