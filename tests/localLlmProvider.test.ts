import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  interpretAssistantMessage,
  type AssistantContext,
  type AssistantPendingIntent,
  type AssistantResult,
} from '../src/ai/localAssistant';
import {
  LocalLlmProvider,
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

test('local runtime and provider have no native or finance imports', () => {
  const runtimeDirectory = fileURLToPath(
    new URL('../src/ai/runtime', import.meta.url),
  );
  const sources = [
    readFileSync(
      fileURLToPath(
        new URL(
          '../src/ai/providers/localLlmProvider.ts',
          import.meta.url,
        ),
      ),
      'utf8',
    ),
    ...readSourceFiles(runtimeDirectory),
  ].join('\n');

  for (const forbidden of [
    /from ['"]react-native['"]/,
    /from ['"]expo-/,
    /\bFinanceService\b/,
    /\bFinanceEngine\b/,
    /\bFinanceRepository\b/,
    /recordMoneyEntry/,
    /expo-sqlite/,
    /sqlite/i,
  ]) {
    assert.doesNotMatch(sources, forbidden);
  }
});

function readSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return readSourceFiles(path);
    return entry.isFile() && path.endsWith('.ts')
      ? [readFileSync(path, 'utf8')]
      : [];
  });
}
