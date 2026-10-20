import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
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

import {
  selectContainerSnapshots,
  selectWalletSnapshots,
} from '@/data/financeSelectors';
import { useMockFinance, type EntryMode } from '@/data/financeStore';
import type { IconName } from '@/lib/icons';
import { formatPeso, parsePesoToMinor } from '@/lib/money';
import { formatMonthKey, isValidMonthKey } from '@/lib/period';
import { useAppTheme, radii, spacing } from '@/theme';
import { AppText } from '../AppText';
import { AppButton } from '../ui/AppButton';

interface MoneyEntryModalProps {
  visible: boolean;
  mode: EntryMode;
  onClose: () => void;
}

const MODE_COPY: Record<
  EntryMode,
  {
    eyebrow: string;
    title: string;
    description: string;
    saveLabel: string;
    icon: IconName;
  }
> = {
  expense: {
    eyebrow: 'NEW EXPENSE',
    title: 'Record spending',
    description:
      'This lowers the wallet and the chosen container. A budget limit is not changed.',
    saveLabel: 'Save expense',
    icon: 'arrow-up-circle-outline',
  },
  income: {
    eyebrow: 'NEW INCOME',
    title: 'Add income',
    description:
      'External income increases recorded funds once. Wallet and container balances move together.',
    saveLabel: 'Save income',
    icon: 'arrow-down-circle-outline',
  },
  wallet_transfer: {
    eyebrow: 'WALLET TRANSFER',
    title: 'Move between wallets',
    description:
      'This changes where money sits, not total funds. It is never income or an expense.',
    saveLabel: 'Move money',
    icon: 'swap-horizontal-outline',
  },
  container_transfer: {
    eyebrow: 'CONTAINER TRANSFER',
    title: 'Move between containers',
    description:
      'This changes the purpose of recorded money without changing income, expenses, or net savings.',
    saveLabel: 'Move between containers',
    icon: 'git-compare-outline',
  },
};

