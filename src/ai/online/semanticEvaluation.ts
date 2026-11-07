import { parsePesoToMinor } from '@/lib/money';
import {
  dateKeyToLocalDate,
  isValidDateKey,
  monthKeyForDateKey,
  toLocalDateKey,
} from '@/lib/period';
import {
  interpretAssistantMessage,
  type AssistantAction,
  type AssistantContext,
  type AssistantIntent,
  type AssistantMissingField,
  type AssistantResult,
} from '../localAssistant';
import { validateAssistantResult } from '../validation';
import {
  createOnlineRequest,
  validateOnlineResponse,
  type OnlineEntityRefs,
  type OnlineResponse,
} from './contract';

export type SemanticAcceptanceStatus =
  | 'accepted'
  | 'clarification_required'
  | 'rejected'
  | 'unsupported';

export type SemanticRejectionReason =
  | 'offline_interpretation_failed'
  | 'offline_interpreter_already_produced_a_proposal'
  | 'offline_interpreter_answered_a_read_only_question'
  | 'candidate_failed_contract_validation'
  | 'candidate_is_not_a_proposal'
  | 'candidate_requested_clarification'
  | 'candidate_clarification_ungrounded'
  | 'candidate_unknown_entity'
  | 'candidate_read_only_requires_local_answer'
  | 'candidate_refused_or_unsupported'
  | 'unsupported_historical_question'
  | 'negated_or_uncertain_action'
  | 'non_transaction_or_ambiguous_statement'
  | 'candidate_failed_financial_validation'
  | 'eligibility_context_missing_or_stale'
  | 'inactive_wallet'
  | 'unsupported_action'
  | 'prompt_injection_evidence'
  | 'multiple_action_evidence'
  | 'ambiguous_income_or_transfer'
  | 'candidate_intent_does_not_match_action'
  | 'candidate_declared_missing_fields'
  | 'candidate_amount_is_missing_or_invalid'
  | 'candidate_amount_is_not_evidenced_in_message'
  | 'candidate_action_is_not_evidenced_in_message'
  | 'savings_action_is_not_evidenced_in_message'
  | 'candidate_entities_are_incomplete'
  | 'candidate_entities_are_not_evidenced'
  | 'candidate_date_is_invalid_or_ungrounded'
  | 'unknown_or_stale_wallet'
  | 'unknown_or_archived_container'
  | 'expense_targets_system_container'
  | 'income_targets_savings'
  | 'wallet_transfer_reuses_wallet'
  | 'container_transfer_reuses_container'
  | 'invalid_savings_contribution_route'
  | 'invalid_savings_withdrawal_route'
  | 'ordinary_transfer_targets_system_container';

/** Evidence checked by the experiment, not a guarantee of financial validity. */
export interface SemanticCandidateEvidence {
  contractValid: true;
  actionMentioned: true;
  amountMentioned: true;
  entityNamesMentioned: true;
  dateResolved: true;
}

export interface SemanticAcceptedCandidate {
  action: AssistantAction;
  amountMinor: number;
  effectiveDate: string;
  walletId?: string;
  containerId?: string;
  sourceWalletId?: string;
  destinationWalletId?: string;
  sourceContainerId?: string;
  destinationContainerId?: string;
}

export interface SemanticEvaluationInput {
  message: string;
  context: AssistantContext;
  candidate: unknown;
  /** Synthetic, trusted test snapshot; never derived from the candidate. */
  eligibility?: {
    balanceAsOfDateKey: string;
    walletStatuses: Readonly<Record<string, 'active' | 'archived'>>;
    /** Synthetic test tokens, supplied by the trusted experiment caller. */
    snapshotRevision?: string;
    currentRevision?: string;
  };
}

export interface SemanticEvaluationResult {
  status: SemanticAcceptanceStatus;
  offline: AssistantResult;
  candidate?: SemanticAcceptedCandidate;
  missingFields?: AssistantMissingField[];
  reasons: SemanticRejectionReason[];
  evidence?: SemanticCandidateEvidence;
}

const ACTION_INTENT: Record<AssistantAction, AssistantIntent> = {
  expense: 'expense',
  income: 'income',
  wallet_transfer: 'wallet_transfer',
  container_transfer: 'container_transfer',
  savings_contribution: 'container_transfer',
  savings_withdrawal: 'container_transfer',
};

