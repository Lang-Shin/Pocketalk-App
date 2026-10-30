import { Ionicons } from '@expo/vector-icons';
import { useRef, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { ConfirmationDialog } from '@/components/feedback/ConfirmationDialog';
import type { ContainerSnapshot } from '@/data/models';
import { useFinance } from '@/data/financeStore';
import { createOperationKey } from '@/data/financeService';
import type { IconName } from '@/lib/icons';
import { formatPeso, formatPesoInput, parsePesoToMinor } from '@/lib/money';
import { formatMonthKey } from '@/lib/period';
import { useAppTheme, layout, radii, spacing, type Tone } from '@/theme';
import { AppText } from '../AppText';
import { AppButton } from '../ui/AppButton';
import { NoticeBanner } from '../ui/NoticeBanner';

interface ContainerEditorModalProps {
  visible: boolean;
  monthKey: string;
  activeMonthKey: string;
  container?: ContainerSnapshot;
  onClose: () => void;
}

const ICONS: { value: IconName; label: string }[] = [
  { value: 'restaurant-outline', label: 'Food' },
  { value: 'bus-outline', label: 'Transport' },
  { value: 'book-outline', label: 'School' },
  { value: 'game-controller-outline', label: 'Fun' },
  { value: 'phone-portrait-outline', label: 'Phone' },
  { value: 'medkit-outline', label: 'Health' },
  { value: 'gift-outline', label: 'Gift' },
  { value: 'flag-outline', label: 'Goal' },
];

const TONES: { value: Tone; label: string }[] = [
  { value: 'emerald', label: 'Green' },
  { value: 'blue', label: 'Blue' },
  { value: 'violet', label: 'Violet' },
  { value: 'amber', label: 'Amber' },
  { value: 'coral', label: 'Coral' },
];

type PendingAction = 'archive' | 'delete' | null;

export function ContainerEditorModal({
  visible,
  monthKey,
  activeMonthKey,
  container,
  onClose,
}: ContainerEditorModalProps) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const stackActions = width < 400;
  const {
    createContainer,
    updateContainer,
    archiveContainer,
    reactivateContainer,
    deleteContainer,
  } = useFinance();
  const isEditing = Boolean(container);
  const isArchived = container?.status === 'archived';
  const limitEditable = monthKey === activeMonthKey && !isArchived;
  const balanceMinor = container?.balanceMinor ?? 0;

  const [name, setName] = useState(container?.name ?? '');
  const [description, setDescription] = useState(container?.description ?? '');
  const [icon, setIcon] = useState<IconName>(
    container?.icon ?? 'wallet-outline',
  );
  const [tone, setTone] = useState<Tone>(container?.tone ?? 'emerald');
  const [limit, setLimit] = useState(
    container?.limitsByMonth[monthKey]
      ? formatPesoInput(container.limitsByMonth[monthKey] ?? 0)
      : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [pending, setPending] = useState(false);
  const operationKey = useRef(createOperationKey('container-save'));

  const handleSave = async () => {
    if (pending || isArchived) return;
    setError(null);
    const limitMinor = limit.trim() ? parsePesoToMinor(limit) : 0;
    if (limitMinor === null) {
      setError('Enter a valid monthly limit, such as 1200 or 1200.50.');
      return;
    }

    const input = {
      name,
      description,
      icon,
      tone,
      limitMinor,
      monthKey,
      idempotencyKey: operationKey.current,
    };
    setPending(true);
    const result = container
      ? await updateContainer({ ...input, id: container.id })
      : await createContainer(input);
    setPending(false);

    if (!result.ok) {
      setError(result.message ?? 'Check the details and try again.');
      return;
    }

    onClose();
  };

  const handleArchive = async () => {
    if (!container || pending) return;
    setPending(true);
    const result = await archiveContainer(container.id);
    setPending(false);
    setPendingAction(null);
    if (!result.ok) {
      setError(result.message ?? 'The container could not be archived.');
      return;
    }
    onClose();
  };

  const handleDelete = async () => {
    if (!container || pending) return;
    setPending(true);
    const result = await deleteContainer(container.id);
    setPending(false);
    setPendingAction(null);
    if (!result.ok) {
      setError(result.message ?? 'The container could not be deleted.');
      return;
    }
    onClose();
  };

  const handleReactivate = async () => {
    if (!container || pending) return;
    setPending(true);
    const result = await reactivateContainer(container.id);
    setPending(false);
    if (!result.ok) {
      setError(result.message ?? 'The container could not be reactivated.');
      return;
    }
    onClose();
  };

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={onClose}
      >
        <KeyboardAvoidingView
          style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close container editor"
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
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: theme.colors.primarySoft },
                ]}
              >
                <Ionicons
                  name={isArchived ? 'archive-outline' : icon}
                  size={21}
                  color={theme.colors.primarySoftText}
                />
              </View>
              <View style={styles.headerCopy}>
                <AppText variant="micro" color={theme.colors.textTertiary}>
                  {isEditing ? 'CONTAINER SETTINGS' : 'NEW CONTAINER'} ·{' '}
                  {formatMonthKey(monthKey).toUpperCase()}
                </AppText>
                <AppText variant="h2">
                  {isEditing
                    ? container?.name
                    : 'Shape a container for real life'}
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={onClose}
                hitSlop={8}
                style={styles.close}
              >
                <Ionicons name="close" size={22} color={theme.colors.text} />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.form}
            >
              {isArchived ? (
                <NoticeBanner
                  title="Archived container"
                  message="Its balance and history stay intact. It is excluded from new active planning."
                  icon="archive-outline"
                />
              ) : null}

              {isEditing ? (
                <View
                  style={[
                    styles.balanceBox,
                    {
                      backgroundColor: theme.colors.surfaceMuted,
                      borderColor: theme.colors.border,
                    },
                  ]}
                >
                  <View>
                    <AppText variant="micro" color={theme.colors.textTertiary}>
                      ACTUAL BALANCE
                    </AppText>
                    <AppText variant="h2">{formatPeso(balanceMinor)}</AppText>
                  </View>
                  <View style={styles.balanceCopy}>
                    <AppText
                      variant="caption"
                      color={theme.colors.textSecondary}
                      align="right"
                    >
                      Separate from the monthly limit
                    </AppText>
                  </View>
                </View>
              ) : null}

              <Field label="Name" hint="Up to 40 characters">
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Food & drinks"
                  placeholderTextColor={theme.colors.textTertiary}
                  maxLength={40}
                  accessibilityLabel="Container name"
                  style={[
                    styles.input,
                    {
                      color: theme.colors.text,
                      backgroundColor: theme.colors.surfaceMuted,
                      borderColor: theme.colors.border,
                    },
                  ]}
                />
              </Field>

              <Field label="Description" hint="Optional">
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Meals, snacks, and coffee"
                  placeholderTextColor={theme.colors.textTertiary}
                  maxLength={90}
                  accessibilityLabel="Container description"
                  style={[
                    styles.input,
                    {
                      color: theme.colors.text,
                      backgroundColor: theme.colors.surfaceMuted,
                      borderColor: theme.colors.border,
                    },
                  ]}
                />
              </Field>

              <Field
                label="Monthly limit"
                hint={
                  limitEditable
                    ? 'Optional planning value'
                    : 'Past-month limits are read-only'
                }
              >
                {limitEditable ? (
                  <View
                    style={[
                      styles.limitBox,
                      {
                        backgroundColor: theme.colors.surfaceMuted,
                        borderColor: theme.colors.border,
                      },
                    ]}
                  >
                    <AppText variant="h3" color={theme.colors.textSecondary}>
                      {'\u20B1'}
                    </AppText>
                    <TextInput
                      value={limit}
                      onChangeText={setLimit}
                      placeholder="0.00"
                      placeholderTextColor={theme.colors.textTertiary}
                      keyboardType="decimal-pad"
                      accessibilityLabel="Optional monthly limit"
                      style={[
                        styles.limitInput,
                        { color: theme.colors.text },
                      ]}
                    />
                  </View>
                ) : (
                  <AppText variant="bodySmall" color={theme.colors.textSecondary}>
                    {formatPeso(container?.limitsByMonth[monthKey] ?? 0)} for{' '}
                    {formatMonthKey(monthKey)}. Past months remain read-only.
                  </AppText>
                )}
              </Field>

              <Field label="Icon">
                <View style={styles.optionWrap} accessibilityRole="radiogroup">
                  {ICONS.map((option) => {
                    const selected = icon === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="radio"
                        accessibilityLabel={option.label}
                        accessibilityState={{ selected }}
                        onPress={() => setIcon(option.value)}
                        style={[
                          styles.iconOption,
                          {
                            backgroundColor: selected
                              ? theme.colors.primarySoft
                              : theme.colors.surfaceMuted,
                            borderColor: selected
                              ? theme.colors.primary
                              : theme.colors.border,
                          },
                        ]}
                      >
                        <Ionicons
                          name={option.value}
                          size={20}
                          color={
                            selected
                              ? theme.colors.primarySoftText
                              : theme.colors.textSecondary
                          }
                        />
                      </Pressable>
                    );
                  })}
                </View>
              </Field>

              <Field label="Color">
                <View style={styles.optionWrap} accessibilityRole="radiogroup">
                  {TONES.map((option) => {
                    const selected = tone === option.value;
                    const palette = theme.colors.categories[option.value];
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="radio"
                        accessibilityLabel={option.label}
                        accessibilityState={{ selected }}
                        onPress={() => setTone(option.value)}
                        style={[
                          styles.toneOption,
                          {
                            backgroundColor: palette.background,
                            borderColor: selected
                              ? palette.foreground
                              : theme.colors.border,
                            borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.toneDot,
                            { backgroundColor: palette.foreground },
                          ]}
                        />
                        <AppText
                          variant="caption"
                          color={palette.foreground}
                          weight="semibold"
                        >
                          {option.label}
                        </AppText>
                        {selected ? (
                          <Ionicons
                            name="checkmark"
                            size={14}
                            color={palette.foreground}
                          />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </Field>

              {error ? (
                <View
                  style={[
                    styles.error,
                    { backgroundColor: theme.colors.dangerSoft },
                  ]}
                >
                  <Ionicons
                    name="alert-circle-outline"
                    size={17}
                    color={theme.colors.danger}
                  />
                  <AppText
                    variant="caption"
                    color={theme.colors.danger}
                    style={styles.flex}
                  >
                    {error}
                  </AppText>
                </View>
              ) : null}

              {isEditing ? (
                <View style={styles.manageBlock}>
                  <AppText variant="micro" color={theme.colors.textTertiary}>
                    LIFECYCLE
                  </AppText>
                  {isArchived ? (
                    <AppButton
                      label={pending ? 'Working…' : 'Reactivate container'}
                      icon="refresh-outline"
                      variant="secondary"
                      onPress={handleReactivate}
                      disabled={pending}
                      fullWidth
                    />
                  ) : (
                    <AppButton
                      label="Archive container"
                      icon="archive-outline"
                      variant="outline"
                      onPress={() => setPendingAction('archive')}
                      disabled={pending}
                      fullWidth
                    />
                  )}
                  <AppText variant="caption" color={theme.colors.textSecondary}>
                    Archiving never moves money or deletes history. Archived
                    balances remain visible.
                  </AppText>
                  <AppButton
                    label="Delete container"
                    icon="trash-outline"
                    variant="danger"
                    onPress={() => setPendingAction('delete')}
                    disabled={pending}
                    fullWidth
                  />
                  <AppText variant="caption" color={theme.colors.textSecondary}>
                    Deletion is blocked when a balance or history exists. Move
                    remaining funds, then archive instead.
                  </AppText>
                </View>
              ) : null}
            </ScrollView>

            <View
              style={[styles.actions, stackActions ? styles.actionsStacked : null]}
            >
              <AppButton
                label="Cancel"
                variant="outline"
                onPress={onClose}
                style={[
                  styles.action,
                  stackActions ? styles.actionStacked : null,
                ]}
              />
              <AppButton
                label={
                  pending
                    ? 'Saving…'
                    : isEditing
                      ? 'Save changes'
                      : 'Create container'
                }
                icon="checkmark"
                onPress={handleSave}
                disabled={pending || isArchived}
                style={[
                  styles.action,
                  stackActions ? styles.actionStacked : null,
                ]}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ConfirmationDialog
        visible={pendingAction !== null}
        title={
          pendingAction === 'delete'
            ? 'Try deleting this container?'
            : 'Archive this container?'
        }
        description={
          pendingAction === 'delete'
            ? 'Containers with a balance, monthly limits, or transaction history cannot be deleted. Move remaining funds and archive it instead.'
            : balanceMinor !== 0
              ? `Its ${formatPeso(
                  balanceMinor,
                )} balance and all history stay in place. No money moves, and the container remains visible in the archived area.`
              : 'No money moves. The container and its history remain visible in the archived area.'
        }
        confirmLabel={
          pendingAction === 'delete' ? 'Check deletion' : 'Archive container'
        }
        cancelLabel="Keep as is"
        tone={pendingAction === 'delete' ? 'danger' : 'primary'}
        onConfirm={
          pendingAction === 'delete' ? handleDelete : handleArchive
        }
        onCancel={() => setPendingAction(null)}
      />
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabel}>
        <AppText variant="label" weight="semibold">
          {label}
        </AppText>
        {hint ? (
          <AppText variant="micro" color={theme.colors.textTertiary}>
            {hint}
          </AppText>
        ) : null}
      </View>
      {children}
    </View>
  );
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
    maxHeight: '92%',
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
  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
    gap: 1,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: {
    gap: spacing.lg,
    paddingBottom: spacing.sm,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  input: {
    minHeight: 50,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
  },
  limitBox: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  limitInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 18,
    fontWeight: '600',
  },
  balanceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  balanceCopy: {
    flex: 1,
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  iconOption: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toneOption: {
    minHeight: layout.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
  },
  toneDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  manageBlock: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  flex: {
    flex: 1,
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