export function MoneyEntryModal({
  visible,
  mode,
  onClose,
}: MoneyEntryModalProps) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const stackActions = width < 480;
  const { state, activeMonthKey, todayDateKey, recordMoneyEntry } =
    useMockFinance();
  const wallets = selectWalletSnapshots(state, todayDateKey);
  const containers = selectContainerSnapshots(state, activeMonthKey).filter(
    (container) => container.status === 'active',
  );
  const copy = MODE_COPY[mode];

  const preferredWallet =
    wallets.find((wallet) => wallet.kind === 'virtual_gcash') ?? wallets[0];
  const firstContainer = containers[0];

  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayDateKey);
  const [walletId, setWalletId] = useState(preferredWallet?.id ?? '');
  const [containerId, setContainerId] = useState(firstContainer?.id ?? '');
  const [destinationWalletId, setDestinationWalletId] = useState(
    wallets.find((wallet) => wallet.id !== preferredWallet?.id)?.id ?? '',
  );
  const [destinationContainerId, setDestinationContainerId] = useState(
    containers.find((container) => container.id !== firstContainer?.id)?.id ??
      '',
  );
  const [error, setError] = useState<string | null>(null);

  const selectedWallet = wallets.find((wallet) => wallet.id === walletId);
  const selectedContainer = containers.find(
    (container) => container.id === containerId,
  );

  const handleSubmit = () => {
    setError(null);
    const amountMinor = parsePesoToMinor(amount);
    if (amountMinor === null) {
      setError('Enter a valid amount, such as 145 or 145.50.');
      return;
    }

    const result = recordMoneyEntry({
      mode,
      amountMinor,
      title,
      effectiveDate,
      walletId,
      containerId,
      destinationWalletId,
      destinationContainerId,
    });

    if (!result.ok) {
      setError(result.message ?? 'Check the details and try again.');
      return;
    }

    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[
          styles.overlay,
          { backgroundColor: theme.colors.overlay },
        ]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close entry form"
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
                styles.icon,
                { backgroundColor: theme.colors.primarySoft },
              ]}
            >
              <Ionicons
                name={copy.icon}
                size={22}
                color={theme.colors.primarySoftText}
              />
            </View>
            <View style={styles.headerCopy}>
              <AppText variant="micro" color={theme.colors.textTertiary}>
                {copy.eyebrow} · SESSION ONLY
              </AppText>
              <AppText variant="h2">{copy.title}</AppText>
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
            <AppText
              variant="caption"
              color={theme.colors.textSecondary}
            >
              {copy.description}
            </AppText>

            <Field label="Amount" hint="Philippine pesos">
              <View
                style={[
                  styles.amountBox,
                  {
                    backgroundColor: theme.colors.surfaceMuted,
                    borderColor: theme.colors.border,
                  },
                ]}
              >
                <AppText variant="h2" color={theme.colors.textSecondary}>
                  {'\u20B1'}
                </AppText>
                <TextInput
                  value={amount}
                  onChangeText={setAmount}
                  placeholder="0.00"
                  placeholderTextColor={theme.colors.textTertiary}
                  keyboardType="decimal-pad"
                  style={[styles.amountInput, { color: theme.colors.text }]}
                  accessibilityLabel="Amount in Philippine pesos"
                />
              </View>
            </Field>

            <Field
              label="Description"
              hint={
                mode === 'expense'
                  ? 'What did you spend on?'
                  : mode === 'income'
                    ? 'Where did it come from?'
                    : 'What is this transfer for?'
              }
            >
              <AppInput
                value={title}
                onChangeText={setTitle}
                placeholder={
                  mode === 'expense'
                    ? 'Lunch at the cafeteria'
                    : mode === 'income'
                      ? 'Allowance from Mama'
                      : 'Move money'
                }
                maxLength={80}
                accessibilityLabel="Description"
              />
            </Field>

            <Field label="Effective date" hint="Use YYYY-MM-DD for a late entry">
              <AppInput
                value={effectiveDate}
                onChangeText={setEffectiveDate}
                placeholder={todayDateKey}
                autoCapitalize="none"
                maxLength={10}
                accessibilityLabel="Effective local date"
              />
              <AppText variant="micro" color={theme.colors.textTertiary}>
                {isValidMonthKey(effectiveDate.slice(0, 7))
                  ? formatMonthKey(effectiveDate.slice(0, 7))
                  : 'Enter a complete date'}
              </AppText>
            </Field>

            {mode === 'expense' || mode === 'income' ? (
              <>
                <OptionField
                  label={mode === 'expense' ? 'Pay from wallet' : 'Deposit to wallet'}
                  options={wallets.map((wallet) => ({
                    id: wallet.id,
                    label: wallet.name,
                    caption: formatPeso(wallet.balanceMinor),
                    icon: wallet.icon,
                  }))}
                  selectedId={walletId}
                  onSelect={setWalletId}
                />
                <OptionField
                  label={
                    mode === 'expense'
                      ? 'Spend from container'
                      : 'Add to container'
                  }
                  options={containers.map((container) => ({
                    id: container.id,
                    label: container.name,
                    caption: `${formatPeso(container.balanceMinor)} actual`,
                    icon: container.icon,
                  }))}
                  selectedId={containerId}
                  onSelect={setContainerId}
                />
              </>
            ) : null}

            {mode === 'wallet_transfer' ? (
              <>
                <OptionField
                  label="From wallet"
                  options={wallets.map((wallet) => ({
                    id: wallet.id,
                    label: wallet.name,
                    caption: formatPeso(wallet.balanceMinor),
                    icon: wallet.icon,
                  }))}
                  selectedId={walletId}
                  onSelect={setWalletId}
                />
                <OptionField
                  label="To wallet"
                  options={wallets.map((wallet) => ({
                    id: wallet.id,
                    label: wallet.name,
                    caption:
                      wallet.id === walletId
                        ? 'Choose another wallet'
                        : formatPeso(wallet.balanceMinor),
                    icon: wallet.icon,
                  }))}
                  selectedId={destinationWalletId}
                  onSelect={setDestinationWalletId}
                />
              </>
            ) : null}

            {mode === 'container_transfer' ? (
              <>
                <OptionField
                  label="From container"
                  options={containers.map((container) => ({
                    id: container.id,
                    label: container.name,
                    caption: `${formatPeso(container.balanceMinor)} actual`,
                    icon: container.icon,
                  }))}
                  selectedId={containerId}
                  onSelect={setContainerId}
                />
                <OptionField
                  label="To container"
                  options={containers.map((container) => ({
                    id: container.id,
                    label:
                      container.kind === 'savings'
                        ? `${container.name} (savings)`
                        : container.name,
                    caption:
                      container.id === containerId
                        ? 'Choose another container'
                        : `${formatPeso(container.balanceMinor)} actual`,
                    icon: container.icon,
                  }))}
                  selectedId={destinationContainerId}
                  onSelect={setDestinationContainerId}
                />
              </>
            ) : null}

            {mode === 'expense' && selectedWallet && selectedContainer ? (
              <View
                style={[
                  styles.preview,
                  {
                    backgroundColor: theme.colors.surfaceMuted,
                    borderColor: theme.colors.border,
                  },
                ]}
              >
                <PreviewRow
                  label="Wallet balance"
                  value={formatPeso(selectedWallet.balanceMinor)}
                />
                <PreviewRow
                  label="Container balance"
                  value={formatPeso(selectedContainer.balanceMinor)}
                />
                <PreviewRow
                  label="Monthly limit"
                  value={
                    selectedContainer.limitMinor > 0
                      ? formatPeso(selectedContainer.limitMinor)
                      : 'No limit'
                  }
                />
              </View>
            ) : null}

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
              label={copy.saveLabel}
              icon="checkmark"
              onPress={handleSubmit}
              style={[
                styles.action,
                stackActions ? styles.actionStacked : null,
              ]}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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

