import { Ionicons } from '@expo/vector-icons';
import { isLoaded } from 'expo-font';
import { useEffect, useMemo, useRef, useState } from 'react';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { selectAssistantMode } from '@/ai/assistantMode';
import type {
  AssistantAnswer,
  AssistantClarification,
  AssistantContext,
  AssistantIntent,
  AssistantInterpretation,
  AssistantMissingField,
  AssistantProposal,
  AssistantResult,
} from '@/ai/localAssistant';
import type { AssistantProviderInfo } from '@/ai/providers';
import { createAssistantExecutionCoordinator } from '@/application/assistantExecution';
import { AppText } from '@/components/AppText';
import { ChatBubble } from '@/components/chat/ChatBubble';
import {
  ConfirmationDialog,
  type ConfirmationDetail,
} from '@/components/feedback/ConfirmationDialog';
import { AppButton } from '@/components/ui/AppButton';
import { Chip } from '@/components/ui/Chip';
import { ScreenDecorations } from '@/components/ui/DecorationLayer';
import { IconButton } from '@/components/ui/IconButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorState, LoadingState } from '@/components/ui/QueryStates';
import { Screen } from '@/components/ui/Screen';
import {
  useFinance,
  useFinanceMonth,
  useFinanceWallets,
} from '@/data/financeStore';
import type { ChatMessage } from '@/data/models';
import { formatPeso } from '@/lib/money';
import { formatDateKey, formatMonthKey } from '@/lib/period';
import { useAppTheme, radii, spacing, typography } from '@/theme';

import { AssistantModeSelector } from './AssistantModeSelector';
import { AssistantThinkingIndicator } from './AssistantThinkingIndicator';
import { ResponsePresentation } from './responsePresentation';
import {
  assistantKeyboardConfig,
  assistantInputPalette,
  isAssistantSendEnabled,
} from './composerConfig';
import {
  claimExecution,
  createPendingConfirmation,
  executionFromError,
  executionFromResult,
  releaseExecution,
  type PendingConfirmation,
  type ProposalExecution,
} from './confirmationState';

interface ThreadMessage extends ChatMessage {
  proposal?: AssistantProposal;
  clarification?: AssistantClarification;
  answer?: AssistantAnswer;
  interpretation?: AssistantInterpretation;
  retryText?: string;
  execution?: ProposalExecution;
}

const INTENT_LABELS: Record<AssistantIntent, string> = {
  income: 'Income',
  expense: 'Expense',
  wallet_transfer: 'Wallet transfer',
  container_transfer: 'Container transfer',
  balance_inquiry: 'Balance question',
  spending_summary: 'Spending summary',
  income_summary: 'Income summary',
  budget_inquiry: 'Budget question',
  clarification_request: 'Help request',
  unknown: 'Unsupported',
};

const MISSING_FIELD_LABELS: Record<AssistantMissingField, string> = {
  amount: 'amount',
  effectiveDate: 'effective date',
  sourceWallet: 'source wallet',
  destinationWallet: 'destination wallet',
  sourceContainer: 'source container',
  destinationContainer: 'destination container',
  transferKind: 'transfer type',
};

const SUGGESTIONS = [
  '\u20B150 jeepney fare',
  'Received \u20B12,000 allowance',
  'Move \u20B1300 to savings',
  'Transfer \u20B1100 from GCash to cash',
  'Move \u20B1100 from Food & drinks to Transport',
  'How much is in savings?',
  'How much did I spend this month?',
];

let messageSequence = 0;

