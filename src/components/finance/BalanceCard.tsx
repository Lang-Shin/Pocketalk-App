import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Image, Platform, StyleSheet, useWindowDimensions, View, type ImageSourcePropType } from 'react-native';

import type { WalletSnapshot } from '@/data/models';
import { formatPeso } from '@/lib/money';
import { useAppTheme, radii, spacing } from '@/theme';
import { AppText } from '../AppText';
import { FrostedBackground } from '../ui/FrostedBackground';

interface BalanceCardProps {
  label: string;
  amountMinor: number;
  caption?: string;
  wallets?: WalletSnapshot[];
  footer?: ReactNode;
  headingImage?: ImageSourcePropType;
}

export function BalanceCard({
  label,
  amountMinor,
  caption,
  wallets,
  footer,
  headingImage,
}: BalanceCardProps) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const balanceLabel = formatPeso(amountMinor);
  const compactAmount = balanceLabel.length > 12;
  const walletSummary = wallets
    ?.map((wallet) => `${wallet.name}: ${formatPeso(wallet.balanceMinor)}`)
    .join('. ');

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : theme.glass.heroSurface,
          borderColor: theme.glass.heroBorder,
        },
      ]}
      accessible
      accessibilityLabel={`${label}: ${formatPeso(amountMinor)}. ${
        caption ?? ''
      }${walletSummary ? `. ${walletSummary}` : ''}`}
    >
      <FrostedBackground color={theme.glass.heroSurface} radius={radii.xxl} />
      <View
        pointerEvents="none"
        accessible={false}
        style={[styles.highlight, { backgroundColor: theme.glass.highlight }]}
      />
      <View style={styles.header}>
        <View style={styles.labelRow}>
          {headingImage ? (
            <Image source={headingImage} style={styles.headingImage} resizeMode="contain" accessible={false} />
          ) : (
            <Ionicons
              name="wallet-outline"
              size={16}
              color={theme.colors.heroMuted}
            />
          )}
          <AppText variant="label" color={theme.colors.heroMuted} style={styles.labelText}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.xl,
    gap: spacing.sm,
    overflow: 'hidden',
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: spacing.xl,
    right: spacing.xl,
    height: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
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
    flexShrink: 1,
  },
  labelText: {
    flexShrink: 1,
  },
  headingImage: {
    width: 28,
    height: 28,
    flexShrink: 0,
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
    backgroundColor: '#D3B88D',
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
