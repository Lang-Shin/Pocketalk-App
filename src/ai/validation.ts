import { isValidDateKey, monthKeyForDateKey } from '@/lib/period';
import type {
  AssistantAction,
  AssistantContainerOption,
  AssistantContext,
  AssistantEntityRef,
  AssistantIntent,
  AssistantInterpretation,
  AssistantMissingField,
  AssistantQuestionTopic,
  AssistantResult,
  AssistantWalletOption,
} from './localAssistant';

const KINDS = new Set(['proposal', 'clarification', 'answer', 'refusal']);
const INTENTS = new Set<AssistantIntent>([
  'income',
  'expense',
  'wallet_transfer',
  'container_transfer',
  'balance_inquiry',
  'spending_summary',
  'income_summary',
  'budget_inquiry',
  'clarification_request',
  'unknown',
]);
const ACTIONS = new Set<AssistantAction>([
  'expense',
  'income',
  'wallet_transfer',
  'container_transfer',
  'savings_contribution',
  'savings_withdrawal',
]);
const CLARIFICATION_REASONS = new Set([
  'amount',
  'container',
  'wallet',
  'transfer',
  'setup',
]);
const MISSING_FIELDS = new Set<AssistantMissingField>([
  'amount',
  'effectiveDate',
  'sourceWallet',
  'destinationWallet',
  'sourceContainer',
  'destinationContainer',
  'transferKind',
]);
const QUESTION_TOPICS = new Set<AssistantQuestionTopic>([
  'savings_balance',
  'unallocated_balance',
  'wallet_balance',
  'container_balance',
  'container_spending',
  'budget_remaining',
  'monthly_spending',
  'monthly_income',
  'monthly_net_savings',
  'monthly_savings_activity',
  'help',
]);

export class AssistantValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantValidationError';
  }
}

export function validateAssistantResult(
  value: unknown,
  context: AssistantContext,
): AssistantResult {
  const result = asRecord(value, 'result');
  const kind = asString(result.kind, 'result.kind');
  if (!KINDS.has(kind)) {
    throw new AssistantValidationError('Unsupported assistant result kind.');
  }
  const intent = asIntent(result.intent, 'result.intent');
  const message = asNonEmptyString(result.message, 'result.message');
  const interpretation = validateInterpretation(
    result.interpretation,
    intent,
    context,
  );

  if (kind === 'proposal') {
    validateProposal(
      asRecord(result.proposal, 'result.proposal'),
      interpretation,
      context,
    );
  } else if (kind === 'clarification') {
    validateClarification(
      asRecord(result.clarification, 'result.clarification'),
      interpretation,
      message,
      context,
    );
  } else if (kind === 'answer') {
    validateAnswer(
      asRecord(result.answer, 'result.answer'),
      intent,
      interpretation,
    );
  }

  return value as AssistantResult;
}

