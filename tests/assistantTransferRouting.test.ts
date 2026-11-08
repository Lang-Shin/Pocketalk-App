import assert from 'node:assert/strict';
import test from 'node:test';

import {
  interpretAssistantMessage,
  resolveAssistantContainerChoice,
  type AssistantContext,
  type AssistantProposal,
} from '../src/ai/localAssistant';
import { validateAssistantResult } from '../src/ai/validation';
import {
  AssistantProposalEligibilityError,
  AssistantProposalMappingError,
  assistantProposalToMoneyEntry,
  createAssistantExecutionCoordinator,
  validateAssistantExecutionEligibility,
} from '../src/application/assistantExecution';
import { FinanceService } from '../src/data/financeService';
import { FinanceError } from '../src/db/errors';
import {
  SAVINGS_CONTAINER_ID,
  UNALLOCATED_CONTAINER_ID,
} from '../src/db/systemContainers';
import { createHarness } from './helpers/financeTestHarness';

function context(): AssistantContext {
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
        id: UNALLOCATED_CONTAINER_ID,
        name: 'Unallocated',
        status: 'active',
        systemKey: 'unallocated',
        balanceMinor: 100_000,
        limitMinor: 0,
        spentMinor: 0,
        remainingMinor: 0,
      },
      {
        id: SAVINGS_CONTAINER_ID,
        name: 'Savings',
        status: 'active',
        systemKey: 'savings',
        balanceMinor: 50_000,
        limitMinor: 0,
        spentMinor: 0,
        remainingMinor: 0,
      },
      {
        id: 'container-allowance',
        name: 'Allowance',
        status: 'active',
        systemKey: null,
        balanceMinor: 20_000,
        limitMinor: 100_000,
        spentMinor: 0,
        remainingMinor: 100_000,
      },
      {
        id: 'container-bh-rent',
        name: 'BH rent',
        status: 'active',
        systemKey: null,
        balanceMinor: 10_000,
        limitMinor: 0,
        spentMinor: 0,
        remainingMinor: 0,
      },
      {
        id: 'container-food',
        name: 'Food & drinks',
        status: 'active',
        systemKey: null,
        balanceMinor: 10_000,
        limitMinor: 50_000,
        spentMinor: 0,
        remainingMinor: 50_000,
      },
    ],
    summary: {
      monthKey: '2026-10',
      incomeMinor: 200_000,
      expenseMinor: 0,
      netSavingsMinor: 200_000,
      totalLimitMinor: 150_000,
      totalSpentMinor: 0,
      totalRemainingMinor: 150_000,
      savingsContributionsMinor: 50_000,
      savingsWithdrawalsMinor: 0,
      savingsEndingBalanceMinor: 50_000,
      unallocatedEndingBalanceMinor: 100_000,
    },
  };
}

function proposalFrom(text: string, assistantContext = context()) {
  const result = interpretAssistantMessage(text, assistantContext);
  validateAssistantResult(result, assistantContext);
  assert.equal(result.kind, 'proposal', `${text}: ${result.message}`);
  if (result.kind !== 'proposal') throw new Error('unreachable');
  return result.proposal;
}

test('all eight required transfer prompts classify and preserve direction', () => {
  const cases: {
    text: string;
    action: AssistantProposal['action'];
    amountMinor: number;
    source: string;
    destination: string;
  }[] = [
    {
      text: 'Transfer 500 from Unallocated to Allowance',
      action: 'container_transfer',
      amountMinor: 50_000,
      source: UNALLOCATED_CONTAINER_ID,
      destination: 'container-allowance',
    },
    {
      text: 'Move 500 from Unallocated to Allowance',
      action: 'container_transfer',
      amountMinor: 50_000,
      source: UNALLOCATED_CONTAINER_ID,
      destination: 'container-allowance',
    },
    {
      text: 'Transfer 100 from Savings to Unallocated',
      action: 'savings_withdrawal',
      amountMinor: 10_000,
      source: SAVINGS_CONTAINER_ID,
      destination: UNALLOCATED_CONTAINER_ID,
    },
    {
      text: 'Move 100 from Savings to Unallocated',
      action: 'savings_withdrawal',
      amountMinor: 10_000,
      source: SAVINGS_CONTAINER_ID,
      destination: UNALLOCATED_CONTAINER_ID,
    },
    {
      text: 'Withdraw 100 from Savings',
      action: 'savings_withdrawal',
      amountMinor: 10_000,
      source: SAVINGS_CONTAINER_ID,
      destination: UNALLOCATED_CONTAINER_ID,
    },
    {
      text: 'Add 100 to Savings from Unallocated',
      action: 'savings_contribution',
      amountMinor: 10_000,
      source: UNALLOCATED_CONTAINER_ID,
      destination: SAVINGS_CONTAINER_ID,
    },
    {
      text: 'Transfer 100 from Allowance to Unallocated',
      action: 'container_transfer',
      amountMinor: 10_000,
      source: 'container-allowance',
      destination: UNALLOCATED_CONTAINER_ID,
    },
    {
      text: 'Transfer 100 from Unallocated to Savings',
      action: 'savings_contribution',
      amountMinor: 10_000,
      source: UNALLOCATED_CONTAINER_ID,
      destination: SAVINGS_CONTAINER_ID,
    },
  ];

  for (const expected of cases) {
    const proposal = proposalFrom(expected.text);
    assert.equal(proposal.action, expected.action, expected.text);
    assert.equal(proposal.amountMinor, expected.amountMinor, expected.text);
    assert.equal(proposal.containerId, expected.source, expected.text);
    assert.equal(
      proposal.destinationContainerId,
      expected.destination,
      expected.text,
    );
  }
});

