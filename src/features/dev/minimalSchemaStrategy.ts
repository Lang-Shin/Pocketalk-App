import type {
  AssistantContext,
  AssistantPendingIntent,
  AssistantResult,
} from '@/ai/localAssistant';
import type {
  LocalModelPromptBuilder,
  LocalModelResponse,
  LocalModelResponseParser,
} from '@/ai/runtime';
import { isValidDateKey, monthKeyForDateKey } from '@/lib/period';
import {
  AssistantValidationError,
  validateAssistantResult,
} from '@/ai/validation';

export const MINIMAL_SCHEMA_PROMPT_VERSION = 'pocketa-minimal-v1';

const INSTRUCTIONS = `Return exactly one JSON object and no markdown.
Use only wallet and container IDs that appear in CONTEXT_JSON.
Never invent amounts, wallets, containers, or IDs.
If no date is stated, use todayDateKey; never invent another date.
Income without a named destination uses system-unallocated.
If required information is missing, return a clarification.
If the request is not a Pocketa finance message, return a refusal.
Do not execute, confirm, or save anything.
Type values: proposal, clarification, answer, refusal.
Proposal action values: expense, income, wallet_transfer, container_transfer, savings_contribution, savings_withdrawal.
Missing-field values: amount, effectiveDate, sourceWallet, destinationWallet, sourceContainer, destinationContainer, transferKind.

Examples. Each example shows a user message followed by the exact JSON object to return. Return only that JSON object, starting with { and ending with }, with no label, prefix, explanation, or markdown.

Expense
User message: "Today I spent 50 pesos on lunch from Food & drinks using GCash."
{"type":"proposal","intent":"expense","action":"expense","message":"Lunch","title":"Lunch","amountMinor":5000,"effectiveDate":"2026-10-20","walletId":"wallet-gcash","fromContainerId":"container-food","confidence":0.9}

Income
User message: "Today my mom sent me 2,000 pesos to GCash for Food & drinks."
{"type":"proposal","intent":"income","action":"income","message":"Money from mom","title":"Money from mom","amountMinor":200000,"effectiveDate":"2026-10-20","walletId":"wallet-gcash","toContainerId":"container-food","confidence":0.9}

Wallet transfer
User message: "Today transfer 100 pesos from Cash to GCash."
{"type":"proposal","intent":"wallet_transfer","action":"wallet_transfer","message":"Move cash to GCash","title":"Wallet transfer","amountMinor":10000,"effectiveDate":"2026-10-20","fromWalletId":"wallet-cash","toWalletId":"wallet-gcash","confidence":0.9}

Clarification
User message: "I spent on lunch from Food & drinks."
{"type":"clarification","intent":"expense","message":"What amount should I use?","missingFields":["amount"],"clarificationReason":"amount","fromContainerId":"container-food","title":"Lunch","confidence":0.5}

Answer
User message: "How much is in Savings?"
{"type":"answer","intent":"balance_inquiry","message":"Savings holds PHP 100.00.","topic":"savings_balance","title":"Savings balance","figures":[{"label":"Savings","amountMinor":10000}],"confidence":0.9}

Unsupported request
User message: "What is the weather tomorrow?"
{"type":"refusal","intent":"unknown","message":"I can only interpret Pocketa finance messages.","confidence":0.9}`;

export class MinimalSchemaPromptBuilder implements LocalModelPromptBuilder {
  interpretationPrompt(text: string, context: AssistantContext): string {
    return [
      `POCKETA MINIMAL SCHEMA (${MINIMAL_SCHEMA_PROMPT_VERSION})`,
      INSTRUCTIONS,
      'CONTEXT_JSON:',
      JSON.stringify(serializeContext(context)),
      'USER_MESSAGE_JSON:',
      JSON.stringify(text),
      'Return the JSON object now.',
    ].join('\n\n');
  }

  containerChoicePrompt(
    containerId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): string {
    return [
      `POCKETA MINIMAL SCHEMA (${MINIMAL_SCHEMA_PROMPT_VERSION})`,
      INSTRUCTIONS,
      'TASK: COMPLETE THE PENDING TRANSFER WITH THE SELECTED CONTAINER.',
      'PENDING_TRANSACTION_JSON:',
      JSON.stringify(pending),
      'SELECTED_CONTAINER_ID_JSON:',
      JSON.stringify(containerId),
      'CONTEXT_JSON:',
      JSON.stringify(serializeContext(context)),
      'Return the JSON object now.',
    ].join('\n\n');
  }

