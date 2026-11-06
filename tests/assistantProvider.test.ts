import assert from 'node:assert/strict';
import test from 'node:test';

import {
  interpretAssistantMessage,
  type AssistantContext,
  type AssistantResult,
} from '../src/ai/localAssistant';
import {
  assistantProvider,
  createAssistantProvider,
  createConfiguredAssistantProvider,
  createDevelopmentLocalAssistantProvider,
  createLocalAssistantProvider,
  OfflineAssistantProvider,
  ValidatedAssistantProvider,
  type AssistantProvider,
} from '../src/ai/providers';
import { FakeLocalModelRuntime } from '../src/ai/runtime';
import { AssistantValidationError } from '../src/ai/validation';
import { createAssistantExecutionCoordinator } from '../src/application/assistantExecution';
import { createPendingConfirmation } from '../src/features/assistant/confirmationState';

const localInfo = {
  id: 'selected-local-test',
  displayName: 'Selected local test',
  kind: 'local_llm' as const,
  isRealModel: true,
  modelName: 'test-model',
  needsModelDownload: true,
  offline: true,
  description: 'Test-only local selection.',
};

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

test('the default provider is an explicitly labeled offline provider', () => {
  const provider = createAssistantProvider();

  assert.ok(provider instanceof ValidatedAssistantProvider);
  assert.equal(provider.info.id, 'offline-rules-v1');
  assert.equal(provider.info.kind, 'offline');
  assert.equal(provider.info.displayName, 'Offline rules');
  assert.equal(provider.info.isRealModel, false);
  assert.equal(provider.info.needsModelDownload, false);
  assert.equal(provider.info.offline, true);
  assert.match(provider.info.description, /deterministic offline rules/i);
  assert.match(provider.info.description, /not a language model/i);
});