export function AssistantScreen() {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const inputPalette = assistantInputPalette(theme.colors);
  const { activeMonthKey, todayDateKey, executeMoneyEntry } = useFinance();
  const monthQuery = useFinanceMonth(activeMonthKey);
  const walletQuery = useFinanceWallets();
  const modeSelection = useMemo(() => selectAssistantMode(), []);
  const activeProvider = modeSelection.provider;
  const [messages, setMessages] = useState<ThreadMessage[]>(() => [
    createWelcomeMessage(activeProvider),
  ]);
  const [input, setInput] = useState('');
  const [isResponding, setIsResponding] = useState(false);
  const [presentation] = useState(() => new ResponsePresentation());
  const reduceMotion = useReducedMotion();
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const executionLocks = useRef(new Set<string>());
  const executionCoordinator = useMemo(
    () => createAssistantExecutionCoordinator({ executeMoneyEntry }),
    [executeMoneyEntry],
  );
  useEffect(() => {
    presentation.activate();
    return () => presentation.dispose();
  }, [presentation]);

  const context = useMemo<AssistantContext | null>(() => {
    if (!monthQuery.data || !walletQuery.data) return null;
    return {
      todayDateKey,
      activeMonthKey,
      wallets: walletQuery.data.wallets.map((wallet) => ({
        id: wallet.id,
        name: wallet.name,
        kind: wallet.kind,
        balanceMinor: wallet.balanceMinor,
      })),
      containers: monthQuery.data.containers.map((container) => ({
        id: container.id,
        name: container.name,
        status: container.status,
        systemKey: container.systemKey,
        balanceMinor: container.balanceMinor,
        limitMinor: container.limitMinor,
        spentMinor: container.spentMinor,
        remainingMinor: container.remainingMinor,
      })),
      summary: {
        monthKey: monthQuery.data.summary.monthKey,
        incomeMinor: monthQuery.data.summary.incomeMinor,
        expenseMinor: monthQuery.data.summary.expenseMinor,
        netSavingsMinor: monthQuery.data.summary.netSavingsMinor,
        totalLimitMinor: monthQuery.data.summary.totalLimitMinor,
        totalSpentMinor: monthQuery.data.summary.totalSpentMinor,
        totalRemainingMinor: monthQuery.data.summary.totalRemainingMinor,
        savingsContributionsMinor:
          monthQuery.data.summary.savingsContributionsMinor,
        savingsWithdrawalsMinor:
          monthQuery.data.summary.savingsWithdrawalsMinor,
        savingsEndingBalanceMinor:
          monthQuery.data.summary.savingsEndingBalanceMinor,
        unallocatedEndingBalanceMinor:
          monthQuery.data.summary.unallocatedEndingBalanceMinor,
      },
    };
  }, [activeMonthKey, monthQuery.data, todayDateKey, walletQuery.data]);

  if (monthQuery.status === 'loading' || walletQuery.status === 'loading') {
    return (
      <Screen scroll={false}>
        <PageHeader
          title="Pocketa assistant"
          subtitle="Interpret money messages and answer local questions offline."
          preview={false}
        />
        <LoadingState label="Opening the local assistant…" />
      </Screen>
    );
  }

  if (
    monthQuery.status === 'error' ||
    walletQuery.status === 'error' ||
    !context
  ) {
    return (
      <Screen>
        <PageHeader
          title="Pocketa assistant"
          preview={false}
        />
        <ErrorState
          message={
            monthQuery.error?.message ??
            walletQuery.error?.message ??
            'The local finance data could not be loaded.'
          }
          onRetry={() => {
            monthQuery.retry();
            walletQuery.retry();
          }}
        />
      </Screen>
    );
  }

  const appendProviderError = (retryText?: string) => {
    setMessages((current) => [
      ...current,
      {
        id: nextMessageId('assistant'),
        role: 'assistant',
        text: retryText
          ? 'The assistant runtime is unavailable or could not finish. No transaction was saved. You can retry this message.'
          : 'The assistant runtime is unavailable or could not finish. No transaction was saved. Try again or choose another option.',
        createdAt: new Date().toISOString(),
        retryText,
      },
    ]);
  };

  const requestInterpretation = async (text: string, onStart?: () => void) => {
    await presentation.run(() => activeProvider.interpret(text, context), {
      start: () => { onStart?.(); setIsResponding(true); },
      success: (result) => setMessages((current) => [...current, createThreadMessage(result)]),
      error: () => appendProviderError(text),
      finish: () => setIsResponding(false),
    }, activeProvider.info.kind === 'offline' ? 500 : 0);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isResponding) return;

    const userMessage: ThreadMessage = {
      id: nextMessageId('user'),
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    };

    await requestInterpretation(text, () => {
      setInput('');
      setMessages((current) => [...current, userMessage]);
    });
  };

  const retryMessage = async (message: ThreadMessage) => {
    if (!message.retryText || isResponding) return;
    await requestInterpretation(message.retryText, () => {
      setMessages((current) => current.filter((candidate) => candidate.id !== message.id));
    });
  };

  const appendChoiceResult = (
    message: ThreadMessage,
    result: AssistantResult,
  ) => {
    setMessages((current) => [
      ...current.map((candidate) =>
        candidate.id === message.id
          ? { ...candidate, clarification: undefined }
          : candidate,
      ),
      createThreadMessage(result),
    ]);
  };

  const runChoice = async (
    message: ThreadMessage,
    resolve: () => Promise<AssistantResult>,
  ) => {
    if (isResponding) return;
    await presentation.run(resolve, {
      start: () => setIsResponding(true),
      success: (result) => appendChoiceResult(message, result),
      error: () => appendProviderError(),
      finish: () => setIsResponding(false),
    }, 0);
  };

  const handleContainerChoice = (
    message: ThreadMessage,
    containerId: string,
  ) => {
    const pending = message.clarification?.pending;
    if (!pending) return;
    void runChoice(message, () =>
      activeProvider.resolveContainerChoice(
        containerId,
        pending,
        context,
      ),
    );
  };

  const handleWalletChoice = (
    message: ThreadMessage,
    walletId: string,
  ) => {
    const pending = message.clarification?.pending;
    if (!pending) return;
    void runChoice(message, () =>
      activeProvider.resolveWalletChoice(walletId, pending, context),
    );
  };

  const requestConfirmation = (message: ThreadMessage) => {
    const pending = createPendingConfirmation(message);
    if (pending) setPendingConfirmation(pending);
  };

  const handleConfirmExecution = async () => {
    const pending = pendingConfirmation;
    if (
      !pending ||
      !claimExecution(executionLocks.current, pending.proposal.id)
    ) {
      return;
    }

    setPendingConfirmation(null);
    setMessages((current) =>
      current.map((message) =>
        message.id === pending.messageId
          ? { ...message, execution: { status: 'executing' } }
          : message,
      ),
    );

    try {
      const result = await executionCoordinator.execute({
        proposal: pending.proposal,
        context,
        confirmed: true,
      });
      const execution = executionFromResult(result);

      setMessages((current) =>
        current.map((message) => {
          if (message.id !== pending.messageId) return message;
          return {
            ...message,
            text: result.ok
              ? 'Saved to your local ledger. This transaction now appears in History.'
              : message.text,
            execution,
          };
        }),
      );
    } catch (error) {
      const execution = executionFromError(error);
      setMessages((current) =>
        current.map((message) =>
          message.id === pending.messageId
            ? { ...message, execution }
            : message,
        ),
      );
    } finally {
      releaseExecution(executionLocks.current, pending.proposal.id);
    }
  };

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView
        style={styles.conversation}
        {...assistantKeyboardConfig(Platform.OS)}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.conversation}
          contentContainerStyle={styles.messages}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() =>
            scrollRef.current?.scrollToEnd({ animated: true })
          }
        >
          <ScreenDecorations preset="assistant" width={width} />
          <PageHeader
            title="Pocketa assistant"
            subtitle="A little help with your money, right here on your device."
            preview={false}
          />
          <View style={styles.modeArea}>
            <AssistantModeSelector mode={modeSelection.mode} />
            <AppText variant="caption" color={theme.colors.textSecondary}>
              {activeProvider.info.isRealModel
                ? 'On-device model · review every draft before saving.'
                : 'Offline rules, not a language model · review every draft before saving.'}
            </AppText>
          </View>
          {messages.map((message) => (
            <Animated.View key={message.id} entering={message.role === 'assistant' && !reduceMotion ? FadeIn.duration(180) : undefined}>
            <ChatBubble message={message}>
              {message.interpretation && !message.proposal ? (
                <IntentLine interpretation={message.interpretation} />
              ) : null}
              {message.proposal ? (
                <DraftCard
                  proposal={message.proposal}
                  execution={message.execution}
                  onConfirm={() => requestConfirmation(message)}
                />
              ) : null}
              {message.answer ? (
                <AnswerCard answer={message.answer} />
              ) : null}
              {message.clarification ? (
                <ClarificationDetails
                  interpretation={message.interpretation}
                />
              ) : null}
              {message.retryText ? (
                <AppButton
                  label="Try again"
                  size="small"
                  variant="outline"
                  icon="refresh"
                  onPress={() => void retryMessage(message)}
                  disabled={isResponding}
                  fullWidth
                />
              ) : null}
              {message.clarification?.options?.length ? (
                <View style={styles.options}>
                  {message.clarification.options.map((option) => (
                    <Chip
                      key={option.id}
                      label={option.name}
                      onPress={() =>
                        handleContainerChoice(message, option.id)
                      }
                    />
                  ))}
                </View>
              ) : null}
              {message.clarification?.walletOptions?.length ? (
                <View style={styles.options}>
                  {message.clarification.walletOptions.map((option) => (
                    <Chip
                      key={option.id}
                      label={option.name}
                      onPress={() => handleWalletChoice(message, option.id)}
                    />
                  ))}
                </View>
              ) : null}
            </ChatBubble>
            </Animated.View>
          ))}
          {isResponding ? <AssistantThinkingIndicator /> : null}
        </ScrollView>

        <View
          style={[
            styles.composerArea,
            { borderTopColor: theme.colors.border },
          ]}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.suggestions}
            keyboardShouldPersistTaps="handled"
          >
            {SUGGESTIONS.map((suggestion) => (
              <Chip
                key={suggestion}
                label={suggestion}
                onPress={() => setInput(suggestion)}
              />
            ))}
          </ScrollView>

          <View
            style={[
              styles.composer,
              {
                backgroundColor: theme.glass.surface,
                borderColor: theme.glass.border,
              },
            ]}
          >
            <TextInput
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => void handleSend()}
              placeholder="Tell Pocketa what happened…"
              placeholderTextColor={inputPalette.placeholder}
              selectionColor={inputPalette.selection}
              cursorColor={inputPalette.cursor}
              textAlignVertical="top"
              style={[
                styles.input,
                {
                  color: inputPalette.text,
                  fontFamily: isLoaded(typography.body)
                    ? typography.body
                    : undefined,
                },
              ]}
              multiline
              maxLength={500}
              accessibilityLabel="Message Pocketa"
              returnKeyType="send"
              submitBehavior="submit"
            />
            <IconButton
              icon="arrow-up"
              accessibilityLabel="Send message"
              variant="primary"
              size={42}
              onPress={() => void handleSend()}
              disabled={!isAssistantSendEnabled(input, isResponding)}
            />
          </View>
          <AppText
            variant="micro"
            color={theme.colors.textTertiary}
            align="center"
          >
            {isResponding
              ? 'INTERPRETING…'
              : 'DRAFT FIRST · YOU CONFIRM EVERY WRITE'}
          </AppText>
        </View>
      </KeyboardAvoidingView>

      <ConfirmationDialog
        visible={pendingConfirmation !== null}
        title={
          pendingConfirmation
            ? `Save this ${actionDisplayLabel(
                pendingConfirmation.proposal.action,
              ).toLowerCase()}?`
            : 'Save this transaction?'
        }
        description="This writes the transaction to your local ledger immediately. Review the receipt before confirming."
        details={
          pendingConfirmation
            ? proposalConfirmationDetails(pendingConfirmation.proposal)
            : undefined
        }
        confirmLabel="Save transaction"
        cancelLabel="Keep as draft"
        onConfirm={() => void handleConfirmExecution()}
        onCancel={() => setPendingConfirmation(null)}
      />
    </Screen>
  );
}

