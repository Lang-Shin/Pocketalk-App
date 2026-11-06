import type {
  ContainerStatus,
  SystemContainerKey,
  WalletKind,
} from '@/data/models';
import { formatPeso, parsePesoToMinor } from '@/lib/money';
import {
  dateKeyToLocalDate,
  formatMonthKey,
  isValidDateKey,
  monthKeyForDateKey,
  toLocalDateKey,
} from '@/lib/period';

export type AssistantAction =
  | 'expense'
  | 'income'
  | 'wallet_transfer'
  | 'container_transfer'
  | 'savings_contribution'
  | 'savings_withdrawal';

export type AssistantIntent =
  | 'income'
  | 'expense'
  | 'wallet_transfer'
  | 'container_transfer'
  | 'balance_inquiry'
  | 'spending_summary'
  | 'income_summary'
  | 'budget_inquiry'
  | 'clarification_request'
  | 'unknown';

export type AssistantQuestionTopic =
  | 'savings_balance'
  | 'unallocated_balance'
  | 'wallet_balance'
  | 'container_balance'
  | 'container_spending'
  | 'budget_remaining'
  | 'monthly_spending'
  | 'monthly_income'
  | 'monthly_net_savings'
  | 'monthly_savings_activity'
  | 'help';

export interface AssistantAnswerFigure {
  label: string;
  amountMinor: number;
}

export interface AssistantAnswer {
  topic: AssistantQuestionTopic;
  title: string;
  figures: AssistantAnswerFigure[];
}

export interface AssistantWalletOption {
  id: string;
  name: string;
  kind: WalletKind;
  balanceMinor: number;
}

export interface AssistantContainerOption {
  id: string;
  name: string;
  status: ContainerStatus;
  systemKey?: SystemContainerKey | null;
  balanceMinor: number;
  limitMinor: number;
  spentMinor: number;
  remainingMinor: number;
}

export interface AssistantMonthSummary {
  monthKey: string;
  incomeMinor: number;
  expenseMinor: number;
  netSavingsMinor: number;
  totalLimitMinor: number;
  totalSpentMinor: number;
  totalRemainingMinor: number;
  savingsContributionsMinor: number;
  savingsWithdrawalsMinor: number;
  savingsEndingBalanceMinor: number;
  unallocatedEndingBalanceMinor: number;
}

export interface AssistantContext {
  todayDateKey: string;
  activeMonthKey: string;
  wallets: AssistantWalletOption[];
  containers: AssistantContainerOption[];
  summary: AssistantMonthSummary;
}

export interface AssistantProposal {
  id: string;
  action: AssistantAction;
  title: string;
  amountMinor: number;
  effectiveDate: string;
  monthKey: string;
  walletId?: string;
  walletLabel?: string;
  sourceWalletId?: string;
  sourceWalletLabel?: string;
  destinationWalletId?: string;
  destinationWalletLabel?: string;
  containerId?: string;
  containerLabel?: string;
  destinationContainerId?: string;
  destinationContainerLabel?: string;
  sourceBalanceMinor?: number;
  destinationBalanceMinor?: number;
}

export interface AssistantContainerChoice {
  id: string;
  name: string;
  balanceMinor: number;
}

export interface AssistantWalletChoice {
  id: string;
  name: string;
  kind: WalletKind;
  balanceMinor: number;
}

export interface AssistantPendingIntent {
  action: AssistantAction;
  amountMinor: number;
  title: string;
  effectiveDate: string;
  walletId?: string;
  sourceWalletId?: string;
  destinationWalletId?: string;
  sourceContainerId?: string;
  destinationContainerId?: string;
  role: 'source' | 'destination';
}

export interface AssistantClarification {
  reason: 'amount' | 'container' | 'wallet' | 'transfer' | 'setup';
  options?: AssistantContainerChoice[];
  walletOptions?: AssistantWalletChoice[];
  pending?: AssistantPendingIntent;
}

export type AssistantMissingField =
  | 'amount'
  | 'effectiveDate'
  | 'sourceWallet'
  | 'destinationWallet'
  | 'sourceContainer'
  | 'destinationContainer'
  | 'transferKind';

export interface AssistantEntityRef {
  id: string;
  name: string;
}

export interface AssistantInterpretation {
  intent: AssistantIntent;
  amountMinor?: number;
  currency?: 'PHP';
  effectiveDate?: string;
  sourceWallet?: AssistantEntityRef;
  destinationWallet?: AssistantEntityRef;
  sourceContainer?: AssistantEntityRef;
  destinationContainer?: AssistantEntityRef;
  description?: string;
  confidence: number;
  missingFields: AssistantMissingField[];
  clarificationQuestion?: string;
  reasoningSummary: string;
}

export type AssistantResultBase =
  | {
      kind: 'proposal';
      intent: AssistantIntent;
      message: string;
      proposal: AssistantProposal;
    }
  | {
      kind: 'clarification';
      intent: AssistantIntent;
      message: string;
      clarification: AssistantClarification;
    }
  | {
      kind: 'answer';
      intent: AssistantIntent;
      message: string;
      answer: AssistantAnswer;
    }
  | {
      kind: 'refusal';
      intent: AssistantIntent;
      message: string;
    };

export type AssistantResult = AssistantResultBase & {
  interpretation: AssistantInterpretation;
};

interface ParsedAmount {
  amountMinor: number;
}

interface DraftParts {
  action: AssistantAction;
  amountMinor: number;
  title: string;
  effectiveDate: string;
  walletId?: string;
  sourceWalletId?: string;
  destinationWalletId?: string;
  sourceContainerId?: string;
  destinationContainerId?: string;
}

let proposalSequence = 0;

export function interpretAssistantMessage(
  text: string,
  context: AssistantContext,
): AssistantResult {
  return attachInterpretation(
    interpretAssistantMessageBase(text, context),
    context,
  );
}

function interpretAssistantMessageBase(
  text: string,
  context: AssistantContext,
): AssistantResultBase {
  const statement = text.trim();
  if (!statement) {
    return clarifyAmount(
      'Tell me what happened, including an amount.',
      'unknown',
    );
  }

  if (isClarificationRequest(statement)) {
    return helpResult();
  }

  if (isQuestion(statement)) {
    return answerQuestion(statement, context);
  }

  const action = detectAction(statement, context);
  if (!action) {
    if (looksLikeTransfer(statement)) {
      return transferCategoryClarification();
    }
    return {
      kind: 'refusal',
      intent: 'unknown',
      message:
        'I can draft expenses, income, wallet transfers, container transfers, Savings transfers, and read-only questions. Name the source and destination, and include an amount.',
    };
  }

  const intent = intentForAction(action);
  const parsedAmount = extractAmount(statement);
  if (!parsedAmount) {
    return {
      kind: 'clarification',
      intent,
      message:
        'What amount should I use? Include a peso amount, such as ₱145 or 1,200.',
      clarification: { reason: 'amount' },
    };
  }

  const effectiveDate = resolveEffectiveDate(statement, context.todayDateKey);
  if (!effectiveDate) {
    return {
      kind: 'refusal',
      intent,
      message:
        'I could not use that date. Use today, yesterday, or a valid date such as 2026-10-20.',
    };
  }
  if (effectiveDate > context.todayDateKey) {
    return {
      kind: 'refusal',
      intent,
      message: 'Future-dated entries are blocked. Choose today or an earlier date.',
    };
  }

  if (action === 'wallet_transfer') {
    return interpretWalletTransfer(statement, context, {
      action,
      amountMinor: parsedAmount.amountMinor,
      title: 'Wallet transfer',
      effectiveDate,
    });
  }

  if (action === 'container_transfer') {
    return interpretContainerTransfer(statement, context, {
      action,
      amountMinor: parsedAmount.amountMinor,
      title: 'Container transfer',
      effectiveDate,
    });
  }

  const title = extractTitle(statement, action);
  const wallet = needsWallet(action)
    ? resolveWallet(statement, context.wallets)
    : null;

  if (needsWallet(action) && !wallet) {
    return {
      kind: 'clarification',
      intent,
      message: 'There is no wallet available yet. Open the app again after setup.',
      clarification: { reason: 'wallet' },
    };
  }

  const amountMinor = parsedAmount.amountMinor;

  if (action === 'expense') {
    const resolution = resolveExpenseContainer(statement, context, {
      action,
      amountMinor,
      title,
      effectiveDate,
      walletId: wallet?.id,
    });
    if ('result' in resolution) return resolution.result;
    return assembleProposal(
      {
        action,
        amountMinor,
        title,
        effectiveDate,
        walletId: wallet?.id,
        sourceContainerId: resolution.container.id,
      },
      context,
    );
  }

  if (action === 'income') {
    const destination = resolveIncomeContainer(statement, context, {
      action,
      amountMinor,
      title,
      effectiveDate,
      walletId: wallet?.id,
    });
    if ('result' in destination) return destination.result;
    return assembleProposal(
      {
        action,
        amountMinor,
        title,
        effectiveDate,
        walletId: wallet?.id,
        destinationContainerId: destination.container.id,
      },
      context,
    );
  }

  if (action === 'savings_contribution') {
    const savings = findSystemContainer(context, 'savings');
    if (!savings) {
      return {
        kind: 'refusal',
        intent: 'container_transfer',
        message: 'The local Savings container is not available.',
      };
    }
    const source = resolveSavingsSource(statement, context, {
      action,
      amountMinor,
      title,
      effectiveDate,
      destinationContainerId: savings.id,
    });
    if ('result' in source) return source.result;
    return assembleProposal(
      {
        action,
        amountMinor,
        title,
        effectiveDate,
        sourceContainerId: source.container.id,
        destinationContainerId: savings.id,
      },
      context,
    );
  }

  const destination = resolveSavingsDestination(statement, context, {
    action,
    amountMinor,
    title,
    effectiveDate,
  });
  if ('result' in destination) return destination.result;
  const savings = findSystemContainer(context, 'savings');
  if (!savings) {
    return {
      kind: 'refusal',
      intent: 'container_transfer',
      message: 'The local Savings container is not available.',
    };
  }
  return assembleProposal(
    {
      action,
      amountMinor,
      title,
      effectiveDate,
      sourceContainerId: savings.id,
      destinationContainerId: destination.container.id,
    },
    context,
  );
}

