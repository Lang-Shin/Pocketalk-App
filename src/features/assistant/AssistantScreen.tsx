import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppText } from '@/components/AppText';
import { ChatBubble } from '@/components/chat/ChatBubble';
import { ConfirmationDialog } from '@/components/feedback/ConfirmationDialog';
import { AppButton } from '@/components/ui/AppButton';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { NoticeBanner } from '@/components/ui/NoticeBanner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorState, LoadingState } from '@/components/ui/QueryStates';
import { Screen } from '@/components/ui/Screen';
import { useMockFinance } from '@/data/financeStore';
import { useAssistantThread } from '@/data/hooks';
import type {
  ChatMessage,
  ProposedTransactionDraft,
} from '@/data/models';
import { formatPeso } from '@/lib/money';
import { formatMonthKey } from '@/lib/period';
import { useAppTheme, radii, spacing } from '@/theme';

type DraftStatus = 'pending' | 'confirmed';

const SUGGESTIONS = [
  '\u20B150 jeepney fare',
  'Received \u20B12,000 allowance',
  'Move \u20B1300 to savings',
];

export function AssistantScreen() {
  const { status, data, error, retry } = useAssistantThread();
  const { theme } = useAppTheme();
  const { activeMonthKey } = useMockFinance();
  const periodLabel = formatMonthKey(activeMonthKey);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [draftStatus, setDraftStatus] = useState<DraftStatus>('pending');
  const [dialogVisible, setDialogVisible] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const initialized = useRef(false);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (data && !initialized.current) {
      setMessages(data);
      initialized.current = true;
    }
  }, [data]);

  useEffect(() => {
    return () => {
      if (replyTimer.current) clearTimeout(replyTimer.current);
    };
  }, []);

  if (status === 'loading') {
    return (
      <Screen scroll={false}>
        <PageHeader
          title="Pocketa assistant"
          subtitle="A calm way to record money in plain language."
          preview={false}
        />
        <LoadingState label="Opening the preview conversation…" />
      </Screen>
    );
  }

  if (status === 'error' || !data) {
    return (
      <Screen>
        <PageHeader
          title="Pocketa assistant"
          preview={false}
        />
        <ErrorState
          message={error?.message ?? 'Please try again.'}
          onRetry={retry}
        />
      </Screen>
    );
  }

  const draftMessage = messages.find((message) => message.draft);
  const draft = draftMessage?.draft;

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;

    const userMessage: ChatMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    };

    setMessages((current) => [...current, userMessage]);
    setInput('');

    if (replyTimer.current) clearTimeout(replyTimer.current);
    replyTimer.current = setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          id: `local-assistant-${Date.now()}`,
          role: 'assistant',
          text: 'This preview does not use an AI model yet. In a later phase, a local model would turn that into a structured draft for you to confirm.',
          createdAt: new Date().toISOString(),
        },
      ]);
    }, 450);
  };

  const handleConfirm = () => {
    setDialogVisible(false);
    setDraftStatus('confirmed');
  };

  return (
    <Screen scroll={false}>
      <PageHeader
        title="Pocketa assistant"
        subtitle="A calm way to record money in plain language."
        preview={false}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <NoticeBanner
          title="Interface preview only"
          message="No AI model is connected. This draft is sample data and cannot save a transaction."
          icon="sparkles-outline"
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
              {message.draft ? (
                <DraftCard
                  draft={message.draft}
                  periodLabel={periodLabel}
                  status={draftStatus}
                  onReview={() => setDialogVisible(true)}
                />
              ) : null}
            </ChatBubble>
          ))}

          {draftStatus === 'confirmed' ? (
            <NoticeBanner
              title="Draft confirmed — demo only"
              message="Nothing was saved. Real confirmation will be connected to the ledger in a later phase."
              tone="success"
            />
          ) : null}
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
            AI IS NOT CONNECTED IN THIS PREVIEW
          </AppText>
        </View>
      </KeyboardAvoidingView>

      {draft ? (
        <ConfirmationDialog
          visible={dialogVisible}
          title="Review this draft"
          description="This is a sample transaction. Confirming will not move or save money in this phase."
          details={buildDraftDetails(draft, periodLabel)}
          confirmLabel="Confirm demo"
          cancelLabel="Not now"
          onConfirm={handleConfirm}
          onCancel={() => setDialogVisible(false)}
        />
      ) : null}
    </Screen>
  );
}

function DraftCard({
  draft,
  periodLabel,
  status,
  onReview,
}: {
  draft: ProposedTransactionDraft;
  periodLabel: string;
  status: DraftStatus;
  onReview: () => void;
}) {
  const { theme } = useAppTheme();
  const confirmed = status === 'confirmed';
  const draftLabel =
    draft.action === 'expense'
      ? 'PROPOSED EXPENSE'
      : draft.action === 'income'
        ? 'PROPOSED INCOME'
        : 'PROPOSED TRANSFER';

  return (
    <View
      style={[
        styles.draft,
        {
          backgroundColor: confirmed
            ? theme.colors.successSoft
            : theme.colors.surfaceMuted,
          borderColor: confirmed ? theme.colors.success : theme.colors.border,
        },
      ]}
    >
      <View style={styles.draftHeader}>
        <View
          style={[
            styles.draftIcon,
            {
              backgroundColor: confirmed
                ? theme.colors.successSoft
                : theme.colors.primarySoft,
            },
          ]}
        >
          <Ionicons
            name={confirmed ? 'checkmark' : 'receipt-outline'}
            size={18}
            color={
              confirmed ? theme.colors.success : theme.colors.primary
            }
          />
        </View>
        <View style={styles.draftCopy}>
          <AppText variant="micro" color={theme.colors.textTertiary}>
            {draftLabel}
          </AppText>
          <AppText variant="h3">{draft.title}</AppText>
        </View>
      </View>

      <View style={styles.draftAmountRow}>
        <AppText variant="amount">{formatPeso(draft.amountMinor)}</AppText>
      </View>

      <DraftLine
        label={draft.action === 'income' ? 'To' : 'From'}
        value={draft.sourceLabel ?? draft.destinationLabel ?? 'Sample account'}
      />
      <DraftLine
        label={draft.action === 'transfer' ? 'To' : 'Container'}
        value={draft.destinationLabel ?? 'Sample container'}
      />
      <DraftLine label="When" value={draft.dateLabel} />
      <DraftLine label="Period" value={periodLabel} />

      {confirmed ? (
        <AppText variant="caption" color={theme.colors.success}>
          Confirmed in the demo. No transaction was saved.
        </AppText>
      ) : (
        <AppButton
          label="Review & confirm"
          size="small"
          icon="checkmark-circle-outline"
          onPress={onReview}
          fullWidth
        />
      )}
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

function buildDraftDetails(
  draft: ProposedTransactionDraft,
  periodLabel: string,
) {
  return [
    {
      label: 'Type',
      value:
        draft.action === 'expense'
          ? 'Expense'
          : draft.action === 'income'
            ? 'Income'
            : 'Transfer',
    },
    { label: 'Amount', value: formatPeso(draft.amountMinor) },
    { label: 'Account', value: draft.sourceLabel ?? 'Sample account' },
    {
      label: draft.action === 'transfer' ? 'To' : 'Container',
      value: draft.destinationLabel ?? 'Sample container',
    },
    { label: 'When', value: draft.dateLabel },
    { label: 'Period', value: periodLabel },
  ];
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
