import type {
  AssistantAction,
  AssistantContext,
  AssistantIntent,
  AssistantMissingField,
  AssistantQuestionTopic,
} from '../localAssistant';
import { isValidDateKey, isValidMonthKey, monthKeyForDateKey } from '@/lib/period';

export const ONLINE_CONTRACT_VERSION = 'online-intent-v1' as const;
export const ONLINE_REQUEST_MAX_BYTES = 12_000;
export const ONLINE_RESPONSE_MAX_BYTES = 8_000;
export const ONLINE_MAX_MESSAGE_LENGTH = 2_000;
export const ONLINE_MAX_LABEL_LENGTH = 80;
export const ONLINE_MAX_ALIAS_LENGTH = 16;
export const ONLINE_MAX_WALLETS = 20;
export const ONLINE_MAX_CONTAINERS = 50;

export type OnlineWalletKind = 'cash' | 'virtual_gcash';
export type OnlineContainerKind = 'ordinary' | 'savings' | 'unallocated';

export interface OnlineWalletRef {
  ref: string;
  label: string;
  kind: OnlineWalletKind;
}

export interface OnlineContainerRef {
  ref: string;
  label: string;
  kind: OnlineContainerKind;
}

export interface OnlineRequest {
  version: typeof ONLINE_CONTRACT_VERSION;
  message: string;
  todayDateKey: string;
  activeMonthKey: string;
  wallets: OnlineWalletRef[];
  containers: OnlineContainerRef[];
}

export interface OnlineRequestEnvelope {
  request: OnlineRequest;
  walletIdsByAlias: ReadonlyMap<string, string>;
  containerIdsByAlias: ReadonlyMap<string, string>;
  toJSON(): OnlineRequest;
}

export interface OnlineEntityRefs {
  wallet?: string;
  sourceWallet?: string;
  destinationWallet?: string;
  container?: string;
  sourceContainer?: string;
  destinationContainer?: string;
}

export type OnlineClarificationReason =
  | 'missing_amount'
  | 'missing_destination'
  | 'ambiguous_entity'
  | 'invalid_date'
  | 'unsupported_transfer';

export type OnlineRefusalReason =
  | 'unsupported'
  | 'multiple_actions'
  | 'prompt_injection'
  | 'out_of_scope'
  | 'invalid_request';

interface OnlineResponseBase {
  version: typeof ONLINE_CONTRACT_VERSION;
  intent: AssistantIntent;
}

export interface OnlineProposalResponse extends OnlineResponseBase {
  kind: 'proposal';
  action: AssistantAction;
  amountText?: string;
  dateText?: string;
  refs?: OnlineEntityRefs;
  missingFields?: AssistantMissingField[];
}

export interface OnlineClarificationResponse extends OnlineResponseBase {
  kind: 'clarification';
  missingFields: AssistantMissingField[];
  refs?: OnlineEntityRefs;
  reason?: OnlineClarificationReason;
}

export interface OnlineAnswerResponse extends OnlineResponseBase {
  kind: 'answer';
  answerTopic: AssistantQuestionTopic;
  refs?: OnlineEntityRefs;
}

export interface OnlineRefusalResponse extends OnlineResponseBase {
  kind: 'refusal';
  reason: OnlineRefusalReason;
}

export type OnlineResponse =
  | OnlineProposalResponse
  | OnlineClarificationResponse
  | OnlineAnswerResponse
  | OnlineRefusalResponse;

const ACTIONS = new Set<AssistantAction>([
  'expense',
  'income',
  'wallet_transfer',
  'container_transfer',
  'savings_contribution',
  'savings_withdrawal',
]);

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

const RESPONSE_KINDS = new Set([
  'proposal',
  'clarification',
  'answer',
  'refusal',
]);

const RESPONSE_KEYS: Record<string, ReadonlySet<string>> = {
  proposal: new Set([
    'version',
    'kind',
    'intent',
    'action',
    'amountText',
    'dateText',
    'refs',
    'missingFields',
  ]),
  clarification: new Set([
    'version',
    'kind',
    'intent',
    'missingFields',
    'refs',
    'reason',
  ]),
  answer: new Set([
    'version',
    'kind',
    'intent',
    'answerTopic',
    'refs',
  ]),
  refusal: new Set(['version', 'kind', 'intent', 'reason']),
};

const WALLET_KINDS = new Set<OnlineWalletKind>([
  'cash',
  'virtual_gcash',
]);

