import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { AssistantValidationError } from '../src/ai/validation';
import {
  LOCAL_AI_EVALUATION_CASES,
  LOCAL_AI_EVALUATION_CONTEXT,
  evaluateParsedResult,
} from '../src/features/dev/localAiEvaluation';
import {
  MINIMAL_SCHEMA_PROMPT_VERSION,
  MinimalSchemaPromptBuilder,
  MinimalSchemaResponseParser,
} from '../src/features/dev/minimalSchemaStrategy';

const parser = new MinimalSchemaResponseParser();
const builder = new MinimalSchemaPromptBuilder();

test('minimal prompt uses concrete examples without union placeholders', () => {
  const prompt = builder.interpretationPrompt(
    'I spent 50 pesos from Food & drinks.',
    LOCAL_AI_EVALUATION_CONTEXT,
  );

  assert.equal(prompt.includes(MINIMAL_SCHEMA_PROMPT_VERSION), true);
  assert.equal(prompt.includes('proposal|clarification'), false);
  assert.equal(prompt.includes('INTENT'), false);
  assert.equal(prompt.includes('ACTION'), false);
  assert.equal(prompt.includes('TOPIC'), false);
  assert.equal(prompt.includes('"type":"proposal"'), true);
  assert.equal(prompt.includes('"type":"clarification"'), true);
  assert.equal(prompt.includes('"type":"answer"'), true);
  assert.equal(prompt.includes('"type":"refusal"'), true);
  assert.equal(prompt.includes('Output:'), false);
  assert.equal(prompt.includes('Input:'), false);
});

test('minimal examples pair inputs with exact parseable outputs', () => {
  const prompt = builder.interpretationPrompt(
    'I spent 50 pesos from Food & drinks.',
    LOCAL_AI_EVALUATION_CONTEXT,
  );
  const outputs = prompt
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .filter((line) => {
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        return typeof value.type === 'string';
      } catch {
        return false;
      }
    });

  assert.equal(outputs.length, 6);
  for (const output of outputs) {
    assert.doesNotThrow(() =>
      parser.parse(
        { text: output },
        LOCAL_AI_EVALUATION_CONTEXT,
      ),
    );
  }

  for (const input of [
    'I spent 50 pesos on lunch',
    'my mom sent me 2,000 pesos',
    'transfer 100 pesos from Cash to GCash',
    'I spent on lunch',
    'How much is in Savings?',
    'What is the weather tomorrow?',
  ]) {
    assert.equal(prompt.includes(input), true, input);
  }

  const clarificationOutput =
    outputs.find((output) => output?.includes('"type":"clarification"')) ??
    '';
  assert.equal(clarificationOutput.includes('"amountMinor"'), false);
  assert.equal(clarificationOutput.includes('"effectiveDate"'), false);
});

test('minimal parser maps proposal fields into the existing validated domain', () => {
  const parsed = parser.parse(
    {
      text: JSON.stringify({
        type: 'proposal',
        intent: 'expense',
        action: 'expense',
        message: 'Lunch',
        title: 'Lunch',
        amountMinor: 5000,
        effectiveDate: '2026-10-20',
        walletId: 'wallet-gcash',
        fromContainerId: 'container-food',
        confidence: 0.9,
      }),
    },
    LOCAL_AI_EVALUATION_CONTEXT,
  );

  assert.equal(parsed.kind, 'proposal');
  if (parsed.kind !== 'proposal') return;
  assert.match(parsed.proposal.id, /^assistant-minimal-/);
  assert.equal(parsed.proposal.action, 'expense');
  assert.equal(parsed.proposal.amountMinor, 5000);
  assert.equal(parsed.proposal.containerId, 'container-food');
  assert.equal(parsed.proposal.monthKey, '2026-10');
  assert.equal(parsed.interpretation.sourceWallet?.id, 'wallet-gcash');
  assert.equal(parsed.interpretation.sourceContainer?.id, 'container-food');
});

