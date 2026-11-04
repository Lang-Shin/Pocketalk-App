import assert from 'node:assert/strict';
import test from 'node:test';

import { AssistantValidationError } from '../src/ai/validation';
import { LOCAL_AI_EVALUATION_CONTEXT } from '../src/features/dev/localAiEvaluation';
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
});

test('minimal examples pair inputs with exact parseable outputs', () => {
  const prompt = builder.interpretationPrompt(
    'I spent 50 pesos from Food & drinks.',
    LOCAL_AI_EVALUATION_CONTEXT,
  );
  const outputs = [...prompt.matchAll(/^Output: (\{.*\})$/gm)].map(
    (match) => match[1],
  );

  assert.equal(outputs.length, 6);
  for (const output of outputs) {
    assert.doesNotThrow(() =>
      parser.parse(
        { text: output ?? '' },
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