export function resolveAssistantContainerChoice(
  containerId: string,
  pending: AssistantPendingIntent,
  context: AssistantContext,
): AssistantResult {
  return attachInterpretation(
    resolveAssistantContainerChoiceBase(containerId, pending, context),
    context,
  );
}

function resolveAssistantContainerChoiceBase(
  containerId: string,
  pending: AssistantPendingIntent,
  context: AssistantContext,
): AssistantResultBase {
  const choice = context.containers.find(
    (container) =>
      container.id === containerId && container.status === 'active',
  );
  if (!choice) {
    return {
      kind: 'refusal',
      intent: intentForAction(pending.action),
      message: 'That container is no longer available. Choose an active one.',
    };
  }

  if (pending.action === 'savings_contribution') {
    const savings = findSystemContainer(context, 'savings');
    if (!savings) {
      return {
        kind: 'refusal',
        intent: 'container_transfer',
        message: 'The local Savings container is not available.',
      };
    }
    return assembleProposal(
      {
        action: pending.action,
        amountMinor: pending.amountMinor,
        title: pending.title,
        effectiveDate: pending.effectiveDate,
        sourceContainerId: choice.id,
        destinationContainerId: savings.id,
      },
      context,
    );
  }

  if (pending.action === 'savings_withdrawal') {
    const savings = findSystemContainer(context, 'savings');
    if (!savings) {
      return {
        kind: 'refusal',
        intent: 'container_transfer',
        message: 'The local Savings container is not available.',
      };
    }
    return assembleProposal(
      {
        action: pending.action,
        amountMinor: pending.amountMinor,
        title: pending.title,
        effectiveDate: pending.effectiveDate,
        sourceContainerId: savings.id,
        destinationContainerId: choice.id,
      },
      context,
    );
  }

  if (pending.action === 'container_transfer') {
    if (choice.systemKey != null) {
      return {
        kind: 'refusal',
        intent: 'container_transfer',
        message: 'Container transfers require active ordinary containers.',
      };
    }
    const sourceContainerId =
      pending.role === 'source' ? choice.id : pending.sourceContainerId;
    const destinationContainerId =
      pending.role === 'destination'
        ? choice.id
        : pending.destinationContainerId;
    const nextPending: AssistantPendingIntent = {
      ...pending,
      sourceContainerId,
      destinationContainerId,
      role: 'source',
    };

    if (!sourceContainerId) {
      return containerTransferClarification(
        'Which container should send the money?',
        nextPending,
        context,
        'source',
      );
    }
    if (!destinationContainerId) {
      return containerTransferClarification(
        'Which container should receive the money?',
        nextPending,
        context,
        'destination',
      );
    }

    return assembleProposal(
      {
        action: pending.action,
        amountMinor: pending.amountMinor,
        title: pending.title,
        effectiveDate: pending.effectiveDate,
        sourceContainerId,
        destinationContainerId,
      },
      context,
    );
  }

  if (pending.role === 'source') {
    return assembleProposal(
      {
        action: pending.action,
        amountMinor: pending.amountMinor,
        title: pending.title,
        effectiveDate: pending.effectiveDate,
        walletId: pending.walletId,
        sourceContainerId: choice.id,
        destinationContainerId: pending.destinationContainerId,
      },
      context,
    );
  }

  return assembleProposal(
    {
      action: pending.action,
      amountMinor: pending.amountMinor,
      title: pending.title,
      effectiveDate: pending.effectiveDate,
      walletId: pending.walletId,
      sourceContainerId: pending.sourceContainerId,
      destinationContainerId: choice.id,
    },
    context,
  );
}

export function resolveAssistantWalletChoice(
  walletId: string,
  pending: AssistantPendingIntent,
  context: AssistantContext,
): AssistantResult {
  return attachInterpretation(
    resolveAssistantWalletChoiceBase(walletId, pending, context),
    context,
  );
}

function resolveAssistantWalletChoiceBase(
  walletId: string,
  pending: AssistantPendingIntent,
  context: AssistantContext,
): AssistantResultBase {
  const choice = context.wallets.find((wallet) => wallet.id === walletId);
  if (!choice) {
    return {
      kind: 'refusal',
      intent: 'wallet_transfer',
      message: 'That wallet is no longer available. Choose another wallet.',
    };
  }

  const sourceWalletId =
    pending.role === 'source' ? choice.id : pending.sourceWalletId;
  const destinationWalletId =
    pending.role === 'destination'
      ? choice.id
      : pending.destinationWalletId;
  const nextPending: AssistantPendingIntent = {
    ...pending,
    sourceWalletId,
    destinationWalletId,
    role: 'source',
  };

  if (!sourceWalletId) {
    return walletTransferClarification(
      'Which wallet should send the money?',
      nextPending,
      context,
      'source',
    );
  }
  if (!destinationWalletId) {
    return walletTransferClarification(
      'Which wallet should receive the money?',
      nextPending,
      context,
      'destination',
    );
  }

  return assembleProposal(
    {
      action: 'wallet_transfer',
      amountMinor: pending.amountMinor,
      title: pending.title,
      effectiveDate: pending.effectiveDate,
      sourceWalletId,
      destinationWalletId,
    },
    context,
  );
}

type TransferBase = Pick<
  AssistantPendingIntent,
  'action' | 'amountMinor' | 'title' | 'effectiveDate'
>;