test('minimal parser maps clarification, answer, and refusal outcomes', () => {
  const clarification = parser.parse(
    {
      text: JSON.stringify({
        type: 'clarification',
        intent: 'expense',
        message: 'What amount should I use?',
        missingFields: ['amount'],
        clarificationReason: 'amount',
        fromContainerId: 'container-food',
        confidence: 0.5,
      }),
    },
    LOCAL_AI_EVALUATION_CONTEXT,
  );
  assert.equal(clarification.kind, 'clarification');

  const answer = parser.parse(
    {
      text: JSON.stringify({
        type: 'answer',
        intent: 'balance_inquiry',
        message: 'Savings holds PHP 100.00.',
        topic: 'savings_balance',
        title: 'Savings balance',
        figures: [{ label: 'Savings', amountMinor: 10000 }],
        confidence: 0.9,
      }),
    },
    LOCAL_AI_EVALUATION_CONTEXT,
  );
  assert.equal(answer.kind, 'answer');

  const refusal = parser.parse(
    {
      text: JSON.stringify({
        type: 'refusal',
        intent: 'unknown',
        message: 'I can only interpret Pocketa finance messages.',
        confidence: 0.9,
      }),
    },
    LOCAL_AI_EVALUATION_CONTEXT,
  );
  assert.equal(refusal.kind, 'refusal');
});

test('minimal parser still rejects invalid or unknown entities', () => {
  assert.throws(
    () =>
      parser.parse(
        {
          text: JSON.stringify({
            type: 'proposal',
            intent: 'expense',
            action: 'expense',
            message: 'Lunch',
            title: 'Lunch',
            amountMinor: 5000,
            effectiveDate: '2026-10-20',
            walletId: 'wallet-missing',
            fromContainerId: 'container-food',
            confidence: 0.9,
          }),
        },
        LOCAL_AI_EVALUATION_CONTEXT,
      ),
    AssistantValidationError,
  );

  assert.throws(
    () =>
      parser.parse(
        { text: 'not json' },
        LOCAL_AI_EVALUATION_CONTEXT,
      ),
    AssistantValidationError,
  );

  assert.throws(
    () =>
      parser.parse(
        {
          text: JSON.stringify({
            type: 'clarification',
            intent: 'expense',
            message: 'Which container?',
            missingFields: [],
            clarificationReason: 'container',
            confidence: 0.5,
          }),
        },
        LOCAL_AI_EVALUATION_CONTEXT,
      ),
    AssistantValidationError,
  );
});

test('minimal parser maps every supported proposal action', () => {
  const proposals: Record<string, unknown>[] = [
    {
      type: 'proposal',
      intent: 'expense',
      action: 'expense',
      message: 'Lunch',
      title: 'Lunch',
      amountMinor: 5000,
      effectiveDate: '2026-10-20',
      walletId: 'wallet-gcash',
      fromContainerId: 'container-food',
      confidence: 0.9,
    },
    {
      type: 'proposal',
      intent: 'income',
      action: 'income',
      message: 'Allowance',
      title: 'Allowance',
      amountMinor: 10000,
      effectiveDate: '2026-10-20',
      walletId: 'wallet-gcash',
      toContainerId: 'system-unallocated',
      confidence: 0.9,
    },
    {
      type: 'proposal',
      intent: 'wallet_transfer',
      action: 'wallet_transfer',
      message: 'Move to GCash',
      title: 'Wallet transfer',
      amountMinor: 10000,
      effectiveDate: '2026-10-20',
      fromWalletId: 'wallet-cash',
      toWalletId: 'wallet-gcash',
      confidence: 0.9,
    },
    {
      type: 'proposal',
      intent: 'container_transfer',
      action: 'container_transfer',
      message: 'Move to Transport',
      title: 'Container transfer',
      amountMinor: 15000,
      effectiveDate: '2026-10-20',
      fromContainerId: 'container-food',
      toContainerId: 'container-transport',
      confidence: 0.9,
    },
    {
      type: 'proposal',
      intent: 'container_transfer',
      action: 'savings_contribution',
      message: 'Save for later',
      title: 'Savings contribution',
      amountMinor: 1000,
      effectiveDate: '2026-10-20',
      fromContainerId: 'container-food',
      toContainerId: 'system-savings',
      confidence: 0.9,
    },
    {
      type: 'proposal',
      intent: 'container_transfer',
      action: 'savings_withdrawal',
      message: 'Use savings',
      title: 'Savings withdrawal',
      amountMinor: 1000,
      effectiveDate: '2026-10-20',
      fromContainerId: 'system-savings',
      toContainerId: 'container-food',
      confidence: 0.9,
    },
  ];

  for (const proposal of proposals) {
    const parsed = parser.parse(
      { text: JSON.stringify(proposal) },
      LOCAL_AI_EVALUATION_CONTEXT,
    );
    assert.equal(parsed.kind, 'proposal');
    if (parsed.kind !== 'proposal') continue;
    assert.equal(parsed.proposal.action, proposal.action);
    assert.match(parsed.proposal.id, /^assistant-minimal-/);
  }
});

