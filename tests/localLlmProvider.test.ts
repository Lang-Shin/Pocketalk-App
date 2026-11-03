import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  interpretAssistantMessage,
  type AssistantContext,
  type AssistantPendingIntent,
  type AssistantResult,
} from '../src/ai/localAssistant';
import {
  ApproximateCharacterPromptTokenEstimator,
  createLocalAssistantProvider,
  DEFAULT_POLICY_MAX_CONTEXT_TOKENS,
  DEFAULT_POLICY_OUTPUT_TOKEN_ALLOWANCE,
  DEFAULT_MAX_PENDING_REQUESTS,
  DEFAULT_POLICY_PROMPT_SAFETY_MARGIN_TOKENS,
  LocalLlmProvider,
  LocalModelQueueFullError,
  LocalModelUnloadingError,
  PocketaLocalResponseParser,
  PromptBudgetExceededError,
  ValidatedAssistantProvider,
} from '../src/ai/providers';
import {
  FakeLocalModelRuntime,
  LocalModelCancelledError,
  type LocalModelPromptBuilder,
  type LocalModelResponseParser,
} from '../src/ai/runtime';
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
      savingsContributionsMinor: 0,
      savingsWithdrawalsMinor: 0,
      savingsEndingBalanceMinor: 0,
      unallocatedEndingBalanceMinor: 50_000,
    },
  };
}

function validResult(): AssistantResult {
  return interpretAssistantMessage(
    'Spent ₱50 on lunch from Food & drinks',
    createContext(),
  );
}

const promptBuilder: LocalModelPromptBuilder = {
  interpretationPrompt: () => 'interpret prompt',
  containerChoicePrompt: () => 'container prompt',
  walletChoicePrompt: () => 'wallet prompt',
};

const responseParser: LocalModelResponseParser = {
  parse(response) {
    return response.structured as AssistantResult;
  },
};

const info = {
  id: 'test-local-runtime',
  displayName: 'Test local runtime',
  kind: 'local_llm' as const,
  isRealModel: true,
  modelName: 'test-model',
  needsModelDownload: true,
  offline: true,
  description: 'Test-only local provider.',
};

function createProvider(runtime: FakeLocalModelRuntime) {
  return new LocalLlmProvider(runtime, {
    info,
    promptBuilder,
    responseParser,
  });
}

function localDraft(): AssistantResult {
  const draft = structuredClone(validResult());
  assert.equal(draft.kind, 'proposal');
  if (draft.kind !== 'proposal') return draft;
  draft.proposal.id = 'local-draft';
  return draft;
}

test('local provider lazily loads and returns parser output', async () => {
  const runtime = new FakeLocalModelRuntime({
    responses: [{ text: '', structured: validResult() }],
  });
  const provider = createProvider(runtime);

  const result = await provider.interpret('test', createContext());

  assert.equal(result.kind, 'proposal');
  assert.equal(runtime.loadCalls, 1);
  assert.equal(runtime.generateCalls, 1);
  assert.equal(runtime.status(), 'ready');
  assert.ok(runtime.metrics());
});

test('local factory composes prompt builder, fake runtime, parser, and validation', async () => {
  const context = createContext();
  const runtime = new FakeLocalModelRuntime({
    responses: [{ text: JSON.stringify(localDraft()) }],
  });
  const provider = createLocalAssistantProvider(runtime, { info });

  const result = await provider.interpret(
    'Spent 50 pesos on lunch from Food & drinks',
    context,
  );

  assert.equal(provider.info.kind, 'local_llm');
  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.action, 'expense');
  assert.notEqual(result.proposal.id, 'local-draft');
  assert.match(result.proposal.id, /^assistant-local-/);
  assert.equal('moneyEntry' in result, false);
  assert.equal('confirmation' in result, false);
  assert.equal(runtime.loadCalls, 1);
  assert.equal(runtime.generateCalls, 1);
  assert.equal(runtime.status(), 'ready');
  assert.equal(runtime.requests.length, 1);

  const prompt = runtime.requests[0]?.prompt ?? '';
  assert.match(prompt, /CONTEXT_JSON:/);
  assert.match(prompt, /USER_MESSAGE_JSON:/);
  assert.ok(
    prompt.includes(
      JSON.stringify('Spent 50 pesos on lunch from Food & drinks'),
    ),
  );
  assert.equal(runtime.metrics()?.promptTokens, prompt.length);
});