function validateInterpretation(
  value: unknown,
  intent: AssistantIntent,
  context: AssistantContext,
): AssistantInterpretation {
  const record = asRecord(value, 'result.interpretation');
  const interpretedIntent = asIntent(
    record.intent,
    'interpretation.intent',
  );
  if (interpretedIntent !== intent) {
    throw new AssistantValidationError(
      'Interpretation intent does not match the result intent.',
    );
  }

  const amountMinor = optionalPositiveInteger(
    record.amountMinor,
    'interpretation.amountMinor',
  );
  const currency = optionalString(
    record.currency,
    'interpretation.currency',
  );
  if (amountMinor !== undefined && currency !== 'PHP') {
    throw new AssistantValidationError(
      'Interpretation currency must be PHP when an amount is present.',
    );
  }
  if (amountMinor === undefined && currency !== undefined) {
    throw new AssistantValidationError(
      'Interpretation currency cannot be present without an amount.',
    );
  }

  const effectiveDate = optionalString(
    record.effectiveDate,
    'interpretation.effectiveDate',
  );
  if (effectiveDate !== undefined) {
    assertEffectiveDate(effectiveDate, context, 'interpretation.effectiveDate');
  }

  const confidence = asNumber(
    record.confidence,
    'interpretation.confidence',
  );
  if (confidence < 0 || confidence > 1) {
    throw new AssistantValidationError(
      'Interpretation confidence must be between 0 and 1.',
    );
  }

  const missingFields = asArray(
    record.missingFields,
    'interpretation.missingFields',
  ).map((field, index) => {
    const parsed = asString(
      field,
      `interpretation.missingFields[${index}]`,
    );
    if (!MISSING_FIELDS.has(parsed as AssistantMissingField)) {
      throw new AssistantValidationError(
        'Interpretation contains an unsupported missing field.',
      );
    }
    return parsed as AssistantMissingField;
  });

  const clarificationQuestion = optionalString(
    record.clarificationQuestion,
    'interpretation.clarificationQuestion',
  );
  const reasoningSummary = asNonEmptyString(
    record.reasoningSummary,
    'interpretation.reasoningSummary',
  );

  return {
    intent,
    amountMinor,
    currency: currency as 'PHP' | undefined,
    effectiveDate,
    sourceWallet: optionalEntityRef(
      record.sourceWallet,
      'interpretation.sourceWallet',
      context,
    ),
    destinationWallet: optionalEntityRef(
      record.destinationWallet,
      'interpretation.destinationWallet',
      context,
    ),
    sourceContainer: optionalEntityRef(
      record.sourceContainer,
      'interpretation.sourceContainer',
      context,
    ),
    destinationContainer: optionalEntityRef(
      record.destinationContainer,
      'interpretation.destinationContainer',
      context,
    ),
    description: optionalNonEmptyString(
      record.description,
      'interpretation.description',
    ),
    confidence,
    missingFields,
    clarificationQuestion,
    reasoningSummary,
  };
}

