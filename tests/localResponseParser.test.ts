import assert from 'node:assert/strict';
import test from 'node:test';

import {
  interpretAssistantMessage,
  type AssistantContext,
  type AssistantProposal,
  type AssistantResult,
} from '../src/ai/localAssistant';
import { PocketaLocalResponseParser } from '../src/ai/providers/localResponseParser';
import { AssistantValidationError } from '../src/ai/validation';

function createContext(): AssistantContext {
  return {
    todayDateKey: '2026-10-20',
    activeMonthKey: '2026-10',
    wallets: [
      {
        id: 'wallet-cash',
        name: 'Cash on hand',
        kind: 'cash',
        balanceMinor: 50_000,
      },
      {
        id: 'wallet-gcash',
        name: 'Virtual GCash',
        kind: 'virtual_gcash',
        balanceMinor: 50_000,
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
}

function proposalResult(): AssistantResult {
  return interpretAssistantMessage(
    'I spent ₱50 on lunch from Food & drinks.',
    createContext(),
  );
}

function parse(result: AssistantResult): AssistantResult {
  return new PocketaLocalResponseParser().parse(
    { text: JSON.stringify(result) },
    createContext(),
  );
}

test('parses a valid proposal and replaces the model-provided ID', () => {
  const original = proposalResult();
  assert.equal(original.kind, 'proposal');
  if (original.kind !== 'proposal') return;

  const untrustedId = 'model-provided-id';
  const withUntrustedId = {
    ...original,
    proposal: { ...original.proposal, id: untrustedId },
  };
  const parsed = parse(withUntrustedId);

  assert.equal(parsed.kind, 'proposal');
  if (parsed.kind !== 'proposal') return;
  assert.notEqual(parsed.proposal.id, untrustedId);
  assert.match(parsed.proposal.id, /^assistant-local-/);
  assert.equal(parsed.proposal.amountMinor, 5_000);
  assert.equal(parsed.proposal.containerId, 'container-food');
});

test('generates a fresh ID for each parse of the same model output', () => {
  const original = proposalResult();
  const text = JSON.stringify(original);
  const parser = new PocketaLocalResponseParser();

  const first = parser.parse({ text }, createContext());
  const second = parser.parse({ text }, createContext());

  assert.equal(first.kind, 'proposal');
  assert.equal(second.kind, 'proposal');
  if (first.kind !== 'proposal' || second.kind !== 'proposal') return;
  assert.notEqual(first.proposal.id, second.proposal.id);
});

test('parses clarification, answer, and refusal results', () => {
  const clarification = parse(
    interpretAssistantMessage(
      'I spent on lunch from Food & drinks.',
      createContext(),
    ),
  );
  assert.equal(clarification.kind, 'clarification');

  const answer = parse(
    interpretAssistantMessage('How much is in Savings?', createContext()),
  );
  assert.equal(answer.kind, 'answer');

  const refusal = parse(
    interpretAssistantMessage('Hello there', createContext()),
  );
  assert.equal(refusal.kind, 'refusal');
});

test('rejects malformed JSON and markdown code fences', () => {
  const parser = new PocketaLocalResponseParser();
  const context = createContext();

  assert.throws(
    () => parser.parse({ text: 'not json' }, context),
    AssistantValidationError,
  );
  assert.throws(
    () =>
      parser.parse(
        {
          text: `\`\`\`json\n${JSON.stringify(proposalResult())}\n\`\`\``,
        },
        context,
      ),
    AssistantValidationError,
  );
  assert.throws(
    () => parser.parse({ text: '   ' }, context),
    AssistantValidationError,
  );
});

test('rejects unsupported kinds, intents, and actions', () => {
  const context = createContext();
  const parser = new PocketaLocalResponseParser();

  const badKind = {
    ...proposalResult(),
    kind: 'unsupported',
  };
  assert.throws(
    () => parser.parse({ text: JSON.stringify(badKind) }, context),
    AssistantValidationError,
  );

  const intentResult = proposalResult();
  assert.equal(intentResult.kind, 'proposal');
  if (intentResult.kind !== 'proposal') return;
  const badIntent = structuredClone(intentResult);
  badIntent.intent = 'unsupported' as AssistantResult['intent'];
  badIntent.interpretation.intent =
    'unsupported' as AssistantResult['interpretation']['intent'];
  assert.throws(
    () => parser.parse({ text: JSON.stringify(badIntent) }, context),
    AssistantValidationError,
  );

  const badAction = structuredClone(intentResult);
  badAction.proposal.action = 'unsupported' as AssistantProposal['action'];
  assert.throws(
    () => parser.parse({ text: JSON.stringify(badAction) }, context),
    AssistantValidationError,
  );
});

test('does not repair invalid amounts, dates, or entity references', () => {
  const context = createContext();
  const parser = new PocketaLocalResponseParser();
  const base = proposalResult();
  assert.equal(base.kind, 'proposal');
  if (base.kind !== 'proposal') return;

  const invalidAmount = structuredClone(base);
  invalidAmount.proposal.amountMinor = 1.5;
  assert.throws(
    () => parser.parse({ text: JSON.stringify(invalidAmount) }, context),
    AssistantValidationError,
  );

  const invalidDate = structuredClone(base);
  invalidDate.proposal.effectiveDate = '2026-02-30';
  assert.throws(
    () => parser.parse({ text: JSON.stringify(invalidDate) }, context),
    AssistantValidationError,
  );

  const unknownContainer = structuredClone(base);
  unknownContainer.proposal.containerId = 'container-missing';
  unknownContainer.proposal.containerLabel = 'Missing';
  assert.throws(
    () => parser.parse({ text: JSON.stringify(unknownContainer) }, context),
    AssistantValidationError,
  );
});

test('rejects results missing required proposal information', () => {
  const context = createContext();
  const parser = new PocketaLocalResponseParser();
  const base = proposalResult();
  assert.equal(base.kind, 'proposal');
  if (base.kind !== 'proposal') return;

  const missingAmount = structuredClone(base);
  delete (missingAmount.proposal as Partial<typeof missingAmount.proposal>)
    .amountMinor;
  assert.throws(
    () => parser.parse({ text: JSON.stringify(missingAmount) }, context),
    AssistantValidationError,
  );
});
