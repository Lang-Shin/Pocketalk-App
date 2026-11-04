import type {
  AssistantAction,
  AssistantContext,
  AssistantIntent,
  AssistantMissingField,
  AssistantQuestionTopic,
  AssistantResult,
} from '@/ai/localAssistant';

export const LOCAL_AI_EVALUATION_CONTEXT: AssistantContext = {
  todayDateKey: '2026-10-20',
  activeMonthKey: '2026-10',
  wallets: [
    {
      id: 'wallet-cash',
      name: 'Cash on hand',
      kind: 'cash',
      balanceMinor: 100_000,
    },
    {
      id: 'wallet-gcash',
      name: 'Virtual GCash',
      kind: 'virtual_gcash',
      balanceMinor: 100_000,
    },
  ],
  containers: [
    {
      id: 'system-unallocated',
      name: 'Unallocated',
      status: 'active',
      systemKey: 'unallocated',
      balanceMinor: 20_000,
      limitMinor: 0,
      spentMinor: 0,
      remainingMinor: 0,
    },
    {
      id: 'system-savings',
      name: 'Savings',
      status: 'active',
      systemKey: 'savings',
      balanceMinor: 10_000,
      limitMinor: 0,
      spentMinor: 0,
      remainingMinor: 0,
    },
    {
      id: 'container-food',
      name: 'Food & drinks',
      status: 'active',
      systemKey: null,
      balanceMinor: 20_000,
      limitMinor: 100_000,
      spentMinor: 80_000,
      remainingMinor: 20_000,
    },
    {
      id: 'container-transport',
      name: 'Transport',
      status: 'active',
      systemKey: null,
      balanceMinor: 10_000,
      limitMinor: 50_000,
      spentMinor: 40_000,
      remainingMinor: 10_000,
    },
  ],
  summary: {
    monthKey: '2026-10',
    incomeMinor: 200_000,
    expenseMinor: 120_000,
    netSavingsMinor: 80_000,
    totalLimitMinor: 150_000,
    totalSpentMinor: 120_000,
    totalRemainingMinor: 30_000,
    savingsContributionsMinor: 30_000,
    savingsWithdrawalsMinor: 0,
    savingsEndingBalanceMinor: 10_000,
    unallocatedEndingBalanceMinor: 20_000,
  },
};

export type EvaluationExpectedKind =
  | 'proposal'
  | 'clarification'
  | 'answer'
  | 'refusal'
  | 'non-proposal'
  | 'parser-rejection';

export interface EvaluationExpectation {
  kind: EvaluationExpectedKind;
  allowedKinds?: readonly AssistantResult['kind'][];
  intent?: AssistantIntent;
  action?: AssistantAction;
  amountMinor?: number;
  effectiveDate?: string;
  walletId?: string;
  sourceWalletId?: string;
  containerId?: string;
  destinationWalletId?: string;
  destinationContainerId?: string;
  missingFields?: readonly AssistantMissingField[];
  topic?: AssistantQuestionTopic;
  answerScope?: 'topic-only' | 'full';
  allowDateClarification?: boolean;
  description: string;
}

export interface EvaluationCase {
  id: string;
  title: string;
  message: string;
  expectation: EvaluationExpectation;
  syntheticRaw?: string;
}