function validateProposal(
  record: Record<string, unknown>,
  interpretation: AssistantInterpretation,
  context: AssistantContext,
) {
  const action = asAction(record.action, 'proposal.action');
  asNonEmptyString(record.id, 'proposal.id');
  const title = asNonEmptyString(record.title, 'proposal.title');
  const amountMinor = asPositiveInteger(
    record.amountMinor,
    'proposal.amountMinor',
  );
  const effectiveDate = asString(
    record.effectiveDate,
    'proposal.effectiveDate',
  );
  assertEffectiveDate(effectiveDate, context, 'proposal.effectiveDate');
  const monthKey = asNonEmptyString(record.monthKey, 'proposal.monthKey');
  if (monthKey !== monthKeyForDateKey(effectiveDate)) {
    throw new AssistantValidationError(
      'Proposal month does not match its effective date.',
    );
  }
  if (interpretation.amountMinor !== amountMinor) {
    throw new AssistantValidationError(
      'Interpretation amount does not match the proposal amount.',
    );
  }
  if (interpretation.effectiveDate !== effectiveDate) {
    throw new AssistantValidationError(
      'Interpretation date does not match the proposal date.',
    );
  }
  if (interpretation.description !== title) {
    throw new AssistantValidationError(
      'Interpretation description does not match the proposal title.',
    );
  }
  if (
    interpretation.missingFields.length > 0 ||
    interpretation.clarificationQuestion !== undefined
  ) {
    throw new AssistantValidationError(
      'A complete proposal cannot include missing fields or a clarification question.',
    );
  }

  const walletId = optionalString(record.walletId, 'proposal.walletId');
  const walletLabel = optionalString(
    record.walletLabel,
    'proposal.walletLabel',
  );
  const containerId = optionalString(
    record.containerId,
    'proposal.containerId',
  );
  const containerLabel = optionalString(
    record.containerLabel,
    'proposal.containerLabel',
  );
  const destinationContainerId = optionalString(
    record.destinationContainerId,
    'proposal.destinationContainerId',
  );
  const destinationContainerLabel = optionalString(
    record.destinationContainerLabel,
    'proposal.destinationContainerLabel',
  );
  const sourceWalletId = optionalString(
    record.sourceWalletId,
    'proposal.sourceWalletId',
  );
  const sourceWalletLabel = optionalString(
    record.sourceWalletLabel,
    'proposal.sourceWalletLabel',
  );
  const destinationWalletId = optionalString(
    record.destinationWalletId,
    'proposal.destinationWalletId',
  );
  const destinationWalletLabel = optionalString(
    record.destinationWalletLabel,
    'proposal.destinationWalletLabel',
  );

  if (action === 'expense') {
    const wallet = requireWallet(context, walletId, 'expense wallet');
    assertLabel(wallet.name, walletLabel, 'wallet');
    const container = requireActiveOrdinary(
      context,
      containerId,
      'expense container',
    );
    assertLabel(container.name, containerLabel, 'container');
    assertBalance(wallet.balanceMinor, amountMinor, wallet.name);
    assertBalance(container.balanceMinor, amountMinor, container.name);
    assertRef(interpretation.sourceWallet, wallet);
    assertRef(interpretation.sourceContainer, container);
    assertNoRef(interpretation.destinationWallet, 'destination wallet');
    assertNoRef(interpretation.destinationContainer, 'destination container');
  } else if (action === 'income') {
    const wallet = requireWallet(context, walletId, 'income wallet');
    assertLabel(wallet.name, walletLabel, 'wallet');
    const container = requireActiveContainer(
      context,
      destinationContainerId,
      'income container',
    );
    if (container.systemKey === 'savings') {
      throw new AssistantValidationError(
        'Income cannot target the Savings container directly.',
      );
    }
    assertLabel(container.name, destinationContainerLabel, 'container');
    assertRef(interpretation.destinationWallet, wallet);
    assertRef(interpretation.destinationContainer, container);
    assertNoRef(interpretation.sourceWallet, 'source wallet');
    assertNoRef(interpretation.sourceContainer, 'source container');
  } else if (action === 'wallet_transfer') {
    const source = requireWallet(context, sourceWalletId, 'source wallet');
    const destination = requireWallet(
      context,
      destinationWalletId,
      'destination wallet',
    );
    if (source.id === destination.id) {
      throw new AssistantValidationError(
        'Wallet transfer endpoints must be different.',
      );
    }
    assertLabel(source.name, sourceWalletLabel, 'source wallet');
    assertLabel(destination.name, destinationWalletLabel, 'destination wallet');
    assertBalance(source.balanceMinor, amountMinor, source.name);
    assertRef(interpretation.sourceWallet, source);
    assertRef(interpretation.destinationWallet, destination);
    assertNoRef(interpretation.sourceContainer, 'source container');
    assertNoRef(interpretation.destinationContainer, 'destination container');
  } else if (action === 'container_transfer') {
    const source = requireActiveOrdinary(
      context,
      containerId,
      'source container',
    );
    const destination = requireActiveOrdinary(
      context,
      destinationContainerId,
      'destination container',
    );
    if (source.id === destination.id) {
      throw new AssistantValidationError(
        'Container transfer endpoints must be different.',
      );
    }
    assertLabel(source.name, containerLabel, 'source container');
    assertLabel(
      destination.name,
      destinationContainerLabel,
      'destination container',
    );
    assertBalance(source.balanceMinor, amountMinor, source.name);
    assertRef(interpretation.sourceContainer, source);
    assertRef(interpretation.destinationContainer, destination);
    assertNoRef(interpretation.sourceWallet, 'source wallet');
    assertNoRef(interpretation.destinationWallet, 'destination wallet');
  } else if (action === 'savings_contribution') {
    const source = requireActiveContainer(
      context,
      containerId,
      'Savings source',
    );
    if (source.systemKey === 'savings') {
      throw new AssistantValidationError(
        'Savings contributions cannot start from Savings.',
      );
    }
    const destination = requireSystemContainer(
      context,
      destinationContainerId,
      'savings',
    );
    assertLabel(source.name, containerLabel, 'source container');
    assertLabel(
      destination.name,
      destinationContainerLabel,
      'destination container',
    );
    assertBalance(source.balanceMinor, amountMinor, source.name);
    assertRef(interpretation.sourceContainer, source);
    assertRef(interpretation.destinationContainer, destination);
    assertNoRef(interpretation.sourceWallet, 'source wallet');
    assertNoRef(interpretation.destinationWallet, 'destination wallet');
  } else {
    const source = requireSystemContainer(
      context,
      containerId,
      'savings',
    );
    const destination = requireActiveContainer(
      context,
      destinationContainerId,
      'Savings destination',
    );
    if (destination.systemKey === 'savings') {
      throw new AssistantValidationError(
        'Savings withdrawals must end outside Savings.',
      );
    }
    assertLabel(source.name, containerLabel, 'source container');
    assertLabel(
      destination.name,
      destinationContainerLabel,
      'destination container',
    );
    assertBalance(source.balanceMinor, amountMinor, source.name);
    assertRef(interpretation.sourceContainer, source);
    assertRef(interpretation.destinationContainer, destination);
    assertNoRef(interpretation.sourceWallet, 'source wallet');
    assertNoRef(interpretation.destinationWallet, 'destination wallet');
  }

  const sourceBalance = optionalNonNegativeInteger(
    record.sourceBalanceMinor,
    'proposal.sourceBalanceMinor',
  );
  const destinationBalance = optionalNonNegativeInteger(
    record.destinationBalanceMinor,
    'proposal.destinationBalanceMinor',
  );
  if (sourceBalance !== undefined) {
    const expected = balanceForRef(
      context,
      interpretation.sourceContainer ?? interpretation.sourceWallet,
    );
    if (expected !== sourceBalance) {
      throw new AssistantValidationError(
        'Proposal source balance does not match local data.',
      );
    }
  }
  if (destinationBalance !== undefined) {
    const expected = balanceForRef(
      context,
      interpretation.destinationContainer ??
        interpretation.destinationWallet,
    );
    if (expected !== destinationBalance) {
      throw new AssistantValidationError(
        'Proposal destination balance does not match local data.',
      );
    }
  }
}

