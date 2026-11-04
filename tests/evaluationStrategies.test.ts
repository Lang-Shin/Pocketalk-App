import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { PocketaLocalResponseParser } from '../src/ai/providers/localResponseParser';
import {
  createEvaluationStrategy,
  STRATEGY_LABELS,
} from '../src/features/dev/evaluationStrategies';
import { LOCAL_AI_EVALUATION_CONTEXT } from '../src/features/dev/localAiEvaluation';
import {
  InstrumentedPromptBuilder,
  unloadRuntimeSafely,
} from '../src/features/dev/localAiInstrumentation';
import { MinimalSchemaResponseParser } from '../src/features/dev/minimalSchemaStrategy';
import { FakeLocalModelRuntime } from '../src/ai/runtime';

test('all evaluation strategies initialize with their intended builders and parsers', () => {
  const production = createEvaluationStrategy('production');
  const minimal = createEvaluationStrategy('minimal');
  const minimalB = createEvaluationStrategy('minimal-b');

  assert.ok(production.promptBuilder instanceof InstrumentedPromptBuilder);
  assert.ok(production.responseParser instanceof PocketaLocalResponseParser);
  assert.ok(minimal.promptBuilder instanceof InstrumentedPromptBuilder);
  assert.ok(minimal.responseParser instanceof MinimalSchemaResponseParser);
  assert.ok(minimalB.promptBuilder instanceof InstrumentedPromptBuilder);
  assert.ok(minimalB.responseParser instanceof MinimalSchemaResponseParser);
  assert.equal(STRATEGY_LABELS.production, 'Production prompt');
  assert.equal(STRATEGY_LABELS.minimal, 'Minimal Schema A');
  assert.equal(STRATEGY_LABELS['minimal-b'], 'Minimal Prompt B');
});

test('strategy selection uses the correct prompt-generation path', () => {
  const production = createEvaluationStrategy('production');
  const minimal = createEvaluationStrategy('minimal');
  const minimalB = createEvaluationStrategy('minimal-b');
  const message = 'I spent 50 pesos from Food & drinks.';

  const productionPrompt = production.promptBuilder.interpretationPrompt(
    message,
    LOCAL_AI_EVALUATION_CONTEXT,
  );
  const minimalPrompt = minimal.promptBuilder.interpretationPrompt(
    message,
    LOCAL_AI_EVALUATION_CONTEXT,
  );
  const minimalBPrompt = minimalB.promptBuilder.interpretationPrompt(
    message,
    LOCAL_AI_EVALUATION_CONTEXT,
  );

  assert.match(productionPrompt, /pocketa-local-prompt-v1/);
  assert.match(minimalPrompt, /pocketa-minimal-v1/);
  assert.match(minimalBPrompt, /pocketa-minimal-b-v1/);
  assert.match(productionPrompt, /USER_MESSAGE_JSON/);
  assert.match(minimalPrompt, /USER_MESSAGE_JSON/);
  assert.ok(minimalBPrompt.includes(JSON.stringify(message)));
  assert.notEqual(productionPrompt, minimalPrompt);
  assert.notEqual(minimalPrompt, minimalBPrompt);
  assert.ok(minimalBPrompt.length < minimalPrompt.length);
});

test('experimental prompts state date and income-default rules', () => {
  const message = 'My mom sent me 1,000 pesos.';
  for (const strategy of ['minimal', 'minimal-b'] as const) {
    const prompt = createEvaluationStrategy(
      strategy,
    ).promptBuilder.interpretationPrompt(
      message,
      LOCAL_AI_EVALUATION_CONTEXT,
    );
    assert.match(prompt, /If no date is stated, use todayDateKey/);
    assert.match(
      prompt,
      /Income without a named destination uses system-unallocated/,
    );
    assert.equal(prompt.includes('system-unallocated'), true);
  }
});

test('minimal prompt B uses only compact entity context', () => {
  const minimalB = createEvaluationStrategy('minimal-b');
  const prompt = minimalB.promptBuilder.interpretationPrompt(
    'I spent 50 pesos from Food & drinks.',
    LOCAL_AI_EVALUATION_CONTEXT,
  );

  assert.equal(prompt.includes('wallet-cash = Cash on hand'), true);
  assert.equal(prompt.includes('container-food = Food & drinks'), true);
  assert.equal(prompt.includes('todayDateKey=2026-10-20'), true);
  assert.equal(prompt.includes('activeMonthKey=2026-10'), true);

  for (const forbidden of [
    'balanceMinor',
    'spentMinor',
    'limitMinor',
    'remainingMinor',
    '"wallets":[',
    '"summary":',
    'transaction history',
    'previous transactions',
  ]) {
    assert.equal(prompt.includes(forbidden), false, forbidden);
  }

  assert.equal(prompt.includes('"type":"proposal"'), false);
  assert.equal(prompt.includes('Output:'), false);
  assert.match(prompt, /Outcome types: proposal, clarification, answer, refusal/);
  assert.match(prompt, /Never invent an amount/);
});

test('minimal prompt B reuses the minimal schema adapter and output fields', () => {
  const minimalB = createEvaluationStrategy('minimal-b');
  const prompt = minimalB.promptBuilder.interpretationPrompt(
    'How much is in Savings?',
    LOCAL_AI_EVALUATION_CONTEXT,
  );

  assert.ok(
    minimalB.responseParser instanceof MinimalSchemaResponseParser,
  );
  for (const field of [
    'type',
    'intent',
    'action',
    'message',
    'title',
    'amountMinor',
    'effectiveDate',
    'confidence',
    'missingFields',
    'clarificationReason',
    'topic',
    'figures',
  ]) {
    assert.equal(prompt.includes(field), true, field);
  }

  assert.match(prompt, /Missing fields: amount, effectiveDate/);
  assert.match(prompt, /Answer topics: savings_balance, unallocated_balance/);
});

test('safe runtime cleanup handles missing, successful, and failing runtimes', async () => {
  await assert.doesNotReject(() => unloadRuntimeSafely(null));
  await assert.doesNotReject(() => unloadRuntimeSafely(undefined));

  const successful = new FakeLocalModelRuntime();
  await successful.load();
  await unloadRuntimeSafely(successful);
  assert.equal(successful.unloadCalls, 1);
  assert.equal(successful.status(), 'unloaded');

  const failed = new FakeLocalModelRuntime({
    unloadError: new Error('unload failed'),
  });
  await assert.doesNotReject(() => unloadRuntimeSafely(failed));
  assert.equal(failed.unloadCalls, 1);
});

test('evaluation screen has no stale singular builder or ref references', () => {
  const source = readFileSync(
    fileURLToPath(
      new URL(
        '../src/app/dev/local-ai-eval.tsx',
        import.meta.url,
      ),
    ),
    'utf8',
  );

  assert.doesNotMatch(source, /\bPocketaLocalPromptBuilder\b/);
  assert.doesNotMatch(source, /\bpromptBuilderRef\b/);
  assert.doesNotMatch(source, /\bproviderRef\b/);
  assert.match(source, /promptBuildersRef/);
  assert.match(source, /providersRef/);
  assert.match(source, /createEvaluationStrategy/);
  assert.match(source, /unloadRuntimeSafely/);
  assert.match(source, /strategy: selectedStrategy/);
  assert.match(source, /runs,/);
});
