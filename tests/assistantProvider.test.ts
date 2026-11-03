import assert from 'node:assert/strict';
import test from 'node:test';

import {
  interpretAssistantMessage,
  type AssistantContext,
} from '../src/ai/localAssistant';
import {
  assistantProvider,
  createAssistantProvider,
  createConfiguredAssistantProvider,
  createDevelopmentLocalAssistantProvider,
  createLocalAssistantProvider,
  MockAssistantProvider,
} from '../src/ai/providers';
import { FakeLocalModelRuntime } from '../src/ai/runtime';
import { createPendingConfirmation } from '../src/features/assistant/confirmationState';

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

test('the default provider is an explicitly labeled mock', () => {
  const provider = createAssistantProvider();

  assert.equal(provider.info.kind, 'mock');
  assert.equal(provider.info.isRealModel, false);
  assert.equal(provider.info.needsModelDownload, false);
  assert.equal(provider.info.offline, true);
  assert.match(provider.info.description, /not a language model/i);
});

test('the app singleton remains mock-backed by default', () => {
  assert.equal(assistantProvider.info.kind, 'mock');
  assert.equal(assistantProvider.info.isRealModel, false);
});

test('local provider selection requires development mode and explicit configuration', () => {
  const localProvider = createDevelopmentLocalAssistantProvider({
    modelPath: 'file:///data/user/0/com.pocketa.app/files/model.pte',
    tokenizerPath:
      'file:///data/user/0/com.pocketa.app/files/tokenizer.json',
    tokenizerConfigPath:
      'file:///data/user/0/com.pocketa.app/files/tokenizer_config.json',
  });
  let localFactoryCalls = 0;

  const selectedLocal = createConfiguredAssistantProvider({
    isDevelopment: true,
    requestedProvider: 'local',
    createLocalProvider: () => {
      localFactoryCalls += 1;
      return localProvider;
    },
  });
  assert.equal(selectedLocal, localProvider);
  assert.equal(selectedLocal.info.kind, 'local_llm');
  assert.equal(localFactoryCalls, 1);

  const production = createConfiguredAssistantProvider({
    isDevelopment: false,
    requestedProvider: 'local',
    createLocalProvider: () => {
      localFactoryCalls += 1;
      return localProvider;
    },
  });
  assert.equal(production.info.kind, 'mock');
  assert.equal(localFactoryCalls, 1);

  const notRequested = createConfiguredAssistantProvider({
    isDevelopment: true,
    requestedProvider: undefined,
    createLocalProvider: () => {
      localFactoryCalls += 1;
      return localProvider;
    },
  });
  assert.equal(notRequested.info.kind, 'mock');
  assert.equal(localFactoryCalls, 1);
});

test('local selection fails explicitly without a development runtime configuration', () => {
  assert.throws(
    () =>
      createConfiguredAssistantProvider({
        isDevelopment: true,
        requestedProvider: 'local',
      }),
    /explicit development runtime configuration/i,
  );
  assert.throws(
    () =>
      createDevelopmentLocalAssistantProvider({
        modelPath: ' ',
        tokenizerPath: 'file:///tokenizer.json',
        tokenizerConfigPath: 'file:///tokenizer_config.json',
      }),
    /EXPO_PUBLIC_POCKETA_LOCAL_MODEL_PATH/,
  );
});

test('explicit local selection preserves the proposal confirmation flow', async () => {
  const context = createContext();
  const draft = interpretAssistantMessage(
    'Spent 50 pesos from Food & drinks',
    context,
  );
  assert.equal(draft.kind, 'proposal');
  if (draft.kind !== 'proposal') return;
  draft.proposal.id = 'local-draft';

  const localProvider = createLocalAssistantProvider(
    new FakeLocalModelRuntime({
      responses: [{ text: JSON.stringify(draft) }],
    }),
    {
      info: {
        id: 'selected-local-test',
        displayName: 'Selected local test',
        kind: 'local_llm',
        isRealModel: true,
        modelName: 'test-model',
        needsModelDownload: true,
        offline: true,
        description: 'Test-only local selection.',
      },
    },
  );
  const selected = createConfiguredAssistantProvider({
    isDevelopment: true,
    requestedProvider: 'local',
    createLocalProvider: () => localProvider,
  });

  const result = await selected.interpret(
    'Spent 50 pesos from Food & drinks',
    context,
  );
  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.match(result.proposal.id, /^assistant-local-/);
  assert.notEqual(result.proposal.id, 'local-draft');

  const pending = createPendingConfirmation({
    id: 'message-selected-local',
    proposal: result.proposal,
  });
  assert.ok(pending);
  assert.equal(pending?.proposal.id, result.proposal.id);
});

test('the mock provider exposes no-op model lifecycle hooks', async () => {
  const provider = new MockAssistantProvider();

  await provider.load();
  await provider.unload();
});

test('the mock provider interprets through the existing assistant engine', async () => {
  const provider = new MockAssistantProvider();
  const result = await provider.interpret(
    'Transfer ₱100 from Cash to GCash',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.action, 'wallet_transfer');
  assert.equal(result.interpretation.amountMinor, 10_000);
  assert.equal(result.interpretation.currency, 'PHP');
});

test('the mock provider resolves wallet and container clarifications', async () => {
  const provider = new MockAssistantProvider();
  const context = createContext();

  const walletClarification = await provider.interpret(
    'Transfer ₱100 to Cash',
    context,
  );
  assert.equal(walletClarification.kind, 'clarification');
  if (walletClarification.kind !== 'clarification') return;
  const walletPending = walletClarification.clarification.pending;
  assert.ok(walletPending);
  const walletResult = await provider.resolveWalletChoice(
    'wallet-gcash',
    walletPending,
    context,
  );
  assert.equal(walletResult.kind, 'proposal');

  const containerClarification = await provider.interpret(
    'Move ₱100 from Food & drinks',
    context,
  );
  assert.equal(containerClarification.kind, 'clarification');
  if (containerClarification.kind !== 'clarification') return;
  const containerPending = containerClarification.clarification.pending;
  assert.ok(containerPending);
  const containerResult = await provider.resolveContainerChoice(
    'container-transport',
    containerPending,
    context,
  );
  assert.equal(containerResult.kind, 'proposal');
  if (containerResult.kind !== 'proposal') return;
  assert.equal(containerResult.proposal.action, 'container_transfer');
});
