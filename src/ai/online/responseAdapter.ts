import {
  dateKeyToLocalDate,
  isValidDateKey,
  monthKeyForDateKey,
  toLocalDateKey,
} from '@/lib/period';
import { parsePesoToMinor } from '@/lib/money';
import {
  interpretAssistantMessage,
  type AssistantAction,
  type AssistantClarification,
  type AssistantContainerOption,
  type AssistantContext,
  type AssistantIntent,
  type AssistantInterpretation,
  type AssistantMissingField,
  type AssistantProposal,
  type AssistantResult,
  type AssistantWalletOption,
} from '../localAssistant';
import { validateAssistantResult } from '../validation';
import {
  validateOnlineResponse,
  type OnlineEntityRefs,
  type OnlineRequestEnvelope,
  type OnlineResponse,
} from './contract';

export class OnlineAdapterError extends Error {
  constructor(
    message: string,
    readonly code = 'invalid_response',
  ) {
    super(message);
    this.name = 'OnlineAdapterError';
  }
}

let onlineProposalSequence = 0;

export function adaptOnlineResponse(
  response: unknown,
  envelope: OnlineRequestEnvelope,
  context: AssistantContext,
): AssistantResult {
  const parsed = validateOnlineResponse(response);
  assertKnownRefs(parsed, envelope);

  if (parsed.kind === 'refusal') {
    return validateResult(refusalResult(parsed), context);
  }
  if (parsed.kind === 'answer') {
    return validateResult(
      answerResult(parsed, envelope.request.message, context),
      context,
    );
  }
  if (parsed.kind === 'clarification') {
    return validateResult(
      clarificationResult(parsed.intent, parsed.missingFields, context),
      context,
    );
  }

  return adaptProposal(parsed, envelope, context);
}

function adaptProposal(
  response: Extract<OnlineResponse, { kind: 'proposal' }>,
  envelope: OnlineRequestEnvelope,
  context: AssistantContext,
): AssistantResult {
  if ((response.missingFields?.length ?? 0) > 0) {
    return validateResult(
      clarificationResult(
        response.intent,
        response.missingFields ?? [],
        context,
      ),
      context,
    );
  }

  assertIntentMatchesAction(response.intent, response.action);

  if (!response.amountText) {
    return validateResult(
      clarificationResult(response.intent, ['amount'], context),
      context,
    );
  }

  const amountMinor = parseGroundedAmount(
    response.amountText,
    envelope.request.message,
  );
  const effectiveDate = resolveEffectiveDate(
    response.dateText,
    envelope.request.message,
    context,
  );
  const refs = response.refs ?? {};
  const missingFields = requiredProposalFields(response.action, refs);
  if (missingFields.length > 0) {
    return validateResult(
      clarificationResult(response.intent, missingFields, context),
      context,
    );
  }

  if (response.action === 'expense') {
    const wallet = resolveWallet(
      refs.wallet ?? refs.sourceWallet,
      envelope,
      context,
      'expense wallet',
    );
    const container = resolveContainer(
      refs.container ?? refs.sourceContainer,
      envelope,
      context,
      'expense container',
    );
    return validateResult(
      buildProposalResult(
        response.intent,
        'expense',
        amountMinor,
        effectiveDate,
        {
          wallet,
          container,
        },
        context,
      ),
      context,
    );
  }

  if (response.action === 'income') {
    const wallet = resolveWallet(
      refs.wallet ?? refs.destinationWallet,
      envelope,
      context,
      'income wallet',
    );
    const container = resolveContainer(
      refs.container ?? refs.destinationContainer,
      envelope,
      context,
      'income container',
    );
    return validateResult(
      buildProposalResult(
        response.intent,
        'income',
        amountMinor,
        effectiveDate,
        {
          destinationWallet: wallet,
          destinationContainer: container,
        },
        context,
      ),
      context,
    );
  }

  if (response.action === 'wallet_transfer') {
    const sourceWallet = resolveWallet(
      refs.sourceWallet,
      envelope,
      context,
      'source wallet',
    );
    const destinationWallet = resolveWallet(
      refs.destinationWallet,
      envelope,
      context,
      'destination wallet',
    );
    return validateResult(
      buildProposalResult(
        response.intent,
        'wallet_transfer',
        amountMinor,
        effectiveDate,
        {
          sourceWallet,
          destinationWallet,
        },
        context,
      ),
      context,
    );
  }

  const sourceContainer = resolveContainer(
    refs.sourceContainer ?? refs.container,
    envelope,
    context,
    'source container',
  );
  const destinationContainer = resolveContainer(
    refs.destinationContainer,
    envelope,
    context,
    'destination container',
  );

  if (response.action === 'container_transfer') {
    return validateResult(
      buildProposalResult(
        response.intent,
        'container_transfer',
        amountMinor,
        effectiveDate,
        {
          sourceContainer,
          destinationContainer,
        },
        context,
      ),
      context,
    );
  }

  return validateResult(
    buildProposalResult(
      response.intent,
      response.action,
      amountMinor,
      effectiveDate,
      {
        sourceContainer,
        destinationContainer,
      },
      context,
    ),
    context,
  );
}