function interpretWalletTransfer(
  text: string,
  context: AssistantContext,
  base: TransferBase,
): AssistantResultBase {
  const endpoints = extractTransferEndpoints(text);
  const sourceMatches = endpoints.sourceSegment
    ? resolveWalletMatches(endpoints.sourceSegment, context.wallets)
    : [];
  const destinationMatches = endpoints.destinationSegment
    ? resolveWalletMatches(endpoints.destinationSegment, context.wallets)
    : [];
  const source =
    sourceMatches.length === 1 ? sourceMatches[0] : undefined;
  const destination =
    destinationMatches.length === 1 ? destinationMatches[0] : undefined;
  const pending: AssistantPendingIntent = {
    ...base,
    role: 'source',
    sourceWalletId: source?.id,
    destinationWalletId: destination?.id,
  };

  if (sourceMatches.length > 1) {
    return walletTransferClarification(
      'Which wallet should send the money?',
      pending,
      context,
      'source',
      sourceMatches,
    );
  }
  if (endpoints.sourceSegment && !source) {
    return walletTransferClarification(
      `I could not match “${endpoints.sourceSegment}” to a wallet. Choose the source wallet.`,
      pending,
      context,
      'source',
    );
  }
  if (destinationMatches.length > 1) {
    return walletTransferClarification(
      'Which wallet should receive the money?',
      pending,
      context,
      'destination',
      destinationMatches,
    );
  }
  if (endpoints.destinationSegment && !destination) {
    return walletTransferClarification(
      `I could not match “${endpoints.destinationSegment}” to a wallet. Choose the destination wallet.`,
      pending,
      context,
      'destination',
    );
  }
  if (!source) {
    return walletTransferClarification(
      'Which wallet should send the money?',
      pending,
      context,
      'source',
    );
  }
  if (!destination) {
    return walletTransferClarification(
      'Which wallet should receive the money?',
      pending,
      context,
      'destination',
    );
  }

  return assembleProposal(
    {
      ...base,
      sourceWalletId: source.id,
      destinationWalletId: destination.id,
    },
    context,
  );
}

function interpretContainerTransfer(
  text: string,
  context: AssistantContext,
  base: TransferBase,
): AssistantResultBase {
  const endpoints = extractTransferEndpoints(text);
  const sourceMatches = endpoints.sourceSegment
    ? resolveOrdinaryContainerMatches(endpoints.sourceSegment, context)
    : [];
  const destinationMatches = endpoints.destinationSegment
    ? resolveOrdinaryContainerMatches(endpoints.destinationSegment, context)
    : [];
  const source =
    sourceMatches.length === 1 ? sourceMatches[0] : undefined;
  const destination =
    destinationMatches.length === 1 ? destinationMatches[0] : undefined;
  const pending: AssistantPendingIntent = {
    ...base,
    role: 'source',
    sourceContainerId: source?.id,
    destinationContainerId: destination?.id,
  };

  const archivedSource = endpoints.sourceSegment
    ? findArchivedMention(endpoints.sourceSegment, context)
    : undefined;
  if (archivedSource) {
    return containerTransferClarification(
      `${archivedSource.name} is archived. Choose an active source container.`,
      pending,
      context,
      'source',
    );
  }
  const archivedDestination = endpoints.destinationSegment
    ? findArchivedMention(endpoints.destinationSegment, context)
    : undefined;
  if (archivedDestination) {
    return containerTransferClarification(
      `${archivedDestination.name} is archived. Choose an active destination container.`,
      pending,
      context,
      'destination',
    );
  }

  if (sourceMatches.length > 1) {
    return containerTransferClarification(
      'Which container should send the money?',
      pending,
      context,
      'source',
      sourceMatches,
    );
  }
  if (endpoints.sourceSegment && !source) {
    return containerTransferClarification(
      `I could not match “${endpoints.sourceSegment}” to an active ordinary container. Choose the source container.`,
      pending,
      context,
      'source',
    );
  }
  if (destinationMatches.length > 1) {
    return containerTransferClarification(
      'Which container should receive the money?',
      pending,
      context,
      'destination',
      destinationMatches,
    );
  }
  if (endpoints.destinationSegment && !destination) {
    return containerTransferClarification(
      `I could not match “${endpoints.destinationSegment}” to an active ordinary container. Choose the destination container.`,
      pending,
      context,
      'destination',
    );
  }
  if (!source) {
    return containerTransferClarification(
      'Which container should send the money?',
      pending,
      context,
      'source',
    );
  }
  if (!destination) {
    return containerTransferClarification(
      'Which container should receive the money?',
      pending,
      context,
      'destination',
    );
  }

  return assembleProposal(
    {
      ...base,
      sourceContainerId: source.id,
      destinationContainerId: destination.id,
    },
    context,
  );
}

function walletTransferClarification(
  message: string,
  pending: AssistantPendingIntent,
  context: AssistantContext,
  role: 'source' | 'destination',
  matches?: AssistantWalletOption[],
): AssistantResultBase {
  const excludedId =
    role === 'source' ? pending.destinationWalletId : pending.sourceWalletId;
  const options = (matches ?? context.wallets).filter(
    (wallet) => wallet.id !== excludedId,
  );
  if (options.length === 0) {
    return {
      kind: 'refusal',
      intent: 'wallet_transfer',
      message:
        'A wallet transfer needs two available wallets. Add another wallet or use a different transfer.',
    };
  }
  return {
    kind: 'clarification',
    intent: 'wallet_transfer',
    message,
    clarification: {
      reason: 'wallet',
      walletOptions: options.map((wallet) => ({
        id: wallet.id,
        name: wallet.name,
        kind: wallet.kind,
        balanceMinor: wallet.balanceMinor,
      })),
      pending: { ...pending, role },
    },
  };
}

function containerTransferClarification(
  message: string,
  pending: AssistantPendingIntent,
  context: AssistantContext,
  role: 'source' | 'destination',
  matches?: AssistantContainerOption[],
): AssistantResultBase {
  const excludedId =
    role === 'source'
      ? pending.destinationContainerId
      : pending.sourceContainerId;
  const options = (matches ?? ordinaryContainers(context)).filter(
    (container) => container.id !== excludedId,
  );
  if (options.length === 0) {
    return {
      kind: 'refusal',
      intent: 'container_transfer',
      message:
        'A container transfer needs two active ordinary containers. Create or reactivate another container first.',
    };
  }
  return {
    kind: 'clarification',
    intent: 'container_transfer',
    message,
    clarification: {
      reason: 'container',
      options: options.map((container) => ({
        id: container.id,
        name: container.name,
        balanceMinor: container.balanceMinor,
      })),
      pending: { ...pending, role },
    },
  };
}

function resolveWalletMatches(
  text: string,
  wallets: AssistantWalletOption[],
): AssistantWalletOption[] {
  const normalized = normalize(text);
  return wallets.filter((wallet) => {
    const normalizedName = normalize(wallet.name);
    if (
      normalizedName.length >= 3 &&
      normalized.includes(normalizedName)
    ) {
      return true;
    }
    if (wallet.kind === 'cash') {
      return /\bcash\b/.test(normalized);
    }
    return /\bgcash\b|\bvirtual gcash\b/.test(normalized);
  });
}

function resolveOrdinaryContainerMatches(
  text: string,
  context: AssistantContext,
): AssistantContainerOption[] {
  return ordinaryContainers(context).filter((container) =>
    mentionsContainer(text, container),
  );
}

function ordinaryContainers(
  context: AssistantContext,
): AssistantContainerOption[] {
  return context.containers.filter(
    (container) =>
      container.status === 'active' && container.systemKey == null,
  );
}

function extractTransferEndpoints(text: string): {
  sourceSegment: string | null;
  destinationSegment: string | null;
} {
  const cleaned = text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(
      /\b(?:today|ngayon|kanina|yesterday|kahapon|tomorrow|bukas)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  const fromTo =
    /\b(?:from|galing sa|mula sa)\s+(.+?)\s+(?:to|into|papunta sa)\s+(.+)$/i.exec(
      cleaned,
    );
  if (fromTo) {
    return {
      sourceSegment: cleanTransferSegment(fromTo[1]),
      destinationSegment: cleanTransferSegment(fromTo[2]),
    };
  }

  const fromOnly =
    /\b(?:from|galing sa|mula sa)\s+(.+)$/i.exec(cleaned);
  const toOnly =
    /\b(?:to|into|papunta sa)\s+(.+)$/i.exec(cleaned);
  if (fromOnly && toOnly) {
    const sourceIndex = fromOnly.index ?? 0;
    const destinationIndex = toOnly.index ?? 0;
    if (sourceIndex < destinationIndex) {
      return {
        sourceSegment: cleanTransferSegment(fromOnly[1]),
        destinationSegment: null,
      };
    }
    return {
      sourceSegment: null,
      destinationSegment: cleanTransferSegment(toOnly[1]),
    };
  }
  if (fromOnly) {
    return {
      sourceSegment: cleanTransferSegment(fromOnly[1]),
      destinationSegment: null,
    };
  }
  if (toOnly) {
    return {
      sourceSegment: null,
      destinationSegment: cleanTransferSegment(toOnly[1]),
    };
  }
  return { sourceSegment: null, destinationSegment: null };
}

function cleanTransferSegment(
  value: string | undefined,
): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(
      /\b(?:today|ngayon|kanina|yesterday|kahapon|tomorrow|bukas)\b/gi,
      ' ',
    )
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[-:,;\s]+|[-:,;\s]+$/g, '')
    .trim();
  return cleaned || null;
}

