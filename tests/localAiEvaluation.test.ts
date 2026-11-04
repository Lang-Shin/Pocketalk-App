import assert from 'node:assert/strict';
import test from 'node:test';

import {
  interpretAssistantMessage,
  type AssistantResult,
} from '../src/ai/localAssistant';
import { PocketaLocalResponseParser } from '../src/ai/providers/localResponseParser';
import { MinimalSchemaResponseParser } from '../src/features/dev/minimalSchemaStrategy';
import {
  LOCAL_AI_EVALUATION_CASES,
  LOCAL_AI_EVALUATION_CONTEXT,
  evaluateParserRejection,
  evaluateParsedResult,
} from '../src/features/dev/localAiEvaluation';

function modelCase(id: string) {
  const testCase = LOCAL_AI_EVALUATION_CASES.find(
    (candidate) => candidate.id === id,
  );
  assert.ok(testCase);
  assert.equal(testCase.syntheticRaw, undefined);
  return testCase;
}

test('evaluation cases use a deterministic context and unique ids', () => {
  assert.equal(LOCAL_AI_EVALUATION_CONTEXT.todayDateKey, '2026-10-20');
  assert.equal(LOCAL_AI_EVALUATION_CONTEXT.activeMonthKey, '2026-10');
  assert.equal(
    new Set(LOCAL_AI_EVALUATION_CASES.map((testCase) => testCase.id)).size,
    LOCAL_AI_EVALUATION_CASES.length,
  );
});

test('deterministic fixtures satisfy proposal, clarification, and answer cases', () => {
  for (const id of [
    'income',
    'expense',
    'wallet-transfer',
    'container-transfer',
    'balance-inquiry',
    'spending-summary',
    'budget-inquiry',
    'missing-amount',
    'missing-destination',
    'ambiguous-date',
    'unsupported-request',
  ]) {
    const testCase = modelCase(id);
    const result = interpretAssistantMessage(
      testCase.message,
      LOCAL_AI_EVALUATION_CONTEXT,
    );
    const evaluation = evaluateParsedResult(testCase, result);
    assert.equal(evaluation.passed, true, id);
  }
});

test('original model messages remain unchanged', () => {
  assert.deepEqual(
    LOCAL_AI_EVALUATION_CASES.slice(0, 11).map((testCase) => testCase.message),
    [
      'My mom sent me 1,000 pesos.',
      'I spent 50 pesos on lunch from Food & drinks.',
      'Transfer 100 pesos from Cash to GCash.',
      'Move 150 pesos from Food & drinks to Transport.',
      'How much is in Savings?',
      'How much did I spend this month?',
      'How much budget is left for Food & drinks?',
      'I spent on lunch from Food & drinks.',
      'Move 150 pesos from Food & drinks.',
      'I spent 50 pesos on lunch last week.',
      'What is the weather tomorrow?',
    ],
  );
});

test('missing-date clarification is accepted as a valid alternative', () => {
  const testCase = modelCase('expense');
  const parsed = new MinimalSchemaResponseParser().parse(
    {
      text: JSON.stringify({
        type: 'clarification',
        intent: 'expense',
        message: 'What date should I use?',
        missingFields: ['effectiveDate'],
        clarificationReason: 'setup',
        confidence: 0.5,
      }),
    },
    LOCAL_AI_EVALUATION_CONTEXT,
  );

  const evaluation = evaluateParsedResult(testCase, parsed);
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.checks.schemaValid, true);
  assert.equal(evaluation.checks.semanticFaithful, true);
});

test('read-only answer cases are explicitly topic-only', () => {
  for (const id of [
    'balance-inquiry',
    'spending-summary',
    'budget-inquiry',
  ]) {
    const testCase = modelCase(id);
    assert.equal(testCase.expectation.answerScope, 'topic-only');
  }

  const testCase = modelCase('balance-inquiry');
  const parsed = new MinimalSchemaResponseParser().parse(
    {
      text: JSON.stringify({
        type: 'answer',
        intent: 'balance_inquiry',
        message: 'Savings balance question recognized.',
        topic: 'savings_balance',
        title: 'Savings balance',
        figures: [],
        confidence: 0.5,
      }),
    },
    LOCAL_AI_EVALUATION_CONTEXT,
  );
  const evaluation = evaluateParsedResult(testCase, parsed);
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.checks.semanticFaithful, true);
});

test('valid JSON with wrong semantics fails semantic evaluation', () => {
  const testCase = modelCase('expense');
  const result = interpretAssistantMessage(
    testCase.message,
    LOCAL_AI_EVALUATION_CONTEXT,
  );
  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;

  const wrongAmount = structuredClone(result) as AssistantResult;
  if (wrongAmount.kind !== 'proposal') return;
  wrongAmount.proposal.amountMinor = result.proposal.amountMinor + 1;
  wrongAmount.interpretation.amountMinor = wrongAmount.proposal.amountMinor;

  const amountEvaluation = evaluateParsedResult(testCase, wrongAmount);
  assert.equal(amountEvaluation.checks.schemaValid, true);
  assert.equal(amountEvaluation.checks.amountCorrect, false);
  assert.equal(amountEvaluation.checks.semanticFaithful, false);
  assert.equal(amountEvaluation.passed, false);

  const wrongContainer = structuredClone(result) as AssistantResult;
  if (wrongContainer.kind !== 'proposal') return;
  wrongContainer.proposal.containerId = 'container-transport';
  wrongContainer.proposal.containerLabel = 'Transport';
  wrongContainer.interpretation.sourceContainer = {
    id: 'container-transport',
    name: 'Transport',
  };

  const containerEvaluation = evaluateParsedResult(
    testCase,
    wrongContainer,
  );
  assert.equal(containerEvaluation.checks.schemaValid, true);
  assert.equal(containerEvaluation.checks.entitiesCorrect, false);
  assert.equal(containerEvaluation.passed, false);
});

test('malformed model output is reported as parser rejection', () => {
  const testCase = LOCAL_AI_EVALUATION_CASES.find(
    (candidate) => candidate.id === 'malformed-output',
  );
  assert.ok(testCase);
  assert.ok(testCase.syntheticRaw);
  const parser = new PocketaLocalResponseParser();

  assert.throws(
    () =>
      parser.parse(
        { text: testCase.syntheticRaw ?? '' },
        LOCAL_AI_EVALUATION_CONTEXT,
      ),
    (error: unknown) => {
      const evaluation = evaluateParserRejection(error);
      assert.equal(evaluation.passed, true);
      assert.equal(evaluation.checks.schemaValid, false);
      assert.equal(evaluation.checks.semanticFaithful, false);
      return true;
    },
  );
});
