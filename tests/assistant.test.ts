import assert from 'node:assert/strict';
import test from 'node:test';

import {
  interpretAssistantMessage,
  resolveAssistantContainerChoice,
  resolveAssistantWalletChoice,
  type AssistantContext,
} from '../src/ai/localAssistant';

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
        limitMinor: 0,
        spentMinor: 0,
        remainingMinor: 0,
      },
      {
        id: 'system-savings',
        name: 'Savings',
        status: 'active',
        systemKey: 'savings',
        balanceMinor: 40_000,
        limitMinor: 0,
        spentMinor: 0,
        remainingMinor: 0,
      },
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
      savingsContributionsMinor: 30_000,
      savingsWithdrawalsMinor: 0,
      savingsEndingBalanceMinor: 40_000,
      unallocatedEndingBalanceMinor: 50_000,
    },
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
  assert.equal(result.intent, 'expense');
  assert.equal(result.proposal.containerId, 'container-food');
  assert.equal(result.proposal.amountMinor, 14_500);
  assert.equal(result.proposal.title, 'Lunch');
  assert.equal(result.proposal.walletId, 'wallet-gcash');
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

test('assistant interprets a natural income sentence', () => {
  const result = interpretAssistantMessage(
    'My mom sent me ₱1,000',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.intent, 'income');
  assert.equal(result.proposal.action, 'income');
  assert.equal(result.proposal.amountMinor, 100_000);
});

test('assistant keeps expense intent when the amount is missing', () => {
  const result = interpretAssistantMessage(
    'I spent some money yesterday',
    createContext(),
  );

  assert.equal(result.kind, 'clarification');
  if (result.kind !== 'clarification') return;
  assert.equal(result.intent, 'expense');
  assert.equal(result.clarification.reason, 'amount');
  assert.equal(result.clarification.pending, undefined);
});

test('assistant drafts a Savings contribution with an explicit source', () => {
  const result = interpretAssistantMessage(
    'Move ₱300 from Unallocated to savings',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.intent, 'container_transfer');
  assert.equal(result.proposal.action, 'savings_contribution');
  assert.equal(result.proposal.containerId, 'system-unallocated');
  assert.equal(result.proposal.destinationContainerId, 'system-savings');
  assert.equal(result.proposal.amountMinor, 30_000);
});

test('assistant asks for a missing Savings contribution source', () => {
  const result = interpretAssistantMessage(
    'Move ₱300 to savings',
    createContext(),
  );

  assert.equal(result.kind, 'clarification');
  if (result.kind !== 'clarification') return;
  assert.equal(result.intent, 'container_transfer');
  assert.equal(result.clarification.reason, 'container');
  assert.equal(result.clarification.pending?.amountMinor, 30_000);
  assert.equal(
    result.clarification.pending?.destinationContainerId,
    'system-savings',
  );
  assert.deepEqual(result.interpretation.destinationContainer, {
    id: 'system-savings',
    name: 'Savings',
  });

  const pending = result.clarification.pending;
  assert.ok(pending);
  const proposal = resolveAssistantContainerChoice(
    'system-unallocated',
    pending,
    createContext(),
  );
  assert.equal(proposal.kind, 'proposal');
  if (proposal.kind !== 'proposal') return;
  assert.equal(proposal.intent, 'container_transfer');
  assert.equal(proposal.proposal.containerId, 'system-unallocated');
  assert.equal(proposal.proposal.destinationContainerId, 'system-savings');
});