export const LOCAL_AI_EVALUATION_CASES: readonly EvaluationCase[] = [
  {
    id: 'income',
    title: 'Income',
    message: 'My mom sent me 1,000 pesos.',
    expectation: {
      kind: 'proposal',
      intent: 'income',
      action: 'income',
      amountMinor: 100_000,
      effectiveDate: '2026-10-20',
      destinationContainerId: 'system-unallocated',
      allowDateClarification: true,
      description:
        'Income proposal for PHP 1,000 on 2026-10-20 into Unallocated, or clarification for the missing date.',
    },
  },
  {
    id: 'expense',
    title: 'Expense',
    message: 'I spent 50 pesos on lunch from Food & drinks.',
    expectation: {
      kind: 'proposal',
      intent: 'expense',
      action: 'expense',
      amountMinor: 5_000,
      effectiveDate: '2026-10-20',
      containerId: 'container-food',
      allowDateClarification: true,
      description:
        'Expense proposal for PHP 50 from Food & drinks on 2026-10-20, or clarification for the missing date.',
    },
  },
  {
    id: 'wallet-transfer',
    title: 'Wallet transfer',
    message: 'Transfer 100 pesos from Cash to GCash.',
    expectation: {
      kind: 'proposal',
      intent: 'wallet_transfer',
      action: 'wallet_transfer',
      amountMinor: 10_000,
      effectiveDate: '2026-10-20',
      sourceWalletId: 'wallet-cash',
      destinationWalletId: 'wallet-gcash',
      allowDateClarification: true,
      description:
        'Wallet transfer of PHP 100 from Cash to GCash on 2026-10-20, or clarification for the missing date.',
    },
  },
  {
    id: 'container-transfer',
    title: 'Container transfer',
    message: 'Move 150 pesos from Food & drinks to Transport.',
    expectation: {
      kind: 'proposal',
      intent: 'container_transfer',
      action: 'container_transfer',
      amountMinor: 15_000,
      effectiveDate: '2026-10-20',
      containerId: 'container-food',
      destinationContainerId: 'container-transport',
      allowDateClarification: true,
      description:
        'Container transfer of PHP 150 from Food & drinks to Transport on 2026-10-20, or clarification for the missing date.',
    },
  },
  {
    id: 'balance-inquiry',
    title: 'Balance inquiry',
    message: 'How much is in Savings?',
    expectation: {
      kind: 'answer',
      intent: 'balance_inquiry',
      topic: 'savings_balance',
      answerScope: 'topic-only',
      description:
        'Read-only Savings balance answer; topic recognition only, figures are not scored.',
    },
  },
  {
    id: 'spending-summary',
    title: 'Spending summary',
    message: 'How much did I spend this month?',
    expectation: {
      kind: 'answer',
      intent: 'spending_summary',
      topic: 'monthly_spending',
      answerScope: 'topic-only',
      description:
        'Read-only monthly spending summary; topic recognition only, figures are not scored.',
    },
  },
  {
    id: 'budget-inquiry',
    title: 'Budget inquiry',
    message: 'How much budget is left for Food & drinks?',
    expectation: {
      kind: 'answer',
      intent: 'budget_inquiry',
      topic: 'budget_remaining',
      answerScope: 'topic-only',
      description:
        'Read-only remaining budget answer; topic recognition only, figures are not scored.',
    },
  },
  {
    id: 'missing-amount',
    title: 'Missing amount',
    message: 'I spent on lunch from Food & drinks.',
    expectation: {
      kind: 'clarification',
      intent: 'expense',
      missingFields: ['amount'],
      description:
        'Clarification for the missing expense amount; no proposal.',
    },
  },
  {
    id: 'missing-destination',
    title: 'Missing destination',
    message: 'Move 150 pesos from Food & drinks.',
    expectation: {
      kind: 'clarification',
      intent: 'container_transfer',
      missingFields: ['destinationContainer'],
      description:
        'Clarification for the missing transfer destination; no proposal.',
    },
  },
  {
    id: 'ambiguous-date',
    title: 'Ambiguous date',
    message: 'I spent 50 pesos on lunch last week.',
    expectation: {
      kind: 'non-proposal',
      allowedKinds: ['clarification', 'refusal'],
      description:
        'Clarification or refusal for an unsupported relative date; no proposal.',
    },
  },
  {
    id: 'unsupported-request',
    title: 'Unsupported request',
    message: 'What is the weather tomorrow?',
    expectation: {
      kind: 'non-proposal',
      allowedKinds: ['refusal', 'answer'],
      intent: 'unknown',
      description:
        'Unsupported handling with no executable proposal; refusal or help answer is acceptable.',
    },
  },
  {
    id: 'malformed-output',
    title: 'Malformed output',
    message: 'Synthetic malformed model output control.',
    expectation: {
      kind: 'parser-rejection',
      description:
        'The real response parser must reject malformed JSON; no proposal.',
    },
    syntheticRaw: '{"kind":"proposal","intent":"expense"',
  },
];

export interface EvaluationChecks {
  schemaValid: boolean;
  kindCorrect: boolean;
  intentCorrect: boolean | null;
  amountCorrect: boolean | null;
  entitiesCorrect: boolean | null;
  dateCorrect: boolean | null;
  missingFieldsCorrect: boolean | null;
  unsupportedHandled: boolean | null;
  semanticFaithful: boolean;
}

export interface EvaluationOutcome {
  passed: boolean;
  checks: EvaluationChecks;
  summary: string;
}