  walletChoicePrompt(
    walletId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): string {
    return [
      `POCKETA MINIMAL SCHEMA (${MINIMAL_SCHEMA_PROMPT_VERSION})`,
      INSTRUCTIONS,
      'TASK: COMPLETE THE PENDING TRANSFER WITH THE SELECTED WALLET.',
      'PENDING_TRANSACTION_JSON:',
      JSON.stringify(pending),
      'SELECTED_WALLET_ID_JSON:',
      JSON.stringify(walletId),
      'CONTEXT_JSON:',
      JSON.stringify(serializeContext(context)),
      'Return the JSON object now.',
    ].join('\n\n');
  }
}

let minimalProposalSequence = 0;

export class MinimalSchemaResponseParser implements LocalModelResponseParser {
  parse(
    response: LocalModelResponse,
    context: AssistantContext,
  ): AssistantResult {
    const raw = parseJsonObject(response.text);
    const candidate = toAssistantResult(raw, context);
    return validateAssistantResult(candidate, context);
  }
}

function toAssistantResult(
  value: unknown,
  context: AssistantContext,
): unknown {
  const record = asRecord(value, 'result');
  const type = asString(record.type, 'result.type');
  const intent = asString(record.intent, 'result.intent');
  const message = asNonEmptyString(record.message, 'result.message');
  const confidence = asConfidence(record.confidence);

  if (type === 'proposal') {
    const action = asString(record.action, 'result.action');
    assertProposalKeys(record, action);
    assertActionIntent(action, intent);
    const title = asNonEmptyString(record.title, 'result.title');
    const amountMinor = asPositiveInteger(
      record.amountMinor,
      'result.amountMinor',
    );
    const effectiveDate = asString(
      record.effectiveDate,
      'result.effectiveDate',
    );
    if (!isValidDateKey(effectiveDate)) {
      throw new AssistantValidationError(
        'result.effectiveDate must be a valid date.',
      );
    }

    const proposal = buildProposal(
      record,
      action,
      title,
      amountMinor,
      effectiveDate,
      context,
    );
    return {
      kind: 'proposal',
      intent,
      message,
      proposal: {
        ...proposal,
        id: nextProposalId(),
        title,
        amountMinor,
        effectiveDate,
        monthKey: monthKeyForDateKey(effectiveDate),
      },
      interpretation: buildInterpretation({
        action,
        record,
        intent,
        amountMinor,
        effectiveDate,
        title,
        message,
        confidence,
        context,
      }),
    };
  }

  if (type === 'clarification') {
    assertOnlyKeys(
      record,
      [
        'type',
        'intent',
        'message',
        'missingFields',
        'clarificationReason',
        'confidence',
        'title',
        'fromContainerId',
      ],
      'clarification',
    );
    const missingFields = asStringArray(
      record.missingFields,
      'result.missingFields',
    );
    const clarificationReason = asString(
      record.clarificationReason,
      'result.clarificationReason',
    );
    if (missingFields.length === 0) {
      throw new AssistantValidationError(
        'A clarification must include missingFields.',
      );
    }
    const title =
      record.title === undefined
        ? undefined
        : asNonEmptyString(record.title, 'result.title');
    const sourceContainer = containerRefOrThrow(
      record.fromContainerId,
      context,
      'result.fromContainerId',
    );
    return {
      kind: 'clarification',
      intent,
      message,
      clarification: {
        reason: clarificationReason,
      },
      interpretation: {
        intent,
        confidence,
        description: title,
        sourceContainer,
        missingFields,
        clarificationQuestion: message,
        reasoningSummary: message,
      },
    };
  }

  if (type === 'answer') {
    assertOnlyKeys(
      record,
      [
        'type',
        'intent',
        'message',
        'topic',
        'title',
        'figures',
        'confidence',
      ],
      'answer',
    );
    const topic = asString(record.topic, 'result.topic');
    const title = asNonEmptyString(record.title, 'result.title');
    const figures = asArray(record.figures, 'result.figures').map(
      (figure, index) => {
        const item = asRecord(figure, `result.figures[${index}]`);
        assertOnlyKeys(
          item,
          ['label', 'amountMinor'],
          `result.figures[${index}]`,
        );
        return {
          label: asNonEmptyString(item.label, 'figure.label'),
          amountMinor: asNonNegativeInteger(
            item.amountMinor,
            'figure.amountMinor',
          ),
        };
      },
    );
    return {
      kind: 'answer',
      intent,
      message,
      answer: { topic, title, figures },
      interpretation: {
        intent,
        confidence,
        missingFields: [],
        reasoningSummary: message,
      },
    };
  }

  if (type === 'refusal') {
    assertOnlyKeys(
      record,
      ['type', 'intent', 'message', 'confidence'],
      'refusal',
    );
    return {
      kind: 'refusal',
      intent,
      message,
      interpretation: {
        intent,
        confidence,
        missingFields: [],
        reasoningSummary: message,
      },
    };
  }

  throw new AssistantValidationError(
    'result.type must be proposal, clarification, answer, or refusal.',
  );
}