test('assistant interprets an identified container-to-Savings transfer', () => {
  const context = createContext();
  context.containers.push({
    id: 'container-general',
    name: 'General',
    status: 'active',
    systemKey: null,
    balanceMinor: 60_000,
    limitMinor: 0,
    spentMinor: 0,
    remainingMinor: 0,
  });

  const result = interpretAssistantMessage(
    'Move ₱500 from General to Savings',
    context,
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.intent, 'container_transfer');
  assert.equal(result.proposal.action, 'savings_contribution');
  assert.equal(result.proposal.containerId, 'container-general');
  assert.equal(result.proposal.destinationContainerId, 'system-savings');
  assert.equal(result.proposal.amountMinor, 50_000);
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

test('assistant drafts a wallet-to-wallet transfer', () => {
  const result = interpretAssistantMessage(
    'Transfer ₱100 from Cash to GCash',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.intent, 'wallet_transfer');
  assert.equal(result.proposal.action, 'wallet_transfer');
  assert.equal(result.proposal.amountMinor, 10_000);
  assert.equal(result.proposal.title, 'Wallet transfer');
  assert.equal(result.proposal.sourceWalletId, 'wallet-cash');
  assert.equal(result.proposal.destinationWalletId, 'wallet-gcash');
  assert.deepEqual(result.interpretation.sourceWallet, {
    id: 'wallet-cash',
    name: 'Cash on hand',
  });
  assert.deepEqual(result.interpretation.destinationWallet, {
    id: 'wallet-gcash',
    name: 'Virtual GCash',
  });
  assert.equal(result.interpretation.amountMinor, 10_000);
  assert.equal(result.interpretation.currency, 'PHP');
  assert.equal('moneyEntry' in result, false);
});

test('assistant asks for a missing wallet transfer source', () => {
  const result = interpretAssistantMessage(
    'Transfer ₱100 to Cash',
    createContext(),
  );

  assert.equal(result.kind, 'clarification');
  if (result.kind !== 'clarification') return;
  assert.equal(result.intent, 'wallet_transfer');
  assert.equal(result.clarification.reason, 'wallet');
  assert.deepEqual(
    result.clarification.walletOptions?.map((wallet) => wallet.id),
    ['wallet-gcash'],
  );

  const pending = result.clarification.pending;
  assert.ok(pending);
  const proposal = resolveAssistantWalletChoice(
    'wallet-gcash',
    pending,
    createContext(),
  );
  assert.equal(proposal.kind, 'proposal');
  if (proposal.kind !== 'proposal') return;
  assert.equal(proposal.proposal.sourceWalletId, 'wallet-gcash');
  assert.equal(proposal.proposal.destinationWalletId, 'wallet-cash');
});

test('assistant asks for a missing wallet transfer destination', () => {
  const result = interpretAssistantMessage(
    'Transfer ₱100 from GCash',
    createContext(),
  );

  assert.equal(result.kind, 'clarification');
  if (result.kind !== 'clarification') return;
  assert.equal(result.clarification.reason, 'wallet');
  assert.deepEqual(
    result.clarification.walletOptions?.map((wallet) => wallet.id),
    ['wallet-cash'],
  );
});

test('assistant clarifies ambiguous wallet names', () => {
  const context = createContext();
  context.wallets.push({
    id: 'wallet-cash-wallet',
    name: 'Cash wallet',
    kind: 'cash',
    balanceMinor: 50_000,
  });

  const result = interpretAssistantMessage(
    'Transfer ₱100 from Cash wallet to GCash',
    context,
  );

  assert.equal(result.kind, 'clarification');
  if (result.kind !== 'clarification') return;
  assert.equal(result.intent, 'wallet_transfer');
  assert.equal(result.clarification.reason, 'wallet');
  assert.deepEqual(
    result.clarification.walletOptions?.map((wallet) => wallet.id),
    ['wallet-cash', 'wallet-cash-wallet'],
  );
});

test('assistant drafts an ordinary container-to-container transfer', () => {
  const result = interpretAssistantMessage(
    'Move ₱150 from Food & drinks to Transport',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.intent, 'container_transfer');
  assert.equal(result.proposal.action, 'container_transfer');
  assert.equal(result.proposal.amountMinor, 15_000);
  assert.equal(result.proposal.title, 'Container transfer');
  assert.equal(result.proposal.containerId, 'container-food');
  assert.equal(result.proposal.destinationContainerId, 'container-transport');
  assert.deepEqual(result.interpretation.sourceContainer, {
    id: 'container-food',
    name: 'Food & drinks',
  });
  assert.deepEqual(result.interpretation.destinationContainer, {
    id: 'container-transport',
    name: 'Transport',
  });
  assert.equal(result.interpretation.amountMinor, 15_000);
  assert.equal('moneyEntry' in result, false);
});

test('assistant asks for missing container transfer endpoints', () => {
  const missingDestination = interpretAssistantMessage(
    'Move ₱150 from Food & drinks',
    createContext(),
  );
  assert.equal(missingDestination.kind, 'clarification');
  if (missingDestination.kind !== 'clarification') return;
  assert.equal(missingDestination.clarification.reason, 'container');
  assert.deepEqual(
    missingDestination.clarification.options?.map((option) => option.id),
    ['system-unallocated', 'container-transport'],
  );

  const missingSource = interpretAssistantMessage(
    'Move ₱150 to Transport',
    createContext(),
  );
  assert.equal(missingSource.kind, 'clarification');
  if (missingSource.kind !== 'clarification') return;
  assert.deepEqual(
    missingSource.clarification.options?.map((option) => option.id),
    ['system-unallocated', 'container-food'],
  );
});

test('assistant clarifies ambiguous container transfer endpoints', () => {
  const context = createContext();
  context.containers.push({
    id: 'container-food-delivery',
    name: 'Food delivery',
    status: 'active',
    systemKey: null,
    balanceMinor: 5_000,
    limitMinor: 0,
    spentMinor: 0,
    remainingMinor: 0,
  });

  const result = interpretAssistantMessage(
    'Move ₱50 from Food to Food delivery',
    context,
  );

  assert.equal(result.kind, 'clarification');
  if (result.kind !== 'clarification') return;
  assert.equal(result.clarification.reason, 'container');
  assert.deepEqual(
    result.clarification.options?.map((option) => option.id),
    ['container-food', 'container-food-delivery'],
  );
});

test('assistant rejects invalid and unsupported transfer requests', () => {
  const missingAmount = interpretAssistantMessage(
    'Move from Food & drinks to Transport',
    createContext(),
  );
  assert.equal(missingAmount.kind, 'clarification');
  if (missingAmount.kind !== 'clarification') return;
  assert.equal(missingAmount.clarification.reason, 'amount');

  const zeroAmount = interpretAssistantMessage(
    'Move ₱0 from Food & drinks to Transport',
    createContext(),
  );
  assert.equal(zeroAmount.kind, 'clarification');
  if (zeroAmount.kind !== 'clarification') return;
  assert.equal(zeroAmount.clarification.reason, 'amount');

  const insufficient = interpretAssistantMessage(
    'Move ₱500 from Food & drinks to Transport',
    createContext(),
  );
  assert.equal(insufficient.kind, 'refusal');
  if (insufficient.kind !== 'refusal') return;
  assert.equal(insufficient.intent, 'container_transfer');
  assert.match(insufficient.message, /only ₱200\.00/);

  const unknownCategory = interpretAssistantMessage(
    'Transfer ₱100',
    createContext(),
  );
  assert.equal(unknownCategory.kind, 'clarification');
  if (unknownCategory.kind !== 'clarification') return;
  assert.equal(unknownCategory.intent, 'unknown');
  assert.equal(unknownCategory.clarification.reason, 'transfer');

  const unsupported = interpretAssistantMessage(
    'Hello there',
    createContext(),
  );
  assert.equal(unsupported.kind, 'refusal');
  if (unsupported.kind !== 'refusal') return;
  assert.equal(unsupported.intent, 'unknown');
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
    limitMinor: 0,
    spentMinor: 0,
    remainingMinor: 0,
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

test('assistant rejects closed containers and offers active choices', () => {
  const context = createContext();
  context.containers = context.containers.map((container) =>
    container.id === 'container-food'
      ? { ...container, status: 'closed' as const }
      : container,
  );

  const result = interpretAssistantMessage(
    'Spent 50 on lunch from Food & drinks',
    context,
  );

  assert.equal(result.kind, 'clarification');
  if (result.kind !== 'clarification') return;
  assert.match(result.message, /closed/i);
  assert.deepEqual(
    result.clarification.options?.map((option) => option.id),
    ['container-transport'],
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

test('assistant answers a read-only Savings balance question', () => {
  const result = interpretAssistantMessage(
    'How much is in Savings?',
    createContext(),
  );

  assert.equal(result.kind, 'answer');
  if (result.kind !== 'answer') return;
  assert.equal(result.intent, 'balance_inquiry');
  assert.equal(result.answer.topic, 'savings_balance');
  assert.deepEqual(result.answer.figures, [
    { label: 'Savings balance', amountMinor: 40_000 },
  ]);
});

test('assistant answers monthly spending and income questions', () => {
  const spending = interpretAssistantMessage(
    'How much did I spend this month?',
    createContext(),
  );
  assert.equal(spending.kind, 'answer');
  if (spending.kind !== 'answer') return;
  assert.equal(spending.intent, 'spending_summary');
  assert.equal(spending.answer.topic, 'monthly_spending');
  assert.equal(spending.answer.figures[0]?.amountMinor, 120_000);

  const income = interpretAssistantMessage(
    'How much did I receive this month?',
    createContext(),
  );
  assert.equal(income.kind, 'answer');
  if (income.kind !== 'answer') return;
  assert.equal(income.intent, 'income_summary');
  assert.equal(income.answer.topic, 'monthly_income');
  assert.equal(income.answer.figures[0]?.amountMinor, 200_000);
});

test('assistant answers container and budget questions', () => {
  const balance = interpretAssistantMessage(
    'How much is in Food & drinks?',
    createContext(),
  );
  assert.equal(balance.kind, 'answer');
  if (balance.kind !== 'answer') return;
  assert.equal(balance.intent, 'balance_inquiry');
  assert.equal(balance.answer.topic, 'container_balance');
  assert.equal(balance.answer.figures[0]?.amountMinor, 20_000);

  const budget = interpretAssistantMessage(
    'How much budget is left in Food & drinks?',
    createContext(),
  );
  assert.equal(budget.kind, 'answer');
  if (budget.kind !== 'answer') return;
  assert.equal(budget.intent, 'budget_inquiry');
  assert.equal(budget.answer.topic, 'budget_remaining');
  assert.equal(budget.answer.figures[2]?.amountMinor, 20_000);
});

test('assistant answers wallet and Unallocated questions read-only', () => {
  const wallet = interpretAssistantMessage(
    'How much money do I have?',
    createContext(),
  );
  assert.equal(wallet.kind, 'answer');
  if (wallet.kind !== 'answer') return;
  assert.equal(wallet.intent, 'balance_inquiry');
  assert.equal(wallet.answer.topic, 'wallet_balance');
  assert.equal(
    wallet.answer.figures.reduce(
      (sum, figure) => sum + figure.amountMinor,
      0,
    ),
    200_000,
  );

  const unallocated = interpretAssistantMessage(
    'How much is in Unallocated?',
    createContext(),
  );
  assert.equal(unallocated.kind, 'answer');
  if (unallocated.kind !== 'answer') return;
  assert.equal(unallocated.intent, 'balance_inquiry');
  assert.equal(unallocated.answer.topic, 'unallocated_balance');
  assert.equal(unallocated.answer.figures[0]?.amountMinor, 50_000);
});

test('assistant recognizes a clarification request', () => {
  const result = interpretAssistantMessage(
    'What can you do?',
    createContext(),
  );

  assert.equal(result.kind, 'answer');
  if (result.kind !== 'answer') return;
  assert.equal(result.intent, 'clarification_request');
  assert.equal(result.answer.topic, 'help');
});

test('assistant declines out-of-scope historical questions', () => {
  const result = interpretAssistantMessage(
    'How much did I spend last month?',
    createContext(),
  );

  assert.equal(result.kind, 'answer');
  if (result.kind !== 'answer') return;
  assert.equal(result.intent, 'unknown');
  assert.equal(result.answer.topic, 'help');
  assert.match(result.message, /Monthly History/);
});

test('assistant exposes a structured expense interpretation', () => {
  const result = interpretAssistantMessage(
    'I spent ₱145 on lunch from Food & drinks kanina.',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  const interpretation = result.interpretation;
  assert.equal(interpretation.intent, 'expense');
  assert.equal(interpretation.amountMinor, 14_500);
  assert.equal(Number.isSafeInteger(interpretation.amountMinor), true);
  assert.equal(interpretation.currency, 'PHP');
  assert.equal(interpretation.effectiveDate, '2026-10-20');
  assert.deepEqual(interpretation.sourceWallet, {
    id: 'wallet-gcash',
    name: 'Virtual GCash',
  });
  assert.deepEqual(interpretation.sourceContainer, {
    id: 'container-food',
    name: 'Food & drinks',
  });
  assert.equal(interpretation.description, 'Lunch');
  assert.deepEqual(interpretation.missingFields, []);
  assert.equal(interpretation.clarificationQuestion, undefined);
  assert.equal(interpretation.confidence > 0, true);
  assert.equal(interpretation.confidence <= 1, true);
  assert.match(interpretation.reasoningSummary, /expense/i);
});

test('structured clarification exposes missing fields without guessing', () => {
  const missingAmount = interpretAssistantMessage(
    'I spent some money yesterday',
    createContext(),
  );
  assert.equal(missingAmount.kind, 'clarification');
  if (missingAmount.kind !== 'clarification') return;
  assert.deepEqual(missingAmount.interpretation.missingFields, ['amount']);
  assert.equal(missingAmount.interpretation.amountMinor, undefined);
  assert.equal(missingAmount.interpretation.effectiveDate, undefined);
  assert.match(
    missingAmount.interpretation.clarificationQuestion ?? '',
    /amount/i,
  );

  const missingWallet = interpretAssistantMessage(
    'Transfer ₱100 to Cash',
    createContext(),
  );
  assert.equal(missingWallet.kind, 'clarification');
  if (missingWallet.kind !== 'clarification') return;
  assert.deepEqual(missingWallet.interpretation.missingFields, [
    'sourceWallet',
  ]);
  assert.equal(missingWallet.interpretation.sourceWallet, undefined);
  assert.deepEqual(missingWallet.interpretation.destinationWallet, {
    id: 'wallet-cash',
    name: 'Cash on hand',
  });
});

test('structured clarification preserves ambiguous container uncertainty', () => {
  const context = createContext();
  context.containers.push({
    id: 'container-food-delivery',
    name: 'Food delivery',
    status: 'active',
    systemKey: null,
    balanceMinor: 5_000,
    limitMinor: 0,
    spentMinor: 0,
    remainingMinor: 0,
  });

  const result = interpretAssistantMessage(
    'Move ₱50 from Food to Food delivery',
    context,
  );

  assert.equal(result.kind, 'clarification');
  if (result.kind !== 'clarification') return;
  assert.deepEqual(result.interpretation.missingFields, [
    'sourceContainer',
  ]);
  assert.equal(result.interpretation.sourceContainer, undefined);
  assert.equal(result.interpretation.destinationContainer, undefined);
});

test('structured answers and refusals expose safe interpretation metadata', () => {
  const answer = interpretAssistantMessage(
    'How much money do I have?',
    createContext(),
  );
  assert.equal(answer.kind, 'answer');
  if (answer.kind !== 'answer') return;
  assert.equal(answer.interpretation.intent, 'balance_inquiry');
  assert.deepEqual(answer.interpretation.missingFields, []);
  assert.equal(answer.interpretation.confidence > 0, true);
  assert.equal(answer.interpretation.amountMinor, undefined);

  const refusal = interpretAssistantMessage(
    'Hello there',
    createContext(),
  );
  assert.equal(refusal.kind, 'refusal');
  if (refusal.kind !== 'refusal') return;
  assert.equal(refusal.interpretation.intent, 'unknown');
  assert.equal(refusal.interpretation.confidence, 0);
  assert.equal(refusal.interpretation.reasoningSummary.length > 0, true);
});

test('assistant does not expose any execution step', () => {
  const result = interpretAssistantMessage(
    'Move ₱300 from Unallocated to savings',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal('moneyEntry' in result, false);
  assert.match(result.message, /No ledger entry/i);
});

test('parses supported peso amount formats without floating-point rounding', () => {
  const peso = '\u20B1';
  const context = createContext();
  const formats: ReadonlyArray<readonly [string, number]> = [
    ['I received PHP 50', 5_000],
    [`I received ${peso}50`, 5_000],
    ['I received 50 pesos', 5_000],
    ['I received P50', 5_000],
    [`I received ${peso}1,000`, 100_000],
    [`I received ${peso}1,000.50`, 100_050],
    ['I received 1k', 100_000],
    ['I received 1 thousand', 100_000],
  ];

  for (const [message, expected] of formats) {
    const result = interpretAssistantMessage(message, context);
    assert.equal(result.kind, 'proposal', message);
    if (result.kind !== 'proposal') continue;
    assert.equal(result.proposal.action, 'income', message);
    assert.equal(result.proposal.amountMinor, expected, message);
  }
});

test('rejects zero, negative, and malformed decimal amounts', () => {
  const peso = '\u20B1';
  const context = createContext();
  const unsafeMessages = [
    `I received ${peso}0`,
    `I received -${peso}50`,
    'I received -50 pesos',
    `I received ${peso}50.999`,
  ];

  for (const message of unsafeMessages) {
    const result = interpretAssistantMessage(message, context);
    assert.notEqual(result.kind, 'proposal', message);
  }
});

test('ignores dates and unrelated numbers when extracting amounts', () => {
  const peso = '\u20B1';
  const context = createContext();
  const result = interpretAssistantMessage(
    `I received ${peso}50 on 2026-10-20 in 2 payments`,
    context,
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.amountMinor, 5_000);
  assert.equal(result.proposal.effectiveDate, '2026-10-20');
});

test('uses the plain-number fallback for messages without a currency marker', () => {
  const result = interpretAssistantMessage('I received 50', createContext());

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.amountMinor, 5_000);
});

test('uses the current local date when no date is supplied', () => {
  const result = interpretAssistantMessage(
    'I spent 50 on lunch from Food & drinks',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.effectiveDate, '2026-10-20');
  assert.equal(result.proposal.monthKey, '2026-10');
});

test('resolves today and yesterday from the active local date', () => {
  const context = createContext();
  const today = interpretAssistantMessage(
    'I spent 50 on lunch from Food & drinks today',
    context,
  );
  const yesterday = interpretAssistantMessage(
    'I spent 50 on lunch from Food & drinks yesterday',
    context,
  );

  assert.equal(today.kind, 'proposal');
  if (today.kind === 'proposal') {
    assert.equal(today.proposal.effectiveDate, '2026-10-20');
  }
  assert.equal(yesterday.kind, 'proposal');
  if (yesterday.kind === 'proposal') {
    assert.equal(yesterday.proposal.effectiveDate, '2026-10-19');
  }
});

test('refuses future and unsupported relative dates', () => {
  const context = createContext();
  const future = interpretAssistantMessage(
    'I spent 50 on lunch from Food & drinks 2026-10-21',
    context,
  );
  const relative = interpretAssistantMessage(
    'I spent 50 on lunch from Food & drinks last week',
    context,
  );

  assert.notEqual(future.kind, 'proposal');
  assert.notEqual(relative.kind, 'proposal');
});

test('resolves an explicitly named wallet for an expense', () => {
  const context = createContext();
  const cash = interpretAssistantMessage(
    'I spent 50 on lunch from Food & drinks using Cash',
    context,
  );
  const gcash = interpretAssistantMessage(
    'I spent 50 on lunch from Food & drinks using GCash',
    context,
  );

  assert.equal(cash.kind, 'proposal');
  if (cash.kind === 'proposal') assert.equal(cash.proposal.walletId, 'wallet-cash');
  assert.equal(gcash.kind, 'proposal');
  if (gcash.kind === 'proposal') assert.equal(gcash.proposal.walletId, 'wallet-gcash');
});

test('defaults to the only wallet when no wallet is mentioned', () => {
  const context = createContext();
  context.wallets = context.wallets.filter((wallet) => wallet.kind === 'cash');

  const result = interpretAssistantMessage(
    'I spent 50 on lunch from Food & drinks',
    context,
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.walletId, 'wallet-cash');
});

test('defaults to the virtual GCash wallet when multiple wallets exist and none is named', () => {
  const result = interpretAssistantMessage(
    'I spent 50 on lunch from Food & drinks',
    createContext(),
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.walletId, 'wallet-gcash');
});

test('asks for clarification when a named transfer wallet is unavailable', () => {
  const result = interpretAssistantMessage(
    'Transfer 100 from Bank to GCash',
    createContext(),
  );

  assert.equal(result.kind, 'clarification');
});

test('answers balance, spending, income, and budget questions without proposing a write', () => {
  const context = createContext();
  const cases = [
    {
      message: 'How much is in Savings?',
      intent: 'balance_inquiry',
      topic: 'savings_balance',
      figures: [{ label: 'Savings balance', amountMinor: 40_000 }],
    },
    {
      message: 'How much did I spend this month?',
      intent: 'spending_summary',
      topic: 'monthly_spending',
      figures: [{ label: 'Expenses', amountMinor: 120_000 }],
    },
    {
      message: 'How much income this month?',
      intent: 'income_summary',
      topic: 'monthly_income',
      figures: [{ label: 'Income', amountMinor: 200_000 }],
    },
    {
      message: 'How much budget is left for Food & drinks?',
      intent: 'budget_inquiry',
      topic: 'budget_remaining',
      figures: [
        { label: 'Limit', amountMinor: 100_000 },
        { label: 'Spent', amountMinor: 80_000 },
        { label: 'Remaining', amountMinor: 20_000 },
      ],
    },
  ] as const;

  for (const expected of cases) {
    const result = interpretAssistantMessage(expected.message, context);
    assert.equal(result.kind, 'answer', expected.message);
    if (result.kind !== 'answer') continue;
    assert.equal(result.intent, expected.intent, expected.message);
    assert.equal(result.answer.topic, expected.topic, expected.message);
    assert.deepEqual(result.answer.figures, expected.figures, expected.message);
    assert.equal('proposal' in result, false, expected.message);
  }
});