export function evaluateParsedResult(
  testCase: EvaluationCase,
  result: AssistantResult,
): EvaluationOutcome {
  const expected = testCase.expectation;
  const allowedKinds =
    expected.kind === 'non-proposal'
      ? expected.allowedKinds ?? ['clarification', 'refusal']
      : [expected.kind];
  const dateClarification =
    expected.allowDateClarification === true &&
    result.kind === 'clarification' &&
    result.interpretation.missingFields.includes('effectiveDate');
  const kindCorrect =
    allowedKinds.includes(result.kind) || dateClarification;
  const intentCorrect = expected.intent
    ? result.intent === expected.intent
    : null;
  const noProposal =
    expected.kind === 'proposal' || result.kind !== 'proposal';

  let amountCorrect: boolean | null = null;
  let entitiesCorrect: boolean | null = null;
  let dateCorrect: boolean | null = null;
  let missingFieldsCorrect: boolean | null = null;
  let unsupportedHandled: boolean | null = null;
  let topicCorrect: boolean | null = null;

  if (expected.kind === 'proposal') {
    if (result.kind !== 'proposal') {
      if (!dateClarification) {
        amountCorrect = false;
        entitiesCorrect = false;
        dateCorrect = false;
      }
    } else {
      amountCorrect =
        expected.amountMinor === undefined ||
        result.proposal.amountMinor === expected.amountMinor;
      dateCorrect =
        expected.effectiveDate === undefined ||
        result.proposal.effectiveDate === expected.effectiveDate;
      entitiesCorrect =
        (expected.walletId === undefined ||
          result.proposal.walletId === expected.walletId) &&
        (expected.sourceWalletId === undefined ||
          result.proposal.sourceWalletId === expected.sourceWalletId) &&
        (expected.containerId === undefined ||
          result.proposal.containerId === expected.containerId) &&
        (expected.destinationWalletId === undefined ||
          result.proposal.destinationWalletId ===
            expected.destinationWalletId) &&
        (expected.destinationContainerId === undefined ||
          result.proposal.destinationContainerId ===
            expected.destinationContainerId);
    }
  }

  if (expected.missingFields) {
    missingFieldsCorrect =
      result.kind === 'clarification' &&
      expected.missingFields.every((field) =>
        result.interpretation.missingFields.includes(field),
      );
  }

  if (expected.topic) {
    topicCorrect =
      result.kind === 'answer' && result.answer.topic === expected.topic;
  }

  if (
    expected.kind === 'refusal' ||
    expected.kind === 'non-proposal' ||
    (allowedKinds.includes('refusal') && result.kind === 'refusal')
  ) {
    unsupportedHandled = result.kind !== 'proposal';
  }

  const semanticFaithful =
    noProposal &&
    kindCorrect &&
    (intentCorrect ?? true) &&
    (amountCorrect ?? true) &&
    (entitiesCorrect ?? true) &&
    (dateCorrect ?? true) &&
    (missingFieldsCorrect ?? true) &&
    (topicCorrect ?? true) &&
    (unsupportedHandled ?? true);

  return {
    passed: kindCorrect && semanticFaithful,
    checks: {
      schemaValid: true,
      kindCorrect,
      intentCorrect,
      amountCorrect,
      entitiesCorrect,
      dateCorrect,
      missingFieldsCorrect,
      unsupportedHandled,
      semanticFaithful,
    },
    summary: summarizeResult(result),
  };
}

export function evaluateParserRejection(
  error: unknown,
): EvaluationOutcome {
  return {
    passed: true,
    checks: {
      schemaValid: false,
      kindCorrect: false,
      intentCorrect: null,
      amountCorrect: null,
      entitiesCorrect: null,
      dateCorrect: null,
      missingFieldsCorrect: null,
      unsupportedHandled: true,
      semanticFaithful: false,
    },
    summary: `Parser rejected output: ${
      error instanceof Error ? error.message : String(error)
    }`,
  };
}

export function summarizeResult(result: AssistantResult): string {
  if (result.kind === 'proposal') {
    return `proposal ${result.proposal.action} ${result.proposal.amountMinor} ${result.proposal.effectiveDate}`;
  }
  if (result.kind === 'clarification') {
    return `clarification ${result.clarification.reason} missing=${result.interpretation.missingFields.join(',')}`;
  }
  if (result.kind === 'answer') {
    return `answer ${result.answer.topic}`;
  }
  return `refusal ${result.intent}`;
}