function buildProposal(
  record: Record<string, unknown>,
  action: string,
  title: string,
  amountMinor: number,
  effectiveDate: string,
  context: AssistantContext,
): Record<string, unknown> {
  const base = {
    action,
    title,
    amountMinor,
    effectiveDate,
  };

  if (action === 'expense') {
    const walletId = asString(record.walletId, 'result.walletId');
    const containerId = asString(
      record.fromContainerId,
      'result.fromContainerId',
    );
    return {
      ...base,
      walletId,
      walletLabel: walletName(walletId, context),
      containerId,
      containerLabel: containerName(containerId, context),
    };
  }

  if (action === 'income') {
    const walletId = asString(record.walletId, 'result.walletId');
    const destinationContainerId = asString(
      record.toContainerId,
      'result.toContainerId',
    );
    return {
      ...base,
      walletId,
      walletLabel: walletName(walletId, context),
      destinationContainerId,
      destinationContainerLabel: containerName(
        destinationContainerId,
        context,
      ),
    };
  }

  if (action === 'wallet_transfer') {
    const sourceWalletId = asString(
      record.fromWalletId,
      'result.fromWalletId',
    );
    const destinationWalletId = asString(
      record.toWalletId,
      'result.toWalletId',
    );
    return {
      ...base,
      sourceWalletId,
      sourceWalletLabel: walletName(sourceWalletId, context),
      destinationWalletId,
      destinationWalletLabel: walletName(
        destinationWalletId,
        context,
      ),
    };
  }

  if (
    action === 'container_transfer' ||
    action === 'savings_contribution' ||
    action === 'savings_withdrawal'
  ) {
    const containerId = asString(
      record.fromContainerId,
      'result.fromContainerId',
    );
    const destinationContainerId = asString(
      record.toContainerId,
      'result.toContainerId',
    );
    return {
      ...base,
      containerId,
      containerLabel: containerName(containerId, context),
      destinationContainerId,
      destinationContainerLabel: containerName(
        destinationContainerId,
        context,
      ),
    };
  }

  return base;
}

function buildInterpretation(input: {
  action: string;
  record: Record<string, unknown>;
  intent: string;
  amountMinor: number;
  effectiveDate: string;
  title: string;
  message: string;
  confidence: number;
  context: AssistantContext;
}): Record<string, unknown> {
  const base = {
    intent: input.intent,
    amountMinor: input.amountMinor,
    currency: 'PHP' as const,
    effectiveDate: input.effectiveDate,
    description: input.title,
    confidence: input.confidence,
    missingFields: [],
    reasoningSummary: input.message,
  };

  if (input.action === 'expense') {
    return {
      ...base,
      sourceWallet: walletRef(
        input.record.walletId,
        input.context,
      ),
      sourceContainer: containerRef(
        input.record.fromContainerId,
        input.context,
      ),
    };
  }
  if (input.action === 'income') {
    return {
      ...base,
      destinationWallet: walletRef(
        input.record.walletId,
        input.context,
      ),
      destinationContainer: containerRef(
        input.record.toContainerId,
        input.context,
      ),
    };
  }
  if (input.action === 'wallet_transfer') {
    return {
      ...base,
      sourceWallet: walletRef(
        input.record.fromWalletId,
        input.context,
      ),
      destinationWallet: walletRef(
        input.record.toWalletId,
        input.context,
      ),
    };
  }
  return {
    ...base,
    sourceContainer: containerRef(
      input.record.fromContainerId,
      input.context,
    ),
    destinationContainer: containerRef(
      input.record.toContainerId,
      input.context,
    ),
  };
}

