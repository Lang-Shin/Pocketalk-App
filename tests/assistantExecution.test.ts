import assert from 'node:assert/strict';
import test from 'node:test';

import {
  interpretAssistantMessage,
  type AssistantContainerOption,
  type AssistantContext,
  type AssistantProposal,
} from '../src/ai/localAssistant';
import {
  createAssistantProvider,
  OfflineAssistantProvider,
  type AssistantProvider,
} from '../src/ai/providers';
import { createPendingConfirmation } from '../src/features/assistant/confirmationState';
import {
  AssistantProposalMappingError,
  assistantProposalToMoneyEntry,
  createAssistantExecutionCoordinator,
  executeConfirmedAssistantProposal,
  type AssistantFinanceExecutor,
} from '../src/application/assistantExecution';
import type {
  MoneyEntryExecutionResult,
  MoneyEntryInput,
} from '../src/data/financeService';

function proposal(
  overrides: Partial<AssistantProposal> = {},
): AssistantProposal {
  return {
    id: 'proposal-1',
    action: 'expense',
    title: 'Lunch',
    amountMinor: 2_500,
    effectiveDate: '2026-11-02',
    monthKey: '2026-11',
    walletId: 'wallet-cash',
    containerId: 'container-food',
    ...overrides,
  };
}

function container(
  id: string,
  systemKey: AssistantContainerOption['systemKey'] = null,
): AssistantContainerOption {
  return {
    id,
    name: id,
    status: 'active',
    systemKey,
    balanceMinor: 100_000,
    limitMinor: 0,
    spentMinor: 0,
    remainingMinor: 0,
  };
}

function createContext(
  overrides: Partial<AssistantContext> = {},
): AssistantContext {
  return {
    todayDateKey: '2026-11-02',
    activeMonthKey: '2026-11',
    wallets: [
      {
        id: 'wallet-cash',
        name: 'Cash',
        kind: 'cash',
        balanceMinor: 100_000,
      },
      {
        id: 'wallet-bank',
        name: 'Bank',
        kind: 'virtual_gcash',
        balanceMinor: 100_000,
      },
    ],
    containers: [
      container('container-food'),
      container('container-transport'),
      container('container-income'),
      container('system-unallocated', 'unallocated'),
      container('system-savings', 'savings'),
    ],
    summary: {
      monthKey: '2026-11',
      incomeMinor: 0,
      expenseMinor: 0,
      netSavingsMinor: 0,
      totalLimitMinor: 0,
      totalSpentMinor: 0,
      totalRemainingMinor: 0,
      savingsContributionsMinor: 0,
      savingsWithdrawalsMinor: 0,
      savingsEndingBalanceMinor: 100_000,
      unallocatedEndingBalanceMinor: 0,
    },
    ...overrides,
  };
}

function executorReturning(
  result: MoneyEntryExecutionResult,
): AssistantFinanceExecutor & { calls: MoneyEntryInput[] } {
  const calls: MoneyEntryInput[] = [];
  return {
    calls,
    executeMoneyEntry: async (input) => {
      calls.push(input);
      return result;
    },
  };
}

test('maps an expense proposal without changing amounts or dates', () => {
  const mapped = assistantProposalToMoneyEntry(proposal());

  assert.deepEqual(mapped, {
    mode: 'expense',
    amountMinor: 2_500,
    title: 'Lunch',
    effectiveDate: '2026-11-02',
    walletId: 'wallet-cash',
    containerId: 'container-food',
    idempotencyKey: 'assistant:proposal-1',
  });
});

test('maps income to the destination wallet and container', () => {
  const mapped = assistantProposalToMoneyEntry(
    proposal({
      action: 'income',
      walletId: 'wallet-bank',
      destinationContainerId: 'container-income',
    }),
  );

  assert.equal(mapped.mode, 'income');
  assert.equal(mapped.walletId, 'wallet-bank');
  assert.equal(mapped.containerId, 'container-income');
});