const CONTAINER_KINDS = new Set<OnlineContainerKind>([
  'ordinary',
  'savings',
  'unallocated',
]);

const CLARIFICATION_REASONS = new Set<OnlineClarificationReason>([
  'missing_amount',
  'missing_destination',
  'ambiguous_entity',
  'invalid_date',
  'unsupported_transfer',
]);

const REFUSAL_REASONS = new Set<OnlineRefusalReason>([
  'unsupported',
  'multiple_actions',
  'prompt_injection',
  'out_of_scope',
  'invalid_request',
]);

export class OnlineContractError extends Error {
  constructor(
    message: string,
    readonly code = 'invalid_contract',
  ) {
    super(message);
    this.name = 'OnlineContractError';
  }
}

export function createOnlineRequest(
  message: string,
  context: AssistantContext,
): OnlineRequestEnvelope {
  const walletIdsByAlias = new Map<string, string>();
  const containerIdsByAlias = new Map<string, string>();
  const wallets: OnlineWalletRef[] = context.wallets.map((wallet, index) => {
    const ref = `w${index + 1}`;
    walletIdsByAlias.set(ref, wallet.id);
    return {
      ref,
      label: wallet.name,
      kind: wallet.kind,
    };
  });
  const containers: OnlineContainerRef[] = context.containers
    .filter((container) => container.status === 'active')
    .map((container, index) => {
      const ref = `c${index + 1}`;
      containerIdsByAlias.set(ref, container.id);
      return {
        ref,
        label: container.name,
        kind: containerKind(container.systemKey),
      };
    });

  const request = validateOnlineRequest({
    version: ONLINE_CONTRACT_VERSION,
    message,
    todayDateKey: context.todayDateKey,
    activeMonthKey: context.activeMonthKey,
    wallets,
    containers,
  });

  return {
    request,
    walletIdsByAlias,
    containerIdsByAlias,
    toJSON: () => request,
  };
}

export function toGatewayRequest(
  envelope: OnlineRequestEnvelope,
): OnlineRequest {
  return validateOnlineRequest(envelope.request);
}

export function serializeOnlineRequest(
  envelope: OnlineRequestEnvelope,
): string {
  return JSON.stringify(toGatewayRequest(envelope));
}

export function validateOnlineRequest(value: unknown): OnlineRequest {
  const record = asRecord(value, 'request');
  assertOnlyKeys(
    record,
    new Set([
      'version',
      'message',
      'todayDateKey',
      'activeMonthKey',
      'wallets',
      'containers',
    ]),
    'request',
  );
  assertPayloadSize(record, ONLINE_REQUEST_MAX_BYTES, 'request');

  const version = asString(record.version, 'request.version');
  if (version !== ONLINE_CONTRACT_VERSION) {
    throw new OnlineContractError('Unsupported request version.');
  }
  const message = asNonEmptyString(record.message, 'request.message');
  if (message.length > ONLINE_MAX_MESSAGE_LENGTH) {
    throw new OnlineContractError('Request message is too long.');
  }
  const todayDateKey = asNonEmptyString(
    record.todayDateKey,
    'request.todayDateKey',
  );
  if (!isValidDateKey(todayDateKey)) {
    throw new OnlineContractError('Request date is invalid.');
  }
  const activeMonthKey = asNonEmptyString(
    record.activeMonthKey,
    'request.activeMonthKey',
  );
  if (!isValidMonthKey(activeMonthKey)) {
    throw new OnlineContractError('Request active month is invalid.');
  }
  if (monthKeyForDateKey(todayDateKey) !== activeMonthKey) {
    throw new OnlineContractError(
      'Request date must belong to the active month.',
    );
  }

  const wallets = asArray(record.wallets, 'request.wallets');
  if (wallets.length > ONLINE_MAX_WALLETS) {
    throw new OnlineContractError('Request has too many wallets.');
  }
  const containers = asArray(record.containers, 'request.containers');
  if (containers.length > ONLINE_MAX_CONTAINERS) {
    throw new OnlineContractError('Request has too many containers.');
  }

  const aliases = new Set<string>();
  const validatedWallets = wallets.map((wallet, index) => {
    const item = asRecord(wallet, `request.wallets[${index}]`);
    assertOnlyKeys(item, new Set(['ref', 'label', 'kind']), 'wallet');
    const ref = validateAlias(item.ref, aliases, `wallet ${index + 1}`);
    const label = validateLabel(item.label, `wallet ${index + 1}`);
    const kind = asString(item.kind, `wallet ${index + 1}.kind`);
    if (!WALLET_KINDS.has(kind as OnlineWalletKind)) {
      throw new OnlineContractError('Unsupported wallet kind.');
    }
    return {
      ref,
      label,
      kind: kind as OnlineWalletKind,
    };
  });
  const validatedContainers = containers.map((container, index) => {
    const item = asRecord(container, `request.containers[${index}]`);
    assertOnlyKeys(item, new Set(['ref', 'label', 'kind']), 'container');
    const ref = validateAlias(
      item.ref,
      aliases,
      `container ${index + 1}`,
    );
    const label = validateLabel(item.label, `container ${index + 1}`);
    const kind = asString(item.kind, `container ${index + 1}.kind`);
    if (!CONTAINER_KINDS.has(kind as OnlineContainerKind)) {
      throw new OnlineContractError('Unsupported container kind.');
    }
    return {
      ref,
      label,
      kind: kind as OnlineContainerKind,
    };
  });

  return {
    version: ONLINE_CONTRACT_VERSION,
    message,
    todayDateKey,
    activeMonthKey,
    wallets: validatedWallets,
    containers: validatedContainers,
  };
}