test('income wording still drafts income', () => {
  const result = interpretAssistantMessage('Received 500 allowance', context());
  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.intent, 'income');
  assert.equal(result.proposal.action, 'income');
  assert.equal(result.proposal.amountMinor, 50_000);
  assert.equal(result.proposal.destinationContainerId, 'container-allowance');
});

test('transfer syntax wins over income-like container names', () => {
  const assistantContext = context();
  assistantContext.containers.push({
    id: 'container-bonus',
    name: 'Bonus',
    status: 'active',
    systemKey: null,
    balanceMinor: 5_000,
    limitMinor: 0,
    spentMinor: 0,
    remainingMinor: 0,
  });

  const result = interpretAssistantMessage(
    'Transfer 100 from Unallocated to Bonus',
    assistantContext,
  );
  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.intent, 'container_transfer');
  assert.equal(result.proposal.action, 'container_transfer');
  assert.equal(result.proposal.containerId, UNALLOCATED_CONTAINER_ID);
  assert.equal(result.proposal.destinationContainerId, 'container-bonus');
});

test('ambiguous and missing endpoints preserve the resolved side', () => {
  const ambiguousContext = context();
  ambiguousContext.containers.push({
    id: 'container-food-delivery',
    name: 'Food delivery',
    status: 'active',
    systemKey: null,
    balanceMinor: 5_000,
    limitMinor: 0,
    spentMinor: 0,
    remainingMinor: 0,
  });
  const ambiguous = interpretAssistantMessage(
    'Move 50 from Unallocated to Food',
    ambiguousContext,
  );
  assert.equal(ambiguous.kind, 'clarification');
  if (ambiguous.kind !== 'clarification') return;
  assert.equal(ambiguous.clarification.pending?.action, 'container_transfer');
  assert.equal(ambiguous.clarification.pending?.role, 'destination');
  assert.equal(
    ambiguous.clarification.pending?.sourceContainerId,
    UNALLOCATED_CONTAINER_ID,
  );
  assert.deepEqual(
    ambiguous.clarification.options?.map((option) => option.id),
    ['container-food', 'container-food-delivery'],
  );

  const missingDestination = interpretAssistantMessage(
    'Move 500 from Unallocated',
    context(),
  );
  assert.equal(missingDestination.kind, 'clarification');
  if (missingDestination.kind !== 'clarification') return;
  assert.equal(missingDestination.clarification.pending?.action, 'container_transfer');
  assert.equal(missingDestination.clarification.pending?.role, 'destination');
  assert.equal(
    missingDestination.clarification.pending?.sourceContainerId,
    UNALLOCATED_CONTAINER_ID,
  );

  const missingSource = interpretAssistantMessage(
    'Move 500 to Allowance',
    context(),
  );
  assert.equal(missingSource.kind, 'clarification');
  if (missingSource.kind !== 'clarification') return;
  assert.equal(missingSource.clarification.pending?.action, 'container_transfer');
  assert.equal(missingSource.clarification.pending?.role, 'source');
  assert.equal(
    missingSource.clarification.pending?.destinationContainerId,
    'container-allowance',
  );
});