test('maps wallet transfers with distinct source and destination wallets', () => {
  const mapped = assistantProposalToMoneyEntry(
    proposal({
      action: 'wallet_transfer',
      sourceWalletId: 'wallet-cash',
      destinationWalletId: 'wallet-bank',
    }),
  );

  assert.equal(mapped.mode, 'wallet_transfer');
  assert.equal(mapped.walletId, 'wallet-cash');
  assert.equal(mapped.destinationWalletId, 'wallet-bank');
});

test('maps ordinary and savings transfers through container transfers', () => {
  const ordinary = assistantProposalToMoneyEntry(
    proposal({
      action: 'container_transfer',
      containerId: 'container-food',
      destinationContainerId: 'container-transport',
    }),
  );
  const contribution = assistantProposalToMoneyEntry(
    proposal({
      action: 'savings_contribution',
      containerId: 'container-food',
      destinationContainerId: 'container-savings',
    }),
  );
  const withdrawal = assistantProposalToMoneyEntry(
    proposal({
      action: 'savings_withdrawal',
      containerId: 'container-savings',
      destinationContainerId: 'container-food',
    }),
  );

  assert.deepEqual(ordinary, {
    mode: 'container_transfer',
    amountMinor: 2_500,
    title: 'Lunch',
    effectiveDate: '2026-11-02',
    containerId: 'container-food',
    destinationContainerId: 'container-transport',
    idempotencyKey: 'assistant:proposal-1',
  });
  assert.equal(contribution.mode, 'container_transfer');
  assert.equal(contribution.containerId, 'container-food');
  assert.equal(contribution.destinationContainerId, 'container-savings');
  assert.equal(withdrawal.mode, 'container_transfer');
  assert.equal(withdrawal.containerId, 'container-savings');
  assert.equal(withdrawal.destinationContainerId, 'container-food');
});

test('rejects incomplete, invalid, or unsupported proposals', () => {
  assert.throws(
    () => assistantProposalToMoneyEntry(proposal({ amountMinor: 0 })),
    AssistantProposalMappingError,
  );
  assert.throws(
    () => assistantProposalToMoneyEntry(proposal({ effectiveDate: '2026-02-30' })),
    AssistantProposalMappingError,
  );
  assert.throws(
    () => assistantProposalToMoneyEntry(proposal({ monthKey: '2026-10' })),
    AssistantProposalMappingError,
  );
  assert.throws(
    () => assistantProposalToMoneyEntry(proposal({ title: '   ' })),
    AssistantProposalMappingError,
  );
  assert.throws(
    () => assistantProposalToMoneyEntry(proposal({ containerId: undefined })),
    AssistantProposalMappingError,
  );
  assert.throws(
    () =>
      assistantProposalToMoneyEntry(
        proposal({
          action: 'wallet_transfer',
          sourceWalletId: 'wallet-cash',
          destinationWalletId: 'wallet-cash',
        }),
      ),
    AssistantProposalMappingError,
  );
  assert.throws(
    () =>
      assistantProposalToMoneyEntry(
        proposal({
          action: 'container_transfer',
          containerId: 'container-food',
          destinationContainerId: 'container-food',
        }),
      ),
    AssistantProposalMappingError,
  );
  assert.throws(
    () =>
      assistantProposalToMoneyEntry(
        proposal({ action: 'unknown' as AssistantProposal['action'] }),
      ),
    AssistantProposalMappingError,
  );
});

test('does not call the executor without explicit confirmation', async () => {
  const executor = executorReturning({ ok: true, transactionId: 'tx-1' });

  const result = await executeConfirmedAssistantProposal(
    { proposal: proposal(), context: createContext(), confirmed: false },
    executor,
  );

  assert.equal(result.ok, false);
  assert.equal(executor.calls.length, 0);
});

test('executes a confirmed proposal and preserves the transaction ID', async () => {
  const executor = executorReturning({ ok: true, transactionId: 'tx-1' });

  const result = await executeConfirmedAssistantProposal(
    { proposal: proposal(), context: createContext(), confirmed: true },
    executor,
  );

  assert.deepEqual(result, { ok: true, transactionId: 'tx-1' });
  assert.equal(executor.calls.length, 1);
  const [input] = executor.calls;
  assert.ok(input);
  assert.equal(input.idempotencyKey, 'assistant:proposal-1');
});

