import { FinanceEngine } from '../../src/db/financeEngine';
import { migrateDatabase } from '../../src/db/migrations';
import { NodeSqlDatabase } from './nodeSqlDatabase';

export interface AccountIds {
  cashWalletId: string;
  gcashWalletId: string;
  foodContainerId: string;
  savingsContainerId: string;
}

export class TestClock {
  private current: Date;

  constructor(year = 2026, monthIndex = 9, day = 20, hour = 12) {
    this.current = new Date(year, monthIndex, day, hour, 0, 0);
  }

  readonly now = (): Date => new Date(this.current);

  set(year: number, monthIndex: number, day: number, hour = 12): void {
    this.current = new Date(year, monthIndex, day, hour, 0, 0);
  }
}

export function createTestIdFactory(): (prefix: string) => string {
  let sequence = 0;
  return (prefix) => {
    sequence += 1;
    return `${prefix}-test-${String(sequence).padStart(3, '0')}`;
  };
}

export interface TestHarness {
  database: NodeSqlDatabase;
  engine: FinanceEngine;
  clock: TestClock;
}

export async function createHarness(
  date = new Date(2026, 9, 20, 12, 0, 0),
): Promise<TestHarness> {
  const database = new NodeSqlDatabase();
  await migrateDatabase(database);
  const clock = new TestClock(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
  );
  const engine = new FinanceEngine(database, {
    now: clock.now,
    idFactory: createTestIdFactory(),
  });
  return { database, engine, clock };
}

export async function seedStandardAccounts(
  engine: FinanceEngine,
): Promise<AccountIds> {
  const cashWalletId = 'wallet-cash';
  const gcashWalletId = 'wallet-gcash';
  const foodContainerId = 'container-food';
  const savingsContainerId = 'container-savings';

  await engine.createWallet({
    id: cashWalletId,
    name: 'Cash on hand',
    kind: 'cash',
    icon: 'cash-outline',
    tone: 'amber',
    idempotencyKey: 'seed-wallet-cash',
  });
  await engine.createWallet({
    id: gcashWalletId,
    name: 'Virtual GCash',
    kind: 'virtual_gcash',
    icon: 'phone-portrait-outline',
    tone: 'blue',
    idempotencyKey: 'seed-wallet-gcash',
  });
  await engine.createContainer({
    id: foodContainerId,
    name: 'Food & drinks',
    description: 'Meals and snacks',
    icon: 'restaurant-outline',
    tone: 'coral',
    limitMinor: 100_000,
    idempotencyKey: 'seed-container-food',
  });
  await engine.createContainer({
    id: savingsContainerId,
    name: 'Emergency fund',
    description: 'Savings',
    icon: 'flag-outline',
    tone: 'emerald',
    kind: 'savings',
    idempotencyKey: 'seed-container-savings',
  });

  return {
    cashWalletId,
    gcashWalletId,
    foodContainerId,
    savingsContainerId,
  };
}

let incomeSequence = 0;

export async function recordIncome(
  engine: FinanceEngine,
  accounts: AccountIds,
  amountMinor: number,
  options: {
    effectiveDate?: string;
    walletId?: string;
    containerId?: string;
    title?: string;
    idempotencyKey?: string;
  } = {},
): Promise<string> {
  incomeSequence += 1;
  const result = await engine.recordTransaction({
    kind: 'income',
    title: options.title ?? 'Allowance',
    amountMinor,
    effectiveDate: options.effectiveDate ?? '2026-10-20',
    walletId: options.walletId ?? accounts.cashWalletId,
    containerId: options.containerId ?? accounts.foodContainerId,
    idempotencyKey:
      options.idempotencyKey ?? `income-${amountMinor}-${incomeSequence}`,
  });
  return result.transactionId;
}
