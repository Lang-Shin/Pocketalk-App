import assert from 'node:assert/strict';
import test from 'node:test';

import type { AssistantContext } from '../src/ai/localAssistant';
import {
  createAssistantProvider,
  MockAssistantProvider,
} from '../src/ai/providers';

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