function looksLikeTransfer(text: string): boolean {
  return /\b(?:transfer|transferred|move|moved|ilipat|inilipat)\b|\b(?:galing|mula)\s+sa\b/i.test(
    text,
  );
}

function transferCategoryClarification(): AssistantResultBase {
  return {
    kind: 'clarification',
    intent: 'unknown',
    message:
      'Is this a transfer between wallets or between containers? Name the source and destination.',
    clarification: { reason: 'transfer' },
  };
}

function assembleProposal(
  parts: DraftParts,
  context: AssistantContext,
): AssistantResultBase {
  if (
    !Number.isSafeInteger(parts.amountMinor) ||
    parts.amountMinor <= 0
  ) {
    return {
      kind: 'refusal',
      intent: intentForAction(parts.action),
      message: 'Enter an amount greater than zero.',
    };
  }
  if (!isValidDateKey(parts.effectiveDate)) {
    return {
      kind: 'refusal',
      intent: intentForAction(parts.action),
      message: 'Use a valid effective date in YYYY-MM-DD format.',
    };
  }
  if (parts.effectiveDate > context.todayDateKey) {
    return {
      kind: 'refusal',
      intent: intentForAction(parts.action),
      message: 'Future-dated entries are blocked. Choose today or an earlier date.',
    };
  }

  const wallet = parts.walletId
    ? context.wallets.find((candidate) => candidate.id === parts.walletId)
    : undefined;
  const sourceWallet = parts.sourceWalletId
    ? context.wallets.find(
        (candidate) => candidate.id === parts.sourceWalletId,
      )
    : undefined;
  const destinationWallet = parts.destinationWalletId
    ? context.wallets.find(
        (candidate) => candidate.id === parts.destinationWalletId,
      )
    : undefined;
  const source = parts.sourceContainerId
    ? context.containers.find(
        (candidate) => candidate.id === parts.sourceContainerId,
      )
    : undefined;
  const destination = parts.destinationContainerId
    ? context.containers.find(
        (candidate) => candidate.id === parts.destinationContainerId,
      )
    : undefined;

  if (needsWallet(parts.action) && !wallet) {
    return {
      kind: 'refusal',
      intent: intentForAction(parts.action),
      message: 'Choose a wallet before recording this entry.',
    };
  }

  if (parts.action === 'expense') {
    if (!source || source.status !== 'active' || source.systemKey != null) {
      return {
        kind: 'refusal',
        intent: intentForAction(parts.action),
        message: 'Choose an active budget container for this expense.',
      };
    }
    if (wallet && wallet.balanceMinor < parts.amountMinor) {
      return {
        kind: 'refusal',
        intent: intentForAction(parts.action),
        message: `${wallet.name} has only ${formatPeso(
          wallet.balanceMinor,
        )} recorded. Lower the amount or add income first.`,
      };
    }
    if (source.balanceMinor < parts.amountMinor) {
      return {
        kind: 'refusal',
        intent: intentForAction(parts.action),
        message: `${source.name} has only ${formatPeso(
          source.balanceMinor,
        )}. Allocate more money or lower the amount.`,
      };
    }
  }

  if (parts.action === 'income') {
    if (
      !destination ||
      destination.status !== 'active' ||
      destination.systemKey === 'savings'
    ) {
      return {
        kind: 'refusal',
        intent: intentForAction(parts.action),
        message: 'Choose an active container for this income.',
      };
    }
  }

  if (parts.action === 'wallet_transfer') {
    if (!sourceWallet || !destinationWallet) {
      return {
        kind: 'refusal',
        intent: intentForAction(parts.action),
        message: 'Choose both a source wallet and a destination wallet.',
      };
    }
    if (sourceWallet.id === destinationWallet.id) {
      return {
        kind: 'refusal',
        intent: intentForAction(parts.action),
        message: 'Choose two different wallets for a wallet transfer.',
      };
    }
    if (sourceWallet.balanceMinor < parts.amountMinor) {
      return {
        kind: 'refusal',
        intent: intentForAction(parts.action),
        message: `${sourceWallet.name} has only ${formatPeso(
          sourceWallet.balanceMinor,
        )}. Lower the amount.`,
      };
    }
  }

  if (parts.action === 'container_transfer') {
    if (
      !source ||
      !destination ||
      source.status !== 'active' ||
      destination.status !== 'active' ||
      source.systemKey != null ||
      destination.systemKey != null
    ) {
      return {
        kind: 'refusal',
        intent: intentForAction(parts.action),
        message:
          'Choose two active ordinary containers for a container transfer.',
      };
    }
    if (source.id === destination.id) {
      return {
        kind: 'refusal',
        intent: intentForAction(parts.action),
        message: 'Choose two different containers for a container transfer.',
      };
    }
    if (source.balanceMinor < parts.amountMinor) {
      return {
        kind: 'refusal',
        intent: intentForAction(parts.action),
        message: `${source.name} has only ${formatPeso(
          source.balanceMinor,
        )}. Lower the amount.`,
      };
    }
  }

  if (parts.action === 'savings_contribution') {
    if (
      !source ||
      source.status !== 'active' ||
      source.systemKey === 'savings'
    ) {
      return {
        kind: 'refusal',
        intent: intentForAction(parts.action),
        message: 'Choose an active container with money to move into Savings.',
      };
    }
    if (!destination || destination.systemKey !== 'savings') {
      return {
        kind: 'refusal',
        intent: intentForAction(parts.action),
        message: 'The destination for a Savings contribution must be Savings.',
      };
    }
    if (source.balanceMinor < parts.amountMinor) {
      return {
        kind: 'refusal',
        intent: intentForAction(parts.action),
        message: `${source.name} has only ${formatPeso(
          source.balanceMinor,
        )}. Choose another source or lower the amount.`,
      };
    }
  }

  if (parts.action === 'savings_withdrawal') {
    if (!source || source.systemKey !== 'savings') {
      return {
        kind: 'refusal',
        intent: intentForAction(parts.action),
        message: 'Savings withdrawals must start from Savings.',
      };
    }
    if (
      !destination ||
      destination.status !== 'active' ||
      destination.systemKey === 'savings'
    ) {
      return {
        kind: 'refusal',
        intent: intentForAction(parts.action),
        message: 'Choose an active container to receive this withdrawal.',
      };
    }
    if (source.balanceMinor < parts.amountMinor) {
      return {
        kind: 'refusal',
        intent: intentForAction(parts.action),
        message: `Savings has only ${formatPeso(
          source.balanceMinor,
        )}. Lower the amount.`,
      };
    }
  }

  proposalSequence += 1;
  const proposal: AssistantProposal = {
    id: `assistant-${Date.now().toString(36)}-${proposalSequence}`,
    action: parts.action,
    title: parts.title,
    amountMinor: parts.amountMinor,
    effectiveDate: parts.effectiveDate,
    monthKey: monthKeyForDateKey(parts.effectiveDate),
    walletId: wallet?.id,
    walletLabel: wallet?.name,
    sourceWalletId: sourceWallet?.id,
    sourceWalletLabel: sourceWallet?.name,
    destinationWalletId: destinationWallet?.id,
    destinationWalletLabel: destinationWallet?.name,
    containerId: source?.id ?? destination?.id,
    containerLabel: source?.name ?? destination?.name,
    destinationContainerId: destination?.id,
    destinationContainerLabel: destination?.name,
    sourceBalanceMinor: source?.balanceMinor ?? sourceWallet?.balanceMinor,
    destinationBalanceMinor:
      destination?.balanceMinor ?? destinationWallet?.balanceMinor,
  };

  return {
    kind: 'proposal',
    intent: intentForAction(parts.action),
    message: proposalMessage(parts.action),
    proposal,
  };
}