test('the app singleton uses the offline provider by default', () => {
  assert.equal(assistantProvider.info.id, 'offline-rules-v1');
  assert.equal(assistantProvider.info.kind, 'offline');
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
  assert.equal(production.info.kind, 'offline');
  assert.equal(localFactoryCalls, 1);

  const notRequested = createConfiguredAssistantProvider({
    isDevelopment: true,
    requestedProvider: undefined,
    createLocalProvider: () => {
      localFactoryCalls += 1;
      return localProvider;
    },
  });
  assert.equal(notRequested.info.kind, 'offline');
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

test('selected local providers cannot bypass assistant result validation', async () => {
  const context = createContext();
  const invalid = interpretAssistantMessage(
    'Spent 50 pesos from Food & drinks',
    context,
  );
  assert.equal(invalid.kind, 'proposal');
  if (invalid.kind !== 'proposal') return;
  invalid.proposal.amountMinor = 1;

  const rawProvider: AssistantProvider = {
    info: {
      id: 'raw-local-test',
      displayName: 'Raw local test',
      kind: 'local_llm',
      isRealModel: true,
      modelName: 'test-model',
      needsModelDownload: true,
      offline: true,
      description: 'Unvalidated test provider.',
    },
    load: async () => undefined,
    unload: async () => undefined,
    interpret: async () => invalid as AssistantResult,
    resolveContainerChoice: async () => invalid as AssistantResult,
    resolveWalletChoice: async () => invalid as AssistantResult,
  };
  const selected = createConfiguredAssistantProvider({
    isDevelopment: true,
    requestedProvider: 'local',
    createLocalProvider: () => rawProvider,
  });

  await assert.rejects(
    () =>
      selected.interpret(
        'Spent 50 pesos from Food & drinks',
        context,
      ),
    AssistantValidationError,
  );
});

test('selected local clarification remains a clarification', async () => {
  const context = createContext();
  const clarification = interpretAssistantMessage(
    'I spent 50 pesos',
    context,
  );
  assert.equal(clarification.kind, 'clarification');
  const runtime = new FakeLocalModelRuntime({
    responses: [{ text: JSON.stringify(clarification) }],
  });
  const selected = createConfiguredAssistantProvider({
    isDevelopment: true,
    requestedProvider: 'local',
    createLocalProvider: () =>
      createLocalAssistantProvider(runtime, { info: localInfo }),
  });

  const result = await selected.interpret('I spent 50 pesos', context);

  assert.equal(result.kind, 'clarification');
});

test('selected local invalid model output cannot become a proposal', async () => {
  const runtime = new FakeLocalModelRuntime({
    responses: [{ text: '```json\n{"kind":"proposal"}\n```' }],
  });
  const selected = createConfiguredAssistantProvider({
    isDevelopment: true,
    requestedProvider: 'local',
    createLocalProvider: () =>
      createLocalAssistantProvider(runtime, { info: localInfo }),
  });

  await assert.rejects(
    () =>
      selected.interpret(
        'Spent 50 pesos from Food & drinks',
        createContext(),
      ),
    AssistantValidationError,
  );
  assert.equal(runtime.generateCalls, 1);
});

test('selected local runtime errors do not fall back to offline or cloud', async () => {
  const runtimeError = new Error('local runtime unavailable');
  const runtime = new FakeLocalModelRuntime({
    responses: [runtimeError],
  });
  const selected = createConfiguredAssistantProvider({
    isDevelopment: true,
    requestedProvider: 'local',
    createLocalProvider: () =>
      createLocalAssistantProvider(runtime, { info: localInfo }),
  });

  await assert.rejects(
    () =>
      selected.interpret(
        'Spent 50 pesos from Food & drinks',
        createContext(),
      ),
    runtimeError,
  );
  assert.equal(selected.info.kind, 'local_llm');
  assert.equal(runtime.generateCalls, 1);
});

test('selected local proposals require confirmation before coordinator execution', async () => {
  const context = createContext();
  const draft = interpretAssistantMessage(
    'Spent 50 pesos from Food & drinks',
    context,
  );
  assert.equal(draft.kind, 'proposal');
  if (draft.kind !== 'proposal') return;
  draft.proposal.id = 'local-draft';

  const runtime = new FakeLocalModelRuntime({
    responses: [{ text: JSON.stringify(draft) }],
  });
  const selected = createConfiguredAssistantProvider({
    isDevelopment: true,
    requestedProvider: 'local',
    createLocalProvider: () =>
      createLocalAssistantProvider(runtime, { info: localInfo }),
  });
  let executions = 0;
  const coordinator = createAssistantExecutionCoordinator({
    executeMoneyEntry: async () => {
      executions += 1;
      return { ok: true, transactionId: 'transaction-1' };
    },
  });

  const result = await selected.interpret(
    'Spent 50 pesos from Food & drinks',
    context,
  );
  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(executions, 0);

  const withoutConfirmation = await coordinator.execute({
    proposal: result.proposal,
    context,
    confirmed: false,
  });
  assert.equal(withoutConfirmation.ok, false);
  assert.equal(executions, 0);

  const confirmed = await coordinator.execute({
    proposal: result.proposal,
    context,
    confirmed: true,
  });
  assert.equal(confirmed.ok, true);
  assert.equal(executions, 1);
});

test('the offline provider implements AssistantProvider with no-op lifecycle hooks', async () => {
  const provider: AssistantProvider = new OfflineAssistantProvider();

  assert.equal(provider.info.id, 'offline-rules-v1');
  await provider.load();
  await provider.unload();
});

test('the offline provider interprets through the existing assistant engine', async () => {
  const provider = new OfflineAssistantProvider();
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

test('the offline provider resolves wallet and container clarifications', async () => {
  const provider = new OfflineAssistantProvider();
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

test('the offline provider returns refusal and read-only answers without proposals', async () => {
  const provider = new OfflineAssistantProvider();
  const context = createContext();

  const refusal = await provider.interpret('Hello there', context);
  assert.equal(refusal.kind, 'refusal');
  if (refusal.kind === 'refusal') {
    assert.equal(refusal.interpretation.intent, 'unknown');
  }

  const answer = await provider.interpret(
    'How much is in Savings?',
    context,
  );
  assert.equal(answer.kind, 'answer');
  assert.equal('proposal' in answer, false);
});