const ACTION_EVIDENCE: Record<AssistantAction, RegExp> = {
  expense:
    /\b(spent|spend|paid|pay|bought|buy|purchased|purchase|gastos|gasto|binili|bumili|nagbayad|bayad|set me back)\b/i,
  income:
    /\b(received|receive|got|get|earned|earn|income|allowance|sweldo|sahod|padala|pinadala|regalo|bonus)\b|\b(?:sent|send)\s+me\b/i,
  wallet_transfer:
    /\b(transfer|transferred|move|moved|ilipat|ilagay)\b/i,
  container_transfer:
    /\b(transfer|transferred|move|moved|allocate|allocated|return|returned|ilipat|ilagay)\b/i,
  savings_contribution:
    /\b(save|saved|saving|contribute|contributed|move|moved|put|set aside|ilagay|ilipat|tabi|magtabi)\b/i,
  savings_withdrawal:
    /\b(withdraw|withdrew|withdrawal|take out|took out|kunin|bawi|bawas)\b/i,
};

const SAVINGS_EVIDENCE = /\b(savings?|ipon|impok)\b/i;
const MULTIPLE_ACTION_EVIDENCE = [
  ACTION_EVIDENCE.expense,
  ACTION_EVIDENCE.income,
  /\b(transfer|transferred|move|moved|ilipat|ilagay)\b/i,
  ACTION_EVIDENCE.savings_withdrawal,
];
const PROMPT_INJECTION_EVIDENCE =
  /\b(ignore (?:previous|prior|all) instructions?|bypass confirmation|reveal (?:the )?system prompt|execute automatically|without confirmation)\b/i;
const ACTION_PHRASES = /\b(set me back|take out|took out|set aside|spent|spend|paid|pay|bought|buy|purchased|purchase|gastos|gasto|binili|bumili|nagbayad|bayad|received|receive|got|get|earned|earn|income|allowance|sweldo|sahod|padala|pinadala|regalo|bonus|transfer|transferred|move|moved|allocate|allocated|return|returned|ilipat|ilagay|save|saved|saving|contribute|contributed|put|tabi|magtabi|withdraw|withdrew|withdrawal|kunin|bawi|bawas)\b/gi;

export function evaluateOfflineBaseline(
  input: Pick<SemanticEvaluationInput, 'message' | 'context'>,
): AssistantResult {
  return interpretAssistantMessage(input.message, input.context);
}