export function validateOnlineResponse(value: unknown): OnlineResponse {
  const record = asRecord(value, 'response');
  assertPayloadSize(record, ONLINE_RESPONSE_MAX_BYTES, 'response');
  const kind = asString(record.kind, 'response.kind');
  if (!RESPONSE_KINDS.has(kind)) {
    throw new OnlineContractError('Unsupported response kind.');
  }
  assertOnlyKeys(record, RESPONSE_KEYS[kind] ?? new Set(), 'response');

  const version = asString(record.version, 'response.version');
  if (version !== ONLINE_CONTRACT_VERSION) {
    throw new OnlineContractError('Unsupported response version.');
  }
  const intent = asIntent(record.intent, 'response.intent');

  if (kind === 'proposal') {
    const action = asAction(record.action, 'response.action');
    const amountText = optionalText(record.amountText, 'response.amountText');
    const dateText = optionalText(record.dateText, 'response.dateText');
    const refs = optionalRefs(record.refs, 'response.refs');
    const missingFields = optionalMissingFields(
      record.missingFields,
      'response.missingFields',
    );
    return {
      version: ONLINE_CONTRACT_VERSION,
      kind: 'proposal',
      intent,
      action,
      amountText,
      dateText,
      refs,
      missingFields,
    };
  }

  if (kind === 'clarification') {
    const missingFields = requiredMissingFields(
      record.missingFields,
      'response.missingFields',
    );
    const refs = optionalRefs(record.refs, 'response.refs');
    const reason = optionalString(record.reason, 'response.reason');
    if (
      reason !== undefined &&
      !CLARIFICATION_REASONS.has(reason as OnlineClarificationReason)
    ) {
      throw new OnlineContractError('Unsupported clarification reason.');
    }
    return {
      version: ONLINE_CONTRACT_VERSION,
      kind: 'clarification',
      intent,
      missingFields,
      refs,
      reason: reason as OnlineClarificationReason | undefined,
    };
  }

  if (kind === 'answer') {
    const answerTopic = asString(record.answerTopic, 'response.answerTopic');
    if (!QUESTION_TOPICS.has(answerTopic as AssistantQuestionTopic)) {
      throw new OnlineContractError('Unsupported answer topic.');
    }
    const refs = optionalRefs(record.refs, 'response.refs');
    return {
      version: ONLINE_CONTRACT_VERSION,
      kind: 'answer',
      intent,
      answerTopic: answerTopic as AssistantQuestionTopic,
      refs,
    };
  }

  const reason = asString(record.reason, 'response.reason');
  if (!REFUSAL_REASONS.has(reason as OnlineRefusalReason)) {
    throw new OnlineContractError('Unsupported refusal reason.');
  }
  return {
    version: ONLINE_CONTRACT_VERSION,
    kind: 'refusal',
    intent,
    reason: reason as OnlineRefusalReason,
  };
}