test('local factory validates parser output through the existing boundary', async () => {
  const invalid = structuredClone(validResult());
  assert.equal(invalid.kind, 'proposal');
  if (invalid.kind !== 'proposal') return;
  invalid.proposal.amountMinor = 1;

  const runtime = new FakeLocalModelRuntime({
    responses: [{ text: 'ignored' }],
  });
  const provider = createLocalAssistantProvider(runtime, {
    info,
    responseParser: {
      parse: () => invalid,
    },
  });

  await assert.rejects(
    () =>
      provider.interpret(
        'Spent 50 pesos from Food & drinks',
        createContext(),
      ),
    AssistantValidationError,
  );
});

test('local factory uses concrete builders for both choice paths', async () => {
  const context = createContext();
  const runtime = new FakeLocalModelRuntime({
    responses: [
      { text: JSON.stringify(localDraft()) },
      { text: JSON.stringify(localDraft()) },
    ],
  });
  const provider = createLocalAssistantProvider(runtime, { info });
  const pending: AssistantPendingIntent = {
    action: 'expense',
    amountMinor: 5_000,
    title: 'Lunch',
    effectiveDate: '2026-10-20',
    role: 'source',
  };

  await provider.resolveContainerChoice(
    'container-food',
    pending,
    context,
  );
  await provider.resolveWalletChoice('wallet-cash', pending, context);

  assert.equal(runtime.loadCalls, 1);
  assert.equal(runtime.generateCalls, 2);
  assert.match(
    runtime.requests[0]?.prompt ?? '',
    /TASK: RESOLVE_CONTAINER_CHOICE/,
  );
  assert.match(
    runtime.requests[0]?.prompt ?? '',
    /SELECTED_CONTAINER_ID_JSON:\n"container-food"/,
  );
  assert.match(
    runtime.requests[1]?.prompt ?? '',
    /TASK: RESOLVE_WALLET_CHOICE/,
  );
  assert.match(
    runtime.requests[1]?.prompt ?? '',
    /SELECTED_WALLET_ID_JSON:\n"wallet-cash"/,
  );
});

test('local factory unloads, clears metrics, and reloads lazily', async () => {
  const context = createContext();
  const runtime = new FakeLocalModelRuntime({
    responses: [
      { text: JSON.stringify(localDraft()) },
      { text: JSON.stringify(localDraft()) },
    ],
  });
  const provider = createLocalAssistantProvider(runtime, { info });

  await provider.interpret('Spent 50 pesos from Food & drinks', context);
  assert.equal(runtime.status(), 'ready');
  assert.ok(runtime.metrics());

  await provider.unload();
  assert.equal(runtime.status(), 'unloaded');
  assert.equal(runtime.unloadCalls, 1);
  assert.equal(runtime.metrics(), null);

  await provider.interpret('Spent 50 pesos from Food & drinks', context);
  assert.equal(runtime.status(), 'ready');
  assert.equal(runtime.loadCalls, 2);
  assert.equal(runtime.generateCalls, 2);
});

test('local factory reuses one load across repeated interpretation calls', async () => {
  const runtime = new FakeLocalModelRuntime({
    responses: [
      { text: JSON.stringify(localDraft()) },
      { text: JSON.stringify(localDraft()) },
    ],
  });
  const provider = createLocalAssistantProvider(runtime, { info });

  const first = await provider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );
  const second = await provider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );

  assert.equal(first.kind, 'proposal');
  assert.equal(second.kind, 'proposal');
  if (first.kind !== 'proposal' || second.kind !== 'proposal') return;
  assert.notEqual(first.proposal.id, second.proposal.id);
  assert.equal(runtime.loadCalls, 1);
  assert.equal(runtime.generateCalls, 2);
  assert.equal(runtime.requests.length, 2);
  assert.equal(runtime.status(), 'ready');
});

test('concurrent interpretations share one lazy load and run serially', async () => {
  const runtime = new FakeLocalModelRuntime({
    holdLoad: true,
    responses: [
      { text: JSON.stringify(localDraft()) },
      { text: JSON.stringify(localDraft()) },
    ],
  });
  const provider = createLocalAssistantProvider(runtime, { info });

  const first = provider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );
  const second = provider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(runtime.status(), 'loading');
  assert.equal(runtime.loadCalls, 1);
  assert.equal(runtime.generateCalls, 0);

  runtime.releaseLoad();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.kind, 'proposal');
  assert.equal(secondResult.kind, 'proposal');
  if (firstResult.kind !== 'proposal' || secondResult.kind !== 'proposal') {
    return;
  }
  assert.notEqual(firstResult.proposal.id, secondResult.proposal.id);
  assert.equal(runtime.loadCalls, 1);
  assert.equal(runtime.generateCalls, 2);
});

