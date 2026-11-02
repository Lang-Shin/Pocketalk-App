import assert from 'node:assert/strict';
import test from 'node:test';

import type { AssistantProposal } from '../src/ai/localAssistant';
import {
  AssistantProposalMappingError,
  assistantProposalToMoneyEntry,
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
    { proposal: proposal(), confirmed: false },
    executor,
  );

  assert.equal(result.ok, false);
  assert.equal(executor.calls.length, 0);
});

test('executes a confirmed proposal and preserves the transaction ID', async () => {
  const executor = executorReturning({ ok: true, transactionId: 'tx-1' });

  const result = await executeConfirmedAssistantProposal(
    { proposal: proposal(), confirmed: true },
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
    { proposal: proposal({ amountMinor: -1 }), confirmed: true },
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
    { proposal: proposal(), confirmed: true },
    executor,
  );

  assert.deepEqual(result, { ok: false, message: 'Insufficient funds.' });
});
