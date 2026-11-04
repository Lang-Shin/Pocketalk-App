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

test('both evaluation strategies initialize with their intended builders and parsers', () => {
  const production = createEvaluationStrategy('production');
  const minimal = createEvaluationStrategy('minimal');

  assert.ok(production.promptBuilder instanceof InstrumentedPromptBuilder);
  assert.ok(production.responseParser instanceof PocketaLocalResponseParser);
  assert.ok(minimal.promptBuilder instanceof InstrumentedPromptBuilder);
  assert.ok(minimal.responseParser instanceof MinimalSchemaResponseParser);
  assert.equal(STRATEGY_LABELS.production, 'Production prompt');
  assert.equal(STRATEGY_LABELS.minimal, 'Minimal schema A');
});

test('strategy selection uses the correct prompt-generation path', () => {
  const production = createEvaluationStrategy('production');
  const minimal = createEvaluationStrategy('minimal');
  const message = 'I spent 50 pesos from Food & drinks.';

  const productionPrompt = production.promptBuilder.interpretationPrompt(
    message,
    LOCAL_AI_EVALUATION_CONTEXT,
  );
  const minimalPrompt = minimal.promptBuilder.interpretationPrompt(
    message,
    LOCAL_AI_EVALUATION_CONTEXT,
  );

  assert.match(productionPrompt, /pocketa-local-prompt-v1/);
  assert.match(productionPrompt, /USER_MESSAGE_JSON/);
  assert.match(minimalPrompt, /pocketa-minimal-v1/);
  assert.match(minimalPrompt, /USER_MESSAGE_JSON/);
  assert.notEqual(productionPrompt, minimalPrompt);
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
});