test('requests during active generation wait for the active request', async () => {
  const runtime = new FakeLocalModelRuntime({ holdGeneration: true });
  const provider = createLocalAssistantProvider(runtime, { info });

  const first = provider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.generateCalls, 1);

  const second = provider.interpret(
    'Spent 75 pesos from Food & drinks',
    createContext(),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.generateCalls, 1);
  assert.equal(runtime.status(), 'generating');
  assert.ok(
    runtime.requests[0]?.prompt.includes(
      JSON.stringify('Spent 50 pesos from Food & drinks'),
    ),
  );

  runtime.releaseGeneration({ text: JSON.stringify(localDraft()) });
  const firstResult = await first;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.generateCalls, 2);
  assert.ok(
    runtime.requests[1]?.prompt.includes(
      JSON.stringify('Spent 75 pesos from Food & drinks'),
    ),
  );

  runtime.releaseGeneration({ text: JSON.stringify(localDraft()) });
  const secondResult = await second;

  assert.equal(firstResult.kind, 'proposal');
  assert.equal(secondResult.kind, 'proposal');
  assert.equal(runtime.loadCalls, 1);
});

test('unload during generation cancels active work and rejects queued work', async () => {
  const runtime = new FakeLocalModelRuntime({ holdGeneration: true });
  const provider = createLocalAssistantProvider(runtime, { info });

  const first = provider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = provider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  const unloading = provider.unload();
  const firstRejection = assert.rejects(first, LocalModelCancelledError);
  const secondRejection = assert.rejects(
    second,
    LocalModelUnloadingError,
  );

  await unloading;
  await Promise.all([firstRejection, secondRejection]);

  assert.equal(runtime.cancelCalls, 1);
  assert.equal(runtime.unloadCalls, 1);
  assert.equal(runtime.generateCalls, 1);
  assert.equal(runtime.status(), 'unloaded');
});

test('unload waits for cancellation confirmation and generation settlement', async () => {
  const runtime = new FakeLocalModelRuntime({
    holdGeneration: true,
    holdCancellation: true,
  });
  const provider = createLocalAssistantProvider(runtime, { info });

  const interpretation = provider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.status(), 'generating');

  let unloadSettled = false;
  const unloading = provider.unload().finally(() => {
    unloadSettled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(runtime.cancelCalls, 1);
  assert.equal(unloadSettled, false);

  runtime.releaseCancellation();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(unloadSettled, false);
  assert.equal(runtime.status(), 'generating');

  runtime.releaseGeneration({ text: JSON.stringify(localDraft()) });
  const rejection = assert.rejects(
    interpretation,
    LocalModelUnloadingError,
  );
  await unloading;
  await rejection;

  assert.equal(unloadSettled, true);
  assert.equal(runtime.unloadCalls, 1);
  assert.equal(runtime.status(), 'unloaded');
});

test('unload still cleans up when generation fails after cancellation', async () => {
  const generationError = new Error('generation failed during unload');
  const runtime = new FakeLocalModelRuntime({
    holdGeneration: true,
    holdCancellation: true,
  });
  const provider = createLocalAssistantProvider(runtime, { info });

  const interpretation = provider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  const unloading = provider.unload();
  await new Promise((resolve) => setTimeout(resolve, 0));
  runtime.releaseCancellation();
  runtime.rejectGeneration(generationError);

  const rejection = assert.rejects(interpretation, generationError);
  await unloading;
  await rejection;

  assert.equal(runtime.unloadCalls, 1);
  assert.equal(runtime.status(), 'unloaded');
});

test('cancellation failure rejects unload and remains recoverable', async () => {
  const cancelError = new Error('cancel confirmation failed');
  const runtime = new FakeLocalModelRuntime({
    holdGeneration: true,
    cancelErrorOnce: cancelError,
  });
  const provider = createLocalAssistantProvider(runtime, { info });

  const interpretation = provider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  const rejection = assert.rejects(
    interpretation,
    LocalModelCancelledError,
  );
  await assert.rejects(() => provider.unload(), cancelError);
  await rejection;
  assert.equal(runtime.status(), 'unloaded');

  const recovered = provider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.generateCalls, 2);
  runtime.releaseGeneration({ text: JSON.stringify(localDraft()) });
  const result = await recovered;

  assert.equal(result.kind, 'proposal');
  assert.equal(runtime.status(), 'ready');
});