function walletRef(
  id: unknown,
  context: AssistantContext,
): { id: string; name: string } | undefined {
  if (typeof id !== 'string') return undefined;
  const wallet = context.wallets.find((candidate) => candidate.id === id);
  return wallet ? { id, name: wallet.name } : undefined;
}

function containerRef(
  id: unknown,
  context: AssistantContext,
): { id: string; name: string } | undefined {
  if (typeof id !== 'string') return undefined;
  const container = context.containers.find(
    (candidate) => candidate.id === id,
  );
  return container ? { id, name: container.name } : undefined;
}

function walletName(
  id: string | undefined,
  context: AssistantContext,
): string | undefined {
  return context.wallets.find((wallet) => wallet.id === id)?.name;
}

function containerName(
  id: string | undefined,
  context: AssistantContext,
): string | undefined {
  return context.containers.find((container) => container.id === id)?.name;
}

function nextProposalId(): string {
  minimalProposalSequence += 1;
  return `assistant-minimal-${Date.now().toString(36)}-${minimalProposalSequence}`;
}

function parseJsonObject(text: string): unknown {
  if (!text.trim()) {
    throw new AssistantValidationError(
      'Minimal-schema response is empty.',
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AssistantValidationError(
      'Minimal-schema response is not valid JSON.',
    );
  }
}

function serializeContext(context: AssistantContext): unknown {
  return {
    todayDateKey: context.todayDateKey,
    activeMonthKey: context.activeMonthKey,
    wallets: context.wallets.map((wallet) => ({
      id: wallet.id,
      name: wallet.name,
    })),
    containers: context.containers.map((container) => ({
      id: container.id,
      name: container.name,
      status: container.status,
      systemKey: container.systemKey ?? null,
      balanceMinor: container.balanceMinor,
      remainingMinor: container.remainingMinor,
    })),
    summary: context.summary,
  };
}

function assertProposalKeys(
  record: Record<string, unknown>,
  action: string,
): void {
  const common = [
    'type',
    'intent',
    'action',
    'message',
    'title',
    'amountMinor',
    'effectiveDate',
    'confidence',
  ];
  const specific =
    action === 'expense'
      ? ['walletId', 'fromContainerId']
      : action === 'income'
        ? ['walletId', 'toContainerId']
        : action === 'wallet_transfer'
          ? ['fromWalletId', 'toWalletId']
          : action === 'container_transfer' ||
              action === 'savings_contribution' ||
              action === 'savings_withdrawal'
            ? ['fromContainerId', 'toContainerId']
            : [];
  assertOnlyKeys(record, [...common, ...specific], 'proposal');
}

function assertActionIntent(action: string, intent: string): void {
  const expected =
    action === 'expense' ||
    action === 'income' ||
    action === 'wallet_transfer'
      ? action
      : action === 'container_transfer' ||
          action === 'savings_contribution' ||
          action === 'savings_withdrawal'
        ? 'container_transfer'
        : null;
  if (!expected) {
    throw new AssistantValidationError(
      'result.action is not a supported proposal action.',
    );
  }
  if (intent !== expected) {
    throw new AssistantValidationError(
      'result.intent does not match result.action.',
    );
  }
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new AssistantValidationError(
        `${label} contains unsupported field ${key}.`,
      );
    }
  }
}

function containerRefOrThrow(
  value: unknown,
  context: AssistantContext,
  label: string,
): { id: string; name: string } | undefined {
  if (value === undefined) return undefined;
  const id = asString(value, label);
  const container = context.containers.find(
    (candidate) => candidate.id === id,
  );
  if (!container) {
    throw new AssistantValidationError(
      `${label} references an unknown container.`,
    );
  }
  return { id, name: container.name };
}

function asRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
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
  const text = asString(value, label);
  if (!text.trim()) {
    throw new AssistantValidationError(`${label} cannot be empty.`);
  }
  return text;
}

function asStringArray(value: unknown, label: string): string[] {
  return asArray(value, label).map((item, index) =>
    asString(item, `${label}[${index}]`),
  );
}

function asConfidence(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new AssistantValidationError(
      'result.confidence must be between 0 and 1.',
    );
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