test('does not call the executor when mapping fails', async () => {
  const executor = executorReturning({ ok: true, transactionId: 'tx-1' });

  const result = await executeConfirmedAssistantProposal(
    {
      proposal: proposal({ amountMinor: -1 }),
      context: createContext(),
      confirmed: true,
    },
    executor,
  );

  assert.equal(result.ok, false);
  assert.equal(executor.calls.length, 0);
});

test('returns execution failures to the caller', async () => {
  const executor = executorReturning({
    ok: false,
    message: 'Insufficient funds.',
  });

  const result = await executeConfirmedAssistantProposal(
    { proposal: proposal(), context: createContext(), confirmed: true },
    executor,
  );

  assert.deepEqual(result, { ok: false, message: 'Insufficient funds.' });
});

test('revalidates the active period and current references before execution', async () => {
  const executor = executorReturning({ ok: true, transactionId: 'tx-1' });
  const context = createContext();
  const archived = createContext({
    containers: context.containers.map((item) =>
      item.id === 'container-food'
        ? { ...item, status: 'archived' as const }
        : item,
    ),
  });

  const cases = [
    {
      context,
      proposal: proposal({ effectiveDate: '2026-11-03' }),
      message: /future/i,
    },
    {
      context,
      proposal: proposal({
        effectiveDate: '2026-10-31',
        monthKey: '2026-10',
      }),
      message: /active month/i,
    },
    {
      context,
      proposal: proposal({ containerId: 'system-savings' }),
      message: /system container/i,
    },
    {
      context,
      proposal: proposal({ walletId: 'wallet-missing' }),
      message: /wallet/i,
    },
    {
      context,
      proposal: proposal({ containerId: 'container-missing' }),
      message: /container/i,
    },
    {
      context: archived,
      proposal: proposal({ containerId: 'container-food' }),
      message: /archived/i,
    },
    {
      context,
      proposal: proposal({
        action: 'income',
        destinationContainerId: 'system-savings',
      }),
      message: /Savings/i,
    },
    {
      context,
      proposal: proposal({
        action: 'wallet_transfer',
        sourceWalletId: 'wallet-cash',
        destinationWalletId: 'wallet-missing',
      }),
      message: /wallet/i,
    },
    {
      context,
      proposal: proposal({
        action: 'container_transfer',
        containerId: 'system-unallocated',
        destinationContainerId: 'container-food',
      }),
      message: /system container/i,
    },
    {
      context,
      proposal: proposal({
        action: 'savings_contribution',
        containerId: 'system-savings',
        destinationContainerId: 'container-food',
      }),
      message: /source/i,
    },
    {
      context,
      proposal: proposal({
        action: 'savings_contribution',
        containerId: 'container-food',
        destinationContainerId: 'container-transport',
      }),
      message: /Savings container/i,
    },
    {
      context,
      proposal: proposal({
        action: 'savings_withdrawal',
        containerId: 'container-food',
        destinationContainerId: 'container-transport',
      }),
      message: /Savings container/i,
    },
  ];

  for (const testCase of cases) {
    const result = await executeConfirmedAssistantProposal(
      {
        proposal: testCase.proposal,
        context: testCase.context,
        confirmed: true,
      },
      executor,
    );

    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.match(result.message, testCase.message);
  }

  assert.equal(executor.calls.length, 0);
});

test('suppresses concurrent execution of the same proposal', async () => {
  let resolveExecution:
    | ((result: MoneyEntryExecutionResult) => void)
    | undefined;
  const calls: MoneyEntryInput[] = [];
  const executor: AssistantFinanceExecutor = {
    executeMoneyEntry: (input) => {
      calls.push(input);
      return new Promise((resolve) => {
        resolveExecution = resolve;
      });
    },
  };
  const coordinator = createAssistantExecutionCoordinator(executor);
  const request = {
    proposal: proposal(),
    context: createContext(),
    confirmed: true,
  };

  const first = coordinator.execute(request);
  const second = coordinator.execute(request);

  assert.equal(calls.length, 1);
  resolveExecution?.({ ok: true, transactionId: 'tx-1' });
  assert.deepEqual(await first, { ok: true, transactionId: 'tx-1' });
  assert.deepEqual(await second, { ok: true, transactionId: 'tx-1' });
  assert.equal(calls.length, 1);
});

