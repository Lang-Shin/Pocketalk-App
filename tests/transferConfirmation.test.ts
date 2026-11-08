import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildContainerTransferConfirmation,
  containerTransferDirection,
  isTransferConfirmationCurrent,
  type ContainerTransferEndpoint,
} from '../src/components/finance/transferConfirmation';
import { FinanceService } from '../src/data/financeService';
import { FinanceError } from '../src/db/errors';
import {
  SAVINGS_CONTAINER_ID,
  UNALLOCATED_CONTAINER_ID,
} from '../src/db/systemContainers';
import { createHarness } from './helpers/financeTestHarness';

const UNALLOCATED: ContainerTransferEndpoint = {
  id: UNALLOCATED_CONTAINER_ID,
  name: 'Unallocated',
  systemKey: 'unallocated',
};
const SAVINGS: ContainerTransferEndpoint = {
  id: SAVINGS_CONTAINER_ID,
  name: 'Savings',
  systemKey: 'savings',
};
const FOOD: ContainerTransferEndpoint = {
  id: 'container-food',
  name: 'Food & drinks',
  systemKey: null,
};

function draft(
  overrides: Partial<{
    amountText: string;
    title: string;
    effectiveDate: string;
    sourceContainerId: string;
    destinationContainerId: string;
  }> = {},
) {
  return {
    amountText: '1000',
    title: 'Move money',
    effectiveDate: '2026-10-20',
    sourceContainerId: SAVINGS.id,
    destinationContainerId: UNALLOCATED.id,
    ...overrides,
  };
}

test('generic transfer defaults are never silently executable', () => {
  // Fresh form state: no endpoints chosen. Both must be selected.
  const empty = buildContainerTransferConfirmation(
    draft({ sourceContainerId: '', destinationContainerId: '' }),
    undefined,
    undefined,
  );
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.reason, 'choose_source');

  const destinationOnly = buildContainerTransferConfirmation(
    draft({ sourceContainerId: '' }),
    undefined,
    SAVINGS,
  );
  assert.equal(destinationOnly.ok, false);
  if (!destinationOnly.ok) assert.equal(destinationOnly.reason, 'choose_source');

  const sourceOnly = buildContainerTransferConfirmation(
    draft({ destinationContainerId: '' }),
    SAVINGS,
    undefined,
  );
  assert.equal(sourceOnly.ok, false);
  if (!sourceOnly.ok) assert.equal(sourceOnly.reason, 'choose_destination');
});

test('preset endpoint alone is still not submittable', () => {
  // "Withdraw from Savings" presets the source; the user must still choose
  // the destination.
  const preset = buildContainerTransferConfirmation(
    draft({ sourceContainerId: SAVINGS.id, destinationContainerId: '' }),
    SAVINGS,
    undefined,
  );
  assert.equal(preset.ok, false);
  if (!preset.ok) assert.equal(preset.reason, 'choose_destination');
});

test('same-container and invalid amounts are rejected before writing', () => {
  const same = buildContainerTransferConfirmation(
    draft({ destinationContainerId: SAVINGS.id }),
    SAVINGS,
    SAVINGS,
  );
  assert.equal(same.ok, false);
  if (!same.ok) assert.equal(same.reason, 'same_container');

  for (const amountText of ['', '0', '-5', 'abc', '1.234']) {
    const invalid = buildContainerTransferConfirmation(
      draft({ amountText }),
      SAVINGS,
      UNALLOCATED,
    );
    assert.equal(invalid.ok, false, amountText);
    if (!invalid.ok) assert.equal(invalid.reason, 'invalid_amount');
  }
});

test('confirmation summary shows the exact amount and direction chosen', () => {
  const withdrawal = buildContainerTransferConfirmation(
    draft(),
    SAVINGS,
    UNALLOCATED,
  );
  assert.equal(withdrawal.ok, true);
  if (!withdrawal.ok) return;
  assert.equal(withdrawal.confirmation.amountMinor, 100_000);
  assert.equal(withdrawal.confirmation.sourceContainerId, SAVINGS.id);
  assert.equal(withdrawal.confirmation.destinationContainerId, UNALLOCATED.id);
  assert.equal(withdrawal.confirmation.direction, 'savings_withdrawal');
  assert.equal(
    withdrawal.confirmation.summary,
    'Move \u20B11,000.00 from Savings to Unallocated',
  );

  const contribution = buildContainerTransferConfirmation(
    draft(),
    UNALLOCATED,
    SAVINGS,
  );
  assert.equal(contribution.ok, true);
  if (!contribution.ok) return;
  assert.equal(contribution.confirmation.direction, 'savings_contribution');
  assert.equal(
    contribution.confirmation.summary,
    'Move \u20B11,000.00 from Unallocated to Savings',
  );
});

