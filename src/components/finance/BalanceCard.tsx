import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import type { WalletSnapshot } from '@/data/models';
import { formatPeso } from '@/lib/money';
import { useAppTheme, radii, spacing } from '@/theme';
import { AppText } from '../AppText';

interface BalanceCardProps {
  label: string;
  amountMinor: number;
  caption?: string;
  wallets?: WalletSnapshot[];
  footer?: ReactNode;
}

export function BalanceCard({
  label,
  amountMinor,
  caption,
  wallets,
  footer,
}: BalanceCardProps) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const balanceLabel = formatPeso(amountMinor);
  const compactAmount = balanceLabel.length > 12;
  const walletSummary = wallets
    ?.map((wallet) => `${wallet.name}: ${formatPeso(wallet.balanceMinor)}`)
    .join('. ');

  return (
    <LinearGradient
      colors={[theme.colors.heroStart, theme.colors.heroEnd]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
      accessible
      accessibilityLabel={`${label}: ${formatPeso(amountMinor)}. ${
        caption ?? ''
      }${walletSummary ? `. ${walletSummary}` : ''}`}
    >
      <View pointerEvents="none" style={styles.glowOne} />
      <View pointerEvents="none" style={styles.glowTwo} />

      <View style={styles.header}>
        <View style={styles.labelRow}>
          <Ionicons
            name="wallet-outline"
            size={16}
            color={theme.colors.heroMuted}
          />
          <AppText variant="label" color={theme.colors.heroMuted}>
            {label}
          </AppText>
        </View>
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <AppText variant="micro" color={theme.colors.heroText}>
            LOCAL
          </AppText>
        </View>
      </View>

      <AppText
        variant={compactAmount ? 'amount' : 'amountLarge'}
        color={theme.colors.heroText}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {balanceLabel}
      </AppText>

      {caption ? (
        <AppText variant="bodySmall" color={theme.colors.heroMuted}>
          {caption}
        </AppText>
      ) : null}

      {wallets && wallets.length > 0 ? (
        <View
          style={[
            styles.wallets,
            width < 360 ? { flexDirection: 'column' } : null,
          ]}
        >
          {wallets.map((wallet) => (
            <View key={wallet.id} style={styles.walletItem}>
              <View style={styles.walletIcon}>
                <Ionicons
                  name={wallet.icon}
                  size={15}
                  color={theme.colors.heroText}
                />
              </View>
              <View style={styles.walletCopy}>
                <AppText
                  variant="micro"
                  color={theme.colors.heroMuted}
                  numberOfLines={2}
                >
                  {wallet.name}
                </AppText>
                <AppText
                  variant="label"
                  color={theme.colors.heroText}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                >
                  {formatPeso(wallet.balanceMinor)}
                </AppText>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {footer}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xxl,
    padding: spacing.xl,
    gap: spacing.sm,
    overflow: 'hidden',
  },
  glowOne: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: 'rgba(255,255,255,0.08)',
    top: -80,
    right: -50,
  },
  glowTwo: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.05)',
    bottom: -50,
    left: -30,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#B9F5DF',
  },
  wallets: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  walletItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.11)',
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  walletIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  walletCopy: {
    flex: 1,
    gap: 1,
  },
});