interface ProposalEntities {
  wallet?: AssistantWalletOption;
  destinationWallet?: AssistantWalletOption;
  sourceWallet?: AssistantWalletOption;
  sourceContainer?: AssistantContainerOption;
  destinationContainer?: AssistantContainerOption;
  container?: AssistantContainerOption;
}

function buildProposalResult(
  intent: AssistantIntent,
  action: AssistantAction,
  amountMinor: number,
  effectiveDate: string,
  entities: ProposalEntities,
  context: AssistantContext,
): AssistantResult {
  const title = titleForAction(action);
  const monthKey = monthKeyForDateKey(effectiveDate);
  const proposal: AssistantProposal = {
    id: nextProposalId(),
    action,
    title,
    amountMinor,
    effectiveDate,
    monthKey,
    ...proposalEntityFields(action, entities),
  };
  const interpretation = proposalInterpretation(
    intent,
    action,
    title,
    amountMinor,
    effectiveDate,
    entities,
    context,
  );

  return {
    kind: 'proposal',
    intent,
    message: `I prepared a ${title.toLowerCase()} draft for your review. No transaction has been saved.`,
    proposal,
    interpretation,
  };
}

function proposalEntityFields(
  action: AssistantAction,
  entities: ProposalEntities,
): Partial<AssistantProposal> {
  if (action === 'expense') {
    return {
      walletId: entities.wallet?.id,
      walletLabel: entities.wallet?.name,
      containerId: entities.container?.id,
      containerLabel: entities.container?.name,
    };
  }
  if (action === 'income') {
    return {
      walletId: entities.destinationWallet?.id,
      walletLabel: entities.destinationWallet?.name,
      destinationContainerId: entities.destinationContainer?.id,
      destinationContainerLabel: entities.destinationContainer?.name,
    };
  }
  if (action === 'wallet_transfer') {
    return {
      sourceWalletId: entities.sourceWallet?.id,
      sourceWalletLabel: entities.sourceWallet?.name,
      destinationWalletId: entities.destinationWallet?.id,
      destinationWalletLabel: entities.destinationWallet?.name,
    };
  }
  return {
    containerId: entities.sourceContainer?.id,
    containerLabel: entities.sourceContainer?.name,
    destinationContainerId: entities.destinationContainer?.id,
    destinationContainerLabel: entities.destinationContainer?.name,
  };
}

function proposalInterpretation(
  intent: AssistantIntent,
  action: AssistantAction,
  title: string,
  amountMinor: number,
  effectiveDate: string,
  entities: ProposalEntities,
  context: AssistantContext,
): AssistantInterpretation {
  const interpretation: AssistantInterpretation = {
    intent,
    amountMinor,
    currency: 'PHP',
    effectiveDate,
    description: title,
    confidence: 0.75,
    missingFields: [],
    reasoningSummary:
      'Prepared a validated online draft from the current message and local entity list.',
  };

  if (action === 'expense') {
    interpretation.sourceWallet = entityRef(
      context.wallets,
      entities.wallet?.id,
    );
    interpretation.sourceContainer = entityRef(
      context.containers,
      entities.container?.id,
    );
  } else if (action === 'income') {
    interpretation.destinationWallet = entityRef(
      context.wallets,
      entities.destinationWallet?.id,
    );
    interpretation.destinationContainer = entityRef(
      context.containers,
      entities.destinationContainer?.id,
    );
  } else if (action === 'wallet_transfer') {
    interpretation.sourceWallet = entityRef(
      context.wallets,
      entities.sourceWallet?.id,
    );
    interpretation.destinationWallet = entityRef(
      context.wallets,
      entities.destinationWallet?.id,
    );
  } else {
    interpretation.sourceContainer = entityRef(
      context.containers,
      entities.sourceContainer?.id,
    );
    interpretation.destinationContainer = entityRef(
      context.containers,
      entities.destinationContainer?.id,
    );
  }

  return interpretation;
}

