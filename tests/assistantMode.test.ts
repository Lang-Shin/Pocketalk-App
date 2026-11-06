import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ASSISTANT_MODE_OPTIONS,
  DEFAULT_ASSISTANT_MODE,
  selectAssistantMode,
  type AssistantMode,
} from '../src/ai/assistantMode';
import type { AssistantContext } from '../src/ai/localAssistant';
import {
  createAssistantProvider,
  createLocalAssistantProvider,
  ValidatedAssistantProvider,
} from '../src/ai/providers';
import { FakeLocalModelRuntime } from '../src/ai/runtime';
import { createAssistantExecutionCoordinator } from '../src/application/assistantExecution';
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

test('offline is the default user-facing mode', () => {
  const mode: AssistantMode = DEFAULT_ASSISTANT_MODE;
  const selection = selectAssistantMode();

  assert.equal(mode, 'offline');
  assert.equal(selection.mode, 'offline');
  assert.equal(selection.status, 'available');
  assert.ok(selection.provider instanceof ValidatedAssistantProvider);
  assert.equal(selection.provider.info.kind, 'offline');
  assert.equal(selection.provider.info.id, 'offline-rules-v1');

  const offlineOption = ASSISTANT_MODE_OPTIONS.find(
    (option) => option.mode === 'offline',
  );
  const onlineOption = ASSISTANT_MODE_OPTIONS.find(
    (option) => option.mode === 'online',
  );
  assert.equal(offlineOption?.availability, 'available');
  assert.equal(offlineOption?.statusLabel, 'Available');
  assert.equal(onlineOption?.availability, 'coming_soon');
  assert.equal(onlineOption?.statusLabel, 'Coming soon');
});

test('offline resolves to the validated deterministic provider', async () => {
  const selection = selectAssistantMode('offline');
  const result = await selection.provider.interpret(
    'Spent 50 on lunch from Food & drinks',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.action, 'expense');
  assert.equal(result.proposal.amountMinor, 5_000);
  assert.equal(result.proposal.effectiveDate, '2026-10-20');
});

test('online is unavailable without activating or substituting a provider', () => {
  let factoryCalls = 0;
  const selection = selectAssistantMode('online', {
    createOfflineProvider: () => {
      factoryCalls += 1;
      return createAssistantProvider();
    },
  });

  assert.equal(selection.mode, 'online');
  assert.equal(selection.status, 'unavailable');
  assert.equal(selection.provider, null);
  assert.equal(factoryCalls, 0);
  assert.match(selection.message, /not available yet/i);
  assert.match(selection.message, /no online request/i);
});

test('online cannot invoke or resolve to the experimental local model provider', () => {
  const localProvider = createLocalAssistantProvider(
    new FakeLocalModelRuntime({ responses: [] }),
    {
      info: {
        id: 'mode-test-local',
        displayName: 'Mode test local',
        kind: 'local_llm',
        isRealModel: true,
        modelName: 'test-model',
        needsModelDownload: true,
        offline: true,
        description: 'Test-only local provider.',
      },
    },
  );
  let localFactoryCalls = 0;

  const selection = selectAssistantMode('online', {
    createOfflineProvider: () => {
      localFactoryCalls += 1;
      return localProvider;
    },
  });

  assert.equal(selection.provider, null);
  assert.equal(localFactoryCalls, 0);
  assert.throws(
    () =>
      selectAssistantMode('offline', {
        createOfflineProvider: () => localProvider,
      }),
    /validated OfflineAssistantProvider/i,
  );
});

test('mode selection has no network or local runtime access', () => {
  const source = readFileSync(
    fileURLToPath(
      new URL('../src/ai/assistantMode.ts', import.meta.url),
    ),
    'utf8',
  );

  for (const forbidden of [
    /\bfetch\s*\(/,
    /https?:\/\//,
    /XMLHttpRequest/i,
    /\bcreateLocalAssistantProvider\b/,
    /\bLocalLlmProvider\b/,
    /\bexecutorch\b/i,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

test('selected offline provider preserves wallet and container clarification', async () => {
  const selection = selectAssistantMode('offline');
  const context = createContext();

  const walletClarification = await selection.provider.interpret(
    'Transfer \u20B1100 to Cash',
    context,
  );
  assert.equal(walletClarification.kind, 'clarification');
  if (walletClarification.kind !== 'clarification') return;
  const walletPending = walletClarification.clarification.pending;
  assert.ok(walletPending);
  const walletResult = await selection.provider.resolveWalletChoice(
    'wallet-gcash',
    walletPending,
    context,
  );
  assert.equal(walletResult.kind, 'proposal');

  const containerClarification = await selection.provider.interpret(
    'Move \u20B1100 from Food & drinks',
    context,
  );
  assert.equal(containerClarification.kind, 'clarification');
  if (containerClarification.kind !== 'clarification') return;
  const containerPending = containerClarification.clarification.pending;
  assert.ok(containerPending);
  const containerResult =
    await selection.provider.resolveContainerChoice(
      'container-transport',
      containerPending,
      context,
    );
  assert.equal(containerResult.kind, 'proposal');
});

test('selected offline provider still requires transaction confirmation', async () => {
  const selection = selectAssistantMode('offline');
  const context = createContext();
  const result = await selection.provider.interpret(
    'Spent 50 on lunch from Food & drinks',
    context,
  );
  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;

  const pending = createPendingConfirmation({
    id: 'mode-confirmation',
    proposal: result.proposal,
  });
  assert.ok(pending);

  let executions = 0;
  const coordinator = createAssistantExecutionCoordinator({
    executeMoneyEntry: async () => {
      executions += 1;
      return { ok: true, transactionId: 'transaction-mode' };
    },
  });

  const withoutConfirmation = await coordinator.execute({
    proposal: pending.proposal,
    context,
    confirmed: false,
  });
  assert.equal(withoutConfirmation.ok, false);
  assert.equal(executions, 0);

  const confirmed = await coordinator.execute({
    proposal: pending.proposal,
    context,
    confirmed: true,
  });
  assert.equal(confirmed.ok, true);
  assert.equal(executions, 1);
});