function balanceForRef(
  context: AssistantContext,
  ref: AssistantEntityRef | undefined,
): number | undefined {
  if (!ref) return undefined;
  return (
    context.wallets.find((wallet) => wallet.id === ref.id)?.balanceMinor ??
    context.containers.find((container) => container.id === ref.id)
      ?.balanceMinor
  );
}

function validateClarification(
  record: Record<string, unknown>,
  interpretation: AssistantInterpretation,
  message: string,
  context: AssistantContext,
) {
  const reason = asString(record.reason, 'clarification.reason');
  if (!CLARIFICATION_REASONS.has(reason)) {
    throw new AssistantValidationError(
      'Unsupported clarification reason.',
    );
  }
  if (interpretation.missingFields.length === 0) {
    throw new AssistantValidationError(
      'A clarification must report at least one missing field.',
    );
  }
  if (interpretation.clarificationQuestion !== message) {
    throw new AssistantValidationError(
      'Clarification question does not match the result message.',
    );
  }

  if (record.options !== undefined) {
    const options = asArray(record.options, 'clarification.options');
    for (const [index, option] of options.entries()) {
      const item = asRecord(option, `clarification.options[${index}]`);
      const id = asNonEmptyString(item.id, 'container option id');
      const name = asNonEmptyString(item.name, 'container option name');
      const container = requireActiveContainer(context, id, 'container option');
      if (container.name !== name) {
        throw new AssistantValidationError(
          'Container option name does not match local data.',
        );
      }
    }
  }

  if (record.walletOptions !== undefined) {
    const options = asArray(record.walletOptions, 'clarification.walletOptions');
    for (const [index, option] of options.entries()) {
      const item = asRecord(option, `clarification.walletOptions[${index}]`);
      const id = asNonEmptyString(item.id, 'wallet option id');
      const name = asNonEmptyString(item.name, 'wallet option name');
      const wallet = requireWallet(context, id, 'wallet option');
      if (wallet.name !== name) {
        throw new AssistantValidationError(
          'Wallet option name does not match local data.',
        );
      }
    }
  }

  if (record.pending !== undefined) {
    const pending = asRecord(record.pending, 'clarification.pending');
    asAction(pending.action, 'clarification.pending.action');
    const amount = asPositiveInteger(
      pending.amountMinor,
      'clarification.pending.amountMinor',
    );
    asNonEmptyString(pending.title, 'clarification.pending.title');
    const date = asString(
      pending.effectiveDate,
      'clarification.pending.effectiveDate',
    );
    assertEffectiveDate(date, context, 'clarification.pending.effectiveDate');
    const role = asString(pending.role, 'clarification.pending.role');
    if (role !== 'source' && role !== 'destination') {
      throw new AssistantValidationError(
        'Clarification role must be source or destination.',
      );
    }
    const pendingWalletId = optionalString(
      pending.walletId,
      'clarification.pending.walletId',
    );
    if (pendingWalletId) {
      requireWallet(context, pendingWalletId, 'pending wallet');
    }
    const pendingSourceWalletId = optionalString(
      pending.sourceWalletId,
      'clarification.pending.sourceWalletId',
    );
    if (pendingSourceWalletId) {
      requireWallet(context, pendingSourceWalletId, 'pending source wallet');
    }
    const pendingDestinationWalletId = optionalString(
      pending.destinationWalletId,
      'clarification.pending.destinationWalletId',
    );
    if (pendingDestinationWalletId) {
      requireWallet(
        context,
        pendingDestinationWalletId,
        'pending destination wallet',
      );
    }
    const pendingSourceContainerId = optionalString(
      pending.sourceContainerId,
      'clarification.pending.sourceContainerId',
    );
    if (pendingSourceContainerId) {
      requireActiveContainer(
        context,
        pendingSourceContainerId,
        'pending source container',
      );
    }
    const pendingDestinationContainerId = optionalString(
      pending.destinationContainerId,
      'clarification.pending.destinationContainerId',
    );
    if (pendingDestinationContainerId) {
      requireActiveContainer(
        context,
        pendingDestinationContainerId,
        'pending destination container',
      );
    }
    assertPendingRef(
      interpretation.sourceWallet,
      pendingSourceWalletId,
      'source wallet',
    );
    assertPendingRef(
      interpretation.destinationWallet,
      pendingDestinationWalletId,
      'destination wallet',
    );
    assertPendingRef(
      interpretation.sourceContainer,
      pendingSourceContainerId,
      'source container',
    );
    assertPendingRef(
      interpretation.destinationContainer,
      pendingDestinationContainerId,
      'destination container',
    );
    if (interpretation.amountMinor !== amount) {
      throw new AssistantValidationError(
        'Interpretation amount does not match the pending clarification.',
      );
    }
    if (interpretation.effectiveDate !== date) {
      throw new AssistantValidationError(
        'Interpretation date does not match the pending clarification.',
      );
    }
  } else if (
    interpretation.amountMinor !== undefined ||
    interpretation.effectiveDate !== undefined
  ) {
    throw new AssistantValidationError(
      'Clarification without pending data cannot include amount or date.',
    );
  }
}