test('unload during loading prevents generation and settles as unloaded', async () => {
  const runtime = new FakeLocalModelRuntime({ holdLoad: true });
  const provider = createLocalAssistantProvider(runtime, { info });

  const interpretation = provider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.status(), 'loading');

  let unloadSettled = false;
  const unloading = provider.unload().finally(() => {
    unloadSettled = true;
  });
  const rejection = assert.rejects(interpretation, LocalModelUnloadingError);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(runtime.unloadCalls, 0);
  assert.equal(runtime.status(), 'loading');
  assert.equal(unloadSettled, false);

  runtime.releaseLoad();
  await unloading;
  await rejection;

  assert.equal(runtime.generateCalls, 0);
  assert.equal(runtime.unloadCalls, 1);
  assert.equal(unloadSettled, true);
  assert.equal(runtime.status(), 'unloaded');
});

test('repeated load and unload calls are deterministic', async () => {
  const runtime = new FakeLocalModelRuntime();
  const provider = createLocalAssistantProvider(runtime, { info });

  await Promise.all([provider.load(), provider.load()]);
  assert.equal(runtime.loadCalls, 1);
  assert.equal(runtime.status(), 'ready');

  const firstUnload = provider.unload();
  const secondUnload = provider.unload();
  assert.equal(firstUnload, secondUnload);
  await firstUnload;

  assert.equal(runtime.unloadCalls, 1);
  assert.equal(runtime.status(), 'unloaded');

  await provider.load();
  assert.equal(runtime.loadCalls, 2);
  assert.equal(runtime.status(), 'ready');
});

test('repeated completed unloads remain safe', async () => {
  const runtime = new FakeLocalModelRuntime();
  const provider = createLocalAssistantProvider(runtime, { info });

  await provider.load();
  await provider.unload();
  await provider.unload();

  assert.equal(runtime.unloadCalls, 2);
  assert.equal(runtime.metrics(), null);
  assert.equal(runtime.status(), 'unloaded');
  assert.equal(provider.info.kind, 'local_llm');
});

test('load requested after unload starts runs after cleanup', async () => {
  const runtime = new FakeLocalModelRuntime();
  const provider = createLocalAssistantProvider(runtime, { info });

  await provider.load();
  const unloading = provider.unload();
  const reloading = provider.load();

  await Promise.all([unloading, reloading]);

  assert.equal(runtime.unloadCalls, 1);
  assert.equal(runtime.loadCalls, 2);
  assert.equal(runtime.status(), 'ready');
});

test('load failure leaves the provider recoverable', async () => {
  const loadError = new Error('transient load failure');
  const runtime = new FakeLocalModelRuntime({
    loadErrorOnce: loadError,
    responses: [{ text: JSON.stringify(localDraft()) }],
  });
  const provider = createLocalAssistantProvider(runtime, { info });

  await assert.rejects(
    () =>
      provider.interpret(
        'Spent 50 pesos from Food & drinks',
        createContext(),
      ),
    loadError,
  );
  assert.equal(runtime.status(), 'error');

  const result = await provider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  assert.equal(runtime.loadCalls, 2);
  assert.equal(runtime.status(), 'ready');
});

test('unload failure leaves the provider recoverable', async () => {
  const unloadError = new Error('transient unload failure');
  const runtime = new FakeLocalModelRuntime({ unloadErrorOnce: unloadError });
  const provider = createLocalAssistantProvider(runtime, { info });

  await provider.load();
  await assert.rejects(() => provider.unload(), unloadError);
  assert.equal(runtime.status(), 'error');

  await provider.load();
  assert.equal(runtime.status(), 'ready');
  assert.equal(runtime.loadCalls, 2);
});

test('pending requests are bounded by the configured queue depth', async () => {
  const runtime = new FakeLocalModelRuntime({ holdGeneration: true });
  const provider = createLocalAssistantProvider(runtime, {
    info,
    maxPendingRequests: 1,
  });
  assert.equal(DEFAULT_MAX_PENDING_REQUESTS, 16);

  const first = provider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  await assert.rejects(
    () =>
      provider.interpret(
        'Spent 50 pesos from Food & drinks',
        createContext(),
      ),
    (error: unknown) => {
      assert.ok(error instanceof LocalModelQueueFullError);
      assert.equal(error.maxPendingRequests, 1);
      return true;
    },
  );

  const firstRejection = assert.rejects(
    first,
    LocalModelCancelledError,
  );
  await runtime.cancel();
  await firstRejection;
  await provider.unload();

  assert.equal(runtime.generateCalls, 1);
  assert.equal(runtime.status(), 'unloaded');
});

