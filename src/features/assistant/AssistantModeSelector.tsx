import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  ASSISTANT_MODE_OPTIONS,
  type AssistantMode,
} from '@/ai/assistantMode';
import { AppText } from '@/components/AppText';
import { useAppTheme, radii, spacing } from '@/theme';

interface AssistantModeSelectorProps {
  mode: AssistantMode;
}

export function AssistantModeSelector({
  mode,
}: AssistantModeSelectorProps) {
  const { theme } = useAppTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Assistant mode"
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <View style={styles.copy}>
        <AppText variant="label">Assistant mode</AppText>
        <AppText variant="caption" color={theme.colors.textSecondary}>
          Choose how Pocketa interprets messages.
        </AppText>
      </View>

      <View style={styles.options}>
        {ASSISTANT_MODE_OPTIONS.map((option) => {
          const selected = option.mode === mode;
          const disabled = option.availability !== 'available';

          return (
            <Pressable
              key={option.mode}
              accessibilityRole="radio"
              accessibilityLabel={`${option.label}: ${option.statusLabel}`}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              style={[
                styles.option,
                {
                  backgroundColor: selected
                    ? theme.colors.primarySoft
                    : theme.colors.surfaceMuted,
                  borderColor: selected
                    ? theme.colors.primary
                    : theme.colors.border,
                  opacity: disabled ? 0.55 : 1,
                },
              ]}
            >
              <Ionicons
                name={
                  option.mode === 'offline'
                    ? 'cloud-offline-outline'
                    : 'cloud-outline'
                }
                size={20}
                color={
                  selected
                    ? theme.colors.primary
                    : theme.colors.textTertiary
                }
              />
              <View style={styles.optionCopy}>
                <AppText
                  variant="label"
                  color={
                    selected
                      ? theme.colors.primarySoftText
                      : theme.colors.textSecondary
                  }
                >
                  {option.label}
                </AppText>
                <AppText
                  variant="micro"
                  color={
                    option.availability === 'available'
                      ? theme.colors.success
                      : theme.colors.textTertiary
                  }
                >
                  {option.statusLabel}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>

      <AppText variant="micro" color={theme.colors.textTertiary}>
        Offline mode uses deterministic rules on this device, with no
        internet or LLM. Online mode is not available yet; no online
        request will be made.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  copy: {
    gap: 2,
  },
  options: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  option: {
    flex: 1,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionCopy: {
    flexShrink: 1,
    gap: 1,
  },
});