function resolveExpenseContainer(
  text: string,
  context: AssistantContext,
  pendingBase: Omit<AssistantPendingIntent, 'role'>,
):
  | { container: AssistantContainerOption }
  | { result: AssistantResultBase } {
  const candidates = context.containers.filter(
    (container) =>
      container.status === 'active' && container.systemKey == null,
  );
  const archived = findArchivedMention(text, context);
  if (archived) {
    return {
      result: containerClarification(
        `${archived.name} is archived. Choose an active container instead.`,
        context,
        candidates,
        pendingBase,
        'source',
      ),
    };
  }

  const matches = candidates.filter((container) =>
    mentionsContainer(text, container),
  );

  if (matches.length === 1) {
    const matched = matches[0];
    return matched
      ? { container: matched }
      : {
          result: containerClarification(
            text,
            context,
            candidates,
            pendingBase,
            'source',
          ),
        };
  }
  if (matches.length > 1) {
    return {
      result: containerClarification(
        'Which budget container should this expense come from?',
        context,
        matches,
        pendingBase,
        'source',
      ),
    };
  }

  if (candidates.length === 1) {
    const only = candidates[0];
    return only
      ? { container: only }
      : {
          result: containerClarification(
            text,
            context,
            candidates,
            pendingBase,
            'source',
          ),
        };
  }

  if (candidates.length === 0) {
    return {
      result: {
        kind: 'clarification',
        intent: intentForAction(pendingBase.action),
        message:
          'There is no active budget container to use. Create one in Budgets, then try again.',
        clarification: { reason: 'setup' },
      },
    };
  }

  return {
    result: containerClarification(
      'Which budget container should this expense come from?',
      context,
      candidates,
      pendingBase,
      'source',
    ),
  };
}

function resolveIncomeContainer(
  text: string,
  context: AssistantContext,
  pendingBase: Omit<AssistantPendingIntent, 'role'>,
):
  | { container: AssistantContainerOption }
  | { result: AssistantResultBase } {
  const candidates = context.containers.filter(
    (container) =>
      container.status === 'active' && container.systemKey !== 'savings',
  );
  const archived = findArchivedMention(text, context);
  if (archived) {
    return {
      result: containerClarification(
        `${archived.name} is archived. Choose an active container instead.`,
        context,
        candidates,
        pendingBase,
        'destination',
      ),
    };
  }
  const matches = candidates.filter((container) =>
    mentionsContainer(text, container),
  );

  if (matches.length === 1) {
    const matched = matches[0];
    return matched
      ? { container: matched }
      : unallocatedOrClarification(
          context,
          candidates,
          pendingBase,
          'destination',
        );
  }
  if (matches.length > 1) {
    return {
      result: containerClarification(
        'Which container should receive this income?',
        context,
        matches,
        pendingBase,
        'destination',
      ),
    };
  }

  return unallocatedOrClarification(
    context,
    candidates,
    pendingBase,
    'destination',
  );
}

function unallocatedOrClarification(
  context: AssistantContext,
  candidates: AssistantContainerOption[],
  pendingBase: Omit<AssistantPendingIntent, 'role'>,
  role: 'source' | 'destination',
): { container: AssistantContainerOption } | { result: AssistantResultBase } {
  const unallocated = findSystemContainer(context, 'unallocated');
  if (unallocated && unallocated.status === 'active') {
    return { container: unallocated };
  }
  if (candidates.length === 1) {
    const only = candidates[0];
    return only
      ? { container: only }
      : {
          result: {
            kind: 'refusal',
            intent: intentForAction(pendingBase.action),
            message: 'No active container can receive this entry.',
          },
        };
  }
  if (candidates.length === 0) {
    return {
      result: {
        kind: 'refusal',
        intent: intentForAction(pendingBase.action),
        message: 'No active container can receive this entry.',
      },
    };
  }
  return {
    result: containerClarification(
      'Which container should receive this entry?',
      context,
      candidates,
      pendingBase,
      role,
    ),
  };
}

function resolveSavingsSource(
  text: string,
  context: AssistantContext,
  pendingBase: Omit<AssistantPendingIntent, 'role'>,
):
  | { container: AssistantContainerOption }
  | { result: AssistantResultBase } {
  const candidates = context.containers.filter(
    (container) =>
      container.status === 'active' && container.systemKey !== 'savings',
  );
  const sourceSegment = extractTransferEndpoints(text).sourceSegment;
  const archived = sourceSegment
    ? findArchivedMention(sourceSegment, context)
    : undefined;
  if (archived) {
    return {
      result: containerClarification(
        `${archived.name} is archived. Choose an active source instead.`,
        context,
        candidates,
        pendingBase,
        'source',
      ),
    };
  }
  if (!sourceSegment) {
    return {
      result: containerClarification(
        'Which container should fund this Savings contribution?',
        context,
        candidates,
        pendingBase,
        'source',
      ),
    };
  }

  const matches = candidates.filter((container) =>
    mentionsContainer(sourceSegment, container),
  );
  if (matches.length === 1) {
    const matched = matches[0];
    return matched
      ? { container: matched }
      : {
          result: containerClarification(
            'Which container should fund this Savings contribution?',
            context,
            candidates,
            pendingBase,
            'source',
          ),
        };
  }
  if (matches.length > 1) {
    return {
      result: containerClarification(
        'Which container should fund this Savings contribution?',
        context,
        matches,
        pendingBase,
        'source',
      ),
    };
  }

  return {
    result: containerClarification(
      `I could not match “${sourceSegment}” to an active container. Choose the source container.`,
      context,
      candidates,
      pendingBase,
      'source',
    ),
  };
}

function resolveSavingsDestination(
  text: string,
  context: AssistantContext,
  pendingBase: Omit<AssistantPendingIntent, 'role'>,
):
  | { container: AssistantContainerOption }
  | { result: AssistantResultBase } {
  const candidates = context.containers.filter(
    (container) =>
      container.status === 'active' && container.systemKey !== 'savings',
  );
  const archived = findArchivedMention(text, context);
  if (archived) {
    return {
      result: containerClarification(
        `${archived.name} is archived. Choose an active destination instead.`,
        context,
        candidates,
        pendingBase,
        'destination',
      ),
    };
  }
  const matches = candidates.filter((container) =>
    mentionsContainer(text, container),
  );

  if (matches.length === 1) {
    const matched = matches[0];
    return matched
      ? { container: matched }
      : destinationDefault(context, candidates, pendingBase);
  }
  if (matches.length > 1) {
    return {
      result: containerClarification(
        'Which container should receive this Savings withdrawal?',
        context,
        matches,
        pendingBase,
        'destination',
      ),
    };
  }

  return destinationDefault(context, candidates, pendingBase);
}

function destinationDefault(
  context: AssistantContext,
  candidates: AssistantContainerOption[],
  pendingBase: Omit<AssistantPendingIntent, 'role'>,
): { container: AssistantContainerOption } | { result: AssistantResultBase } {
  const unallocated = findSystemContainer(context, 'unallocated');
  if (unallocated && unallocated.status === 'active') {
    return { container: unallocated };
  }
  if (candidates.length === 1) {
    const only = candidates[0];
    return only
      ? { container: only }
      : {
          result: {
            kind: 'refusal',
            intent: intentForAction(pendingBase.action),
            message: 'No active container can receive this withdrawal.',
          },
        };
  }
  if (candidates.length === 0) {
    return {
      result: {
        kind: 'refusal',
        intent: intentForAction(pendingBase.action),
        message: 'No active container can receive this withdrawal.',
      },
    };
  }
  return {
    result: containerClarification(
      'Which container should receive this Savings withdrawal?',
      context,
      candidates,
      pendingBase,
      'destination',
    ),
  };
}