function validateAnswer(
  record: Record<string, unknown>,
  intent: AssistantIntent,
  interpretation: AssistantInterpretation,
) {
  const topic = asString(record.topic, 'answer.topic');
  if (!QUESTION_TOPICS.has(topic as AssistantQuestionTopic)) {
    throw new AssistantValidationError('Unsupported answer topic.');
  }
  asNonEmptyString(record.title, 'answer.title');
  const figures = asArray(record.figures, 'answer.figures');
  for (const [index, figure] of figures.entries()) {
    const item = asRecord(figure, `answer.figures[${index}]`);
    asNonEmptyString(item.label, 'answer figure label');
    asNonNegativeInteger(
      item.amountMinor,
      'answer figure amountMinor',
    );
  }
  if (interpretation.amountMinor !== undefined) {
    throw new AssistantValidationError(
      'Answer interpretations must not include a transaction amount.',
    );
  }
  if (interpretation.effectiveDate !== undefined) {
    throw new AssistantValidationError(
      'Answer interpretations must not include an effective date.',
    );
  }
  if (
    interpretation.missingFields.length > 0 ||
    interpretation.clarificationQuestion !== undefined ||
    interpretation.sourceWallet ||
    interpretation.destinationWallet ||
    interpretation.sourceContainer ||
    interpretation.destinationContainer
  ) {
    throw new AssistantValidationError(
      'Answer interpretations cannot include clarification or transaction references.',
    );
  }
  const expectedIntent = intentForTopic(topic as AssistantQuestionTopic);
  if (expectedIntent && expectedIntent !== intent) {
    throw new AssistantValidationError(
      'Answer intent does not match its topic.',
    );
  }
}