test('local factory unload during generation rejects and clears runtime state', async () => {
  const runtime = new FakeLocalModelRuntime({ holdGeneration: true });
  const provider = createLocalAssistantProvider(runtime, { info });

  const generation = provider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.status(), 'generating');

  const cancelled = assert.rejects(generation, LocalModelCancelledError);
  await provider.unload();
  await cancelled;

  assert.equal(runtime.unloadCalls, 1);
  assert.equal(runtime.status(), 'unloaded');
  assert.equal(runtime.metrics(), null);
});

test('local factory propagates cancellation and can unload afterward', async () => {
  const runtime = new FakeLocalModelRuntime({ holdGeneration: true });
  const provider = createLocalAssistantProvider(runtime, { info });

  const generation = provider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.status(), 'generating');

  await runtime.cancel();
  await assert.rejects(generation, LocalModelCancelledError);
  assert.equal(runtime.cancelCalls, 1);

  await provider.unload();
  assert.equal(runtime.status(), 'unloaded');
  assert.equal(runtime.unloadCalls, 1);
});

test('local factory propagates load, generation, and parser errors', async () => {
  const loadError = new Error('factory load failed');
  const loadRuntime = new FakeLocalModelRuntime({ loadError });
  await assert.rejects(
    () =>
      createLocalAssistantProvider(loadRuntime, { info }).interpret(
        'Spent 50 pesos from Food & drinks',
        createContext(),
      ),
    loadError,
  );

  const generationError = new Error('factory generation failed');
  const generationRuntime = new FakeLocalModelRuntime({
    responses: [generationError],
  });
  await assert.rejects(
    () =>
      createLocalAssistantProvider(generationRuntime, { info }).interpret(
        'Spent 50 pesos from Food & drinks',
        createContext(),
      ),
    generationError,
  );

  const parserRuntime = new FakeLocalModelRuntime({
    responses: [{ text: '{"kind":"proposal"}' }],
  });
  await assert.rejects(
    () =>
      createLocalAssistantProvider(parserRuntime, { info }).interpret(
        'Spent 50 pesos from Food & drinks',
        createContext(),
      ),
    AssistantValidationError,
  );
});

test('local factory keeps using the local runtime after parser or runtime failures', async () => {
  const parserRuntime = new FakeLocalModelRuntime({
    responses: [
      { text: '{"kind":"proposal"}' },
      { text: JSON.stringify(localDraft()) },
    ],
  });
  const parserProvider = createLocalAssistantProvider(parserRuntime, { info });

  await assert.rejects(
    () =>
      parserProvider.interpret(
        'Spent 50 pesos from Food & drinks',
        createContext(),
      ),
    AssistantValidationError,
  );
  assert.equal(parserProvider.info.kind, 'local_llm');

  const afterParserFailure = await parserProvider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );
  assert.equal(afterParserFailure.kind, 'proposal');
  assert.equal(parserRuntime.loadCalls, 1);
  assert.equal(parserRuntime.generateCalls, 2);
  assert.equal(parserRuntime.requests.length, 2);

  const runtimeError = new Error('local generation failed');
  const runtimeFailure = new FakeLocalModelRuntime({
    responses: [
      runtimeError,
      { text: JSON.stringify(localDraft()) },
    ],
  });
  const runtimeProvider = createLocalAssistantProvider(runtimeFailure, {
    info,
  });

  await assert.rejects(
    () =>
      runtimeProvider.interpret(
        'Spent 50 pesos from Food & drinks',
        createContext(),
      ),
    runtimeError,
  );
  assert.equal(runtimeProvider.info.kind, 'local_llm');

  const afterRuntimeFailure = await runtimeProvider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );
  assert.equal(afterRuntimeFailure.kind, 'proposal');
  assert.equal(runtimeFailure.loadCalls, 1);
  assert.equal(runtimeFailure.generateCalls, 2);
  assert.equal(runtimeFailure.requests.length, 2);
});

test('local provider delegates lifecycle operations', async () => {
  const runtime = new FakeLocalModelRuntime();
  const provider = createProvider(runtime);

  await provider.load();
  assert.equal(runtime.status(), 'ready');
  assert.equal(runtime.loadCalls, 1);

  await provider.unload();
  assert.equal(runtime.status(), 'unloaded');
  assert.equal(runtime.unloadCalls, 1);
});