function containerClarification(
  message: string,
  _context: AssistantContext,
  options: AssistantContainerOption[],
  pendingBase: Omit<AssistantPendingIntent, 'role'>,
  role: 'source' | 'destination',
): AssistantResultBase {
  return {
    kind: 'clarification',
    intent: intentForAction(pendingBase.action),
    message,
    clarification: {
      reason: 'container',
      options: options.map((container) => ({
        id: container.id,
        name: container.name,
        balanceMinor: container.balanceMinor,
      })),
      pending: { ...pendingBase, role },
    },
  };
}

function findSystemContainer(
  context: AssistantContext,
  systemKey: SystemContainerKey,
): AssistantContainerOption | undefined {
  return context.containers.find(
    (container) => container.systemKey === systemKey,
  );
}

function findArchivedMention(
  text: string,
  context: AssistantContext,
): AssistantContainerOption | undefined {
  return context.containers.find(
    (container) =>
      container.status === 'archived' &&
      mentionsContainerName(text, container),
  );
}

function needsWallet(action: AssistantAction): boolean {
  return action === 'expense' || action === 'income';
}

function attachInterpretation(
  result: AssistantResultBase,
  context: AssistantContext,
): AssistantResult {
  return { ...result, interpretation: buildInterpretation(result, context) };
}

function buildInterpretation(
  result: AssistantResultBase,
  context: AssistantContext,
): AssistantInterpretation {
  if (result.kind === 'proposal') {
    const { proposal } = result;
    const sourceWallet = walletRef(context, proposal.walletId);
    const destinationWallet = walletRef(context, proposal.walletId);
    const sourceContainer = containerRef(context, proposal.containerId);
    const destinationContainer = containerRef(
      context,
      proposal.destinationContainerId,
    );
    const interpretation: AssistantInterpretation = {
      intent: result.intent,
      amountMinor: proposal.amountMinor,
      currency: 'PHP',
      effectiveDate: proposal.effectiveDate,
      description: proposal.title,
      confidence: 0.85,
      missingFields: [],
      reasoningSummary: `Interpreted this as ${result.intent.replace(
        /_/g,
        ' ',
      )} for ${formatPeso(proposal.amountMinor)}.`,
    };

    if (proposal.action === 'expense') {
      interpretation.sourceWallet = sourceWallet;
      interpretation.sourceContainer = sourceContainer;
    } else if (proposal.action === 'income') {
      interpretation.destinationWallet = destinationWallet;
      interpretation.destinationContainer = destinationContainer;
    } else if (proposal.action === 'wallet_transfer') {
      interpretation.sourceWallet = walletRef(
        context,
        proposal.sourceWalletId,
      );
      interpretation.destinationWallet = walletRef(
        context,
        proposal.destinationWalletId,
      );
    } else {
      interpretation.sourceContainer = sourceContainer;
      interpretation.destinationContainer = destinationContainer;
    }

    return interpretation;
  }

  if (result.kind === 'clarification') {
    const { clarification } = result;
    return {
      intent: result.intent,
      amountMinor: clarification.pending?.amountMinor,
      currency: clarification.pending ? 'PHP' : undefined,
      effectiveDate: clarification.pending?.effectiveDate,
      sourceWallet: walletRef(
        context,
        clarification.pending?.sourceWalletId,
      ),
      destinationWallet: walletRef(
        context,
        clarification.pending?.destinationWalletId,
      ),
      sourceContainer: containerRef(
        context,
        clarification.pending?.sourceContainerId,
      ),
      destinationContainer: containerRef(
        context,
        clarification.pending?.destinationContainerId,
      ),
      confidence: 0.45,
      missingFields: missingFieldsForClarification(clarification),
      clarificationQuestion: result.message,
      reasoningSummary: `The intent is ${result.intent.replace(
        /_/g,
        ' ',
      )}, but required details are still missing or ambiguous.`,
    };
  }

  if (result.kind === 'answer') {
    return {
      intent: result.intent,
      confidence: 0.9,
      missingFields: [],
      reasoningSummary: `Answered a ${result.intent.replace(
        /_/g,
        ' ',
      )} from the active month's local finance data.`,
    };
  }

  return {
    intent: result.intent,
    confidence: 0,
    missingFields: [],
    reasoningSummary: result.message,
  };
}

function missingFieldsForClarification(
  clarification: AssistantClarification,
): AssistantMissingField[] {
  if (clarification.reason === 'amount') return ['amount'];
  if (clarification.reason === 'wallet') {
    return [
      clarification.pending?.role === 'destination'
        ? 'destinationWallet'
        : 'sourceWallet',
    ];
  }
  if (clarification.reason === 'container') {
    return [
      clarification.pending?.role === 'destination'
        ? 'destinationContainer'
        : 'sourceContainer',
    ];
  }
  if (clarification.reason === 'transfer') {
    return [
      'transferKind',
      'sourceWallet',
      'destinationWallet',
      'sourceContainer',
      'destinationContainer',
    ];
  }
  return ['sourceContainer', 'destinationContainer'];
}

function walletRef(
  context: AssistantContext,
  walletId: string | undefined,
): AssistantEntityRef | undefined {
  if (!walletId) return undefined;
  const wallet = context.wallets.find((candidate) => candidate.id === walletId);
  return wallet ? { id: wallet.id, name: wallet.name } : undefined;
}

function containerRef(
  context: AssistantContext,
  containerId: string | undefined,
): AssistantEntityRef | undefined {
  if (!containerId) return undefined;
  const container = context.containers.find(
    (candidate) => candidate.id === containerId,
  );
  return container
    ? { id: container.id, name: container.name }
    : undefined;
}

function intentForAction(action: AssistantAction): AssistantIntent {
  if (action === 'expense') return 'expense';
  if (action === 'income') return 'income';
  if (action === 'wallet_transfer') return 'wallet_transfer';
  return 'container_transfer';
}

function clarifyAmount(
  message: string,
  intent: AssistantIntent,
): AssistantResultBase {
  return {
    kind: 'clarification',
    intent,
    message,
    clarification: { reason: 'amount' },
  };
}

function isClarificationRequest(text: string): boolean {
  return /\b(what can you do|what do you do|how do i use|how does this work|what does this mean|explain|help me understand|clarify|i don't understand|hindi ko maintindihan|paano (?:ba )?(?:ito|gamitin))\b/i.test(
    text,
  );
}

function isQuestion(text: string): boolean {
  if (/\?\s*$/.test(text)) return true;
  return /^(?:what|what's|whats|how|how much|how many|where|which|when|can|could|do|does|did|is|are|magkano|ilan|ano|saan|kailan)\b/i.test(
    text.trim(),
  );
}

function helpResult(): AssistantResultBase {
  return {
    kind: 'answer',
    intent: 'clarification_request',
    message:
      'I can interpret expenses, income, wallet transfers, container transfers, Savings transfers, and read-only questions. Try “I spent ₱120 on lunch”, “Transfer ₱100 from Cash to GCash”, “Move ₱100 from Food to Transport”, “Move ₱300 to savings”, or “How much is in Savings?”. I never change balances or save transactions.',
    answer: {
      topic: 'help',
      title: 'What I can understand',
      figures: [],
    },
  };
}