function DraftCard({
  proposal,
  execution,
  onConfirm,
}: {
  proposal: AssistantProposal;
  execution?: ProposalExecution;
  onConfirm: () => void;
}) {
  const { theme } = useAppTheme();
  const saved = execution?.status === 'success';
  const receiptColor = saved
    ? theme.colors.success
    : execution?.status === 'error'
      ? theme.colors.warning
      : execution?.status === 'executing'
        ? theme.colors.primary
        : theme.colors.textTertiary;

  return (
    <View
      style={[
        styles.draft,
        {
          backgroundColor: theme.colors.surfaceMuted,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <View style={styles.draftHeader}>
        <View
          style={[
            styles.draftIcon,
            { backgroundColor: theme.colors.primarySoft },
          ]}
        >
          <Ionicons
            name={actionIcon(proposal)}
            size={18}
            color={theme.colors.primary}
          />
        </View>
        <View style={styles.draftCopy}>
          <AppText variant="micro" color={receiptColor}>
            {receiptStateLabel(proposal, execution)}
          </AppText>
          <AppText variant="h3">{proposal.title}</AppText>
        </View>
      </View>

      <View style={styles.draftAmountRow}>
        <AppText
          variant="amount"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {formatPeso(proposal.amountMinor)}
        </AppText>
      </View>

      {proposal.walletLabel ? (
        <DraftLine label="Wallet" value={proposal.walletLabel} />
      ) : null}
      {proposal.action === 'wallet_transfer' ? (
        <>
          <DraftLine
            label="From wallet"
            value={proposal.sourceWalletLabel ?? 'Wallet'}
          />
          <DraftLine
            label="To wallet"
            value={proposal.destinationWalletLabel ?? 'Wallet'}
          />
        </>
      ) : null}
      {proposal.action === 'container_transfer' ? (
        <>
          <DraftLine
            label="From container"
            value={proposal.containerLabel ?? 'Container'}
          />
          <DraftLine
            label="To container"
            value={proposal.destinationContainerLabel ?? 'Container'}
          />
        </>
      ) : null}
      {proposal.action === 'expense' ? (
        <DraftLine
          label="Container"
          value={proposal.containerLabel ?? 'Budget container'}
        />
      ) : null}
      {proposal.action === 'income' ? (
        <DraftLine
          label="To container"
          value={
            proposal.destinationContainerLabel ??
            proposal.containerLabel ??
            'Unallocated'
          }
        />
      ) : null}
      {proposal.action === 'savings_contribution' ||
      proposal.action === 'savings_withdrawal' ? (
        <>
          <DraftLine
            label="From"
            value={proposal.containerLabel ?? 'Container'}
          />
          <DraftLine
            label="To"
            value={proposal.destinationContainerLabel ?? 'Container'}
          />
        </>
      ) : null}
      <DraftLine label="When" value={formatDateKey(proposal.effectiveDate)} />
      <DraftLine label="Period" value={formatMonthKey(proposal.monthKey)} />
      {proposal.sourceBalanceMinor !== undefined ? (
        <DraftLine
          label="Source now"
          value={formatPeso(proposal.sourceBalanceMinor)}
        />
      ) : null}
      {proposal.destinationBalanceMinor !== undefined ? (
        <DraftLine
          label="Destination now"
          value={formatPeso(proposal.destinationBalanceMinor)}
        />
      ) : null}

      {execution?.status === 'success' ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.executionNotice,
            {
              backgroundColor: theme.colors.successSoft,
              borderColor: theme.colors.success + '33',
            },
          ]}
        >
          <Ionicons
            name="checkmark-circle"
            size={18}
            color={theme.colors.success}
          />
          <View style={styles.executionCopy}>
            <AppText variant="label" color={theme.colors.success}>
              Saved to your local ledger
            </AppText>
            <AppText variant="caption" color={theme.colors.textSecondary}>
              This transaction now appears in History.
            </AppText>
            <AppText
              variant="micro"
              color={theme.colors.textTertiary}
              numberOfLines={1}
            >
              Reference: {execution.transactionId}
            </AppText>
          </View>
        </View>
      ) : (
        <>
          {execution?.status === 'error' ? (
            <View
              accessibilityLiveRegion="polite"
              style={[
                styles.executionNotice,
                {
                  backgroundColor: theme.colors.warningSoft,
                  borderColor: theme.colors.warning + '33',
                },
              ]}
            >
              <Ionicons
                name="alert-circle-outline"
                size={18}
                color={theme.colors.warning}
              />
              <View style={styles.executionCopy}>
                <AppText variant="label" color={theme.colors.warning}>
                  Not saved
                </AppText>
                <AppText variant="caption" color={theme.colors.textSecondary}>
                  {execution.message}
                </AppText>
              </View>
            </View>
          ) : null}

          {execution?.status === 'executing' ? (
            <View style={styles.executionProgress}>
              <ActivityIndicator
                size="small"
                color={theme.colors.primary}
              />
              <AppText variant="caption" color={theme.colors.textSecondary}>
                Saving to your local ledger…
              </AppText>
            </View>
          ) : (
            <AppButton
              label={
                execution?.status === 'error'
                  ? 'Review and retry'
                  : 'Review & Confirm'
              }
              icon={execution?.status === 'error' ? 'refresh' : 'checkmark'}
              accessibilityHint="Opens the receipt for final review."
              onPress={onConfirm}
              fullWidth
            />
          )}

          <AppText variant="caption" color={theme.colors.textSecondary}>
            Nothing changes until you confirm.
          </AppText>
        </>
      )}
    </View>
  );
}