test('minimal parser rejects missing required fields and invalid financial values', () => {
  const base = {
    type: 'proposal',
    intent: 'expense',
    action: 'expense',
    message: 'Lunch',
    title: 'Lunch',
    amountMinor: 5000,
    effectiveDate: '2026-10-20',
    walletId: 'wallet-gcash',
    fromContainerId: 'container-food',
    confidence: 0.9,
  };

  for (const field of [
    'amountMinor',
    'effectiveDate',
    'walletId',
    'fromContainerId',
    'confidence',
  ]) {
    const missing = structuredClone(base) as Record<string, unknown>;
    delete missing[field];
    assert.throws(
      () =>
        parser.parse(
          { text: JSON.stringify(missing) },
          LOCAL_AI_EVALUATION_CONTEXT,
        ),
      AssistantValidationError,
      field,
    );
  }

  const future = { ...base, effectiveDate: '2026-10-21' };
  assert.throws(
    () =>
      parser.parse(
        { text: JSON.stringify(future) },
        LOCAL_AI_EVALUATION_CONTEXT,
      ),
    AssistantValidationError,
  );

  const invented = { ...base, amountMinor: 999_999 };
  assert.throws(
    () =>
      parser.parse(
        { text: JSON.stringify(invented) },
        LOCAL_AI_EVALUATION_CONTEXT,
      ),
    AssistantValidationError,
  );
});

test('minimal parser rejects unknown proposal intents but allows unknown refusal intent', () => {
  assert.throws(
    () =>
      parser.parse(
        {
          text: JSON.stringify({
            type: 'proposal',
            intent: 'unknown',
            action: 'expense',
            message: 'Lunch',
            title: 'Lunch',
            amountMinor: 5000,
            effectiveDate: '2026-10-20',
            walletId: 'wallet-gcash',
            fromContainerId: 'container-food',
            confidence: 0.9,
          }),
        },
        LOCAL_AI_EVALUATION_CONTEXT,
      ),
    AssistantValidationError,
  );

  const refusal = parser.parse(
    {
      text: JSON.stringify({
        type: 'refusal',
        intent: 'unknown',
        message: 'I can only interpret Pocketa finance messages.',
        confidence: 0.9,
      }),
    },
    LOCAL_AI_EVALUATION_CONTEXT,
  );
  assert.equal(refusal.kind, 'refusal');
});

test('minimal unsupported handling remains a safe non-proposal', () => {
  const testCase = LOCAL_AI_EVALUATION_CASES.find(
    (candidate) => candidate.id === 'unsupported-request',
  );
  assert.ok(testCase);
  const refusal = parser.parse(
    {
      text: JSON.stringify({
        type: 'refusal',
        intent: 'unknown',
        message: 'I can only interpret Pocketa finance messages.',
        confidence: 0.9,
      }),
    },
    LOCAL_AI_EVALUATION_CONTEXT,
  );
  assert.equal(evaluateParsedResult(testCase, refusal).passed, true);
});