test('editing any confirmed value invalidates the earlier confirmation', () => {
  const built = buildContainerTransferConfirmation(
    draft(),
    SAVINGS,
    UNALLOCATED,
  );
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const confirmation = built.confirmation;

  assert.equal(isTransferConfirmationCurrent(confirmation, draft()), true);
  for (const change of [
    { amountText: '1001' },
    { sourceContainerId: UNALLOCATED.id },
    { destinationContainerId: FOOD.id },
    { effectiveDate: '2026-10-19' },
    { title: 'Other' },
  ]) {
    assert.equal(
      isTransferConfirmationCurrent(confirmation, draft(change)),
      false,
      JSON.stringify(change),
    );
  }
});

test('direction classification maps all four Savings routes', () => {
  assert.equal(containerTransferDirection(UNALLOCATED, SAVINGS), 'savings_contribution');
  assert.equal(containerTransferDirection(SAVINGS, UNALLOCATED), 'savings_withdrawal');
  assert.equal(containerTransferDirection(SAVINGS, FOOD), 'savings_withdrawal');
  assert.equal(containerTransferDirection(FOOD, SAVINGS), 'savings_contribution');
  assert.equal(containerTransferDirection(UNALLOCATED, FOOD), 'container_transfer');
});

async function setup(): Promise<{
  harness: Awaited<ReturnType<typeof createHarness>>;
  service: FinanceService;
  foodContainerId: string;
}> {
  const harness = await createHarness(new Date(2026, 9, 20, 12));
  const service = new FinanceService(harness.engine, {
    now: harness.clock.now,
  });
  await service.initialize();
  const food = await service.createContainer({
    name: 'Food & drinks',
    description: '',
    icon: 'restaurant-outline',
    tone: 'coral',
    limitMinor: 0,
    monthKey: '2026-10',
  });
  await service.recordMoneyEntry({
    mode: 'income',
    amountMinor: 200_000,
    title: 'Allowance',
    effectiveDate: '2026-10-20',
    walletId: 'wallet-cash',
    containerId: UNALLOCATED_CONTAINER_ID,
    idempotencyKey: 'setup-income',
  });
  return { harness, service, foodContainerId: food.containerId };
}

function balancesOf(
  containers: { id: string; balanceMinor: number }[],
  ids: string[],
): number[] {
  return ids.map(
    (id) =>
      containers.find((container) => container.id === id)?.balanceMinor ?? 0,
  );
}

test('Savings contribution and withdrawal persist the confirmed direction', async () => {
  const { harness, service, foodContainerId } = await setup();
  try {
    const walletBefore = (await service.getWalletView()).totalBalanceMinor;

    await service.recordMoneyEntry({
      mode: 'container_transfer',
      amountMinor: 100_000,
      title: 'Add to Savings',
      effectiveDate: '2026-10-20',
      containerId: UNALLOCATED_CONTAINER_ID,
      destinationContainerId: SAVINGS_CONTAINER_ID,
      idempotencyKey: 'u-to-s',
    });

    let month = await service.getMonthView('2026-10');
    assert.deepEqual(
      balancesOf(month.containers, [
        UNALLOCATED_CONTAINER_ID,
        SAVINGS_CONTAINER_ID,
      ]),
      [100_000, 100_000],
    );
    assert.equal(month.summary.savingsContributionsMinor, 100_000);
    assert.equal(month.summary.savingsWithdrawalsMinor, 0);
    assert.equal(month.summary.netSavingsMinor, 200_000);

    const contribution = month.transactions.find(
      (transaction) => transaction.id !== undefined && transaction.kind === 'savings',
    );
    assert.ok(contribution);
    assert.equal(contribution.sourceContainerId, UNALLOCATED_CONTAINER_ID);
    assert.equal(contribution.destinationContainerId, SAVINGS_CONTAINER_ID);
    assert.equal(contribution.sourceContainerName, 'Unallocated');
    assert.equal(contribution.destinationContainerName, 'Savings');

    await service.recordMoneyEntry({
      mode: 'container_transfer',
      amountMinor: 40_000,
      title: 'Withdraw from Savings',
      effectiveDate: '2026-10-20',
      containerId: SAVINGS_CONTAINER_ID,
      destinationContainerId: UNALLOCATED_CONTAINER_ID,
      idempotencyKey: 's-to-u',
    });

    month = await service.getMonthView('2026-10');
    assert.deepEqual(
      balancesOf(month.containers, [
        UNALLOCATED_CONTAINER_ID,
        SAVINGS_CONTAINER_ID,
      ]),
      [140_000, 60_000],
    );
    assert.equal(month.summary.savingsContributionsMinor, 100_000);
    assert.equal(month.summary.savingsWithdrawalsMinor, 40_000);
    assert.equal(month.summary.netSavingsMinor, 200_000);

    const withdrawal = month.transactions.find(
      (transaction) =>
        transaction.kind === 'savings' &&
        transaction.destinationContainerId === UNALLOCATED_CONTAINER_ID,
    );
    assert.ok(withdrawal);
    assert.equal(withdrawal.sourceContainerId, SAVINGS_CONTAINER_ID);
    assert.equal(withdrawal.sourceContainerName, 'Savings');
    assert.equal(withdrawal.destinationContainerName, 'Unallocated');

    // Savings -> ordinary container and ordinary -> Savings.
    await service.recordMoneyEntry({
      mode: 'container_transfer',
      amountMinor: 20_000,
      title: 'Savings to food',
      effectiveDate: '2026-10-20',
      containerId: SAVINGS_CONTAINER_ID,
      destinationContainerId: foodContainerId,
      idempotencyKey: 's-to-food',
    });
    await service.recordMoneyEntry({
      mode: 'container_transfer',
      amountMinor: 5_000,
      title: 'Food to savings',
      effectiveDate: '2026-10-20',
      containerId: foodContainerId,
      destinationContainerId: SAVINGS_CONTAINER_ID,
      idempotencyKey: 'food-to-s',
    });

    month = await service.getMonthView('2026-10');
    assert.deepEqual(
      balancesOf(month.containers, [
        SAVINGS_CONTAINER_ID,
        foodContainerId,
      ]),
      [45_000, 15_000],
    );

    // Wallet totals are unaffected by container-only transfers.
    assert.equal(
      (await service.getWalletView()).totalBalanceMinor,
      walletBefore,
    );
    assert.equal(
      await harness.engine.repository.allWalletContainerTotalsMatch('2026-10-20'),
      true,
    );
  } finally {
    harness.database.close();
  }
});

