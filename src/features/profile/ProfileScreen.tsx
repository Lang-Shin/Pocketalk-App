import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { NoticeBanner } from '@/components/ui/NoticeBanner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorState, LoadingState } from '@/components/ui/QueryStates';
import { Screen } from '@/components/ui/Screen';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SettingRow } from '@/components/ui/SettingRow';
import { useProfileData } from '@/data/hooks';
import { useAppTheme, radii, spacing, type ThemePreference } from '@/theme';

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  icon: 'phone-portrait-outline' | 'sunny-outline' | 'moon-outline';
}[] = [
  { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
];

export function ProfileScreen() {
  const { status, data, error, retry } = useProfileData();
  const { theme, preference, setPreference } = useAppTheme();
  const router = useRouter();

  if (status === 'loading') {
    return (
      <Screen edges={['top', 'bottom']}>
        <PageHeader
          title="Profile & settings"
          onBack={() => router.back()}
          preview={false}
        />
        <LoadingState label="Opening your local profile…" />
      </Screen>
    );
  }

  if (status === 'error' || !data) {
    return (
      <Screen edges={['top', 'bottom']}>
        <PageHeader
          title="Profile & settings"
          onBack={() => router.back()}
          preview={false}
        />
        <ErrorState
          message={error?.message ?? 'Please try again.'}
          onRetry={retry}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <PageHeader
        title="Profile & settings"
        onBack={() => router.back()}
      />

      <Card style={styles.profileCard}>
        <View style={styles.profileRow}>
          <View
            style={[
              styles.avatar,
              { backgroundColor: theme.colors.primarySoft },
            ]}
          >
            <AppText variant="h1" color={theme.colors.primarySoftText}>
              {data.initials}
            </AppText>
          </View>
          <View style={styles.profileCopy}>
            <AppText variant="h2">{data.name}</AppText>
            <AppText variant="caption" color={theme.colors.textSecondary}>
              {data.subtitle}
            </AppText>
          </View>
          <View
            style={[
              styles.localPill,
              { backgroundColor: theme.colors.successSoft },
            ]}
          >
            <Ionicons
              name="phone-portrait-outline"
              size={12}
              color={theme.colors.success}
            />
            <AppText variant="micro" color={theme.colors.success}>
              LOCAL
            </AppText>
          </View>
        </View>
        <View
          style={[styles.rule, { backgroundColor: theme.colors.border }]}
        />
        <View style={styles.goalRow}>
          <Ionicons
            name="flag-outline"
            size={16}
            color={theme.colors.primary}
          />
          <AppText
            variant="bodySmall"
            color={theme.colors.textSecondary}
            style={styles.flex}
          >
            {data.goalLabel}
          </AppText>
        </View>
        <AppText variant="micro" color={theme.colors.textTertiary}>
          {data.joinedLabel.toUpperCase()}
        </AppText>
      </Card>

      <View style={styles.section}>
        <AppText variant="micro" color={theme.colors.textTertiary}>
          APPEARANCE
        </AppText>
        <Card style={styles.appearanceCard}>
          <SegmentedControl
            options={THEME_OPTIONS}
            value={preference}
            onChange={setPreference}
            accessibilityLabel="Appearance theme"
          />
          <AppText variant="caption" color={theme.colors.textSecondary}>
            System follows your Android theme. The choice is remembered for
            this app session.
          </AppText>
        </Card>
      </View>

      <View style={styles.section}>
        <AppText variant="micro" color={theme.colors.textTertiary}>
          PREFERENCES
        </AppText>
        <Card>
          <SettingRow
            icon="cash-outline"
            tone="emerald"
            label="Currency"
            description="All amounts are stored in centavos"
            value="PHP"
          />
          <Divider />
          <SettingRow
            icon="language-outline"
            tone="blue"
            label="Language"
            description="More languages are not enabled yet"
            value="English"
            onPress={() =>
              Alert.alert(
                'Not available yet',
                'Language selection is not enabled in this version.',
              )
            }
          />
          <Divider />
          <SettingRow
            icon="calendar-outline"
            tone="violet"
            label="Budget period"
            description="Weekly and custom periods are unresolved"
            value="Monthly"
          />
        </Card>
      </View>

      <View style={styles.section}>
        <AppText variant="micro" color={theme.colors.textTertiary}>
          OFFLINE & AI
        </AppText>
        <Card>
          <SettingRow
            icon="cloud-offline-outline"
            tone="emerald"
            label="Offline mode"
            description="Core budgeting does not need a connection"
            value="On"
          />
          <Divider />
          <SettingRow
            icon="sparkles-outline"
            tone="amber"
            label="Local AI"
            description="On-device model is not installed"
            value="Not set up"
            onPress={() =>
              Alert.alert(
                'Not available yet',
                'The on-device model remains an unverified Phase 5 requirement.',
              )
            }
          />
          <Divider />
          <SettingRow
            icon="shield-checkmark-outline"
            tone="blue"
            label="AI can never write money"
            description="Every proposed transaction needs your confirmation"
            value="Enforced by design"
          />
        </Card>
      </View>

      <View style={styles.section}>
        <AppText variant="micro" color={theme.colors.textTertiary}>
          DATA & PRIVACY
        </AppText>
        <Card>
          <SettingRow
            icon="download-outline"
            tone="blue"
            label="Export data"
            description="Backups are not available in this version"
            onPress={() =>
              Alert.alert(
                'Not available yet',
                'Data export needs an approved backup and encryption policy first.',
              )
            }
          />
          <Divider />
          <SettingRow
            icon="phone-portrait-outline"
            tone="violet"
            label="Stored on this device"
            description="No account, cloud sync, or server is used"
            value="Local only"
          />
          <Divider />
          <SettingRow
            icon="save-outline"
            tone="emerald"
            label="Budget ledger"
            description="Wallets, containers, and history persist locally"
            value="SQLite"
          />
        </Card>
        <NoticeBanner
          title="Your ledger is saved"
          message="Budget changes are written to SQLite on this device. Profile and assistant content still use sample data."
          icon="shield-checkmark-outline"
        />
      </View>

      <View style={styles.section}>
        <AppText variant="micro" color={theme.colors.textTertiary}>
          ABOUT
        </AppText>
        <Card>
          <SettingRow
            icon="information-circle-outline"
            tone="emerald"
            label="Pocketa"
            description="Offline-first student budgeting"
            value="v0.1.0"
          />
          <Divider />
          <SettingRow
            icon="flask-outline"
            tone="amber"
            label="Build stage"
            description="Local ledger, rollover, and budgeting workflows"
            value="Phase 4"
          />
        </Card>
      </View>

      <View style={styles.footer}>
        <View
          style={[
            styles.footerIcon,
            { backgroundColor: theme.colors.primarySoft },
          ]}
        >
          <Ionicons
            name="leaf-outline"
            size={18}
            color={theme.colors.primarySoftText}
          />
        </View>
        <AppText
          variant="caption"
          color={theme.colors.textTertiary}
          align="center"
        >
          Budget data is stored locally on this device. Profile and assistant
          content are still samples, and no bank or GCash account is connected.
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  profileCard: {
    gap: spacing.md,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCopy: {
    flex: 1,
    gap: 2,
  },
  localPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  section: {
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  appearanceCard: {
    gap: spacing.md,
  },
  footer: {
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xxxl,
    paddingHorizontal: spacing.xl,
  },
  footerIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