function answerQuestion(
  text: string,
  context: AssistantContext,
): AssistantResultBase {
  const lower = text.toLowerCase();
  const summary = context.summary;
  const period = formatMonthKey(summary.monthKey);
  const mentionsSavings = /\bsavings?\b|\bipon\b|\bimpok\b/.test(lower);
  const mentionsWallet = /\bwallet|gcash|cash|pera|money\b/.test(lower);
  const mentionsUnallocated =
    /\bunallocated\b|\bavailable to allocate\b|\bhindi pa nakalaan\b/.test(
      lower,
    );
  const mentionsSpending =
    /\bspent|spend|spending|gastos|gasto|expenses?\b/.test(lower);
  const mentionsIncome =
    /\breceived|receive|earned|earn|income|allowance|sweldo|sahod|padala\b/.test(
      lower,
    );
  const mentionsNetSavings =
    /\bnet savings?\b|\bsaved this month\b|\bnaipon\b/.test(lower);
  const mentionsBudget =
    /\bbudget|limit|remaining|natitira|sobra\b/.test(lower);
  const mentionsSavingsActivity =
    /\bcontribution|contributed|withdraw|withdrew|withdrawal|deposit|moved\b/.test(
      lower,
    );

  if (/\blast month|previous month|nakaraang buwan\b/.test(lower)) {
    return {
      kind: 'answer',
      intent: 'unknown',
      message:
        'I can answer balance and monthly questions for the active month only. Use Monthly History to select an earlier month.',
      answer: { topic: 'help', title: 'Active month only', figures: [] },
    };
  }

  const matchedContainer = context.containers.find(
    (container) =>
      container.status === 'active' &&
      container.systemKey == null &&
      mentionsContainer(text, container),
  );

  if (mentionsSavings && mentionsSavingsActivity) {
    return {
      kind: 'answer',
      intent: 'spending_summary',
      message: `For ${period}, Savings contributions and withdrawals are transfers, not income or expenses.`,
      answer: {
        topic: 'monthly_savings_activity',
        title: 'Savings activity',
        figures: [
          {
            label: 'Contributions',
            amountMinor: summary.savingsContributionsMinor,
          },
          {
            label: 'Withdrawals',
            amountMinor: summary.savingsWithdrawalsMinor,
          },
          {
            label: 'Savings ending balance',
            amountMinor: summary.savingsEndingBalanceMinor,
          },
        ],
      },
    };
  }

  if (matchedContainer && mentionsBudget) {
    return {
      kind: 'answer',
      intent: 'budget_inquiry',
      message: `${matchedContainer.name} has ${formatPeso(
        matchedContainer.remainingMinor,
      )} remaining of its ${formatPeso(matchedContainer.limitMinor)} limit for ${period}.`,
      answer: {
        topic: 'budget_remaining',
        title: `${matchedContainer.name} budget`,
        figures: [
          { label: 'Limit', amountMinor: matchedContainer.limitMinor },
          { label: 'Spent', amountMinor: matchedContainer.spentMinor },
          {
            label: 'Remaining',
            amountMinor: matchedContainer.remainingMinor,
          },
        ],
      },
    };
  }

  if (matchedContainer && mentionsSpending) {
    return {
      kind: 'answer',
      intent: 'spending_summary',
      message: `You recorded ${formatPeso(
        matchedContainer.spentMinor,
      )} in expenses on ${matchedContainer.name} for ${period}.`,
      answer: {
        topic: 'container_spending',
        title: `${matchedContainer.name} spending`,
        figures: [
          {
            label: 'Spent',
            amountMinor: matchedContainer.spentMinor,
          },
          {
            label: 'Recorded balance',
            amountMinor: matchedContainer.balanceMinor,
          },
        ],
      },
    };
  }

  if (matchedContainer) {
    return {
      kind: 'answer',
      intent: 'balance_inquiry',
      message: `${matchedContainer.name} has ${formatPeso(
        matchedContainer.balanceMinor,
      )} recorded in ${period}.`,
      answer: {
        topic: 'container_balance',
        title: `${matchedContainer.name} balance`,
        figures: [
          {
            label: 'Recorded balance',
            amountMinor: matchedContainer.balanceMinor,
          },
        ],
      },
    };
  }

  if (mentionsSavings) {
    return {
      kind: 'answer',
      intent: 'balance_inquiry',
      message: `Savings holds ${formatPeso(
        summary.savingsEndingBalanceMinor,
      )} at the end of ${period}. This balance is separate from monthly net savings.`,
      answer: {
        topic: 'savings_balance',
        title: 'Savings balance',
        figures: [
          {
            label: 'Savings balance',
            amountMinor: summary.savingsEndingBalanceMinor,
          },
        ],
      },
    };
  }

  if (mentionsUnallocated) {
    return {
      kind: 'answer',
      intent: 'balance_inquiry',
      message: `Unallocated has ${formatPeso(
        summary.unallocatedEndingBalanceMinor,
      )} at the end of ${period}.`,
      answer: {
        topic: 'unallocated_balance',
        title: 'Unallocated balance',
        figures: [
          {
            label: 'Unallocated',
            amountMinor: summary.unallocatedEndingBalanceMinor,
          },
        ],
      },
    };
  }

  if (mentionsNetSavings) {
    return {
      kind: 'answer',
      intent: 'spending_summary',
      message: `Net savings for ${period} is ${formatPeso(
        summary.netSavingsMinor,
      )}. It equals external income minus external expenses.`,
      answer: {
        topic: 'monthly_net_savings',
        title: 'Net savings',
        figures: [
          { label: 'Income', amountMinor: summary.incomeMinor },
          { label: 'Expenses', amountMinor: summary.expenseMinor },
          { label: 'Net savings', amountMinor: summary.netSavingsMinor },
        ],
      },
    };
  }

  if (mentionsSpending) {
    return {
      kind: 'answer',
      intent: 'spending_summary',
      message: `You recorded ${formatPeso(
        summary.expenseMinor,
      )} in expenses for ${period}.`,
      answer: {
        topic: 'monthly_spending',
        title: 'Monthly expenses',
        figures: [
          { label: 'Expenses', amountMinor: summary.expenseMinor },
        ],
      },
    };
  }

  if (mentionsIncome) {
    return {
      kind: 'answer',
      intent: 'income_summary',
      message: `You recorded ${formatPeso(
        summary.incomeMinor,
      )} in income for ${period}.`,
      answer: {
        topic: 'monthly_income',
        title: 'Monthly income',
        figures: [{ label: 'Income', amountMinor: summary.incomeMinor }],
      },
    };
  }

  if (mentionsWallet || /\bbalance|total money|how much money\b/.test(lower)) {
    const prefersCash = /\bcash\b/.test(lower);
    const prefersGcash = /\bgcash\b/.test(lower);
    const wallets =
      prefersCash || prefersGcash
        ? context.wallets.filter((wallet) =>
            prefersCash
              ? wallet.kind === 'cash'
              : wallet.kind === 'virtual_gcash',
          )
        : context.wallets;
    const total = wallets.reduce(
      (sum, wallet) => sum + wallet.balanceMinor,
      0,
    );
    return {
      kind: 'answer',
      intent: 'balance_inquiry',
      message:
        wallets.length === 1
          ? `${wallets[0]?.name ?? 'That wallet'} has ${formatPeso(total)} recorded.`
          : `Your wallets hold ${formatPeso(total)} in total.`,
      answer: {
        topic: 'wallet_balance',
        title: 'Wallet balance',
        figures: wallets.map((wallet) => ({
          label: wallet.name,
          amountMinor: wallet.balanceMinor,
        })),
      },
    };
  }

  return {
    kind: 'answer',
    intent: 'unknown',
    message:
      'I can answer simple questions about Savings, Unallocated, wallet balances, container balances, budget remaining, and this month’s income, expenses, or net savings.',
    answer: {
      topic: 'help',
      title: 'Read-only questions',
      figures: [],
    },
  };
}

function detectAction(
  text: string,
  context: AssistantContext,
): AssistantAction | null {
  const lower = text.toLowerCase();
  const mentionsSavings = /\bsavings?\b|\bipon\b|\bimpok\b/.test(lower);
  const mentionsWithdrawal =
    /\b(withdraw|withdrew|withdrawal|take out|took out|kunin|bawi|bawas)\b/.test(
      lower,
    );
  const mentionsContribution =
    /\b(save|saved|saving|move|moved|transfer|transferred|put|ilagay|ilipat|tabi|magtabi)\b/.test(
      lower,
    );
  const mentionsExpense =
    /\b(spent|spend|paid|pay|bought|buy|purchased|purchase|gastos|gasto|binili|bumili|nagbayad|bayad)\b/.test(
      lower,
    );
  const mentionsIncome =
    /\b(received|receive|got|get|earned|earn|income|allowance|sweldo|sahod|padala|pinadala|regalo|bonus)\b|\b(?:sent|send)\s+me\b/.test(
      lower,
    );

  if (mentionsSavings && mentionsWithdrawal) return 'savings_withdrawal';
  if (mentionsSavings && mentionsContribution) return 'savings_contribution';
  if (mentionsExpense && !mentionsIncome) return 'expense';
  if (mentionsIncome && !mentionsExpense) return 'income';
  if (looksLikeTransfer(text)) {
    if (
      resolveWalletMatches(text, context.wallets).length > 0 ||
      /\bwallet\b/.test(lower)
    ) {
      return 'wallet_transfer';
    }
    if (/\bcontainers?\b/.test(lower)) {
      return 'container_transfer';
    }
    if (
      context.containers.some(
        (container) =>
          container.systemKey == null &&
          (container.status === 'active' || container.status === 'archived') &&
          mentionsContainer(text, container),
      )
    ) {
      return 'container_transfer';
    }
  }
  return null;
}