function AppInput({
  value,
  onChangeText,
  placeholder,
  maxLength,
  accessibilityLabel,
  autoCapitalize,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  maxLength: number;
  accessibilityLabel: string;
  autoCapitalize?: 'none' | 'sentences';
}) {
  const { theme } = useAppTheme();

  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.textTertiary}
      maxLength={maxLength}
      autoCapitalize={autoCapitalize}
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.input,
        {
          color: theme.colors.text,
          backgroundColor: theme.colors.surfaceMuted,
          borderColor: theme.colors.border,
        },
      ]}
    />
  );
}

function OptionField({
  label,
  options,
  selectedId,
  onSelect,
}: {
  label: string;
  options: { id: string; label: string; caption: string; icon: IconName }[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const { theme } = useAppTheme();

  return (
    <View style={styles.field}>
      <AppText variant="label" weight="semibold">
        {label}
      </AppText>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={styles.options}
      >
        {options.map((option) => {
          const selected = option.id === selectedId;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${option.label}, ${option.caption}`}
              onPress={() => onSelect(option.id)}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: selected
                    ? theme.colors.primarySoft
                    : theme.colors.surfaceMuted,
                  borderColor: selected
                    ? theme.colors.primary
                    : theme.colors.border,
                  opacity: pressed ? 0.76 : 1,
                },
              ]}
            >
              <Ionicons
                name={option.icon}
                size={16}
                color={selected ? theme.colors.primary : theme.colors.textSecondary}
              />
              <View style={styles.optionCopy}>
                <AppText
                  variant="caption"
                  weight="semibold"
                  color={
                    selected ? theme.colors.primarySoftText : theme.colors.text
                  }
                  numberOfLines={1}
                >
                  {option.label}
                </AppText>
                <AppText
                  variant="micro"
                  color={theme.colors.textSecondary}
                  numberOfLines={1}
                >
                  {option.caption}
                </AppText>
              </View>
              {selected ? (
                <Ionicons
                  name="checkmark-circle"
                  size={16}
                  color={theme.colors.primary}
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.previewRow}>
      <AppText variant="caption" color={theme.colors.textSecondary}>
        {label}
      </AppText>
      <AppText variant="caption" weight="semibold">
        {value}
      </AppText>
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
  icon: {
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
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    minHeight: 58,
  },
  amountInput: {
    flex: 1,
    fontSize: 26,
    fontWeight: '700',
    paddingVertical: 12,
  },
  input: {
    minHeight: 50,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionCopy: {
    flex: 1,
    gap: 1,
  },
  preview: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 6,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.md,
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