function proposalConfirmationDetails(
  proposal: AssistantProposal,
): ConfirmationDetail[] {
  const details: ConfirmationDetail[] = [
    {
      label: 'Action',
      value: actionDisplayLabel(proposal.action),
    },
    {
      label: 'Amount',
      value: formatPeso(proposal.amountMinor),
    },
    {
      label: 'Description',
      value: proposal.title,
    },
  ];

  if (proposal.action === 'wallet_transfer') {
    details.push(
      {
        label: 'From wallet',
        value: proposal.sourceWalletLabel ?? 'Wallet',
      },
      {
        label: 'To wallet',
        value: proposal.destinationWalletLabel ?? 'Wallet',
      },
    );
  } else if (proposal.action === 'expense') {
    details.push(
      { label: 'Wallet', value: proposal.walletLabel ?? 'Wallet' },
      {
        label: 'Container',
        value: proposal.containerLabel ?? 'Budget container',
      },
    );
  } else if (proposal.action === 'income') {
    details.push(
      { label: 'Wallet', value: proposal.walletLabel ?? 'Wallet' },
      {
        label: 'To container',
        value:
          proposal.destinationContainerLabel ??
          proposal.containerLabel ??
          'Unallocated',
      },
    );
  } else {
    details.push(
      {
        label: 'From container',
        value: proposal.containerLabel ?? 'Container',
      },
      {
        label: 'To container',
        value: proposal.destinationContainerLabel ?? 'Container',
      },
    );
  }

  details.push(
    { label: 'When', value: formatDateKey(proposal.effectiveDate) },
    { label: 'Period', value: formatMonthKey(proposal.monthKey) },
  );

  return details;
}