export function evaluateSemanticCandidate(
  input: SemanticEvaluationInput,
): SemanticEvaluationResult {
  let offline: AssistantResult;
  try {
    offline = evaluateOfflineBaseline(input);
  } catch {
    return {
      status: 'rejected',
      offline: refusalResult(),
      reasons: ['offline_interpretation_failed'],
    };
  }

  if ((offline.kind !== 'answer' || /\b(?:if|unless|maybe|perhaps|hypothetically)\b|^\s*did\b/i.test(input.message)) && isNonTransactionOrAmbiguous(input.message)) {
    return {
      status: hasExplicitNegatedAction(input.message) ? 'rejected' : 'clarification_required',
      offline,
      reasons: ['non_transaction_or_ambiguous_statement'],
    };
  }

  if (
    ACTION_EVIDENCE.income.test(input.message) &&
    /\b(transfer|transferred|move|moved|send|sent|padala|pinadala)\b/i.test(input.message)
  ) {
    return {
      status: 'clarification_required',
      offline,
      reasons: ['ambiguous_income_or_transfer'],
    };
  }
  if (hasMultipleActionEvidence(input.message)) {
    return { status: 'rejected', offline, reasons: ['multiple_action_evidence'] };
  }

  if (offline.kind === 'proposal') {
    return {
      status: 'unsupported',
      offline,
      reasons: ['offline_interpreter_already_produced_a_proposal'],
    };
  }
  if (offline.kind === 'answer') {
    if (/\b(last|previous|past)\s+(month|year|week)\b|\b\d{4}-\d{2}(?:-\d{2})?\b/i.test(input.message)) {
      return {
        status: 'unsupported',
        offline: refusalResult(),
        reasons: ['unsupported_historical_question'],
      };
    }
    return {
      status: 'unsupported',
      offline,
      reasons: ['offline_interpreter_answered_a_read_only_question'],
    };
  }

  let candidate: OnlineResponse;
  try {
    candidate = validateOnlineResponse(input.candidate);
  } catch {
    if (typeof input.candidate === 'object' && input.candidate !== null &&
        'kind' in input.candidate && input.candidate.kind === 'proposal' &&
        'action' in input.candidate && typeof input.candidate.action === 'string' &&
        !Object.hasOwn(ACTION_INTENT, input.candidate.action)) {
      return { status: 'unsupported', offline, reasons: ['unsupported_action'] };
    }
    return {
      status: 'rejected',
      offline,
      reasons: ['candidate_failed_contract_validation'],
    };
  }
  if (PROMPT_INJECTION_EVIDENCE.test(input.message)) {
    return { status: 'rejected', offline, reasons: ['prompt_injection_evidence'] };
  }
  if (candidate.kind === 'clarification') {
    if (candidate.refs) {
      const envelope = createOnlineRequest(input.message, input.context);
      const unknown = Object.entries(candidate.refs).some(([key, alias]) =>
        key.toLowerCase().includes('wallet') ? !envelope.walletIdsByAlias.has(alias) : !envelope.containerIdsByAlias.has(alias));
      if (unknown) return { status: 'unsupported', offline, reasons: ['candidate_unknown_entity'] };
    }
    const reasonField: Record<string, readonly AssistantMissingField[]> = {
      missing_amount: ['amount'],
      missing_destination: ['destinationWallet', 'destinationContainer'],
      ambiguous_entity: ['sourceWallet', 'destinationWallet', 'sourceContainer', 'destinationContainer'],
      invalid_date: ['effectiveDate'],
      unsupported_transfer: ['transferKind'],
    };
    const reasonAgrees = candidate.reason === undefined ||
      candidate.missingFields.some((field) => reasonField[candidate.reason ?? '']?.includes(field));
    const numbers = input.message.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ').match(/\d+(?:,\d+)*(?:\.\d+)?/g) ?? [];
    const unambiguousAmountPresent = candidate.missingFields.includes('amount') && numbers.length === 1 &&
      parseCandidateAmount(numbers[0]) !== null;
    const destinationWalletClaim = candidate.missingFields.includes('destinationWallet');
    const sourceWalletExplicit = !destinationWalletClaim || input.context.wallets.some((wallet) => {
      const name = wallet.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\bfrom\\s+${name}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(input.message);
    });
    const destinationWalletExplicit = destinationWalletClaim && input.context.wallets.some((wallet) => {
      const name = wallet.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b(?:to|into)\\s+${name}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(input.message);
    });
    if (offline.kind !== 'clarification' || offline.intent !== candidate.intent ||
        candidate.missingFields.length !== offline.interpretation.missingFields.length ||
        !candidate.missingFields.every((field) => offline.interpretation.missingFields.includes(field)) ||
        !reasonAgrees || unambiguousAmountPresent || !sourceWalletExplicit || destinationWalletExplicit || candidate.refs !== undefined) {
      return { status: 'unsupported', offline, reasons: ['candidate_clarification_ungrounded'] };
    }
    return {
      status: 'clarification_required',
      offline,
      missingFields: [...offline.interpretation.missingFields],
      reasons: ['candidate_requested_clarification'],
    };
  }
  if (candidate.kind === 'answer') {
    return {
      status: 'unsupported',
      offline,
      reasons: ['candidate_read_only_requires_local_answer'],
    };
  }
  if (candidate.kind === 'refusal') {
    return {
      status: 'unsupported',
      offline,
      reasons: ['candidate_refused_or_unsupported'],
    };
  }

  if (candidate.intent !== ACTION_INTENT[candidate.action]) {
    return {
      status: 'rejected',
      offline,
      reasons: ['candidate_intent_does_not_match_action'],
    };
  }
  if ((candidate.missingFields?.length ?? 0) > 0) {
    return { status: 'unsupported', offline, reasons: ['candidate_clarification_ungrounded'] };
  }

  if (!ACTION_EVIDENCE[candidate.action].test(input.message)) {
    return {
      status: 'clarification_required',
      offline,
      reasons: ['candidate_action_is_not_evidenced_in_message'],
    };
  }
  const amountMinor = parseCandidateAmount(candidate.amountText);
  if (amountMinor === null) {
    return {
      status: 'rejected',
      offline,
      reasons: ['candidate_amount_is_missing_or_invalid'],
    };
  }
  if (!messageContainsAmount(input.message, amountMinor)) {
    return {
      status: 'rejected',
      offline,
      reasons: ['candidate_amount_is_not_evidenced_in_message'],
    };
  }
  if (
    (candidate.action === 'savings_contribution' ||
      candidate.action === 'savings_withdrawal') &&
    !SAVINGS_EVIDENCE.test(input.message)
  ) {
    return {
      status: 'rejected',
      offline,
      reasons: ['savings_action_is_not_evidenced_in_message'],
    };
  }

  const envelope = createOnlineRequest(input.message, input.context);
  const refs = candidate.refs ?? {};
  const allowedRefs: Record<AssistantAction, readonly (keyof OnlineEntityRefs)[]> = {
    expense: ['wallet', 'sourceWallet', 'container', 'sourceContainer'],
    income: ['wallet', 'destinationWallet', 'container', 'destinationContainer'],
    wallet_transfer: ['sourceWallet', 'destinationWallet'],
    container_transfer: ['sourceContainer', 'destinationContainer'],
    savings_contribution: ['sourceContainer', 'destinationContainer'],
    savings_withdrawal: ['sourceContainer', 'destinationContainer'],
  };
  if (Object.keys(refs).some((key) => !allowedRefs[candidate.action].includes(key as keyof OnlineEntityRefs)) ||
      (refs.wallet && (refs.sourceWallet ?? refs.destinationWallet) && refs.wallet !== (refs.sourceWallet ?? refs.destinationWallet)) ||
      (refs.container && (refs.sourceContainer ?? refs.destinationContainer) && refs.container !== (refs.sourceContainer ?? refs.destinationContainer))) {
    return { status: 'rejected', offline, reasons: ['candidate_entities_are_not_evidenced'] };
  }
  const resolved = resolveCandidateEntities(
    candidate.action,
    refs,
    envelope,
    input.context,
  );
  if (resolved.kind === 'clarification') {
    return {
      status: 'clarification_required',
      offline,
      missingFields: resolved.missingFields,
      reasons: ['candidate_entities_are_incomplete'],
    };
  }
  if (resolved.kind === 'rejected') {
    return {
      status: 'rejected',
      offline,
      reasons: [resolved.reason],
    };
  }

  // A known alias alone does not establish that the user selected an entity.
  const ids = Object.values(resolved.entities);
  const entities = [...input.context.wallets, ...input.context.containers];
  if (ids.some((id) => {
    const entity = entities.find((item) => item.id === id);
    if (!entity) return true;
    const escaped = entity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(input.message) ||
      entities.filter((item) => item.name.toLowerCase() === entity.name.toLowerCase()).length !== 1;
  })) {
    return { status: 'clarification_required', offline, reasons: ['candidate_entities_are_not_evidenced'] };
  }
  if (entities.some((entity) => {
    if (ids.includes(entity.id)) return false;
    const escaped = entity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(input.message);
  })) {
    return { status: 'clarification_required', offline, reasons: ['candidate_entities_are_not_evidenced'] };
  }
  if (candidate.action === 'wallet_transfer' || candidate.action === 'container_transfer' ||
      candidate.action === 'savings_contribution' || candidate.action === 'savings_withdrawal') {
    const sourceId = resolved.entities.sourceWalletId ?? resolved.entities.sourceContainerId;
    const destinationId = resolved.entities.destinationWalletId ?? resolved.entities.destinationContainerId;
    const source = entities.find((entity) => entity.id === sourceId);
    const destination = entities.find((entity) => entity.id === destinationId);
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const route = source && destination && new RegExp(
      `\\bfrom\\s+${escape(source.name)}\\s+(?:to|for)\\s+${escape(destination.name)}(?=$|[^\\p{L}\\p{N}])`,
      'iu',
    ).test(input.message);
    if (!route) {
      return { status: 'clarification_required', offline, reasons: ['candidate_entities_are_not_evidenced'] };
    }
  }

  let effectiveDate: string;
  try {
    effectiveDate = resolveCandidateDate(
      candidate.dateText,
      input.message,
      input.context,
    );
    if (effectiveDate !== resolveCandidateDate(undefined, input.message, input.context)) {
      throw new Error('conflicting_date');
    }
  } catch {
    return {
      status: 'rejected',
      offline,
      reasons: ['candidate_date_is_invalid_or_ungrounded'],
    };
  }

  const checkedCandidate: SemanticAcceptedCandidate = {
    action: candidate.action, amountMinor, effectiveDate, ...resolved.entities,
  };
  const walletIds = [checkedCandidate.walletId, checkedCandidate.sourceWalletId, checkedCandidate.destinationWalletId].filter((id): id is string => id !== undefined);
  if (!input.eligibility || input.eligibility.balanceAsOfDateKey !== input.context.todayDateKey ||
      !input.eligibility.snapshotRevision?.trim() || !input.eligibility.currentRevision?.trim() ||
      input.eligibility.snapshotRevision !== input.eligibility.currentRevision ||
      walletIds.some((id) => input.eligibility?.walletStatuses[id] === undefined)) {
    return { status: 'clarification_required', offline, reasons: ['eligibility_context_missing_or_stale'] };
  }
  if (walletIds.some((id) => input.eligibility?.walletStatuses[id] !== 'active')) {
    return { status: 'rejected', offline, reasons: ['inactive_wallet'] };
  }
  const sourceIds = candidate.action === 'expense'
    ? [checkedCandidate.walletId, checkedCandidate.containerId]
    : candidate.action === 'wallet_transfer' ? [checkedCandidate.sourceWalletId]
      : candidate.action === 'income' ? [] : [checkedCandidate.sourceContainerId];
  if (sourceIds.some((id) => {
    const entity = entities.find((item) => item.id === id);
    return !entity || !Number.isSafeInteger(entity.balanceMinor) || entity.balanceMinor < 0;
  })) {
    return { status: 'clarification_required', offline, reasons: ['eligibility_context_missing_or_stale'] };
  }
  if (!passesAssistantValidation(checkedCandidate, candidate.intent, input.context)) {
    return { status: 'rejected', offline, reasons: ['candidate_failed_financial_validation'] };
  }

  return {
    status: 'accepted',
    offline,
    candidate: checkedCandidate,
    reasons: [],
    evidence: {
      contractValid: true,
      actionMentioned: true,
      amountMentioned: true,
      entityNamesMentioned: true,
      dateResolved: true,
    },
  };
}