test('local provider propagates load and generation errors', async () => {
  const loadError = new Error('model load failed');
  const failedLoad = new FakeLocalModelRuntime({ loadError });
  await assert.rejects(
    () => createProvider(failedLoad).interpret('test', createContext()),
    loadError,
  );

  const generationError = new Error('generation failed');
  const failedGeneration = new FakeLocalModelRuntime({
    responses: [generationError],
  });
  await assert.rejects(
    () =>
      createProvider(failedGeneration).interpret('test', createContext()),
    generationError,
  );
});

test('local provider supports cancellation through the runtime', async () => {
  const runtime = new FakeLocalModelRuntime({ holdGeneration: true });
  const provider = createProvider(runtime);

  const generation = provider.interpret('test', createContext());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.status(), 'generating');

  await runtime.cancel();
  await assert.rejects(generation, LocalModelCancelledError);
  assert.equal(runtime.cancelCalls, 1);
});

test('local provider uses prompt builders for clarification choices', async () => {
  const pending: AssistantPendingIntent = {
    action: 'expense',
    amountMinor: 5_000,
    title: 'Lunch',
    effectiveDate: '2026-10-20',
    role: 'source',
  };
  const runtime = new FakeLocalModelRuntime({
    responses: [
      { text: '', structured: validResult() },
      { text: '', structured: validResult() },
    ],
  });
  const provider = createProvider(runtime);

  await provider.resolveContainerChoice('container-food', pending, createContext());
  await provider.resolveWalletChoice('wallet-cash', pending, createContext());

  assert.equal(runtime.generateCalls, 2);
});

test('local provider output still passes through deterministic validation', async () => {
  const invalid = structuredClone(validResult());
  assert.equal(invalid.kind, 'proposal');
  if (invalid.kind !== 'proposal') return;
  invalid.proposal.amountMinor = 1;

  const runtime = new FakeLocalModelRuntime({
    responses: [{ text: '', structured: invalid }],
  });
  const validated = new ValidatedAssistantProvider(
    createProvider(runtime),
  );

  await assert.rejects(
    () => validated.interpret('test', createContext()),
    AssistantValidationError,
  );
});

test('malformed local-model output cannot become a proposal or clarification', async () => {
  const runtime = new FakeLocalModelRuntime({
    responses: [{ text: '```json\n{"kind":"proposal"}\n```' }],
  });
  const provider = new LocalLlmProvider(runtime, {
    info,
    promptBuilder,
    responseParser: new PocketaLocalResponseParser(),
  });

  await assert.rejects(
    () => provider.interpret('test', createContext()),
    AssistantValidationError,
  );
  assert.equal(runtime.loadCalls, 1);
  assert.equal(runtime.generateCalls, 1);
});