function IntentLine({
  interpretation,
}: {
  interpretation: AssistantInterpretation;
}) {
  const { theme } = useAppTheme();

  return (
    <View style={styles.intentLine}>
      <AppText variant="micro" color={theme.colors.textTertiary}>
        INTERPRETED AS
      </AppText>
      <AppText
        variant="caption"
        weight="semibold"
        color={theme.colors.primary}
      >
        {INTENT_LABELS[interpretation.intent]}
      </AppText>
    </View>
  );
}

function ClarificationDetails({
  interpretation,
}: {
  interpretation?: AssistantInterpretation;
}) {
  const { theme } = useAppTheme();
  if (!interpretation) return null;

  const rows: { label: string; value: string }[] = [];
  if (interpretation.amountMinor !== undefined) {
    rows.push({
      label: 'Amount',
      value: formatPeso(interpretation.amountMinor),
    });
  }
  if (interpretation.effectiveDate) {
    rows.push({
      label: 'Effective date',
      value: formatDateKey(interpretation.effectiveDate),
    });
  }
  if (interpretation.sourceWallet) {
    rows.push({
      label: 'From wallet',
      value: interpretation.sourceWallet.name,
    });
  }
  if (interpretation.destinationWallet) {
    rows.push({
      label: 'To wallet',
      value: interpretation.destinationWallet.name,
    });
  }
  if (interpretation.sourceContainer) {
    rows.push({
      label: 'From container',
      value: interpretation.sourceContainer.name,
    });
  }
  if (interpretation.destinationContainer) {
    rows.push({
      label: 'To container',
      value: interpretation.destinationContainer.name,
    });
  }
  if (interpretation.description) {
    rows.push({
      label: 'Description',
      value: interpretation.description,
    });
  }

  const missing = interpretation.missingFields
    .map((field) => MISSING_FIELD_LABELS[field])
    .join(', ');

  return (
    <View
      style={[
        styles.detailCard,
        {
          backgroundColor: theme.colors.warningSoft,
          borderColor: theme.colors.warning,
        },
      ]}
    >
      <AppText variant="micro" color={theme.colors.warning}>
        NEEDS MORE INFORMATION
      </AppText>
      {rows.map((row) => (
        <DraftLine key={row.label} label={row.label} value={row.value} />
      ))}
      {missing ? (
        <AppText variant="caption" weight="semibold" color={theme.colors.warning}>
          Missing: {missing}
        </AppText>
      ) : null}
      <AppText variant="caption" color={theme.colors.textSecondary}>
        No transaction was saved.
      </AppText>
    </View>
  );
}

