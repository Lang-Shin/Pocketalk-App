import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  LocalModelMetrics,
  LocalModelRuntime,
  LocalModelRuntimeStatus,
} from '../src/ai/runtime';
import type { LocalModelPromptBuilder } from '../src/ai/runtime';
import {
  InstrumentedLocalModelRuntime,
  InstrumentedPromptBuilder,
  instrumentedCaseMetrics,
} from '../src/features/dev/localAiInstrumentation';

test('runtime instrumentation separates load, generation, and unload timing', async () => {
  let now = 0;
  let status: LocalModelRuntimeStatus = 'unloaded';
  let metrics: LocalModelMetrics | null = null;

  const delegate: LocalModelRuntime = {
    status: () => status,
    metrics: () => metrics,
    load: async () => {
      now += 10;
      status = 'ready';
    },
    generate: async () => {
      now += 20;
      status = 'unloaded';
      metrics = {
        timeToFirstTokenMs: 7,
        promptTokens: 100,
        outputTokens: 5,
      };
      return { text: 'raw response' };
    },
    cancel: async () => undefined,
    unload: async () => {
      now += 5;
      status = 'unloaded';
    },
  };

  const runtime = new InstrumentedLocalModelRuntime(delegate, {
    now: () => now,
  });
  await runtime.load();
  const response = await runtime.generate({ prompt: 'test', maxTokens: 5 });
  await runtime.unload();

  assert.equal(response.text, 'raw response');
  assert.equal(runtime.loadMs, 10);
  assert.equal(runtime.generationMs, 20);
  assert.equal(runtime.unloadMs, 5);
  assert.equal(runtime.runtimeStatusAfterGeneration, 'unloaded');
});

test('prompt builder instrumentation records prompt preparation time', () => {
  let now = 0;
  const delegate: LocalModelPromptBuilder = {
    interpretationPrompt: () => {
      now += 3;
      return 'prompt';
    },
    containerChoicePrompt: () => {
      now += 4;
      return 'container';
    },
    walletChoicePrompt: () => {
      now += 5;
      return 'wallet';
    },
  };
  const builder = new InstrumentedPromptBuilder({
    now: () => now,
    delegate,
  });

  assert.equal(builder.interpretationPrompt('message', {} as never), 'prompt');
  assert.equal(builder.promptPreparationMs, 3);
  assert.equal(builder.promptCharacters, 6);

  builder.resetCase();
  assert.equal(builder.promptPreparationMs, null);
  assert.equal(builder.promptCharacters, null);
});

test('metrics capture prompt tokens, output tokens, TTFT, and cap status', async () => {
  let now = 0;
  const metrics: LocalModelMetrics = {
    timeToFirstTokenMs: 12,
    promptTokens: 1_193,
    outputTokens: 512,
    totalMs: 40_000,
  };
  const delegate: LocalModelRuntime = {
    status: () => 'unloaded',
    metrics: () => metrics,
    load: async () => {
      now += 2;
    },
    generate: async () => {
      now += 40;
      return { text: 'out' };
    },
    cancel: async () => undefined,
    unload: async () => {
      now += 1;
    },
  };
  const runtime = new InstrumentedLocalModelRuntime(delegate, {
    now: () => now,
  });
  const builder = new InstrumentedPromptBuilder({
    now: () => now,
    delegate: {
      interpretationPrompt: () => 'p',
      containerChoicePrompt: () => 'c',
      walletChoicePrompt: () => 'w',
    },
  });

  await runtime.load();
  builder.interpretationPrompt('message', {} as never);
  await runtime.generate({ prompt: 'test', maxTokens: 512 });
  const result = instrumentedCaseMetrics(runtime, builder);

  assert.equal(result.loadMs, 2);
  assert.equal(result.generationMs, 40);
  assert.equal(result.promptPreparationMs, 0);
  assert.equal(result.promptCharacters, 1);
  assert.equal(result.timeToFirstTokenMs, 12);
  assert.equal(result.promptTokens, 1_193);
  assert.equal(result.outputTokens, 512);
  assert.equal(result.maxTokens, 512);
  assert.equal(result.outputLimitStatus, 'reached-or-met');
  assert.equal(result.runtimeStatusAfterGeneration, 'unloaded');
  assert.deepEqual(result.generationStats, metrics);

  metrics.outputTokens = 511;
  const belowLimit = instrumentedCaseMetrics(runtime, builder);
  assert.equal(belowLimit.outputLimitStatus, 'not-reached');
  assert.equal(belowLimit.outputTokens, 511);
});

test('output cap status remains unknown without reported output tokens', () => {
  let now = 0;
  const delegate: LocalModelRuntime = {
    status: () => 'unloaded',
    metrics: () => null,
    load: async () => {
      now += 1;
    },
    generate: async () => {
      now += 1;
      return { text: 'out' };
    },
    cancel: async () => undefined,
    unload: async () => undefined,
  };
  const runtime = new InstrumentedLocalModelRuntime(delegate, {
    now: () => now,
  });
  const builder = new InstrumentedPromptBuilder({
    now: () => now,
    delegate: {
      interpretationPrompt: () => 'p',
      containerChoicePrompt: () => 'c',
      walletChoicePrompt: () => 'w',
    },
  });

  return runtime
    .generate({ prompt: 'test', maxTokens: 512 })
    .then(() => {
      const result = instrumentedCaseMetrics(runtime, builder);
      assert.equal(result.outputLimitStatus, 'unknown');
      assert.equal(result.outputTokens, null);
      assert.equal(result.promptTokens, null);
    });
});
