import assert from 'node:assert/strict';
import test from 'node:test';

import { FinanceError } from '../src/db/errors';
import {
  createHarness,
  seedStandardAccounts,
  type TestHarness,
} from './helpers/financeTestHarness';

async function setup(): Promise<{
  harness: TestHarness;
  accounts: Awaited<ReturnType<typeof seedStandardAccounts>>;
}> {
  const harness = await createHarness();
  const accounts = await seedStandardAccounts(harness.engine);
  return { harness, accounts };
}

function balance(
  balances: Record<string, number>,
  accountId: string,
): number {
  return balances[accountId] ?? 0;
}

test('income increases both wallet and container funds', async () => {
  const { harness, accounts } = await setup();
  try {
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'Allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'income-1',
    });

    const wallets = await harness.engine.getWalletBalances('2026-10-20');
    const containers = await harness.engine.getContainerBalances('2026-10-20');
    const summary = await harness.engine.getMonthSummary('2026-10', '2026-10');

    assert.equal(balance(wallets, accounts.cashWalletId), 100_000);
    assert.equal(balance(containers, accounts.foodContainerId), 100_000);
    assert.equal(summary.incomeMinor, 100_000);
    assert.equal(summary.expenseMinor, 0);
    assert.equal(summary.netSavingsMinor, 100_000);
  } finally {
    harness.database.close();
  }
});

test('expenses decrease both wallet and container funds', async () => {
  const { harness, accounts } = await setup();
  try {
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'Allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'income-1',
    });
    await harness.engine.recordTransaction({
      kind: 'expense',
      title: 'Lunch',
      amountMinor: 25_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'expense-1',
    });

    const wallets = await harness.engine.getWalletBalances('2026-10-20');
    const containers = await harness.engine.getContainerBalances('2026-10-20');
    const summary = await harness.engine.getMonthSummary('2026-10', '2026-10');

    assert.equal(balance(wallets, accounts.cashWalletId), 75_000);
    assert.equal(balance(containers, accounts.foodContainerId), 75_000);
    assert.equal(summary.incomeMinor, 100_000);
    assert.equal(summary.expenseMinor, 25_000);
    assert.equal(summary.netSavingsMinor, 75_000);
  } finally {
    harness.database.close();
  }
});

test('wallet and container transfers conserve total funds', async () => {
  const { harness, accounts } = await setup();
  try {
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'Allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'income-1',
    });
    await harness.engine.recordTransaction({
      kind: 'wallet_transfer',
      title: 'Move to GCash',
      amountMinor: 10_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      destinationWalletId: accounts.gcashWalletId,
      idempotencyKey: 'wallet-transfer-1',
    });
    await harness.engine.recordTransaction({
      kind: 'container_transfer',
      title: 'Fund savings',
      amountMinor: 30_000,
      effectiveDate: '2026-10-20',
      containerId: accounts.foodContainerId,
      destinationContainerId: accounts.savingsContainerId,
      idempotencyKey: 'container-transfer-1',
    });

    const wallets = await harness.engine.getWalletBalances('2026-10-20');
    const containers = await harness.engine.getContainerBalances('2026-10-20');
    const summary = await harness.engine.getMonthSummary('2026-10', '2026-10');
    const walletTotal = Object.values(wallets).reduce(
      (total, amount) => total + amount,
      0,
    );
    const containerTotal = Object.values(containers).reduce(
      (total, amount) => total + amount,
      0,
    );

    assert.equal(balance(wallets, accounts.cashWalletId), 90_000);
    assert.equal(balance(wallets, accounts.gcashWalletId), 10_000);
    assert.equal(balance(containers, accounts.foodContainerId), 70_000);
    assert.equal(balance(containers, accounts.savingsContainerId), 30_000);
    assert.equal(walletTotal, 100_000);
    assert.equal(containerTotal, 100_000);
    assert.equal(summary.incomeMinor, 100_000);
    assert.equal(summary.expenseMinor, 0);
    assert.equal(summary.netSavingsMinor, 100_000);
    assert.equal(summary.savingsContributionsMinor, 30_000);
    assert.equal(summary.savingsEndingBalanceMinor, 30_000);
  } finally {
    harness.database.close();
  }
});