test('prompt budget preserves the prompt and reserves output tokens', async () => {
  const assembledPrompt = `PROMPT_START${'x'.repeat(400)}PROMPT_END`;
  const seenPrompts: string[] = [];
  const runtime = new FakeLocalModelRuntime({
    responses: [{ text: JSON.stringify(localDraft()) }],
  });
  const provider = createLocalAssistantProvider(runtime, {
    info,
    promptBuilder: {
      interpretationPrompt: () => assembledPrompt,
      containerChoicePrompt: () => assembledPrompt,
      walletChoicePrompt: () => assembledPrompt,
    },
    promptTokenEstimator: {
      estimate(prompt) {
        seenPrompts.push(prompt);
        return 150;
      },
    },
    maxContextTokens: 300,
    outputTokenAllowance: 120,
    promptSafetyMarginTokens: 20,
  });

  const result = await provider.interpret(
    'Spent 50 pesos from Food & drinks',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  assert.deepEqual(seenPrompts, [assembledPrompt]);
  assert.equal(runtime.requests[0]?.prompt, assembledPrompt);
  assert.equal(runtime.requests[0]?.maxTokens, 120);
  assert.match(assembledPrompt, /^PROMPT_START/);
  assert.match(assembledPrompt, /PROMPT_END$/);
});

test('all prompt paths preserve full prompts and receive the output allowance', async () => {
  const prompts = {
    interpretation: 'INTERPRET_FULL_PROMPT',
    container: 'CONTAINER_FULL_PROMPT',
    wallet: 'WALLET_FULL_PROMPT',
  };
  const seenPrompts: string[] = [];
  const runtime = new FakeLocalModelRuntime({
    responses: [
      { text: JSON.stringify(localDraft()) },
      { text: JSON.stringify(localDraft()) },
      { text: JSON.stringify(localDraft()) },
    ],
  });
  const provider = createLocalAssistantProvider(runtime, {
    info,
    promptBuilder: {
      interpretationPrompt: () => prompts.interpretation,
      containerChoicePrompt: () => prompts.container,
      walletChoicePrompt: () => prompts.wallet,
    },
    promptTokenEstimator: {
      estimate(prompt) {
        seenPrompts.push(prompt);
        return 150;
      },
    },
    maxContextTokens: 300,
    outputTokenAllowance: 120,
    promptSafetyMarginTokens: 20,
  });
  const pending: AssistantPendingIntent = {
    action: 'expense',
    amountMinor: 5_000,
    title: 'Lunch',
    effectiveDate: '2026-10-20',
    role: 'source',
  };

  await provider.interpret('Spent 50 pesos', createContext());
  await provider.resolveContainerChoice(
    'container-food',
    pending,
    createContext(),
  );
  await provider.resolveWalletChoice('wallet-cash', pending, createContext());

  assert.deepEqual(seenPrompts, [
    prompts.interpretation,
    prompts.container,
    prompts.wallet,
  ]);
  assert.deepEqual(
    runtime.requests.map((request) => request.prompt),
    [prompts.interpretation, prompts.container, prompts.wallet],
  );
  assert.deepEqual(
    runtime.requests.map((request) => request.maxTokens),
    [120, 120, 120],
  );
  assert.equal(runtime.loadCalls, 1);
});

test('output allowance rejects an otherwise fitting prompt before loading', async () => {
  const runtime = new FakeLocalModelRuntime({
    responses: [{ text: JSON.stringify(localDraft()) }],
  });
  const provider = createLocalAssistantProvider(runtime, {
    info,
    promptTokenEstimator: {
      estimate: () => 150,
    },
    maxContextTokens: 300,
    outputTokenAllowance: 180,
    promptSafetyMarginTokens: 20,
  });

  await assert.rejects(
    () =>
      provider.interpret(
        'Spent 50 pesos from Food & drinks',
        createContext(),
      ),
    (error: unknown) => {
      assert.ok(error instanceof PromptBudgetExceededError);
      assert.equal(error.estimatedPromptTokens, 150);
      assert.equal(error.maxPromptTokens, 100);
      assert.equal(error.maxContextTokens, 300);
      assert.equal(error.outputTokenAllowance, 180);
      assert.equal(error.safetyMarginTokens, 20);
      return true;
    },
  );
  assert.equal(runtime.loadCalls, 0);
  assert.equal(runtime.generateCalls, 0);
  assert.equal(runtime.requests.length, 0);
});

test('prompt budget rejects over-budget prompts before loading for all paths', async () => {
  const runtime = new FakeLocalModelRuntime({
    responses: [{ text: JSON.stringify(localDraft()) }],
  });
  const estimatorCalls: string[] = [];
  const provider = createLocalAssistantProvider(runtime, {
    info,
    promptTokenEstimator: {
      estimate(prompt) {
        estimatorCalls.push(prompt);
        return 131;
      },
    },
    maxContextTokens: 200,
    outputTokenAllowance: 50,
    promptSafetyMarginTokens: 20,
  });
  const pending: AssistantPendingIntent = {
    action: 'expense',
    amountMinor: 5_000,
    title: 'Lunch',
    effectiveDate: '2026-10-20',
    role: 'source',
  };

  for (const operation of [
    () => provider.interpret('Spent 50 pesos', createContext()),
    () =>
      provider.resolveContainerChoice(
        'container-food',
        pending,
        createContext(),
      ),
    () =>
      provider.resolveWalletChoice(
        'wallet-cash',
        pending,
        createContext(),
      ),
  ]) {
    let result: AssistantResult | undefined;
    await assert.rejects(
      async () => {
        result = await operation();
      },
      (error: unknown) => {
        assert.ok(error instanceof PromptBudgetExceededError);
        assert.equal(error.estimatedPromptTokens, 131);
        assert.equal(error.maxPromptTokens, 130);
        assert.equal(error.maxContextTokens, 200);
        assert.equal(error.outputTokenAllowance, 50);
        assert.equal(error.safetyMarginTokens, 20);
        return true;
      },
    );
    assert.equal(result, undefined);
  }

  assert.equal(estimatorCalls.length, 3);
  assert.equal(runtime.loadCalls, 0);
  assert.equal(runtime.generateCalls, 0);
  assert.equal(runtime.requests.length, 0);
});

test('runtime and parser errors remain distinct from budget errors', async () => {
  const runtimeError = new Error('runtime generation failed');
  const runtimeProvider = createLocalAssistantProvider(
    new FakeLocalModelRuntime({ responses: [runtimeError] }),
    {
      info,
      maxContextTokens: 10_000,
      outputTokenAllowance: 100,
      promptSafetyMarginTokens: 0,
    },
  );

  await assert.rejects(
    () =>
      runtimeProvider.interpret(
        'Spent 50 pesos from Food & drinks',
        createContext(),
      ),
    (error: unknown) => {
      assert.equal(error, runtimeError);
      assert.equal(error instanceof PromptBudgetExceededError, false);
      return true;
    },
  );

  const parserProvider = createLocalAssistantProvider(
    new FakeLocalModelRuntime({ responses: [{ text: 'not json' }] }),
    {
      info,
      maxContextTokens: 10_000,
      outputTokenAllowance: 100,
      promptSafetyMarginTokens: 0,
    },
  );

  await assert.rejects(
    () =>
      parserProvider.interpret(
        'Spent 50 pesos from Food & drinks',
        createContext(),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AssistantValidationError);
      assert.equal(error instanceof PromptBudgetExceededError, false);
      return true;
    },
  );
});