function clarificationResult(
  intent: AssistantIntent,
  missingFields: AssistantMissingField[],
  context: AssistantContext,
): AssistantResult {
  const fields: AssistantMissingField[] =
    missingFields.length > 0 ? missingFields : ['amount'];
  const reason = clarificationReason(fields);
  const message = clarificationMessage(fields);
  const clarification: AssistantClarification = {
    reason,
    ...(fields.some((field) => field === 'sourceWallet' || field === 'destinationWallet')
      ? {
          walletOptions: context.wallets.map((wallet) => ({
            id: wallet.id,
            name: wallet.name,
            kind: wallet.kind,
            balanceMinor: wallet.balanceMinor,
          })),
        }
      : {}),
    ...(fields.some(
      (field) =>
        field === 'sourceContainer' ||
        field === 'destinationContainer' ||
        field === 'transferKind',
    )
      ? {
          options: context.containers
            .filter((container) => container.status === 'active')
            .map((container) => ({
              id: container.id,
              name: container.name,
              balanceMinor: container.balanceMinor,
            })),
        }
      : {}),
  };

  return {
    kind: 'clarification',
    intent,
    message,
    clarification,
    interpretation: {
      intent,
      confidence: 0.35,
      missingFields: [...fields],
      clarificationQuestion: message,
      reasoningSummary:
        'The online response did not include enough trusted information to prepare a draft.',
    },
  };
}

function answerResult(
  response: Extract<OnlineResponse, { kind: 'answer' }>,
  message: string,
  context: AssistantContext,
): AssistantResult {
  const local = interpretAssistantMessage(message, context);
  if (local.kind !== 'answer') {
    throw new OnlineAdapterError(
      'The online response claimed a read-only answer that local rules could not produce.',
      'unsupported_answer',
    );
  }
  if (
    local.answer.topic !== response.answerTopic ||
    local.intent !== response.intent
  ) {
    throw new OnlineAdapterError(
      'The online answer does not match local interpretation.',
      'contradictory_answer',
    );
  }
  return local;
}

function refusalResult(
  response: Extract<OnlineResponse, { kind: 'refusal' }>,
): AssistantResult {
  const message = refusalMessage(response.reason);
  return {
    kind: 'refusal',
    intent: response.intent,
    message,
    interpretation: {
      intent: response.intent,
      confidence: 0,
      missingFields: [],
      reasoningSummary: message,
    },
  };
}

function validateResult(
  result: AssistantResult,
  context: AssistantContext,
): AssistantResult {
  try {
    return validateAssistantResult(result, context);
  } catch (error) {
    if (error instanceof OnlineAdapterError) throw error;
    throw new OnlineAdapterError(
      error instanceof Error
        ? error.message
        : 'The online response failed local validation.',
      'invalid_result',
    );
  }
}

function requiredProposalFields(
  action: AssistantAction,
  refs: OnlineEntityRefs,
): AssistantMissingField[] {
  const missing: AssistantMissingField[] = [];
  if (action === 'expense') {
    if (!refs.wallet && !refs.sourceWallet) missing.push('sourceWallet');
    if (!refs.container && !refs.sourceContainer) {
      missing.push('sourceContainer');
    }
    return missing;
  }
  if (action === 'income') {
    if (!refs.wallet && !refs.destinationWallet) {
      missing.push('destinationWallet');
    }
    if (!refs.container && !refs.destinationContainer) {
      missing.push('destinationContainer');
    }
    return missing;
  }
  if (action === 'wallet_transfer') {
    if (!refs.sourceWallet) missing.push('sourceWallet');
    if (!refs.destinationWallet) missing.push('destinationWallet');
    return missing;
  }
  if (!refs.sourceContainer && !refs.container) {
    missing.push('sourceContainer');
  }
  if (!refs.destinationContainer) missing.push('destinationContainer');
  return missing;
}