function intentForTopic(
  topic: AssistantQuestionTopic,
): AssistantIntent | null {
  if (
    topic === 'savings_balance' ||
    topic === 'unallocated_balance' ||
    topic === 'wallet_balance' ||
    topic === 'container_balance'
  ) {
    return 'balance_inquiry';
  }
  if (topic === 'budget_remaining') return 'budget_inquiry';
  if (topic === 'monthly_income') return 'income_summary';
  if (
    topic === 'container_spending' ||
    topic === 'monthly_spending' ||
    topic === 'monthly_net_savings' ||
    topic === 'monthly_savings_activity'
  ) {
    return 'spending_summary';
  }
  return null;
}

function optionalEntityRef(
  value: unknown,
  label: string,
  context: AssistantContext,
): AssistantEntityRef | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value, label);
  const id = asNonEmptyString(record.id, `${label}.id`);
  const name = asNonEmptyString(record.name, `${label}.name`);
  const wallet = context.wallets.find((candidate) => candidate.id === id);
  const container = context.containers.find(
    (candidate) => candidate.id === id,
  );
  if (!wallet && !container) {
    throw new AssistantValidationError(
      'Interpretation references an unknown entity.',
    );
  }
  if ((wallet?.name ?? container?.name) !== name) {
    throw new AssistantValidationError(
      'Interpretation entity name does not match local data.',
    );
  }
  return { id, name };
}

function assertRef(
  ref: AssistantEntityRef | undefined,
  expected: AssistantWalletOption | AssistantContainerOption,
) {
  if (!ref || ref.id !== expected.id || ref.name !== expected.name) {
    throw new AssistantValidationError(
      'Interpretation entity does not match the proposal.',
    );
  }
}

function assertPendingRef(
  ref: AssistantEntityRef | undefined,
  id: string | undefined,
  label: string,
) {
  if (id) {
    if (!ref || ref.id !== id) {
      throw new AssistantValidationError(
        `Pending ${label} does not match the interpretation.`,
      );
    }
  } else if (ref) {
    throw new AssistantValidationError(
      `Unexpected ${label} in pending clarification.`,
    );
  }
}

function assertNoRef(
  ref: AssistantEntityRef | undefined,
  label: string,
) {
  if (ref) {
    throw new AssistantValidationError(
      `Unexpected ${label} in interpretation.`,
    );
  }
}