export function parseOnlineResponseJson(raw: string): OnlineResponse {
  if (typeof raw !== 'string') {
    throw new OnlineContractError('Response JSON must be a string.');
  }
  if (utf8ByteLength(raw) > ONLINE_RESPONSE_MAX_BYTES) {
    throw new OnlineContractError('Response JSON is too large.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OnlineContractError('Response JSON is malformed.');
  }
  return validateOnlineResponse(parsed);
}

function containerKind(
  systemKey: AssistantContext['containers'][number]['systemKey'],
): OnlineContainerKind {
  if (systemKey === 'savings') return 'savings';
  if (systemKey === 'unallocated') return 'unallocated';
  return 'ordinary';
}

function asIntent(value: unknown, label: string): AssistantIntent {
  const intent = asString(value, label);
  if (!INTENTS.has(intent as AssistantIntent)) {
    throw new OnlineContractError(`${label} is unsupported.`);
  }
  return intent as AssistantIntent;
}

function asAction(value: unknown, label: string): AssistantAction {
  const action = asString(value, label);
  if (!ACTIONS.has(action as AssistantAction)) {
    throw new OnlineContractError(`${label} is unsupported.`);
  }
  return action as AssistantAction;
}

function optionalRefs(
  value: unknown,
  label: string,
): OnlineEntityRefs | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value, label);
  assertOnlyKeys(
    record,
    new Set([
      'wallet',
      'sourceWallet',
      'destinationWallet',
      'container',
      'sourceContainer',
      'destinationContainer',
    ]),
    label,
  );
  const refs: OnlineEntityRefs = {};
  for (const key of [
    'wallet',
    'sourceWallet',
    'destinationWallet',
    'container',
    'sourceContainer',
    'destinationContainer',
  ] as const) {
    const ref = optionalText(record[key], `${label}.${key}`);
    if (ref !== undefined) {
      if (ref.length > ONLINE_MAX_ALIAS_LENGTH) {
        throw new OnlineContractError(`${label}.${key} is too long.`);
      }
      refs[key] = ref;
    }
  }
  return Object.keys(refs).length > 0 ? refs : undefined;
}

function optionalMissingFields(
  value: unknown,
  label: string,
): AssistantMissingField[] | undefined {
  if (value === undefined) return undefined;
  return parseMissingFields(value, label, false);
}

function requiredMissingFields(
  value: unknown,
  label: string,
): AssistantMissingField[] {
  return parseMissingFields(value, label, true);
}

function parseMissingFields(
  value: unknown,
  label: string,
  required: boolean,
): AssistantMissingField[] {
  const array = asArray(value, label);
  if (required && array.length === 0) {
    throw new OnlineContractError(`${label} cannot be empty.`);
  }
  const seen = new Set<AssistantMissingField>();
  return array.map((field, index) => {
    const parsed = asString(field, `${label}[${index}]`);
    if (!MISSING_FIELDS.has(parsed as AssistantMissingField)) {
      throw new OnlineContractError(`${label} contains an unsupported field.`);
    }
    if (seen.has(parsed as AssistantMissingField)) {
      throw new OnlineContractError(`${label} contains duplicate fields.`);
    }
    seen.add(parsed as AssistantMissingField);
    return parsed as AssistantMissingField;
  });
}

function validateAlias(
  value: unknown,
  aliases: Set<string>,
  label: string,
): string {
  const ref = asNonEmptyString(value, `${label}.ref`);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(ref)) {
    throw new OnlineContractError(`${label}.ref is invalid.`);
  }
  if (aliases.has(ref)) {
    throw new OnlineContractError('Request aliases must be unique.');
  }
  aliases.add(ref);
  return ref;
}

function validateLabel(value: unknown, label: string): string {
  const parsed = asNonEmptyString(value, `${label}.label`);
  if (parsed.length > ONLINE_MAX_LABEL_LENGTH) {
    throw new OnlineContractError(`${label}.label is too long.`);
  }
  return parsed;
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const parsed = asNonEmptyString(value, label);
  if (parsed.length > ONLINE_MAX_LABEL_LENGTH) {
    throw new OnlineContractError(`${label} is too long.`);
  }
  return parsed;
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new OnlineContractError(`${label}.${key} is not allowed.`);
    }
  }
}

function assertPayloadSize(
  value: Record<string, unknown>,
  maxBytes: number,
  label: string,
) {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new OnlineContractError(`${label} cannot be serialized.`);
  }
  if (utf8ByteLength(serialized) > maxBytes) {
    throw new OnlineContractError(`${label} payload is too large.`);
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OnlineContractError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new OnlineContractError(`${label} must be an array.`);
  }
  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new OnlineContractError(`${label} must be a string.`);
  }
  return value;
}

function asNonEmptyString(value: unknown, label: string): string {
  const parsed = asString(value, label);
  if (!parsed.trim()) {
    throw new OnlineContractError(`${label} cannot be empty.`);
  }
  return parsed;
}

function optionalString(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  return asString(value, label);
}