test('reuses the proposal idempotency key when a retry reaches the executor', async () => {
  const executor = executorReturning({ ok: true, transactionId: 'tx-1' });
  const coordinator = createAssistantExecutionCoordinator(executor);
  const request = {
    proposal: proposal(),
    context: createContext(),
    confirmed: true,
  };

  await coordinator.execute(request);
  await coordinator.execute(request);

  assert.equal(executor.calls.length, 2);
  assert.equal(executor.calls[0]?.idempotencyKey, 'assistant:proposal-1');
  assert.equal(executor.calls[1]?.idempotencyKey, 'assistant:proposal-1');
});

test('validated offline provider reaches the coordinator only after confirmation', async () => {
  const provider = createAssistantProvider(new OfflineAssistantProvider());
  const context = createContext();
  const result = await provider.interpret(
    'Spent 50 on lunch from Food & drinks',
    context,
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;

  const pending = createPendingConfirmation({
    id: 'message-1',
    proposal: result.proposal,
  });
  assert.ok(pending);
  assert.equal(pending.proposal.amountMinor, 5_000);
  assert.equal(pending.proposal.effectiveDate, '2026-11-02');

  const executor = executorReturning({ ok: true, transactionId: 'tx-pipeline' });
  const coordinator = createAssistantExecutionCoordinator(executor);
  const blocked = await coordinator.execute({
    proposal: result.proposal,
    context,
    confirmed: false,
  });

  assert.equal(blocked.ok, false);
  assert.equal(executor.calls.length, 0);

  const executed = await coordinator.execute({
    proposal: result.proposal,
    context,
    confirmed: true,
  });

  assert.deepEqual(executed, { ok: true, transactionId: 'tx-pipeline' });
  assert.equal(executor.calls.length, 1);
  assert.equal(executor.calls[0]?.amountMinor, 5_000);
  assert.equal(executor.calls[0]?.idempotencyKey, `assistant:${result.proposal.id}`);
});

test('read-only, clarification, and refusal results never create confirmation', async () => {
  const provider = createAssistantProvider(new OfflineAssistantProvider());
  const context = createContext();
  const messages = [
    'How much is in Savings?',
    'I spent 50 on lunch',
    'Hello there',
  ];

  for (const message of messages) {
    const result = await provider.interpret(message, context);
    assert.notEqual(result.kind, 'proposal', message);
    const proposal = 'proposal' in result ? result.proposal : undefined;
    const pending = createPendingConfirmation({
      id: message,
      proposal,
    });
    assert.equal(pending, null, message);
  }
});

test('rejects invalid provider output before the coordinator can execute it', async () => {
  const context = createContext();
  const valid = interpretAssistantMessage(
    'Spent 50 on lunch from Food & drinks',
    context,
  );
  assert.equal(valid.kind, 'proposal');
  if (valid.kind !== 'proposal') return;

  const invalidProvider: AssistantProvider = {
    info: {
      id: 'invalid-test-provider',
      displayName: 'Invalid test provider',
      kind: 'offline',
      isRealModel: false,
      needsModelDownload: false,
      offline: true,
      description: 'Test-only provider returning invalid output.',
    },
    load: async () => undefined,
    unload: async () => undefined,
    interpret: async () => ({
      ...valid,
      proposal: { ...valid.proposal, amountMinor: -1 },
    }),
    resolveContainerChoice: async () => {
      throw new Error('Unexpected container resolution.');
    },
    resolveWalletChoice: async () => {
      throw new Error('Unexpected wallet resolution.');
    },
  };
  const provider = createAssistantProvider(invalidProvider);

  await assert.rejects(
    () => provider.interpret('Spent 50 on lunch from Food & drinks', context),
  );
});
