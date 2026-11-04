import assert from 'node:assert/strict';
import test from 'node:test';

import {
  interpretAssistantMessage,
  type AssistantResult,
} from '../src/ai/localAssistant';
import { PocketaLocalResponseParser } from '../src/ai/providers/localResponseParser';
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