test('income deposited into a savings container is counted once', async () => {
  const { harness, accounts } = await setup();
  try {
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'Scholarship',
      amountMinor: 50_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.gcashWalletId,
      containerId: accounts.savingsContainerId,
      idempotencyKey: 'savings-income-1',
    });

    const summary = await harness.engine.getMonthSummary('2026-10', '2026-10');

    assert.equal(summary.incomeMinor, 50_000);
    assert.equal(summary.netSavingsMinor, 50_000);
    assert.equal(summary.savingsContributionsMinor, 0);
    assert.equal(summary.savingsEndingBalanceMinor, 50_000);
  } finally {
    harness.database.close();
  }
});

test('invalid transfers and insufficient funds create no partial records', async () => {
  const { harness, accounts } = await setup();
  try {
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'Allowance',
      amountMinor: 10_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'income-1',
    });

    await assert.rejects(
      harness.engine.recordTransaction({
        kind: 'expense',
        title: 'Too large',
        amountMinor: 20_000,
        effectiveDate: '2026-10-20',
        walletId: accounts.cashWalletId,
        containerId: accounts.foodContainerId,
        idempotencyKey: 'expense-too-large',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'INSUFFICIENT_FUNDS',
    );
    await assert.rejects(
      harness.engine.recordTransaction({
        kind: 'wallet_transfer',
        title: 'Self transfer',
        amountMinor: 1_000,
        effectiveDate: '2026-10-20',
        walletId: accounts.cashWalletId,
        destinationWalletId: accounts.cashWalletId,
        idempotencyKey: 'wallet-self',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'VALIDATION',
    );
    await assert.rejects(
      harness.engine.recordTransaction({
        kind: 'container_transfer',
        title: 'Self transfer',
        amountMinor: 1_000,
        effectiveDate: '2026-10-20',
        containerId: accounts.foodContainerId,
        destinationContainerId: accounts.foodContainerId,
        idempotencyKey: 'container-self',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'VALIDATION',
    );
    await assert.rejects(
      harness.engine.recordTransaction({
        kind: 'expense',
        title: 'Invalid amount',
        amountMinor: 1.5,
        effectiveDate: '2026-10-20',
        walletId: accounts.cashWalletId,
        containerId: accounts.foodContainerId,
        idempotencyKey: 'fractional',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'VALIDATION',
    );
    await assert.rejects(
      harness.engine.recordTransaction({
        kind: 'expense',
        title: 'Future expense',
        amountMinor: 1_000,
        effectiveDate: '2026-10-21',
        walletId: accounts.cashWalletId,
        containerId: accounts.foodContainerId,
        idempotencyKey: 'future',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'VALIDATION',
    );
    await assert.rejects(
      harness.engine.recordTransaction({
        kind: 'savings',
        title: 'Wrong destination',
        amountMinor: 1_000,
        effectiveDate: '2026-10-20',
        containerId: accounts.foodContainerId,
        destinationContainerId: accounts.foodContainerId,
        idempotencyKey: 'wrong-savings',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'VALIDATION',
    );

    const transactionCount = await harness.database.getFirstAsync<{
      count: number;
    }>('SELECT COUNT(*) AS count FROM transactions');
    const postingCount = await harness.database.getFirstAsync<{
      count: number;
    }>('SELECT COUNT(*) AS count FROM postings');
    const wallets = await harness.engine.getWalletBalances('2026-10-20');

    assert.equal(transactionCount?.count, 1);
    assert.equal(postingCount?.count, 2);
    assert.equal(balance(wallets, accounts.cashWalletId), 10_000);
  } finally {
    harness.database.close();
  }
});

test('duplicate submissions are idempotent and conflicting reuse fails', async () => {
  const { harness, accounts } = await setup();
  try {
    const input = {
      kind: 'income' as const,
      title: 'Allowance',
      amountMinor: 10_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'duplicate-income',
    };
    const first = await harness.engine.recordTransaction(input);
    const second = await harness.engine.recordTransaction(input);

    const count = await harness.database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM transactions',
    );
    const wallets = await harness.engine.getWalletBalances('2026-10-20');

    assert.equal(second.transactionId, first.transactionId);
    assert.equal(count?.count, 1);
    assert.equal(balance(wallets, accounts.cashWalletId), 10_000);

    await assert.rejects(
      harness.engine.recordTransaction({ ...input, amountMinor: 20_000 }),
      (error: unknown) =>
        error instanceof FinanceError &&
        error.code === 'IDEMPOTENCY_CONFLICT',
    );
    assert.equal(
      balance(await harness.engine.getWalletBalances('2026-10-20'), accounts.cashWalletId),
      10_000,
    );
  } finally {
    harness.database.close();
  }
});

test('creation and lifecycle retries return their original result', async () => {
  const harness = await createHarness();
  try {
    const walletInput = {
      name: 'Retry Wallet',
      kind: 'cash' as const,
      icon: 'wallet-outline' as const,
      tone: 'emerald' as const,
      idempotencyKey: 'wallet-retry',
    };
    const wallet1 = await harness.engine.createWallet(walletInput);
    const wallet2 = await harness.engine.createWallet(walletInput);
    assert.equal(wallet2.walletId, wallet1.walletId);

    const containerInput = {
      name: 'Retry Container',
      icon: 'cart-outline' as const,
      tone: 'blue' as const,
      idempotencyKey: 'container-retry',
    };
    const container1 = await harness.engine.createContainer(containerInput);
    const container2 = await harness.engine.createContainer(containerInput);
    assert.equal(container2.containerId, container1.containerId);

    const containerId = container1.containerId;
    const metadataInput = {
      containerId,
      name: 'Retry Container Renamed',
      icon: 'cart-outline' as const,
      tone: 'blue' as const,
      idempotencyKey: 'metadata-retry',
    };
    await harness.engine.updateContainerMetadata(metadataInput);
    await harness.engine.updateContainerMetadata(metadataInput);

    const limitInput = {
      containerId,
      limitMinor: 0,
      idempotencyKey: 'limit-retry',
    };
    await harness.engine.setBudgetLimit(limitInput);
    await harness.engine.setBudgetLimit(limitInput);

    const archiveInput = {
      containerId,
      idempotencyKey: 'archive-retry',
    };
    await harness.engine.archiveContainer(archiveInput);
    await harness.engine.archiveContainer(archiveInput);

    await harness.engine.setBudgetLimit(limitInput);
    await harness.engine.updateContainerMetadata(metadataInput);

    const reactivateInput = {
      containerId,
      idempotencyKey: 'reactivate-retry',
    };
    await harness.engine.reactivateContainer(reactivateInput);
    await harness.engine.reactivateContainer(reactivateInput);

    const deleteInput = {
      containerId,
      idempotencyKey: 'delete-retry',
    };
    await harness.engine.deleteContainer(deleteInput);
    await harness.engine.deleteContainer(deleteInput);

    const deleted = await harness.engine.getContainerSnapshots('2026-10');
    assert.equal(
      deleted.some((container) => container.id === containerId),
      false,
    );
  } finally {
    harness.database.close();
  }
});

test('archiving preserves balances, blocks new activity, and reactivation keeps history', async () => {
  const { harness, accounts } = await setup();
  try {
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'Allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'income-1',
    });
    await harness.engine.archiveContainer({
      containerId: accounts.foodContainerId,
      idempotencyKey: 'archive-food',
    });

    const snapshots = await harness.engine.getContainerSnapshots('2026-10');
    const archived = snapshots.find(
      (container) => container.id === accounts.foodContainerId,
    );

    assert.equal(archived?.status, 'archived');
    assert.equal(archived?.balanceMinor, 100_000);
    assert.equal(
      balance(
        await harness.engine.getContainerBalances('2026-10-20'),
        accounts.foodContainerId,
      ),
      100_000,
    );

    await assert.rejects(
      harness.engine.recordTransaction({
        kind: 'expense',
        title: 'Archived expense',
        amountMinor: 1_000,
        effectiveDate: '2026-10-20',
        walletId: accounts.cashWalletId,
        containerId: accounts.foodContainerId,
        idempotencyKey: 'archived-expense',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'ARCHIVED_CONTAINER',
    );

    await harness.engine.reactivateContainer({
      containerId: accounts.foodContainerId,
      idempotencyKey: 'reactivate-food',
    });
    const reactivated = (await harness.engine.listContainers()).find(
      (container) => container.id === accounts.foodContainerId,
    );
    const lifecycleEvents = await harness.engine.getLifecycleEvents(
      accounts.foodContainerId,
    );
    const transactions = await harness.engine.getTransactionsForMonth('2026-10');

    assert.equal(reactivated?.status, 'active');
    assert.ok(lifecycleEvents.some((event) => event.eventType === 'archived'));
    assert.ok(
      lifecycleEvents.some((event) => event.eventType === 'reactivated'),
    );
    assert.equal(
      transactions[0]?.destinationContainerId,
      accounts.foodContainerId,
    );
  } finally {
    harness.database.close();
  }
});

test('unsafe container deletion is blocked while unused containers are tombstoned', async () => {
  const { harness, accounts } = await setup();
  try {
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'Allowance',
      amountMinor: 10_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'income-1',
    });

    await assert.rejects(
      harness.engine.deleteContainer({
        containerId: accounts.foodContainerId,
        idempotencyKey: 'delete-used-food',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'INVALID_STATE',
    );

    await harness.engine.createContainer({
      id: 'container-unused',
      name: 'Unused',
      description: '',
      icon: 'albums-outline',
      tone: 'blue',
      idempotencyKey: 'create-unused',
    });
    await harness.engine.deleteContainer({
      containerId: 'container-unused',
      idempotencyKey: 'delete-unused',
    });

    const visible = await harness.engine.listContainers();
    const all = await harness.engine.listContainers(true);
    const deleted = all.find((container) => container.id === 'container-unused');

    assert.ok(!visible.some((container) => container.id === 'container-unused'));
    assert.ok(deleted?.deletedAt);
    await assert.rejects(
      harness.engine.recordTransaction({
        kind: 'income',
        title: 'Deleted target',
        amountMinor: 1_000,
        effectiveDate: '2026-10-20',
        walletId: accounts.cashWalletId,
        containerId: 'container-unused',
        idempotencyKey: 'deleted-target',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'NOT_FOUND',
    );
  } finally {
    harness.database.close();
  }
});

test('renames preserve historical transaction labels and current-month display', async () => {
  const harness = await createHarness(new Date(2024, 8, 15, 12));
  try {
    const accounts = await seedStandardAccounts(harness.engine);
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'September allowance',
      amountMinor: 100_000,
      effectiveDate: '2024-09-10',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'september-income',
    });

    harness.clock.set(2024, 9, 20);
    await harness.engine.updateContainerMetadata({
      containerId: accounts.foodContainerId,
      name: 'Groceries',
      description: 'Weekly groceries',
      icon: 'basket-outline',
      tone: 'amber',
      idempotencyKey: 'rename-food',
    });

    const septemberContainers = await harness.engine.getContainerSnapshots('2024-09');
    const octoberContainers = await harness.engine.getContainerSnapshots('2024-10');
    const septemberTransactions =
      await harness.engine.getTransactionsForMonth('2024-09');
    const metadataHistory = await harness.engine.getMetadataHistory(
      accounts.foodContainerId,
    );

    assert.equal(septemberContainers[0]?.name, 'Food & drinks');
    assert.equal(octoberContainers[0]?.name, 'Groceries');
    assert.equal(septemberTransactions[0]?.destinationContainerName, 'Food & drinks');
    assert.equal(metadataHistory.length, 2);

    await assert.rejects(
      harness.engine.updateContainerMetadata({
        containerId: accounts.foodContainerId,
        effectiveMonthKey: '2024-09',
        name: 'Rewritten past',
        description: '',
        icon: 'basket-outline',
        tone: 'amber',
        idempotencyKey: 'rename-past',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'VALIDATION',
    );
  } finally {
    harness.database.close();
  }
});

test('reversals preserve audit history and remove the original from reports', async () => {
  const { harness, accounts } = await setup();
  try {
    const income = await harness.engine.recordTransaction({
      kind: 'income',
      title: 'Allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'income-1',
    });
    const reversal = await harness.engine.reverseTransaction({
      transactionId: income.transactionId,
      reason: 'Duplicate entry',
      idempotencyKey: 'reverse-income',
    });

    const original = await harness.engine.getTransaction(income.transactionId);
    const summary = await harness.engine.getMonthSummary('2026-10', '2026-10');
    const wallets = await harness.engine.getWalletBalances('2026-10-20');
    const transactions = await harness.engine.getTransactionsForMonth('2026-10');

    assert.equal(original?.status, 'reversed');
    assert.equal(original?.reversalOfId, null);
    assert.equal(summary.incomeMinor, 0);
    assert.equal(summary.netSavingsMinor, 0);
    assert.equal(balance(wallets, accounts.cashWalletId), 0);
    assert.ok(transactions.some((transaction) => transaction.reversalOfId === income.transactionId));
    assert.equal(
      (await harness.engine.getTransaction(reversal.reversalId))?.reversalOfId,
      income.transactionId,
    );

    await assert.rejects(
      harness.engine.reverseTransaction({
        transactionId: income.transactionId,
        idempotencyKey: 'reverse-income-again',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'INVALID_STATE',
    );
  } finally {
    harness.database.close();
  }
});

test('corrections reverse in the original period and post the replacement to its period', async () => {
  const harness = await createHarness(new Date(2026, 8, 20, 12));
  try {
    const accounts = await seedStandardAccounts(harness.engine);
    const original = await harness.engine.recordTransaction({
      kind: 'income',
      title: 'Original allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-09-10',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'september-income',
    });
    harness.clock.set(2026, 9, 20);
    const correction = await harness.engine.correctTransaction({
      transactionId: original.transactionId,
      reason: 'Corrected amount and timing',
      replacement: {
        kind: 'income',
        title: 'Corrected allowance',
        amountMinor: 60_000,
        effectiveDate: '2026-10-15',
        walletId: accounts.cashWalletId,
        containerId: accounts.foodContainerId,
      },
      idempotencyKey: 'correct-september-income',
    });
    const retry = await harness.engine.correctTransaction({
      transactionId: original.transactionId,
      reason: 'Corrected amount and timing',
      replacement: {
        kind: 'income',
        title: 'Corrected allowance',
        amountMinor: 60_000,
        effectiveDate: '2026-10-15',
        walletId: accounts.cashWalletId,
        containerId: accounts.foodContainerId,
      },
      idempotencyKey: 'correct-september-income',
    });

    const september = await harness.engine.getMonthSummary('2026-09', '2026-10');
    const october = await harness.engine.getMonthSummary('2026-10', '2026-10');
    const originalRow = await harness.engine.getTransaction(original.transactionId);
    const reversalRow = await harness.engine.getTransaction(correction.reversalId);
    const replacementRow = await harness.engine.getTransaction(
      correction.replacementId,
    );
    const wallets = await harness.engine.getWalletBalances('2026-10-20');

    assert.equal(september.incomeMinor, 0);
    assert.equal(october.incomeMinor, 60_000);
    assert.equal(originalRow?.status, 'reversed');
    assert.equal(reversalRow?.effectiveMonthKey, '2026-09');
    assert.equal(reversalRow?.reversalOfId, original.transactionId);
    assert.equal(replacementRow?.effectiveMonthKey, '2026-10');
    assert.equal(replacementRow?.correctionOfId, original.transactionId);
    assert.equal(balance(wallets, accounts.cashWalletId), 60_000);
    assert.equal(retry.reversalId, correction.reversalId);
    assert.equal(retry.replacementId, correction.replacementId);
  } finally {
    harness.database.close();
  }
});

test('a failed correction rolls back the reversal and leaves the original posted', async () => {
  const { harness, accounts } = await setup();
  try {
    const original = await harness.engine.recordTransaction({
      kind: 'income',
      title: 'Allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'income-1',
    });

    await assert.rejects(
      harness.engine.correctTransaction({
        transactionId: original.transactionId,
        replacement: {
          kind: 'expense',
          title: 'Impossible replacement',
          amountMinor: 200_000,
          effectiveDate: '2026-10-20',
          walletId: accounts.cashWalletId,
          containerId: accounts.foodContainerId,
        },
        idempotencyKey: 'failed-correction',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'INSUFFICIENT_FUNDS',
    );

    const row = await harness.engine.getTransaction(original.transactionId);
    const summary = await harness.engine.getMonthSummary('2026-10', '2026-10');
    const wallets = await harness.engine.getWalletBalances('2026-10-20');
    const transactions = await harness.database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM transactions',
    );
    const reversalReceipt = await harness.database.getFirstAsync<{
      count: number;
    }>(
      `SELECT COUNT(*) AS count FROM operation_receipts
       WHERE idempotency_key = ?`,
      ['failed-correction'],
    );

    assert.equal(row?.status, 'posted');
    assert.equal(summary.incomeMinor, 100_000);
    assert.equal(balance(wallets, accounts.cashWalletId), 100_000);
    assert.equal(transactions?.count, 1);
    assert.equal(reversalReceipt?.count, 0);
  } finally {
    harness.database.close();
  }
});

test('monthly budget limits are planning data and cannot rewrite balances', async () => {
  const { harness, accounts } = await setup();
  try {
    await harness.engine.recordTransaction({
      kind: 'income',
      title: 'Allowance',
      amountMinor: 100_000,
      effectiveDate: '2026-10-20',
      walletId: accounts.cashWalletId,
      containerId: accounts.foodContainerId,
      idempotencyKey: 'income-1',
    });
    const before = await harness.engine.getMonthSummary('2026-10', '2026-10');

    await harness.engine.setBudgetLimit({
      containerId: accounts.foodContainerId,
      limitMinor: 150_000,
      idempotencyKey: 'raise-limit',
    });
    const after = await harness.engine.getMonthSummary('2026-10', '2026-10');
    const wallets = await harness.engine.getWalletBalances('2026-10-20');

    assert.equal(before.totalLimitMinor, 100_000);
    assert.equal(after.totalLimitMinor, 150_000);
    assert.equal(after.totalSpentMinor, before.totalSpentMinor);
    assert.equal(after.netSavingsMinor, before.netSavingsMinor);
    assert.equal(balance(wallets, accounts.cashWalletId), 100_000);

    await assert.rejects(
      harness.engine.setBudgetLimit({
        containerId: accounts.foodContainerId,
        monthKey: '2026-09',
        limitMinor: 50_000,
        idempotencyKey: 'past-limit',
      }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'VALIDATION',
    );
  } finally {
    harness.database.close();
  }
});