function resolveWallet(
  alias: string | undefined,
  envelope: OnlineRequestEnvelope,
  context: AssistantContext,
  label: string,
): AssistantWalletOption {
  if (!alias) {
    throw new OnlineAdapterError(
      `The online response is missing the ${label}.`,
      'missing_entity_reference',
    );
  }
  const id = envelope.walletIdsByAlias.get(alias);
  if (!id) {
    throw new OnlineAdapterError(
      `The online response referenced an unknown ${label} alias.`,
      'unknown_entity_reference',
    );
  }
  const wallet = context.wallets.find((candidate) => candidate.id === id);
  if (!wallet) {
    throw new OnlineAdapterError(
      `The online response referenced a stale ${label}.`,
      'stale_entity_reference',
    );
  }
  return wallet;
}

function resolveContainer(
  alias: string | undefined,
  envelope: OnlineRequestEnvelope,
  context: AssistantContext,
  label: string,
): AssistantContainerOption {
  if (!alias) {
    throw new OnlineAdapterError(
      `The online response is missing the ${label}.`,
      'missing_entity_reference',
    );
  }
  const id = envelope.containerIdsByAlias.get(alias);
  if (!id) {
    throw new OnlineAdapterError(
      `The online response referenced an unknown ${label} alias.`,
      'unknown_entity_reference',
    );
  }
  const container = context.containers.find(
    (candidate) =>
      candidate.id === id && candidate.status === 'active',
  );
  if (!container) {
    throw new OnlineAdapterError(
      `The online response referenced a stale ${label}.`,
      'stale_entity_reference',
    );
  }
  return container;
}

function assertKnownRefs(
  response: OnlineResponse,
  envelope: OnlineRequestEnvelope,
) {
  if (!('refs' in response) || !response.refs) return;
  for (const [key, alias] of Object.entries(response.refs)) {
    if (!alias) continue;
    const isWalletRef =
      key === 'wallet' ||
      key === 'sourceWallet' ||
      key === 'destinationWallet';
    const exists = isWalletRef
      ? envelope.walletIdsByAlias.has(alias)
      : envelope.containerIdsByAlias.has(alias);
    if (!exists) {
      throw new OnlineAdapterError(
        `The online response referenced an unknown ${key} alias.`,
        'unknown_entity_reference',
      );
    }
  }
}

function parseGroundedAmount(amountText: string, message: string): number {
  const amountMinor = parsePesoToMinor(amountText);
  if (amountMinor === null || amountMinor <= 0) {
    throw new OnlineAdapterError(
      'The online response contained an invalid amount.',
      'invalid_amount',
    );
  }
  if (!messageSupportsAmount(message, amountMinor)) {
    throw new OnlineAdapterError(
      'The online response amount was not supported by the user message.',
      'ungrounded_amount',
    );
  }
  return amountMinor;
}

function messageSupportsAmount(message: string, amountMinor: number): boolean {
  const sanitized = message
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, ' ');
  const matches = sanitized.matchAll(
    /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(k|thousand)?/gi,
  );
  for (const match of matches) {
    const raw = match[1];
    if (!raw) continue;
    const parsed = parsePesoToMinor(raw);
    if (parsed === null) continue;
    const scale = match[2] ? 1000 : 1;
    if (parsed * scale === amountMinor) return true;
  }
  return false;
}

function resolveEffectiveDate(
  dateText: string | undefined,
  message: string,
  context: AssistantContext,
): string {
  if (dateText !== undefined) {
    const lower = dateText.toLowerCase();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
      if (!message.includes(dateText)) {
        throw new OnlineAdapterError(
          'The online response date was not present in the user message.',
          'ungrounded_date',
        );
      }
      return validateEffectiveDate(dateText, context);
    }
    if (lower === 'today' || lower === 'ngayon' || lower === 'kanina') {
      assertMessageMentions(message, /\b(today|ngayon|kanina)\b/i);
      return validateEffectiveDate(context.todayDateKey, context);
    }
    if (lower === 'yesterday' || lower === 'kahapon') {
      assertMessageMentions(message, /\b(yesterday|kahapon)\b/i);
      return validateEffectiveDate(
        shiftDateKey(context.todayDateKey, -1),
        context,
      );
    }
    throw new OnlineAdapterError(
      'The online response contained an unsupported date.',
      'unsupported_date',
    );
  }

  const explicitIso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(message)?.[1];
  if (explicitIso) return validateEffectiveDate(explicitIso, context);
  if (/\b(yesterday|kahapon)\b/i.test(message)) {
    return validateEffectiveDate(
      shiftDateKey(context.todayDateKey, -1),
      context,
    );
  }
  if (/\b(today|ngayon|kanina)\b/i.test(message)) {
    return validateEffectiveDate(context.todayDateKey, context);
  }
  if (
    /\b(tomorrow|bukas|next week|last week|last month|next month)\b/i.test(
      message,
    ) ||
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(
      message,
    )
  ) {
    throw new OnlineAdapterError(
      'The user message contains a date that cannot be executed safely.',
      'invalid_date',
    );
  }
  return validateEffectiveDate(context.todayDateKey, context);
}