test('unknown container refuses instead of inventing an income', () => {
  const result = interpretAssistantMessage(
    'Transfer 100 from Unallocated to Nowhere',
    context(),
  );
  assert.equal(result.kind, 'clarification');
  if (result.kind !== 'clarification') return;
  assert.equal(result.intent, 'container_transfer');
  assert.match(result.message, /could not match/i);
  assert.equal(result.clarification.pending?.action, 'container_transfer');
  assert.equal(
    result.clarification.pending?.sourceContainerId,
    UNALLOCATED_CONTAINER_ID,
  );
});

test('Savings direction survives clarification and never silently flips', () => {
  const contribution = interpretAssistantMessage(
    'Move 100 to Savings',
    context(),
  );
  assert.equal(contribution.kind, 'clarification');
  if (contribution.kind !== 'clarification') return;
  assert.equal(contribution.clarification.pending?.action, 'savings_contribution');
  assert.equal(
    contribution.clarification.pending?.destinationContainerId,
    SAVINGS_CONTAINER_ID,
  );
  const pending = contribution.clarification.pending;
  assert.ok(pending);
  const resolved = resolveAssistantContainerChoice(
    UNALLOCATED_CONTAINER_ID,
    pending,
    context(),
  );
  assert.equal(resolved.kind, 'proposal');
  if (resolved.kind !== 'proposal') return;
  assert.equal(resolved.proposal.action, 'savings_contribution');
  assert.equal(resolved.proposal.containerId, UNALLOCATED_CONTAINER_ID);
  assert.equal(
    resolved.proposal.destinationContainerId,
    SAVINGS_CONTAINER_ID,
  );

  const withdrawal = proposalFrom('Move 100 from Savings', context());
  assert.equal(withdrawal.action, 'savings_withdrawal');
  assert.equal(withdrawal.containerId, SAVINGS_CONTAINER_ID);
  assert.equal(withdrawal.destinationContainerId, UNALLOCATED_CONTAINER_ID);

  const sameSavings = interpretAssistantMessage(
    'Move 100 from Savings to Savings',
    context(),
  );
  assert.equal(sameSavings.kind, 'clarification');
  if (sameSavings.kind !== 'clarification') return;
  assert.equal(sameSavings.clarification.pending?.action, 'container_transfer');
});

test('Unallocated endpoints are eligible, other system endpoints are not', () => {
  const parserContext = context();
  const toAllowance = proposalFrom(
    'Transfer 500 from Unallocated to Allowance',
    parserContext,
  );
  const input = assistantProposalToMoneyEntry(toAllowance);
  assert.equal(input.mode, 'container_transfer');
  assert.equal(input.containerId, UNALLOCATED_CONTAINER_ID);
  assert.equal(input.destinationContainerId, 'container-allowance');
  assert.doesNotThrow(() =>
    validateAssistantExecutionEligibility(
      toAllowance.action,
      input,
      parserContext,
    ),
  );

  const fromAllowance = proposalFrom(
    'Transfer 100 from Allowance to Unallocated',
    parserContext,
  );
  assert.doesNotThrow(() =>
    validateAssistantExecutionEligibility(
      fromAllowance.action,
      assistantProposalToMoneyEntry(fromAllowance),
      parserContext,
    ),
  );

  const unsupported: AssistantProposal = {
    ...toAllowance,
    containerId: UNALLOCATED_CONTAINER_ID,
    destinationContainerId: SAVINGS_CONTAINER_ID,
  };
  assert.throws(
    () =>
      validateAssistantExecutionEligibility(
        'container_transfer',
        assistantProposalToMoneyEntry(unsupported),
        parserContext,
      ),
    AssistantProposalEligibilityError,
  );

  const savingsSource: AssistantProposal = {
    ...toAllowance,
    containerId: SAVINGS_CONTAINER_ID,
    destinationContainerId: 'container-allowance',
  };
  assert.throws(
    () =>
      validateAssistantExecutionEligibility(
        'container_transfer',
        assistantProposalToMoneyEntry(savingsSource),
        parserContext,
      ),
    AssistantProposalEligibilityError,
  );
});