test('prompt estimator limitations are explicit and budget must be valid', () => {
  const estimator = new ApproximateCharacterPromptTokenEstimator();

  assert.equal(estimator.estimate('abcdefgh'), 2);
  assert.equal(estimator.estimate(''), 0);
  assert.equal(DEFAULT_POLICY_MAX_CONTEXT_TOKENS, 2_048);
  assert.equal(DEFAULT_POLICY_OUTPUT_TOKEN_ALLOWANCE, 512);
  assert.equal(DEFAULT_POLICY_PROMPT_SAFETY_MARGIN_TOKENS, 128);

  for (const options of [
    { maxContextTokens: 0 },
    { outputTokenAllowance: 0 },
    { promptSafetyMarginTokens: -1 },
    {
      maxContextTokens: 600,
      outputTokenAllowance: 500,
      promptSafetyMarginTokens: 100,
    },
  ]) {
    assert.throws(
      () =>
        new LocalLlmProvider(new FakeLocalModelRuntime(), {
          info,
          promptBuilder,
          responseParser,
          ...options,
        }),
      RangeError,
    );
  }
});

test('provider and native-free runtime files have no native or finance imports', () => {
  const sources = [
    '../src/ai/providers/index.ts',
    '../src/ai/providers/localLlmProvider.ts',
    '../src/ai/providers/localPromptBuilder.ts',
    '../src/ai/providers/promptBudget.ts',
    '../src/ai/providers/validatedAssistantProvider.ts',
    '../src/ai/runtime/types.ts',
    '../src/ai/runtime/fakeLocalModelRuntime.ts',
    '../src/ai/runtime/index.ts',
    '../src/ai/runtime/executorch/config.ts',
  ]
    .map((path) =>
      readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'),
    )
    .join('\n');

  for (const forbidden of [
    /from ['"]react-native['"]/,
    /from ['"]react-native-executorch['"]/,
    /from ['"]expo-/,
    /\bFinanceService\b/,
    /\bFinanceSession\b/,
    /\bFinanceEngine\b/,
    /\bFinanceRepository\b/,
    /\bassistantExecution\b/,
    /\bexecuteMoneyEntry\b/,
    /\bMoneyEntryInput\b/,
    /\bcreatePendingConfirmation\b/,
    /recordMoneyEntry/,
    /expo-sqlite/,
    /sqlite/i,
  ]) {
    assert.doesNotMatch(sources, forbidden);
  }

  const localProviderSource = readFileSync(
    fileURLToPath(
      new URL(
        '../src/ai/providers/localLlmProvider.ts',
        import.meta.url,
      ),
    ),
    'utf8',
  );
  assert.doesNotMatch(
    localProviderSource,
    /\bMockAssistantProvider\b|https?:\/\/|\bfetch\s*\(/i,
  );
});

test('native runtime import is isolated to the ExecuTorch adapter', () => {
  const adapter = readFileSync(
    fileURLToPath(
      new URL(
        '../src/ai/runtime/executorch/executorchLocalModelRuntime.ts',
        import.meta.url,
      ),
    ),
    'utf8',
  );

  assert.match(adapter, /import\('react-native-executorch'\)/);
  for (const forbidden of [
    /\bFinanceService\b/,
    /\bFinanceEngine\b/,
    /\bFinanceRepository\b/,
    /recordMoneyEntry/,
    /expo-sqlite/,
    /sqlite/i,
  ]) {
    assert.doesNotMatch(adapter, forbidden);
  }
});