function validateEffectiveDate(
  dateKey: string,
  context: AssistantContext,
): string {
  if (!isValidDateKey(dateKey)) {
    throw new OnlineAdapterError(
      'The online response date is invalid.',
      'invalid_date',
    );
  }
  if (dateKey > context.todayDateKey) {
    throw new OnlineAdapterError(
      'The online response date cannot be in the future.',
      'future_date',
    );
  }
  if (monthKeyForDateKey(dateKey) !== context.activeMonthKey) {
    throw new OnlineAdapterError(
      'The online response date must belong to the active month.',
      'inactive_month',
    );
  }
  return dateKey;
}

function shiftDateKey(dateKey: string, days: number): string {
  const date = dateKeyToLocalDate(dateKey);
  date.setDate(date.getDate() + days);
  return toLocalDateKey(date);
}

function assertMessageMentions(message: string, pattern: RegExp) {
  if (!pattern.test(message)) {
    throw new OnlineAdapterError(
      'The online response date was not present in the user message.',
      'ungrounded_date',
    );
  }
}

function assertIntentMatchesAction(
  intent: AssistantIntent,
  action: AssistantAction,
) {
  const expected =
    action === 'expense'
      ? 'expense'
      : action === 'income'
        ? 'income'
        : action === 'wallet_transfer'
          ? 'wallet_transfer'
          : 'container_transfer';
  if (intent !== expected) {
    throw new OnlineAdapterError(
      'The online response intent contradicts its action.',
      'contradictory_intent',
    );
  }
}

function clarificationReason(
  fields: AssistantMissingField[],
): AssistantClarification['reason'] {
  if (fields.includes('amount')) return 'amount';
  if (fields.includes('effectiveDate')) return 'setup';
  if (
    fields.includes('sourceWallet') ||
    fields.includes('destinationWallet')
  ) {
    return 'wallet';
  }
  if (
    fields.includes('sourceContainer') ||
    fields.includes('destinationContainer')
  ) {
    return 'container';
  }
  return 'transfer';
}

function clarificationMessage(fields: AssistantMissingField[]): string {
  if (fields.includes('amount')) {
    return 'How much was involved? Include the amount in pesos.';
  }
  if (fields.includes('effectiveDate')) {
    return 'What date should this use?';
  }
  if (
    fields.includes('sourceWallet') ||
    fields.includes('destinationWallet')
  ) {
    return 'Which wallet should this use?';
  }
  if (
    fields.includes('sourceContainer') ||
    fields.includes('destinationContainer')
  ) {
    return 'Which budget container should this use?';
  }
  return 'Please specify both sides of the transfer.';
}

function refusalMessage(reason: string): string {
  if (reason === 'multiple_actions') {
    return 'Please send one financial action at a time so it can be reviewed safely.';
  }
  if (reason === 'prompt_injection') {
    return 'I can only interpret the finance request itself. I will not follow instructions to reveal secrets or bypass confirmation.';
  }
  if (reason === 'out_of_scope') {
    return 'That request is outside the assistant’s finance interpretation scope.';
  }
  if (reason === 'invalid_request') {
    return 'That request could not be interpreted safely. Please rephrase it with a clear amount and entities.';
  }
  return 'I can only draft finance entries or answer local finance questions. No transaction was saved.';
}

function titleForAction(action: AssistantAction): string {
  if (action === 'expense') return 'Expense';
  if (action === 'income') return 'Income';
  if (action === 'wallet_transfer') return 'Wallet transfer';
  if (action === 'savings_contribution') return 'Savings contribution';
  if (action === 'savings_withdrawal') return 'Savings withdrawal';
  return 'Container transfer';
}

function entityRef(
  entities: AssistantContext['wallets'] | AssistantContext['containers'],
  id: string | undefined,
) {
  if (!id) return undefined;
  const entity = entities.find((candidate) => candidate.id === id);
  return entity ? { id: entity.id, name: entity.name } : undefined;
}

function nextProposalId(): string {
  onlineProposalSequence += 1;
  return `online-${Date.now().toString(36)}-${onlineProposalSequence}`;
}