test('same-container transfers, insufficient funds, and exact confirmation fields', () => {
  const same = interpretAssistantMessage(
    'Transfer 100 from Unallocated to Unallocated',
    context(),
  );
  assert.equal(same.kind, 'refusal');
  if (same.kind !== 'refusal') return;
  assert.match(same.message, /different containers/i);

  const poorContext = context();
  poorContext.containers = poorContext.containers.map((container) =>
    container.id === UNALLOCATED_CONTAINER_ID
      ? { ...container, balanceMinor: 10_000 }
      : container,
  );
  const insufficient = interpretAssistantMessage(
    'Transfer 500 from Unallocated to Allowance',
    poorContext,
  );
  assert.equal(insufficient.kind, 'refusal');
  if (insufficient.kind !== 'refusal') return;
  assert.match(insufficient.message, /only/i);

  const savingsContext = context();
  savingsContext.containers = savingsContext.containers.map((container) =>
    container.id === SAVINGS_CONTAINER_ID
      ? { ...container, balanceMinor: 5_000 }
      : container,
  );
  const savingsInsufficient = interpretAssistantMessage(
    'Withdraw 100 from Savings',
    savingsContext,
  );
  assert.equal(savingsInsufficient.kind, 'refusal');
  if (savingsInsufficient.kind !== 'refusal') return;
  assert.match(savingsInsufficient.message, /Savings has only/i);

  const exact = proposalFrom(
    'Transfer 500 from Unallocated to Allowance',
    context(),
  );
  assert.deepEqual(assistantProposalToMoneyEntry(exact), {
    mode: 'container_transfer',
    amountMinor: 50_000,
    title: 'Container transfer',
    effectiveDate: '2026-10-20',
    containerId: UNALLOCATED_CONTAINER_ID,
    destinationContainerId: 'container-allowance',
    idempotencyKey: `assistant:${exact.id}`,
  });

  const sameEndpoint: AssistantProposal = {
    ...exact,
    destinationContainerId: UNALLOCATED_CONTAINER_ID,
  };
  assert.throws(
    () => assistantProposalToMoneyEntry(sameEndpoint),
    AssistantProposalMappingError,
  );
});