test('schema-valid but financially incorrect output fails semantic evaluation', () => {
  const testCase = LOCAL_AI_EVALUATION_CASES.find(
    (candidate) => candidate.id === 'expense',
  );
  assert.ok(testCase);

  const wrongAmount = parser.parse(
    {
      text: JSON.stringify({
        type: 'proposal',
        intent: 'expense',
        action: 'expense',
        message: 'Lunch',
        title: 'Lunch',
        amountMinor: 5001,
        effectiveDate: '2026-10-20',
        walletId: 'wallet-gcash',
        fromContainerId: 'container-food',
        confidence: 0.9,
      }),
    },
    LOCAL_AI_EVALUATION_CONTEXT,
  );
  const amountEvaluation = evaluateParsedResult(testCase, wrongAmount);
  assert.equal(amountEvaluation.checks.schemaValid, true);
  assert.equal(amountEvaluation.checks.semanticFaithful, false);
  assert.equal(amountEvaluation.passed, false);

  const wrongContainer = parser.parse(
    {
      text: JSON.stringify({
        type: 'proposal',
        intent: 'expense',
        action: 'expense',
        message: 'Lunch',
        title: 'Lunch',
        amountMinor: 5000,
        effectiveDate: '2026-10-20',
        walletId: 'wallet-gcash',
        fromContainerId: 'container-transport',
        confidence: 0.9,
      }),
    },
    LOCAL_AI_EVALUATION_CONTEXT,
  );
  const containerEvaluation = evaluateParsedResult(
    testCase,
    wrongContainer,
  );
  assert.equal(containerEvaluation.checks.schemaValid, true);
  assert.equal(containerEvaluation.checks.semanticFaithful, false);
  assert.equal(containerEvaluation.passed, false);
});

test('minimal strategy has no finance execution or confirmation access', () => {
  const source = readFileSync(
    fileURLToPath(
      new URL(
        '../src/features/dev/minimalSchemaStrategy.ts',
        import.meta.url,
      ),
    ),
    'utf8',
  );

  for (const forbidden of [
    /\bFinanceService\b/,
    /\bFinanceSession\b/,
    /\bFinanceEngine\b/,
    /\bFinanceRepository\b/,
    /\bassistantExecution\b/,
    /\bexecuteMoneyEntry\b/,
    /\brecordMoneyEntry\b/,
    /\bcreatePendingConfirmation\b/,
    /expo-sqlite/,
    /sqlite/i,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

test('minimal parser rejects invented fields and intent/action mismatches', () => {
  assert.throws(
    () =>
      parser.parse(
        {
          text: JSON.stringify({
            type: 'proposal',
            intent: 'expense',
            action: 'expense',
            message: 'Lunch',
            title: 'Lunch',
            amountMinor: 5000,
            effectiveDate: '2026-10-20',
            walletId: 'wallet-gcash',
            fromContainerId: 'container-food',
            confidence: 0.9,
            inventedField: 'not allowed',
          }),
        },
        LOCAL_AI_EVALUATION_CONTEXT,
      ),
    /unsupported field inventedField/,
  );

  assert.throws(
    () =>
      parser.parse(
        {
          text: JSON.stringify({
            type: 'proposal',
            intent: 'income',
            action: 'expense',
            message: 'Lunch',
            title: 'Lunch',
            amountMinor: 5000,
            effectiveDate: '2026-10-20',
            walletId: 'wallet-gcash',
            fromContainerId: 'container-food',
            confidence: 0.9,
          }),
        },
        LOCAL_AI_EVALUATION_CONTEXT,
      ),
    /does not match result.action/,
  );
});