test('Savings withdrawal above the available balance is rejected atomically', async () => {
  const { harness, service } = await setup();
  try {
    await service.recordMoneyEntry({
      mode: 'container_transfer',
      amountMinor: 10_000,
      title: 'Small savings',
      effectiveDate: '2026-10-20',
      containerId: UNALLOCATED_CONTAINER_ID,
      destinationContainerId: SAVINGS_CONTAINER_ID,
      idempotencyKey: 'seed-savings',
    });
    const before = await service.getMonthView('2026-10');

    await assert.rejects(
      () =>
        service.recordMoneyEntry({
          mode: 'container_transfer',
          amountMinor: 10_001,
          title: 'Too much',
          effectiveDate: '2026-10-20',
          containerId: SAVINGS_CONTAINER_ID,
          destinationContainerId: UNALLOCATED_CONTAINER_ID,
          idempotencyKey: 'over-savings',
        }),
      (error: unknown) =>
        error instanceof FinanceError &&
        error.code === 'INSUFFICIENT_FUNDS',
    );

    const after = await service.getMonthView('2026-10');
    assert.deepEqual(
      balancesOf(after.containers, [
        UNALLOCATED_CONTAINER_ID,
        SAVINGS_CONTAINER_ID,
      ]),
      balancesOf(before.containers, [
        UNALLOCATED_CONTAINER_ID,
        SAVINGS_CONTAINER_ID,
      ]),
    );
    assert.equal(after.transactions.length, before.transactions.length);
  } finally {
    harness.database.close();
  }
});

test('same-container transfers are rejected and write nothing', async () => {
  const { harness, service } = await setup();
  try {
    const before = await service.getMonthView('2026-10');
    await assert.rejects(
      () =>
        service.recordMoneyEntry({
          mode: 'container_transfer',
          amountMinor: 1_000,
          title: 'Same container',
          effectiveDate: '2026-10-20',
          containerId: SAVINGS_CONTAINER_ID,
          destinationContainerId: SAVINGS_CONTAINER_ID,
          idempotencyKey: 'same-container',
        }),
      (error: unknown) =>
        error instanceof FinanceError && error.code === 'VALIDATION',
    );
    const after = await service.getMonthView('2026-10');
    assert.equal(after.transactions.length, before.transactions.length);
  } finally {
    harness.database.close();
  }
});

test('duplicate confirmed submissions post exactly one transfer', async () => {
  const { harness, service } = await setup();
  try {
    const entry = {
      mode: 'container_transfer' as const,
      amountMinor: 25_000,
      title: 'Withdraw from Savings',
      effectiveDate: '2026-10-20',
      containerId: SAVINGS_CONTAINER_ID,
      destinationContainerId: UNALLOCATED_CONTAINER_ID,
      idempotencyKey: 'confirmed-withdrawal',
    };

    await service.recordMoneyEntry({
      ...entry,
      containerId: UNALLOCATED_CONTAINER_ID,
      destinationContainerId: SAVINGS_CONTAINER_ID,
      idempotencyKey: 'seed',
    });
    const first = await service.recordMoneyEntry(entry);
    const second = await service.recordMoneyEntry(entry);

    assert.equal(first.transactionId, second.transactionId);
    const month = await service.getMonthView('2026-10');
    assert.deepEqual(
      balancesOf(month.containers, [
        UNALLOCATED_CONTAINER_ID,
        SAVINGS_CONTAINER_ID,
      ]),
      [200_000, 0],
    );
  } finally {
    harness.database.close();
  }
});