test('duplicate confirmation executes a proposal only once', async () => {
  let calls = 0;
  const coordinator = createAssistantExecutionCoordinator({
    executeMoneyEntry: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { ok: true, transactionId: 'tx-1' };
    },
  });
  const proposal = proposalFrom(
    'Transfer 500 from Unallocated to Allowance',
    context(),
  );

  const [first, second] = await Promise.all([
    coordinator.execute({ proposal, context: context(), confirmed: true }),
    coordinator.execute({ proposal, context: context(), confirmed: true }),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  const unconfirmed = await coordinator.execute({
    proposal,
    context: context(),
    confirmed: false,
  });
  assert.equal(unconfirmed.ok, false);
});

async function contextFromService(
  service: FinanceService,
): Promise<AssistantContext> {
  const month = await service.getMonthView('2026-10');
  const walletView = await service.getWalletView();
  return {
    todayDateKey: '2026-10-20',
    activeMonthKey: '2026-10',
    wallets: walletView.wallets.map((wallet) => ({
      id: wallet.id,
      name: wallet.name,
      kind: wallet.kind,
      balanceMinor: wallet.balanceMinor,
    })),
    containers: month.containers.map((container) => ({
      id: container.id,
      name: container.name,
      status: container.status,
      systemKey: container.systemKey,
      balanceMinor: container.balanceMinor,
      limitMinor: container.limitMinor,
      spentMinor: container.spentMinor,
      remainingMinor: container.remainingMinor,
    })),
    summary: {
      monthKey: month.summary.monthKey,
      incomeMinor: month.summary.incomeMinor,
      expenseMinor: month.summary.expenseMinor,
      netSavingsMinor: month.summary.netSavingsMinor,
      totalLimitMinor: month.summary.totalLimitMinor,
      totalSpentMinor: month.summary.totalSpentMinor,
      totalRemainingMinor: month.summary.totalRemainingMinor,
      savingsContributionsMinor: month.summary.savingsContributionsMinor,
      savingsWithdrawalsMinor: month.summary.savingsWithdrawalsMinor,
      savingsEndingBalanceMinor: month.summary.savingsEndingBalanceMinor,
      unallocatedEndingBalanceMinor: month.summary.unallocatedEndingBalanceMinor,
    },
  };
}

async function realSetup(): Promise<{
  harness: Awaited<ReturnType<typeof createHarness>>;
  service: FinanceService;
  assistantContext: AssistantContext;
}> {
  const harness = await createHarness(new Date(2026, 9, 20, 12));
  const service = new FinanceService(harness.engine, {
    now: harness.clock.now,
  });
  await service.initialize();
  await service.createContainer({
    name: 'Allowance',
    description: '',
    icon: 'restaurant-outline',
    tone: 'coral',
    limitMinor: 100_000,
    monthKey: '2026-10',
    idempotencyKey: 'routing-allowance',
  });
  await service.recordMoneyEntry({
    mode: 'income',
    amountMinor: 200_000,
    title: 'seed income',
    effectiveDate: '2026-10-20',
    walletId: 'wallet-cash',
    idempotencyKey: 'routing-income',
  });
  await service.recordMoneyEntry({
    mode: 'container_transfer',
    amountMinor: 100_000,
    title: 'seed savings',
    effectiveDate: '2026-10-20',
    containerId: UNALLOCATED_CONTAINER_ID,
    destinationContainerId: SAVINGS_CONTAINER_ID,
    idempotencyKey: 'routing-savings-seed',
  });

  return {
    harness,
    service,
    assistantContext: await contextFromService(service),
  };
}

test('parsed proposals execute with correct accounting deltas', async () => {
  const { harness, service, assistantContext: initialContext } =
    await realSetup();
  let assistantContext = initialContext;
  try {
    const allowanceId = assistantContext.containers.find(
      (container) => container.name === 'Allowance',
    )?.id;
    assert.ok(allowanceId);

    const steps = [
      {
        text: 'Transfer 500 from Unallocated to Allowance',
        amount: 50_000,
        source: UNALLOCATED_CONTAINER_ID,
        destination: allowanceId,
        kind: 'container_transfer',
      },
      {
        text: 'Transfer 100 from Allowance to Unallocated',
        amount: 10_000,
        source: allowanceId,
        destination: UNALLOCATED_CONTAINER_ID,
        kind: 'container_transfer',
      },
      {
        text: 'Transfer 100 from Unallocated to Savings',
        amount: 10_000,
        source: UNALLOCATED_CONTAINER_ID,
        destination: SAVINGS_CONTAINER_ID,
        kind: 'savings',
      },
      {
        text: 'Transfer 100 from Savings to Unallocated',
        amount: 10_000,
        source: SAVINGS_CONTAINER_ID,
        destination: UNALLOCATED_CONTAINER_ID,
        kind: 'savings',
      },
    ];

    for (const step of steps) {
      const before = await service.getMonthView('2026-10');
      const walletsBefore = await service.getWalletView();
      const proposal = proposalFrom(step.text, assistantContext);
      const input = assistantProposalToMoneyEntry(proposal);
      validateAssistantExecutionEligibility(
        proposal.action,
        input,
        assistantContext,
      );
      await service.recordMoneyEntry(input);
      const after = await service.getMonthView('2026-10');
      const walletsAfter = await service.getWalletView();

      const balance = (
        view: typeof before,
        id: string,
      ) => view.containers.find((item) => item.id === id)?.balanceMinor ?? 0;

      assert.equal(
        balance(after, step.source) - balance(before, step.source),
        -step.amount,
        step.text,
      );
      assert.equal(
        balance(after, step.destination) - balance(before, step.destination),
        step.amount,
        step.text,
      );
      assert.equal(
        walletsAfter.totalBalanceMinor - walletsBefore.totalBalanceMinor,
        0,
        step.text,
      );
      assert.equal(
        after.summary.incomeMinor - before.summary.incomeMinor,
        0,
        step.text,
      );
      assert.equal(
        after.summary.expenseMinor - before.summary.expenseMinor,
        0,
        step.text,
      );

      const transaction = after.transactions.find(
        (candidate) =>
          candidate.kind === step.kind &&
          candidate.amountMinor === step.amount &&
          candidate.sourceContainerId === step.source &&
          candidate.destinationContainerId === step.destination,
      );
      assert.ok(transaction, `${step.text}: transaction direction`);
      assistantContext = await contextFromService(service);
    }
  } finally {
    harness.database.close();
  }
});

test('Savings withdrawals cannot overdraw at execution time', async () => {
  const { harness, service } = await realSetup();
  try {
    const before = await service.getMonthView('2026-10');
    await assert.rejects(
      () =>
        service.recordMoneyEntry({
          mode: 'container_transfer',
          amountMinor: 100_001,
          title: 'Too much',
          effectiveDate: '2026-10-20',
          containerId: SAVINGS_CONTAINER_ID,
          destinationContainerId: UNALLOCATED_CONTAINER_ID,
          idempotencyKey: 'routing-overdraw',
        }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'INSUFFICIENT_FUNDS',
    );
    const after = await service.getMonthView('2026-10');
    assert.equal(
      after.containers.find((item) => item.id === SAVINGS_CONTAINER_ID)
        ?.balanceMinor,
      before.containers.find((item) => item.id === SAVINGS_CONTAINER_ID)
        ?.balanceMinor,
    );
  } finally {
    harness.database.close();
  }
});