function AnswerCard({ answer }: { answer: AssistantAnswer }) {
  const { theme } = useAppTheme();
  if (answer.figures.length === 0) return null;

  return (
    <View
      style={[
        styles.draft,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <AppText variant="micro" color={theme.colors.textTertiary}>
        READ-ONLY ANSWER
      </AppText>
      <AppText variant="h3">{answer.title}</AppText>
      {answer.figures.map((figure) => (
        <DraftLine
          key={`${answer.topic}-${figure.label}`}
          label={figure.label}
          value={formatPeso(figure.amountMinor)}
        />
      ))}
    </View>
  );
}

function DraftLine({ label, value }: { label: string; value: string }) {
  const { theme } = useAppTheme();

  return (
    <View style={styles.draftLine}>
      <AppText variant="caption" color={theme.colors.textSecondary}>
        {label}
      </AppText>
      <AppText
        variant="caption"
        weight="semibold"
        align="right"
        style={styles.flexShrink}
      >
        {value}
      </AppText>
    </View>
  );
}

function createWelcomeMessage(
  provider: { info: AssistantProviderInfo },
): ThreadMessage {
  return {
    id: nextMessageId('assistant'),
    role: 'assistant',
    text: `Hi! I interpret expenses, income, wallet transfers, container transfers, Savings transfers, and simple local finance questions. ${
      provider.info.isRealModel
        ? 'This development build uses the configured on-device language model.'
        : 'I use deterministic rules rather than a language model.'
    } I can prepare a draft, and you can review and confirm it before anything is saved to your local ledger.`,
    createdAt: new Date().toISOString(),
  };
}

function createThreadMessage(result: AssistantResult): ThreadMessage {
  return {
    id: nextMessageId('assistant'),
    role: 'assistant',
    text: result.message,
    createdAt: new Date().toISOString(),
    proposal: result.kind === 'proposal' ? result.proposal : undefined,
    clarification:
      result.kind === 'clarification' ? result.clarification : undefined,
    answer: result.kind === 'answer' ? result.answer : undefined,
    interpretation: result.interpretation,
  };
}

function nextMessageId(role: ChatMessage['role']): string {
  messageSequence += 1;
  return `${role}-${Date.now().toString(36)}-${messageSequence}`;
}

function receiptStateLabel(
  proposal: AssistantProposal,
  execution?: ProposalExecution,
): string {
  if (execution?.status === 'success') return 'SAVED TRANSACTION';
  if (execution?.status === 'executing') return 'SAVING TRANSACTION';
  return `DRAFT · ${actionDisplayLabel(proposal.action).toUpperCase()}`;
}

function actionDisplayLabel(action: AssistantProposal['action']): string {
  if (action === 'expense') return 'Expense';
  if (action === 'income') return 'Income';
  if (action === 'wallet_transfer') return 'Wallet transfer';
  if (action === 'container_transfer') return 'Container transfer';
  if (action === 'savings_contribution') return 'Savings contribution';
  return 'Savings withdrawal';
}

function actionIcon(
  proposal: AssistantProposal,
):
  | 'receipt-outline'
  | 'arrow-down-circle-outline'
  | 'wallet-outline'
  | 'swap-horizontal-outline' {
  if (proposal.action === 'expense') return 'receipt-outline';
  if (proposal.action === 'income') return 'arrow-down-circle-outline';
  if (proposal.action === 'wallet_transfer') return 'wallet-outline';
  return 'swap-horizontal-outline';
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  conversation: {
    flex: 1,
    minHeight: 0,
  },
  flexShrink: {
    flexShrink: 1,
  },
  modeArea: {
    gap: spacing.sm,
  },
  messages: {
    gap: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  intentLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  detailCard: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  loadingCopy: {
    flex: 1,
    gap: 2,
  },
  composerArea: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  suggestions: {
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    paddingLeft: spacing.md,
    paddingRight: 6,
    paddingVertical: 6,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    lineHeight: 20,
  },
  draft: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  draftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  draftIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftCopy: {
    flex: 1,
    gap: 1,
  },
  draftAmountRow: {
    alignItems: 'flex-start',
  },
  draftLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  executionNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  executionCopy: {
    flex: 1,
    gap: 2,
  },
  executionProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
});
