import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assistantProposalToMoneyEntry,
  interpretAssistantMessage,
  resolveAssistantContainerChoice,
  type AssistantContext,
} from '../src/ai/localAssistant';
import { FinanceService } from '../src/data/financeService';
import { createHarness } from './helpers/financeTestHarness';

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
        id: 'system-unallocated',
        name: 'Unallocated',
        status: 'active',
        systemKey: 'unallocated',
        balanceMinor: 50_000,
      },
      {
        id: 'system-savings',
        name: 'Savings',
        status: 'active',
        systemKey: 'savings',
        balanceMinor: 40_000,
      },
      {
        id: 'container-food',
        name: 'Food & drinks',
        status: 'active',
        systemKey: null,
        balanceMinor: 20_000,
      },
      {
        id: 'container-transport',
        name: 'Transport',
        status: 'active',
        systemKey: null,
        balanceMinor: 10_000,
      },
    ],
  };
}

test('assistant drafts an expense only after resolving its container', () => {
  const context = createContext();
  const clarification = interpretAssistantMessage(
    'I spent ₱145 on lunch kanina.',
    context,
  );

  assert.equal(clarification.kind, 'clarification');
  if (clarification.kind !== 'clarification') return;
  assert.equal(clarification.clarification.options?.length, 2);
  const pending = clarification.clarification.pending;
  assert.ok(pending);

  const result = resolveAssistantContainerChoice(
    'container-food',
    pending,
    context,
  );
  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;

  assert.equal(result.proposal.action, 'expense');
  assert.equal(result.proposal.amountMinor, 14_500);
  assert.equal(result.proposal.title, 'Lunch');
  assert.equal(result.proposal.walletId, 'wallet-gcash');
  assert.equal(result.proposal.containerId, 'container-food');
  assert.equal(result.proposal.effectiveDate, '2026-10-20');
  assert.equal(result.proposal.monthKey, '2026-10');
  assert.equal(result.proposal.sourceBalanceMinor, 20_000);
});

test('assistant matches an explicitly named expense container', () => {
  const result = interpretAssistantMessage(
    'I spent ₱145 on lunch from Food & drinks kanina.',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.containerId, 'container-food');
  assert.deepEqual(assistantProposalToMoneyEntry(result.proposal), {
    mode: 'expense',
    amountMinor: 14_500,
    title: 'Lunch',
    effectiveDate: '2026-10-20',
    walletId: 'wallet-gcash',
    containerId: 'container-food',
    idempotencyKey: `assistant:${result.proposal.id}`,
  });
});

test('assistant drafts income into Unallocated by default', () => {
  const result = interpretAssistantMessage(
    'Received ₱2,000 allowance',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.action, 'income');
  assert.equal(result.proposal.amountMinor, 200_000);
  assert.equal(result.proposal.title, 'Allowance');
  assert.equal(result.proposal.walletId, 'wallet-gcash');
  assert.equal(
    result.proposal.destinationContainerId,
    'system-unallocated',
  );
});

test('assistant drafts a Savings contribution as a transfer', () => {
  const result = interpretAssistantMessage(
    'Move ₱300 to savings',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.action, 'savings_contribution');
  assert.equal(result.proposal.containerId, 'system-unallocated');
  assert.equal(result.proposal.destinationContainerId, 'system-savings');
  assert.deepEqual(assistantProposalToMoneyEntry(result.proposal), {
    mode: 'container_transfer',
    amountMinor: 30_000,
    title: 'Savings contribution',
    effectiveDate: '2026-10-20',
    containerId: 'system-unallocated',
    destinationContainerId: 'system-savings',
    idempotencyKey: `assistant:${result.proposal.id}`,
  });
});

test('assistant uses an explicitly named Savings source', () => {
  const result = interpretAssistantMessage(
    'Move ₱150 from Food & drinks to savings',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.amountMinor, 15_000);
  assert.equal(result.proposal.containerId, 'container-food');
  assert.equal(result.proposal.destinationContainerId, 'system-savings');
});

test('assistant resolves a Savings withdrawal destination', () => {
  const result = interpretAssistantMessage(
    'Withdraw ₱200 from savings to Food & drinks',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.action, 'savings_withdrawal');
  assert.equal(result.proposal.containerId, 'system-savings');
  assert.equal(
    result.proposal.destinationContainerId,
    'container-food',
  );
});

test('assistant understands Taglish expense wording', () => {
  const result = interpretAssistantMessage(
    'gastos 50 sa Food & drinks',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.action, 'expense');
  assert.equal(result.proposal.amountMinor, 5_000);
  assert.equal(result.proposal.containerId, 'container-food');
});

