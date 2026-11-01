import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {
  interpretAssistantMessage,
  resolveAssistantContainerChoice,
  type AssistantAnswer,
  type AssistantClarification,
  type AssistantContext,
  type AssistantProposal,
  type AssistantResult,
} from '@/ai/localAssistant';
import { AppText } from '@/components/AppText';
import { ChatBubble } from '@/components/chat/ChatBubble';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { NoticeBanner } from '@/components/ui/NoticeBanner';
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
import { useAppTheme, radii, spacing } from '@/theme';

interface ThreadMessage extends ChatMessage {
  proposal?: AssistantProposal;
  clarification?: AssistantClarification;
  answer?: AssistantAnswer;
}

const SUGGESTIONS = [
  '\u20B150 jeepney fare',
  'Received \u20B12,000 allowance',
  'Move \u20B1300 to savings',
  'How much is in savings?',
  'How much did I spend this month?',
];

let messageSequence = 0;

export function AssistantScreen() {
  const { theme } = useAppTheme();
  const { activeMonthKey, todayDateKey } = useFinance();
  const monthQuery = useFinanceMonth(activeMonthKey);
  const walletQuery = useFinanceWallets();
  const [messages, setMessages] = useState<ThreadMessage[]>(() => [
    createWelcomeMessage(),
  ]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

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
          subtitle="Draft money entries offline, then confirm them yourself."
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

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;

    const userMessage: ThreadMessage = {
      id: nextMessageId('user'),
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    };
    const result = interpretAssistantMessage(text, context);

    setMessages((current) => [
      ...current,
      userMessage,
      createThreadMessage(result),
    ]);
    setInput('');
  };

  const handleChoice = (
    message: ThreadMessage,
    containerId: string,
  ) => {
    const pending = message.clarification?.pending;
    if (!pending) return;

    const result = resolveAssistantContainerChoice(
      containerId,
      pending,
      context,
    );
    setMessages((current) => [
      ...current.map((candidate) =>
        candidate.id === message.id
          ? { ...candidate, clarification: undefined }
          : candidate,
      ),
      createThreadMessage(result),
    ]);
  };

  return (
    <Screen scroll={false}>
      <PageHeader
        title="Pocketa assistant"
        subtitle="Interpret money messages and answer local questions offline."
        preview={false}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <NoticeBanner
          title="Interpretation-only prototype"
          message="No language model is connected. Drafts come from deterministic rules on this device. This screen never writes to the ledger; confirmation and saving belong to Phase 6."
          icon="hardware-chip-outline"
        />

        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.messages}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() =>
            scrollRef.current?.scrollToEnd({ animated: true })
          }
        >
          {messages.map((message) => (
            <ChatBubble key={message.id} message={message}>
              {message.proposal ? (
                <DraftCard proposal={message.proposal} />
              ) : null}
              {message.answer ? (
                <AnswerCard answer={message.answer} />
              ) : null}
              {message.clarification?.options?.length ? (
                <View style={styles.options}>
                  {message.clarification.options.map((option) => (
                    <Chip
                      key={option.id}
                      label={option.name}
                      onPress={() => handleChoice(message, option.id)}
                    />
                  ))}
                </View>
              ) : null}
            </ChatBubble>
          ))}
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
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <TextInput
              value={input}
              onChangeText={setInput}
              onSubmitEditing={handleSend}
              placeholder="Tell Pocketa what happened…"
              placeholderTextColor={theme.colors.textTertiary}
              style={[styles.input, { color: theme.colors.text }]}
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
              onPress={handleSend}
              disabled={!input.trim()}
            />
          </View>
          <AppText
            variant="micro"
            color={theme.colors.textTertiary}
            align="center"
          >
            INTERPRETATION ONLY · NO LEDGER WRITES
          </AppText>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function DraftCard({ proposal }: { proposal: AssistantProposal }) {
  const { theme } = useAppTheme();

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
          <AppText variant="micro" color={theme.colors.textTertiary}>
            {actionLabel(proposal.action)}
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

      <AppText variant="caption" color={theme.colors.textSecondary}>
        Draft only. This prototype cannot save or change balances; confirmation
        and ledger writes belong to Phase 6.
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

function createWelcomeMessage(): ThreadMessage {
  return {
    id: nextMessageId('assistant'),
    role: 'assistant',
    text: 'Hi! I interpret expenses, income, Savings transfers, and simple local finance questions from a short message. I use deterministic rules rather than a language model. I can prepare a draft, but I cannot save it or change balances in this phase.',
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
  };
}

function nextMessageId(role: ChatMessage['role']): string {
  messageSequence += 1;
  return `${role}-${Date.now().toString(36)}-${messageSequence}`;
}

function actionLabel(action: AssistantProposal['action']): string {
  if (action === 'expense') return 'PROPOSED EXPENSE';
  if (action === 'income') return 'PROPOSED INCOME';
  if (action === 'savings_contribution') {
    return 'PROPOSED SAVINGS CONTRIBUTION';
  }
  return 'PROPOSED SAVINGS WITHDRAWAL';
}

function actionIcon(
  proposal: AssistantProposal,
): 'receipt-outline' | 'arrow-down-circle-outline' | 'swap-horizontal-outline' {
  if (proposal.action === 'expense') return 'receipt-outline';
  if (proposal.action === 'income') return 'arrow-down-circle-outline';
  return 'swap-horizontal-outline';
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  flexShrink: {
    flexShrink: 1,
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
});