function isNonTransactionOrAmbiguous(message: string): boolean {
  // This is a bounded fail-closed screen, not a general language parser.
  // A negator is relevant only in the same short phrase as an action; unrelated
  // negation elsewhere must not itself negate the financial action.
  const unresolvedNegation = /\b(?:didn['’]?t|don['’]?t|never|hindi|huwag)\s*[.!?]*\s*$/i;
  const question = /\?/.test(message) || /^\s*(?:did|does|do|can|could|would|was|is|what|how|should)\b/i.test(message);
  const hypothetical = /\b(?:if|unless|maybe|perhaps|hypothetically|was going to|were going to|would have|might|could have)\b/i.test(message);
  const cancellation = /\b(?:cancel|do not record|don't record|dont record|remove|undo)\b/i.test(message);
  const quotation = /["“”‘’]/.test(message) || /(?:^|\s)'[^']+'/.test(message);
  return hasExplicitNegatedAction(message) || unresolvedNegation.test(message) || question || hypothetical || cancellation || quotation;
}

function hasExplicitNegatedAction(message: string): boolean {
  const action = '(?:set me back|set aside|spend|spent|pay|paid|buy|bought|purchase|purchased|receive|received|earn|earned|transfer|transferred|move|moved|save|saved|withdraw|withdrew|record|gastos|gasto|binili|bumili|nagbayad|bayad|ilipat|ilagay|magtabi)';
  return new RegExp(`\\b(?:not|never|no|didn['’]?t|don['’]?t|doesn['’]?t|wouldn['’]?t|isn['’]?t|wasn['’]?t|couldn['’]?t|hindi|huwag|di)\\s+(?:(?:actually|really|ever|yet)\\s+){0,2}${action}\\b`, 'i').test(message);
}

function passesAssistantValidation(
  candidate: SemanticAcceptedCandidate,
  intent: AssistantIntent,
  context: AssistantContext,
): boolean {
  const findWallet = (id: string | undefined) => context.wallets.find((item) => item.id === id);
  const findContainer = (id: string | undefined) => context.containers.find((item) => item.id === id);
  const ref = (entity: { id: string; name: string } | undefined) => entity && ({ id: entity.id, name: entity.name });
  const isExpense = candidate.action === 'expense';
  const isIncome = candidate.action === 'income';
  const isWalletTransfer = candidate.action === 'wallet_transfer';
  const sourceWallet = findWallet(isExpense ? candidate.walletId : candidate.sourceWalletId);
  const destinationWallet = findWallet(candidate.destinationWalletId);
  const sourceContainer = findContainer(isExpense ? candidate.containerId : candidate.sourceContainerId);
  const destinationContainer = findContainer(candidate.destinationContainerId);
  const title = 'Experimental candidate';
  const proposal = {
    id: 'semantic-evaluation-only', title, action: candidate.action,
    amountMinor: candidate.amountMinor, effectiveDate: candidate.effectiveDate,
    monthKey: monthKeyForDateKey(candidate.effectiveDate),
    walletId: isExpense ? candidate.walletId : isIncome ? candidate.destinationWalletId : undefined,
    containerId: isExpense ? candidate.containerId : isIncome || isWalletTransfer ? undefined : candidate.sourceContainerId,
    destinationContainerId: candidate.destinationContainerId,
    sourceWalletId: candidate.sourceWalletId,
    destinationWalletId: isWalletTransfer ? candidate.destinationWalletId : undefined,
  };
  const interpretation = {
    intent, amountMinor: candidate.amountMinor, currency: 'PHP',
    effectiveDate: candidate.effectiveDate, description: title, confidence: 0,
    missingFields: [], reasoningSummary: 'Experimental validation.',
    sourceWallet: ref(sourceWallet), destinationWallet: ref(destinationWallet),
    sourceContainer: ref(sourceContainer), destinationContainer: ref(destinationContainer),
  };
  try {
    validateAssistantResult({ kind: 'proposal', intent, message: title, proposal, interpretation }, context);
    return true;
  } catch {
    return false;
  }
}

function parseCandidateAmount(value: string | undefined): number | null {
  if (value === undefined) return null;
  const amountMinor = parsePesoToMinor(value);
  if (amountMinor === null || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  return amountMinor;
}

function messageContainsAmount(message: string, amountMinor: number): boolean {
  // Reject arithmetic, signed numbers, times and alphanumeric identifiers rather
  // than allowing a model to choose one of their component digits.
  if (/[+×*÷=−–—]/u.test(message) || /(?:^|\s)-\s*\d/.test(message) ||
      /\b\d{1,2}:\d{2}\b/.test(message) || /\b\w*\d+\w*[a-z_]\w*\b/i.test(message)) {
    return false;
  }
  const withoutDates = message.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
  const tokens = withoutDates.match(/\d+(?:,\d+)*(?:\.\d+)?/g) ?? [];
  if (tokens.length !== 1 || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(tokens[0])) {
    return false;
  }
  if (parsePesoToMinor(tokens[0]) !== amountMinor) return false;
  const following = withoutDates.slice(withoutDates.indexOf(tokens[0]) + tokens[0].length);
  const nextWord = /^\s+([a-z]+)/i.exec(following)?.[1]?.toLowerCase();
  if (nextWord && !['pesos', 'peso', 'php', 'from', 'for', 'on', 'using', 'to', 'in', 'at', 'with', 'and', 'today', 'yesterday', 'ngayon', 'kahapon', 'kanina'].includes(nextWord)) return false;
  // A number must immediately follow a supported action phrase; arbitrary
  // quantities elsewhere in the sentence are not enough to establish money.
  return /\b(?:set me back|set aside|spent|spend|paid|pay|bought|buy|purchased|purchase|gastos|gasto|binili|bumili|nagbayad|bayad|received|receive|got|get|earned|earn|income|allowance|sweldo|sahod|padala|pinadala|regalo|bonus|transfer|transferred|move|moved|allocate|allocated|return|returned|ilipat|ilagay|save|saved|saving|contribute|contributed|put|tabi|magtabi|withdraw|withdrew|withdrawal|take out|took out|kunin|bawi|bawas)\s+(?:₱\s*|php\s*|p\s*)?\d/i.test(withoutDates);
}

function hasMultipleActionEvidence(message: string): boolean {
  return (
    MULTIPLE_ACTION_EVIDENCE.filter((pattern) => pattern.test(message))
      .length > 1 || (message.match(ACTION_PHRASES)?.length ?? 0) > 1
  );
}

type EntityResolution =
  | {
      kind: 'resolved';
      entities: Omit<SemanticAcceptedCandidate, 'action' | 'amountMinor' | 'effectiveDate'>;
    }
  | {
      kind: 'clarification';
      missingFields: AssistantMissingField[];
    }
  | {
      kind: 'rejected';
      reason: SemanticRejectionReason;
    };

function resolveCandidateEntities(
  action: AssistantAction,
  refs: OnlineEntityRefs,
  envelope: ReturnType<typeof createOnlineRequest>,
  context: AssistantContext,
): EntityResolution {
  if (action === 'expense') {
    const walletAlias = refs.wallet ?? refs.sourceWallet;
    const containerAlias = refs.container ?? refs.sourceContainer;
    const missing: AssistantMissingField[] = [];
    if (!walletAlias) missing.push('sourceWallet');
    if (!containerAlias) missing.push('sourceContainer');
    if (missing.length > 0) {
      return { kind: 'clarification', missingFields: missing };
    }
    const wallet = resolveWallet(walletAlias, envelope, context);
    const container = resolveContainer(containerAlias, envelope, context);
    if (!wallet) return { kind: 'rejected', reason: 'unknown_or_stale_wallet' };
    if (!container) {
      return { kind: 'rejected', reason: 'unknown_or_archived_container' };
    }
    if (container.systemKey) {
      return { kind: 'rejected', reason: 'expense_targets_system_container' };
    }
    return {
      kind: 'resolved',
      entities: { walletId: wallet.id, containerId: container.id },
    };
  }

  if (action === 'income') {
    const walletAlias = refs.wallet ?? refs.destinationWallet;
    const containerAlias = refs.container ?? refs.destinationContainer;
    const missing: AssistantMissingField[] = [];
    if (!walletAlias) missing.push('destinationWallet');
    if (!containerAlias) missing.push('destinationContainer');
    if (missing.length > 0) {
      return { kind: 'clarification', missingFields: missing };
    }
    const wallet = resolveWallet(walletAlias, envelope, context);
    const container = resolveContainer(containerAlias, envelope, context);
    if (!wallet) return { kind: 'rejected', reason: 'unknown_or_stale_wallet' };
    if (!container) {
      return { kind: 'rejected', reason: 'unknown_or_archived_container' };
    }
    if (container.systemKey === 'savings') {
      return { kind: 'rejected', reason: 'income_targets_savings' };
    }
    return {
      kind: 'resolved',
      entities: {
        destinationWalletId: wallet.id,
        destinationContainerId: container.id,
      },
    };
  }

  if (action === 'wallet_transfer') {
    const sourceAlias = refs.sourceWallet;
    const destinationAlias = refs.destinationWallet;
    const missing: AssistantMissingField[] = [];
    if (!sourceAlias) missing.push('sourceWallet');
    if (!destinationAlias) missing.push('destinationWallet');
    if (missing.length > 0) {
      return { kind: 'clarification', missingFields: missing };
    }
    const source = resolveWallet(sourceAlias, envelope, context);
    const destination = resolveWallet(destinationAlias, envelope, context);
    if (!source || !destination) {
      return { kind: 'rejected', reason: 'unknown_or_stale_wallet' };
    }
    if (source.id === destination.id) {
      return { kind: 'rejected', reason: 'wallet_transfer_reuses_wallet' };
    }
    return {
      kind: 'resolved',
      entities: {
        sourceWalletId: source.id,
        destinationWalletId: destination.id,
      },
    };
  }

  const sourceAlias = refs.sourceContainer ?? refs.container;
  const destinationAlias = refs.destinationContainer;
  const missing: AssistantMissingField[] = [];
  if (!sourceAlias) missing.push('sourceContainer');
  if (!destinationAlias) missing.push('destinationContainer');
  if (missing.length > 0) {
    return { kind: 'clarification', missingFields: missing };
  }
  const source = resolveContainer(sourceAlias, envelope, context);
  const destination = resolveContainer(destinationAlias, envelope, context);
  if (!source || !destination) {
    return { kind: 'rejected', reason: 'unknown_or_archived_container' };
  }
  if (source.id === destination.id) {
    return { kind: 'rejected', reason: 'container_transfer_reuses_container' };
  }
  if (
    action === 'savings_contribution' &&
    (source.systemKey === 'savings' || destination.systemKey !== 'savings')
  ) {
    return { kind: 'rejected', reason: 'invalid_savings_contribution_route' };
  }
  if (
    action === 'savings_withdrawal' &&
    (source.systemKey !== 'savings' || destination.systemKey === 'savings')
  ) {
    return { kind: 'rejected', reason: 'invalid_savings_withdrawal_route' };
  }
  if (
    action === 'container_transfer' &&
    (source.systemKey || destination.systemKey)
  ) {
    return { kind: 'rejected', reason: 'ordinary_transfer_targets_system_container' };
  }
  return {
    kind: 'resolved',
    entities: {
      sourceContainerId: source.id,
      destinationContainerId: destination.id,
    },
  };
}

function resolveWallet(
  alias: string | undefined,
  envelope: ReturnType<typeof createOnlineRequest>,
  context: AssistantContext,
) {
  if (!alias) return undefined;
  const id = envelope.walletIdsByAlias.get(alias);
  if (!id) return undefined;
  return context.wallets.find((wallet) => wallet.id === id);
}

function resolveContainer(
  alias: string | undefined,
  envelope: ReturnType<typeof createOnlineRequest>,
  context: AssistantContext,
) {
  if (!alias) return undefined;
  const id = envelope.containerIdsByAlias.get(alias);
  if (!id) return undefined;
  return context.containers.find(
    (container) => container.id === id && container.status === 'active',
  );
}

function resolveCandidateDate(
  dateText: string | undefined,
  message: string,
  context: AssistantContext,
): string {
  const isoDates = message.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  const relativeDates = message.match(/\b(today|ngayon|kanina|yesterday|kahapon)\b/gi) ?? [];
  const withoutIsoDates = message.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
  if (
    isoDates.length + relativeDates.length > 1 ||
    /\b\d{1,4}\/\d{1,2}(?:\/\d{1,4})?\b|\b\d{1,4}\.\d{1,2}\.\d{1,4}\b/.test(withoutIsoDates) ||
    /\b(tomorrow|bukas|next week|last week|last month|next month|last year|next year)\b/i.test(message) ||
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(message)
  ) {
    throw new Error('ambiguous_or_unsupported_date');
  }
  if (dateText !== undefined) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
      if (!message.includes(dateText)) throw new Error('date_not_evidenced');
      return validateDate(dateText, context);
    }
    const lower = dateText.toLowerCase();
    if (lower === 'today' || lower === 'ngayon' || lower === 'kanina') {
      if (!/\b(today|ngayon|kanina)\b/i.test(message)) {
        throw new Error('date_not_evidenced');
      }
      return validateDate(context.todayDateKey, context);
    }
    if (lower === 'yesterday' || lower === 'kahapon') {
      if (!/\b(yesterday|kahapon)\b/i.test(message)) {
        throw new Error('date_not_evidenced');
      }
      return validateDate(shiftDateKey(context.todayDateKey, -1), context);
    }
    throw new Error('unsupported_date');
  }

  const explicitIso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(message)?.[1];
  if (explicitIso) return validateDate(explicitIso, context);
  if (/\b(yesterday|kahapon)\b/i.test(message)) {
    return validateDate(shiftDateKey(context.todayDateKey, -1), context);
  }
  if (/\b(today|ngayon|kanina)\b/i.test(message)) {
    return validateDate(context.todayDateKey, context);
  }
  if (
    /\b(tomorrow|bukas|next week|last week|last month|next month)\b/i.test(
      message,
    ) ||
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(
      message,
    )
  ) {
    throw new Error('unsupported_date');
  }
  return validateDate(context.todayDateKey, context);
}

function validateDate(dateKey: string, context: AssistantContext): string {
  if (!isValidDateKey(dateKey) || dateKey > context.todayDateKey) {
    throw new Error('invalid_or_future_date');
  }
  if (monthKeyForDateKey(dateKey) !== context.activeMonthKey) {
    throw new Error('inactive_month');
  }
  return dateKey;
}

function shiftDateKey(dateKey: string, days: number): string {
  const date = dateKeyToLocalDate(dateKey);
  date.setDate(date.getDate() + days);
  return toLocalDateKey(date);
}

function refusalResult(): AssistantResult {
  return {
    kind: 'refusal',
    intent: 'unknown',
    message: 'The message could not be interpreted.',
    interpretation: {
      intent: 'unknown',
      confidence: 0,
      missingFields: [],
      reasoningSummary: 'No safe interpretation was produced.',
    },
  };
}