test('assistant supports yesterday without inventing a historical date', () => {
  const context = createContext();
  context.todayDateKey = '2026-11-01';
  context.activeMonthKey = '2026-11';

  const result = interpretAssistantMessage(
    'Spent 50 on lunch yesterday from Food & drinks',
    {
      ...context,
      containers: context.containers.map((container) =>
        container.id === 'container-food'
          ? { ...container, balanceMinor: 50_000 }
          : container,
      ),
    },
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.effectiveDate, '2026-10-31');
  assert.equal(result.proposal.monthKey, '2026-10');
});

test('assistant blocks future-dated drafts', () => {
  const explicitFuture = interpretAssistantMessage(
    'Spent 50 on lunch on 2026-10-21',
    createContext(),
  );
  assert.equal(explicitFuture.kind, 'refusal');

  const relativeFuture = interpretAssistantMessage(
    'Spent 50 on lunch tomorrow',
    createContext(),
  );
  assert.equal(relativeFuture.kind, 'refusal');
});

test('assistant rejects archived containers and offers active choices', () => {
  const context = createContext();
  context.containers.push({
    id: 'container-old',
    name: 'Old food',
    status: 'archived',
    systemKey: null,
    balanceMinor: 500,
  });

  const result = interpretAssistantMessage(
    'Spent 50 on lunch from Old food',
    context,
  );

  assert.equal(result.kind, 'clarification');
  if (result.kind !== 'clarification') return;
  assert.match(result.message, /archived/i);
  assert.deepEqual(
    result.clarification.options?.map((option) => option.id),
    ['container-food', 'container-transport'],
  );
});

test('assistant refuses amounts above recorded balances', () => {
  const result = interpretAssistantMessage(
    'Spent ₱500 on lunch from Food & drinks',
    createContext(),
  );

  assert.equal(result.kind, 'refusal');
  if (result.kind !== 'refusal') return;
  assert.match(result.message, /only ₱200\.00/);
});

test('assistant asks for clarification instead of guessing', () => {
  const missingAmount = interpretAssistantMessage(
    'Spent on lunch',
    createContext(),
  );
  assert.equal(missingAmount.kind, 'clarification');

  const unsupported = interpretAssistantMessage(
    'Hello there',
    createContext(),
  );
  assert.equal(unsupported.kind, 'refusal');
});

test('a confirmed assistant transfer writes through the finance service once', async () => {
  const harness = await createHarness(new Date(2026, 9, 20, 12));
  const service = new FinanceService(harness.engine, {
    now: harness.clock.now,
  });

  try {
    await service.initialize();
    await service.recordMoneyEntry({
      mode: 'income',
      amountMinor: 100_000,
      title: 'Allowance',
      effectiveDate: '2026-10-20',
      walletId: 'wallet-gcash',
    });

    const view = await service.getMonthView('2026-10');
    const walletView = await service.getWalletView();
    const context: AssistantContext = {
      todayDateKey: service.todayDateKey,
      activeMonthKey: service.activeMonthKey,
      wallets: walletView.wallets.map((wallet) => ({
        id: wallet.id,
        name: wallet.name,
        kind: wallet.kind,
        balanceMinor: wallet.balanceMinor,
      })),
      containers: view.containers.map((container) => ({
        id: container.id,
        name: container.name,
        status: container.status,
        systemKey: container.systemKey,
        balanceMinor: container.balanceMinor,
      })),
    };

    const result = interpretAssistantMessage(
      'Move ₱300 to savings',
      context,
    );
    assert.equal(result.kind, 'proposal');
    if (result.kind !== 'proposal') return;

    const entry = assistantProposalToMoneyEntry(result.proposal);
    await service.recordMoneyEntry(entry);
    await service.recordMoneyEntry(entry);

    const after = await service.getMonthView('2026-10');
    assert.equal(after.summary.savingsContributionsMinor, 30_000);
    assert.equal(after.summary.expenseMinor, 0);
    assert.equal(after.summary.incomeMinor, 100_000);
    assert.equal(
      after.containers.find((container) => container.id === 'system-savings')
        ?.balanceMinor,
      30_000,
    );
    assert.equal(
      after.transactions.filter(
        (transaction) =>
          transaction.kind === 'savings' &&
          transaction.destinationContainerId === 'system-savings',
      ).length,
      1,
    );
  } finally {
    harness.database.close();
  }
});