function extractAmount(text: string): ParsedAmount | null {
  const sanitized = text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, ' ');
  const hasNegativeAmount =
    /(?:^|[\s(])[-\u2212]\s*(?:\u20B1|php\b|pesos?\b|p\b)?\s*\d/i.test(
      text,
    ) ||
    /(?:\u20B1|php\b|pesos?\b|p\b)\s*[-\u2212]\s*\d/i.test(text);
  if (hasNegativeAmount) return null;
  if (/[0-9][0-9,]*\.[0-9]{3,}/.test(text)) return null;
  const patterns: { pattern: RegExp }[] = [
    {
      pattern:
        /(?:₱|\bphp\b|\bpesos?\b|\bp\b)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?![0-9]|\.[0-9])\s*(k|thousand)?/i,
    },
    {
      pattern:
        /([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?![0-9]|\.[0-9])\s*(k|thousand|pesos?|php|₱)\b/i,
    },
    {
      pattern: /([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?![0-9]|\.[0-9])\s*(k|thousand)\b/i,
    },
    {
      pattern: /([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?![0-9]|\.[0-9])/,
    },
  ];

  for (const { pattern } of patterns) {
    const match = pattern.exec(sanitized);
    const raw = match?.[1];
    if (!raw) continue;
    const scaleToken = match?.[2]?.toLowerCase();
    const scale = scaleToken === 'k' || scaleToken === 'thousand' ? 1000 : 1;
    if (scale !== 1) {
      const value = Number(raw.replace(/,/g, ''));
      if (Number.isSafeInteger(value * scale)) {
        return { amountMinor: value * scale * 100 };
      }
      continue;
    }
    const amountMinor = parsePesoToMinor(raw);
    if (amountMinor !== null && amountMinor > 0) {
      return { amountMinor };
    }
  }

  return null;
}

function resolveEffectiveDate(
  text: string,
  todayDateKey: string,
): string | null {
  const isoDate = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text)?.[1];
  if (isoDate) {
    return isValidDateKey(isoDate) ? isoDate : null;
  }

  const lower = text.toLowerCase();
  if (
    /\b(tomorrow|bukas|next week|last week|last month|next month)\b/.test(
      lower,
    )
  ) {
    return null;
  }
  if (
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/.test(
      lower,
    )
  ) {
    return null;
  }
  if (/\b(yesterday|kahapon)\b/.test(lower)) {
    return shiftDateKey(todayDateKey, -1);
  }
  if (/\b(today|ngayon|kanina)\b/.test(lower)) {
    return todayDateKey;
  }
  return todayDateKey;
}

function extractTitle(text: string, action: AssistantAction): string {
  if (action === 'savings_contribution') return 'Savings contribution';
  if (action === 'savings_withdrawal') return 'Savings withdrawal';

  if (action === 'income') {
    const lower = text.toLowerCase();
    for (const keyword of [
      'allowance',
      'sweldo',
      'sahod',
      'padala',
      'regalo',
      'bonus',
      'income',
    ]) {
      if (new RegExp(`\\b${keyword}\\b`).test(lower)) {
        return `${keyword.charAt(0).toUpperCase()}${keyword.slice(1)}`;
      }
    }
  }

  const cleaned = text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(
      /(?:₱|\bphp\b|\bpesos?\b|\bp\b)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?/gi,
      ' ',
    )
    .replace(
      /[0-9][0-9,]*(?:\.[0-9]{1,2})?\s*(?:k|thousand|pesos?|php|₱)?/gi,
      ' ',
    )
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, ' ')
    .replace(
      /\b(i|we|ako|ko|kanina|ngayon|today|yesterday|kahapon|lang|po)\b/gi,
      ' ',
    )
    .replace(
      /\b(spent|spend|paid|pay|bought|buy|purchased|purchase|gastos|gasto|binili|bumili|nagbayad|bayad|received|receive|got|get|earned|earn|income|allowance|sweldo|sahod|padala|regalo|bonus)\b/gi,
      ' ',
    )
    .replace(/\b(savings?|ipon|impok|move|moved|transfer|transferred|put|ilagay|ilipat|tabi|magtabi)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let candidate = cleaned;
  const preposition = /\b(?:on|for|sa|para sa)\s+(.+)$/i.exec(cleaned);
  if (preposition?.[1]) {
    candidate = preposition[1];
  }
  candidate = (candidate.split(/\bfrom\b|\bgaling sa\b/i)[0] ?? '')
    .replace(/^[-:,;\s]+|[-:,;\s]+$/g, '')
    .replace(/[.,;:!?]+$/g, '')
    .trim();

  if (!candidate) {
    return action === 'income' ? 'Income' : 'Expense';
  }

  return `${candidate.charAt(0).toUpperCase()}${candidate.slice(1, 79)}`;
}

function resolveWallet(
  text: string,
  wallets: AssistantWalletOption[],
): AssistantWalletOption | null {
  const lower = text.toLowerCase();
  if (/\bvirtual gcash\b|\bgcash\b/.test(lower)) {
    return (
      wallets.find((wallet) => wallet.kind === 'virtual_gcash') ?? wallets[0] ?? null
    );
  }
  if (/\bcash\b/.test(lower)) {
    return wallets.find((wallet) => wallet.kind === 'cash') ?? wallets[0] ?? null;
  }
  return (
    wallets.find((wallet) => wallet.kind === 'virtual_gcash') ??
    wallets[0] ??
    null
  );
}

function mentionsContainer(
  text: string,
  container: AssistantContainerOption,
): boolean {
  if (mentionsContainerName(text, container)) return true;

  const normalizedText = normalize(text);
  const tokens = normalize(container.name)
    .split(' ')
    .filter((token) => token.length >= 4);
  return tokens.some((token) =>
    new RegExp(`(^|\\s)${escapeRegExp(token)}(\\s|$)`).test(normalizedText),
  );
}

function mentionsContainerName(
  text: string,
  container: AssistantContainerOption,
): boolean {
  const normalizedName = normalize(container.name);
  if (normalizedName.length < 3) return false;
  return new RegExp(
    `(^|\\s)${escapeRegExp(normalizedName)}(\\s|$)`,
  ).test(normalize(text));
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shiftDateKey(dateKey: string, days: number): string {
  const date = dateKeyToLocalDate(dateKey);
  date.setDate(date.getDate() + days);
  return toLocalDateKey(date);
}

function proposalMessage(action: AssistantAction): string {
  if (action === 'expense') {
    return 'I interpreted that as an expense and prepared a draft. No ledger entry has been created.';
  }
  if (action === 'income') {
    return 'I interpreted that as income and prepared a draft. No ledger entry has been created.';
  }
  if (action === 'wallet_transfer') {
    return 'I interpreted that as a wallet transfer and prepared a draft. No ledger entry has been created.';
  }
  if (action === 'container_transfer') {
    return 'I interpreted that as a container transfer and prepared a draft. No ledger entry has been created.';
  }
  if (action === 'savings_contribution') {
    return 'I interpreted that as a Savings contribution and prepared a draft. It is a transfer, not an expense. No ledger entry has been created.';
  }
  return 'I interpreted that as a Savings withdrawal and prepared a draft. It is a transfer, not income. No ledger entry has been created.';
}
