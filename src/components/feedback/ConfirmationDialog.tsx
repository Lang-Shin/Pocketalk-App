import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { useAppTheme, radii, spacing } from '@/theme';
import { AppText } from '../AppText';
import { AppButton } from '../ui/AppButton';

export interface ConfirmationDetail {
  label: string;
  value: string;
}

interface ConfirmationDialogProps {
  visible: boolean;
  title: string;
  description?: string;
  details?: ConfirmationDetail[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationDialog({
  visible,
  title,
  description,
  details,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const stackActions = width < 400;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss dialog"
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.dialog,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              ...theme.shadows.floating,
            },
          ]}
        >
          <ScrollView
            style={styles.contentScroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.copy}>
              <AppText variant="h2">{title}</AppText>
              {description ? (
                <AppText
                  variant="bodySmall"
                  color={theme.colors.textSecondary}
                >
                  {description}
                </AppText>
              ) : null}
            </View>

            {details && details.length > 0 ? (
              <View
                style={[
                  styles.details,
                  {
                    backgroundColor: theme.colors.surfaceMuted,
                    borderColor: theme.colors.border,
                  },
                ]}
              >
                {details.map((detail, index) => (
                  <View
                    key={detail.label}
                    style={[
                      styles.detailRow,
                      index > 0
                        ? {
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: theme.colors.border,
                          }
                        : null,
                    ]}
                  >
                    <AppText
                      variant="caption"
                      color={theme.colors.textSecondary}
                    >
                      {detail.label}
                    </AppText>
                    <AppText
                      variant="label"
                      align="right"
                      style={styles.detailValue}
                    >
                      {detail.value}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>

          <View
            style={[styles.actions, stackActions ? styles.actionsStacked : null]}
          >
            <AppButton
              label={cancelLabel}
              variant="outline"
              onPress={onCancel}
              style={[
                styles.action,
                stackActions ? styles.actionStacked : null,
              ]}
            />
            <AppButton
              label={confirmLabel}
              variant={tone === 'danger' ? 'danger' : 'primary'}
              onPress={onConfirm}
              style={[
                styles.action,
                stackActions ? styles.actionStacked : null,
              ]}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    borderRadius: radii.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  contentScroll: {
    flexShrink: 1,
  },
  content: {
    gap: spacing.lg,
  },
  copy: {
    gap: spacing.xs,
  },
  details: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: 10,
  },
  detailValue: {
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionsStacked: {
    flexDirection: 'column',
  },
  action: {
    flex: 1,
  },
  actionStacked: {
    flexGrow: 0,
    width: '100%',
  },
});