function requireWallet(
  context: AssistantContext,
  id: string | undefined,
  label: string,
): AssistantWalletOption {
  const wallet = id
    ? context.wallets.find((candidate) => candidate.id === id)
    : undefined;
  if (!wallet) {
    throw new AssistantValidationError(`Unknown ${label}.`);
  }
  return wallet;
}

function requireActiveContainer(
  context: AssistantContext,
  id: string | undefined,
  label: string,
): AssistantContainerOption {
  const container = id
    ? context.containers.find((candidate) => candidate.id === id)
    : undefined;
  if (!container || container.status !== 'active') {
    throw new AssistantValidationError(`Unknown or inactive ${label}.`);
  }
  return container;
}

function requireActiveOrdinary(
  context: AssistantContext,
  id: string | undefined,
  label: string,
): AssistantContainerOption {
  const container = requireActiveContainer(context, id, label);
  if (container.systemKey != null) {
    throw new AssistantValidationError(`${label} must be an ordinary container.`);
  }
  return container;
}

function requireSystemContainer(
  context: AssistantContext,
  id: string | undefined,
  systemKey: 'savings',
): AssistantContainerOption {
  const container = id
    ? context.containers.find((candidate) => candidate.id === id)
    : undefined;
  if (
    !container ||
    container.status !== 'active' ||
    container.systemKey !== systemKey
  ) {
    throw new AssistantValidationError(
      `Expected the active system ${systemKey} container.`,
    );
  }
  return container;
}

function assertLabel(
  actual: string,
  provided: string | undefined,
  label: string,
) {
  if (provided !== undefined && provided !== actual) {
    throw new AssistantValidationError(
      `Proposal ${label} label does not match local data.`,
    );
  }
}

function assertBalance(balance: number, amount: number, label: string) {
  if (balance < amount) {
    throw new AssistantValidationError(
      `${label} does not have enough recorded funds.`,
    );
  }
}

function assertEffectiveDate(
  date: string,
  context: AssistantContext,
  label: string,
) {
  if (!isValidDateKey(date)) {
    throw new AssistantValidationError(`${label} is invalid.`);
  }
  if (date > context.todayDateKey) {
    throw new AssistantValidationError(`${label} cannot be in the future.`);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AssistantValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new AssistantValidationError(`${label} must be an array.`);
  }
  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new AssistantValidationError(`${label} must be a string.`);
  }
  return value;
}

function asNonEmptyString(value: unknown, label: string): string {
  const parsed = asString(value, label);
  if (!parsed.trim()) {
    throw new AssistantValidationError(`${label} cannot be empty.`);
  }
  return parsed;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return asString(value, label);
}

function optionalNonEmptyString(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  return asNonEmptyString(value, label);
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AssistantValidationError(`${label} must be a finite number.`);
  }
  return value;
}

function asPositiveInteger(value: unknown, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new AssistantValidationError(
      `${label} must be a positive safe integer.`,
    );
  }
  return value;
}

function optionalPositiveInteger(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  return asPositiveInteger(value, label);
}

function asNonNegativeInteger(value: unknown, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new AssistantValidationError(
      `${label} must be a non-negative safe integer.`,
    );
  }
  return value;
}

function optionalNonNegativeInteger(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  return asNonNegativeInteger(value, label);
}

function asIntent(value: unknown, label: string): AssistantIntent {
  const parsed = asString(value, label);
  if (!INTENTS.has(parsed as AssistantIntent)) {
    throw new AssistantValidationError(`${label} is unsupported.`);
  }
  return parsed as AssistantIntent;
}

function asAction(value: unknown, label: string): AssistantAction {
  const parsed = asString(value, label);
  if (!ACTIONS.has(parsed as AssistantAction)) {
    throw new AssistantValidationError(`${label} is unsupported.`);
  }
  return parsed as AssistantAction;
}
