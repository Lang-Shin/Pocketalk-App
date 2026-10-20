import type {
  BudgetContainer,
  ContainerLabel,
  FinanceState,
  SavingsGoal,
  Transaction,
  TransactionKind,
  TransactionStatus,
  Wallet,
} from './models';
import { captureRecordedStamp } from '@/lib/date';
import {
  currentMonthKey,
  getMonthDateKey,
  getMonthKeysBack,
} from '@/lib/period';
import type { IconName } from '@/lib/icons';
import type { Tone } from '@/theme';

const wallets: Wallet[] = [
  {
    id: 'wallet-cash',
    name: 'Cash on hand',
    kind: 'cash',
    icon: 'cash-outline',
    tone: 'amber',
  },
  {
    id: 'wallet-gcash',
    name: 'Virtual GCash',
    kind: 'virtual_gcash',
    icon: 'phone-portrait-outline',
    tone: 'blue',
  },
];

export const mockSavingsGoal: SavingsGoal = {
  id: 'goal-emergency',
  name: 'Emergency fund',
  containerId: 'container-savings',
  targetMinor: 500_000,
  icon: 'flag-outline',
  tone: 'emerald',
};

interface SeedInput {
  id: string;
  title: string;
  amountMinor: number;
  monthOffset: number;
  day: number;
  dayInCurrentMonth?: number;
  kind: TransactionKind;
  sourceWalletId?: string;
  destinationWalletId?: string;
  sourceContainerId?: string;
  destinationContainerId?: string;
  status?: TransactionStatus;
  icon: IconName;
  tone: Tone;
  category?: string;
}

export function buildMockFinanceState(now = new Date()): FinanceState {
  const activeMonthKey = currentMonthKey(now);
  const months = getMonthKeysBack(6, activeMonthKey);
  const monthByOffset = new Map<number, string>();
  months.forEach((monthKey, index) => {
    monthByOffset.set(index - 5, monthKey);
  });

  const currentDay = now.getDate();

  const effectiveDateFor = (offset: number, day: number) => {
    const monthKey = monthByOffset.get(offset) ?? activeMonthKey;
    if (offset === 0) {
      return getMonthDateKey(monthKey, Math.min(day, currentDay));
    }
    return getMonthDateKey(monthKey, day);
  };

  const baseContainers: Omit<BudgetContainer, 'labelsByMonth'>[] = [
    {
      id: 'container-food',
      name: 'Food & drinks',
      description: 'Meals, snacks, and coffee',
      icon: 'restaurant-outline',
      tone: 'coral',
      kind: 'budget',
      status: 'active',
      sortOrder: 1,
      createdMonthKey: months[0] ?? activeMonthKey,
      limitsByMonth: monthlyLimits(months, 120_000),
    },
    {
      id: 'container-transport',
      name: 'Transportation',
      description: 'Jeepney, bus, and rides',
      icon: 'bus-outline',
      tone: 'blue',
      kind: 'budget',
      status: 'active',
      sortOrder: 2,
      createdMonthKey: months[0] ?? activeMonthKey,
      limitsByMonth: monthlyLimits(months, 60_000),
    },
    {
      id: 'container-school',
      name: 'School essentials',
      description: 'Supplies and printing',
      icon: 'book-outline',
      tone: 'violet',
      kind: 'budget',
      status: 'active',
      sortOrder: 3,
      createdMonthKey: months[0] ?? activeMonthKey,
      limitsByMonth: monthlyLimits(months, 50_000),
    },
    {
      id: 'container-fun',
      name: 'Fun money',
      description: 'Guilt-free extras',
      icon: 'game-controller-outline',
      tone: 'amber',
      kind: 'budget',
      status: 'active',
      sortOrder: 4,
      createdMonthKey: months[0] ?? activeMonthKey,
      limitsByMonth: monthlyLimits(months, 40_000),
    },
    {
      id: 'container-bills',
      name: 'Load & bills',
      description: 'Phone load and shared internet',
      icon: 'phone-portrait-outline',
      tone: 'blue',
      kind: 'budget',
      status: 'archived',
      sortOrder: 5,
      createdMonthKey: months[0] ?? activeMonthKey,
      archivedAt: new Date(`${activeMonthKey}-01T08:00:00`).toISOString(),
      limitsByMonth: {
        ...monthlyLimits(months, 80_000),
        [activeMonthKey]: 0,
      },
    },
    {
      id: 'container-savings',
      name: 'Emergency fund',
      description: 'A calmer cushion for surprises',
      icon: 'flag-outline',
      tone: 'emerald',
      kind: 'savings',
      status: 'active',
      sortOrder: 6,
      createdMonthKey: months[0] ?? activeMonthKey,
      limitsByMonth: Object.fromEntries(months.map((month) => [month, 0])),
    },
  ];

  const containers: BudgetContainer[] = baseContainers.map((container) => ({
    ...container,
    labelsByMonth: monthlyLabels(months, {
      name: container.name,
      description: container.description,
      icon: container.icon,
      tone: container.tone,
    }),
  }));

  const containerById = new Map(containers.map((container) => [container.id, container]));
  const walletById = new Map(wallets.map((wallet) => [wallet.id, wallet]));
  const transactions: Transaction[] = [];

  const add = (input: SeedInput) => {
    const effectiveDate = effectiveDateFor(
      input.monthOffset,
      input.dayInCurrentMonth ?? input.day,
    );
    const sourceWallet = input.sourceWalletId
      ? walletById.get(input.sourceWalletId)
      : undefined;
    const destinationWallet = input.destinationWalletId
      ? walletById.get(input.destinationWalletId)
      : undefined;
    const sourceContainer = input.sourceContainerId
      ? containerById.get(input.sourceContainerId)
      : undefined;
    const destinationContainer = input.destinationContainerId
      ? containerById.get(input.destinationContainerId)
      : undefined;
    const recorded = captureRecordedStamp(
      new Date(`${effectiveDate}T12:00:00`),
    );

    transactions.push({
      id: input.id,
      title: input.title,
      category:
        input.category ??
        destinationContainer?.name ??
        sourceContainer?.name ??
        (input.kind === 'income' ? 'Income' : 'Transfer'),
      kind: input.kind,
      direction:
        input.kind === 'income'
          ? 'in'
          : input.kind === 'expense'
            ? 'out'
            : 'neutral',
      amountMinor: input.amountMinor,
      effectiveDate,
      ...recorded,
      status: input.status ?? 'posted',
      sourceWalletId: sourceWallet?.id,
      destinationWalletId: destinationWallet?.id,
      sourceContainerId: sourceContainer?.id,
      destinationContainerId: destinationContainer?.id,
      sourceWalletName: sourceWallet?.name,
      destinationWalletName: destinationWallet?.name,
      sourceContainerName: sourceContainer?.name,
      destinationContainerName: destinationContainer?.name,
      icon: input.icon,
      tone: input.tone,
    });
  };

  add({
    id: 'seed-opening',
    title: 'Opening allowance',
    amountMinor: 300_000,
    monthOffset: -5,
    day: 1,
    kind: 'income',
    destinationWalletId: 'wallet-gcash',
    destinationContainerId: 'container-food',
    icon: 'arrow-down',
    tone: 'emerald',
  });

  add({
    id: 'seed-opening-savings',
    title: 'Moved to opening cushion',
    amountMinor: 120_000,
    monthOffset: -5,
    day: 2,
    kind: 'savings',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-savings',
    icon: 'flag-outline',
    tone: 'emerald',
  });
  add({
    id: 'seed-opening-transport',
    title: 'Funded transport',
    amountMinor: 40_000,
    monthOffset: -5,
    day: 2,
    kind: 'container_transfer',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-transport',
    icon: 'swap-horizontal-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-opening-school',
    title: 'Funded school supplies',
    amountMinor: 40_000,
    monthOffset: -5,
    day: 2,
    kind: 'container_transfer',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-school',
    icon: 'swap-horizontal-outline',
    tone: 'violet',
  });
  add({
    id: 'seed-opening-fun',
    title: 'Funded fun money',
    amountMinor: 20_000,
    monthOffset: -5,
    day: 2,
    kind: 'container_transfer',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-fun',
    icon: 'swap-horizontal-outline',
    tone: 'amber',
  });
  add({
    id: 'seed-opening-bills',
    title: 'Funded load and bills',
    amountMinor: 30_000,
    monthOffset: -5,
    day: 2,
    kind: 'container_transfer',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-bills',
    icon: 'swap-horizontal-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-opening-wallet-transfer',
    title: 'Cash for the week',
    amountMinor: 100_000,
    monthOffset: -5,
    day: 3,
    kind: 'wallet_transfer',
    sourceWalletId: 'wallet-gcash',
    destinationWalletId: 'wallet-cash',
    icon: 'swap-horizontal-outline',
    tone: 'blue',
    category: 'Wallet transfer',
  });

  add({
    id: 'seed-m5-lunch',
    title: 'Cafeteria lunch',
    amountMinor: 15_000,
    monthOffset: -5,
    day: 8,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-food',
    icon: 'restaurant-outline',
    tone: 'coral',
  });
  add({
    id: 'seed-m5-jeep',
    title: 'Jeepney fare',
    amountMinor: 3_000,
    monthOffset: -5,
    day: 9,
    kind: 'expense',
    sourceWalletId: 'wallet-cash',
    sourceContainerId: 'container-transport',
    icon: 'bus-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-m5-print',
    title: 'Printed a reflection',
    amountMinor: 8_000,
    monthOffset: -5,
    day: 11,
    kind: 'expense',
    sourceWalletId: 'wallet-cash',
    sourceContainerId: 'container-school',
    icon: 'print-outline',
    tone: 'violet',
  });
  add({
    id: 'seed-m5-load',
    title: 'Phone load',
    amountMinor: 10_000,
    monthOffset: -5,
    day: 12,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-bills',
    icon: 'phone-portrait-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-m5-snack',
    title: 'Movie night snack',
    amountMinor: 5_000,
    monthOffset: -5,
    day: 15,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-fun',
    icon: 'fast-food-outline',
    tone: 'amber',
  });

  add({
    id: 'seed-m4-allowance',
    title: `Allowance from Mama`,
    amountMinor: 320_000,
    monthOffset: -4,
    day: 1,
    kind: 'income',
    destinationWalletId: 'wallet-gcash',
    destinationContainerId: 'container-food',
    icon: 'arrow-down',
    tone: 'emerald',
  });
  add({
    id: 'seed-m4-stipend',
    title: 'Scholarship stipend',
    amountMinor: 100_000,
    monthOffset: -4,
    day: 3,
    kind: 'income',
    destinationWalletId: 'wallet-gcash',
    destinationContainerId: 'container-school',
    icon: 'school-outline',
    tone: 'emerald',
  });
  add({
    id: 'seed-m4-transfer-transport',
    title: 'Funded transport',
    amountMinor: 50_000,
    monthOffset: -4,
    day: 4,
    kind: 'container_transfer',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-transport',
    icon: 'swap-horizontal-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-m4-transfer-fun',
    title: 'Funded fun money',
    amountMinor: 25_000,
    monthOffset: -4,
    day: 4,
    kind: 'container_transfer',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-fun',
    icon: 'swap-horizontal-outline',
    tone: 'amber',
  });
  add({
    id: 'seed-m4-savings',
    title: 'Moved to emergency fund',
    amountMinor: 60_000,
    monthOffset: -4,
    day: 5,
    kind: 'savings',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-savings',
    icon: 'flag-outline',
    tone: 'emerald',
  });
  add({
    id: 'seed-m4-transfer-bills',
    title: 'Funded load and bills',
    amountMinor: 40_000,
    monthOffset: -4,
    day: 5,
    kind: 'container_transfer',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-bills',
    icon: 'swap-horizontal-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-m4-food',
    title: 'Meals for the week',
    amountMinor: 92_000,
    monthOffset: -4,
    day: 14,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-food',
    icon: 'restaurant-outline',
    tone: 'coral',
  });
  add({
    id: 'seed-m4-transport',
    title: 'Bus and jeepney fares',
    amountMinor: 36_000,
    monthOffset: -4,
    day: 16,
    kind: 'expense',
    sourceWalletId: 'wallet-cash',
    sourceContainerId: 'container-transport',
    icon: 'bus-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-m4-school',
    title: 'Notebook and printing',
    amountMinor: 20_000,
    monthOffset: -4,
    day: 18,
    kind: 'expense',
    sourceWalletId: 'wallet-cash',
    sourceContainerId: 'container-school',
    icon: 'journal-outline',
    tone: 'violet',
  });
  add({
    id: 'seed-m4-fun',
    title: 'Weekend movie',
    amountMinor: 27_000,
    monthOffset: -4,
    day: 20,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-fun',
    icon: 'film-outline',
    tone: 'amber',
  });
  add({
    id: 'seed-m4-bills',
    title: 'Data promo and internet',
    amountMinor: 38_000,
    monthOffset: -4,
    day: 21,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-bills',
    icon: 'wifi-outline',
    tone: 'blue',
  });

  add({
    id: 'seed-m3-allowance',
    title: 'Allowance from Mama',
    amountMinor: 330_000,
    monthOffset: -3,
    day: 1,
    kind: 'income',
    destinationWalletId: 'wallet-gcash',
    destinationContainerId: 'container-food',
    icon: 'arrow-down',
    tone: 'emerald',
  });
  add({
    id: 'seed-m3-stipend',
    title: 'Scholarship stipend',
    amountMinor: 150_000,
    monthOffset: -3,
    day: 2,
    kind: 'income',
    destinationWalletId: 'wallet-gcash',
    destinationContainerId: 'container-school',
    icon: 'school-outline',
    tone: 'emerald',
  });
  add({
    id: 'seed-m3-wallet',
    title: 'Cash for the week',
    amountMinor: 100_000,
    monthOffset: -3,
    day: 3,
    kind: 'wallet_transfer',
    sourceWalletId: 'wallet-gcash',
    destinationWalletId: 'wallet-cash',
    icon: 'swap-horizontal-outline',
    tone: 'blue',
    category: 'Wallet transfer',
  });
  add({
    id: 'seed-m3-transfer-transport',
    title: 'Funded transport',
    amountMinor: 45_000,
    monthOffset: -3,
    day: 4,
    kind: 'container_transfer',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-transport',
    icon: 'swap-horizontal-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-m3-savings',
    title: 'Moved to emergency fund',
    amountMinor: 70_000,
    monthOffset: -3,
    day: 5,
    kind: 'savings',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-savings',
    icon: 'flag-outline',
    tone: 'emerald',
  });
  add({
    id: 'seed-m3-savings-income',
    title: 'Saved birthday gift',
    amountMinor: 50_000,
    monthOffset: -3,
    day: 6,
    kind: 'income',
    destinationWalletId: 'wallet-gcash',
    destinationContainerId: 'container-savings',
    icon: 'gift-outline',
    tone: 'emerald',
  });
  add({
    id: 'seed-m3-fun',
    title: 'Funded fun money',
    amountMinor: 30_000,
    monthOffset: -3,
    day: 6,
    kind: 'container_transfer',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-fun',
    icon: 'swap-horizontal-outline',
    tone: 'amber',
  });
  add({
    id: 'seed-m3-bills',
    title: 'Funded load and bills',
    amountMinor: 35_000,
    monthOffset: -3,
    day: 6,
    kind: 'container_transfer',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-bills',
    icon: 'swap-horizontal-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-m3-food',
    title: 'Groceries and meals',
    amountMinor: 101_000,
    monthOffset: -3,
    day: 13,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-food',
    icon: 'restaurant-outline',
    tone: 'coral',
  });
  add({
    id: 'seed-m3-transport',
    title: 'Fares and one ride',
    amountMinor: 42_000,
    monthOffset: -3,
    day: 16,
    kind: 'expense',
    sourceWalletId: 'wallet-cash',
    sourceContainerId: 'container-transport',
    icon: 'bus-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-m3-school',
    title: 'Art materials',
    amountMinor: 35_000,
    monthOffset: -3,
    day: 18,
    kind: 'expense',
    sourceWalletId: 'wallet-cash',
    sourceContainerId: 'container-school',
    icon: 'color-palette-outline',
    tone: 'violet',
  });
  add({
    id: 'seed-m3-fun-expense',
    title: 'Board game night',
    amountMinor: 18_000,
    monthOffset: -3,
    day: 22,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-fun',
    icon: 'game-controller-outline',
    tone: 'amber',
  });
  add({
    id: 'seed-m3-bills-expense',
    title: 'Phone load',
    amountMinor: 45_000,
    monthOffset: -3,
    day: 24,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-bills',
    icon: 'phone-portrait-outline',
    tone: 'blue',
  });

  add({
    id: 'seed-m2-allowance',
    title: 'Allowance from Mama',
    amountMinor: 310_000,
    monthOffset: -2,
    day: 1,
    kind: 'income',
    destinationWalletId: 'wallet-gcash',
    destinationContainerId: 'container-food',
    icon: 'arrow-down',
    tone: 'emerald',
  });
  add({
    id: 'seed-m2-stipend',
    title: 'Scholarship stipend',
    amountMinor: 120_000,
    monthOffset: -2,
    day: 2,
    kind: 'income',
    destinationWalletId: 'wallet-gcash',
    destinationContainerId: 'container-school',
    icon: 'school-outline',
    tone: 'emerald',
  });
  add({
    id: 'seed-m2-transfer-transport',
    title: 'Funded transport',
    amountMinor: 50_000,
    monthOffset: -2,
    day: 3,
    kind: 'container_transfer',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-transport',
    icon: 'swap-horizontal-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-m2-savings',
    title: 'Moved to emergency fund',
    amountMinor: 65_000,
    monthOffset: -2,
    day: 4,
    kind: 'savings',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-savings',
    icon: 'flag-outline',
    tone: 'emerald',
  });
  add({
    id: 'seed-m2-fun-transfer',
    title: 'Funded fun money',
    amountMinor: 20_000,
    monthOffset: -2,
    day: 4,
    kind: 'container_transfer',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-fun',
    icon: 'swap-horizontal-outline',
    tone: 'amber',
  });
  add({
    id: 'seed-m2-bills-transfer',
    title: 'Funded load and bills',
    amountMinor: 30_000,
    monthOffset: -2,
    day: 4,
    kind: 'container_transfer',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-bills',
    icon: 'swap-horizontal-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-m2-food',
    title: 'Cafeteria and groceries',
    amountMinor: 88_000,
    monthOffset: -2,
    day: 12,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-food',
    icon: 'restaurant-outline',
    tone: 'coral',
  });
  add({
    id: 'seed-m2-transport',
    title: 'Jeepney and bus fares',
    amountMinor: 40_000,
    monthOffset: -2,
    day: 15,
    kind: 'expense',
    sourceWalletId: 'wallet-cash',
    sourceContainerId: 'container-transport',
    icon: 'bus-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-m2-school',
    title: 'Printing and supplies',
    amountMinor: 28_000,
    monthOffset: -2,
    day: 17,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-school',
    icon: 'print-outline',
    tone: 'violet',
  });
  add({
    id: 'seed-m2-fun',
    title: 'Concert ticket',
    amountMinor: 24_000,
    monthOffset: -2,
    day: 21,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-fun',
    icon: 'musical-notes-outline',
    tone: 'amber',
  });
  add({
    id: 'seed-m2-bills',
    title: 'Internet share',
    amountMinor: 35_000,
    monthOffset: -2,
    day: 23,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-bills',
    icon: 'wifi-outline',
    tone: 'blue',
  });

  add({
    id: 'seed-m1-allowance',
    title: 'Allowance from Mama',
    amountMinor: 300_000,
    monthOffset: -1,
    day: 1,
    kind: 'income',
    destinationWalletId: 'wallet-gcash',
    destinationContainerId: 'container-food',
    icon: 'arrow-down',
    tone: 'emerald',
  });
  add({
    id: 'seed-m1-stipend',
    title: 'Scholarship stipend',
    amountMinor: 100_000,
    monthOffset: -1,
    day: 2,
    kind: 'income',
    destinationWalletId: 'wallet-gcash',
    destinationContainerId: 'container-school',
    icon: 'school-outline',
    tone: 'emerald',
  });
  add({
    id: 'seed-m1-wallet',
    title: 'Cash for the week',
    amountMinor: 80_000,
    monthOffset: -1,
    day: 3,
    kind: 'wallet_transfer',
    sourceWalletId: 'wallet-gcash',
    destinationWalletId: 'wallet-cash',
    icon: 'swap-horizontal-outline',
    tone: 'blue',
    category: 'Wallet transfer',
  });
  add({
    id: 'seed-m1-transport-transfer',
    title: 'Funded transport',
    amountMinor: 50_000,
    monthOffset: -1,
    day: 3,
    kind: 'container_transfer',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-transport',
    icon: 'swap-horizontal-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-m1-savings',
    title: 'Moved to emergency fund',
    amountMinor: 50_000,
    monthOffset: -1,
    day: 4,
    kind: 'savings',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-savings',
    icon: 'flag-outline',
    tone: 'emerald',
  });
  add({
    id: 'seed-m1-fun-transfer',
    title: 'Funded fun money',
    amountMinor: 25_000,
    monthOffset: -1,
    day: 4,
    kind: 'container_transfer',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-fun',
    icon: 'swap-horizontal-outline',
    tone: 'amber',
  });
  add({
    id: 'seed-m1-bills-transfer',
    title: 'Funded load and bills',
    amountMinor: 30_000,
    monthOffset: -1,
    day: 4,
    kind: 'container_transfer',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-bills',
    icon: 'swap-horizontal-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-m1-food',
    title: 'Food and coffee',
    amountMinor: 96_000,
    monthOffset: -1,
    day: 11,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-food',
    icon: 'restaurant-outline',
    tone: 'coral',
  });
  add({
    id: 'seed-m1-transport',
    title: 'Transport fares',
    amountMinor: 42_000,
    monthOffset: -1,
    day: 14,
    kind: 'expense',
    sourceWalletId: 'wallet-cash',
    sourceContainerId: 'container-transport',
    icon: 'bus-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-m1-school',
    title: 'School supplies',
    amountMinor: 22_000,
    monthOffset: -1,
    day: 16,
    kind: 'expense',
    sourceWalletId: 'wallet-cash',
    sourceContainerId: 'container-school',
    icon: 'book-outline',
    tone: 'violet',
  });
  add({
    id: 'seed-m1-fun',
    title: 'Barkada dinner',
    amountMinor: 30_000,
    monthOffset: -1,
    day: 19,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-fun',
    icon: 'fast-food-outline',
    tone: 'amber',
  });
  add({
    id: 'seed-m1-bills',
    title: 'Phone load',
    amountMinor: 28_000,
    monthOffset: -1,
    day: 22,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-bills',
    icon: 'phone-portrait-outline',
    tone: 'blue',
  });

  add({
    id: 'seed-current-cash-allowance',
    title: 'Cash allowance',
    amountMinor: 100_000,
    monthOffset: 0,
    day: 1,
    kind: 'income',
    destinationWalletId: 'wallet-cash',
    destinationContainerId: 'container-food',
    icon: 'arrow-down',
    tone: 'emerald',
  });
  add({
    id: 'seed-current-allowance',
    title: `Allowance from Mama`,
    amountMinor: 280_000,
    monthOffset: 0,
    day: 1,
    kind: 'income',
    destinationWalletId: 'wallet-gcash',
    destinationContainerId: 'container-food',
    icon: 'arrow-down',
    tone: 'emerald',
  });
  add({
    id: 'seed-current-stipend',
    title: 'Scholarship stipend',
    amountMinor: 90_000,
    monthOffset: 0,
    day: 2,
    kind: 'income',
    destinationWalletId: 'wallet-gcash',
    destinationContainerId: 'container-school',
    icon: 'school-outline',
    tone: 'emerald',
  });
  add({
    id: 'seed-current-transport-transfer',
    title: 'Funded transport',
    amountMinor: 60_000,
    monthOffset: 0,
    day: 3,
    kind: 'container_transfer',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-transport',
    icon: 'swap-horizontal-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-current-savings',
    title: 'Moved to emergency fund',
    amountMinor: 50_000,
    monthOffset: 0,
    day: 4,
    kind: 'savings',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-savings',
    icon: 'flag-outline',
    tone: 'emerald',
  });
  add({
    id: 'seed-current-fun-transfer',
    title: 'Funded fun money',
    amountMinor: 35_000,
    monthOffset: 0,
    day: 4,
    kind: 'container_transfer',
    sourceContainerId: 'container-food',
    destinationContainerId: 'container-fun',
    icon: 'swap-horizontal-outline',
    tone: 'amber',
  });

  add({
    id: 'seed-current-lunch',
    title: 'Lunch at the cafeteria',
    amountMinor: 14_500,
    monthOffset: 0,
    day: 5,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-food',
    icon: 'restaurant-outline',
    tone: 'coral',
  });
  add({
    id: 'seed-current-jeep',
    title: 'Jeepney fare',
    amountMinor: 2_600,
    monthOffset: 0,
    day: 5,
    kind: 'expense',
    sourceWalletId: 'wallet-cash',
    sourceContainerId: 'container-transport',
    icon: 'bus-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-current-coffee',
    title: 'Iced coffee',
    amountMinor: 12_000,
    monthOffset: 0,
    day: 7,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-food',
    icon: 'cafe-outline',
    tone: 'amber',
  });
  add({
    id: 'seed-current-groceries',
    title: 'Groceries',
    amountMinor: 36_000,
    monthOffset: 0,
    day: 9,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-food',
    icon: 'basket-outline',
    tone: 'coral',
  });
  add({
    id: 'seed-current-bus',
    title: 'Bus fare',
    amountMinor: 9_400,
    monthOffset: 0,
    day: 10,
    kind: 'expense',
    sourceWalletId: 'wallet-cash',
    sourceContainerId: 'container-transport',
    icon: 'bus-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-current-ride',
    title: 'Ride share',
    amountMinor: 30_000,
    monthOffset: 0,
    day: 12,
    kind: 'expense',
    sourceWalletId: 'wallet-cash',
    sourceContainerId: 'container-transport',
    icon: 'car-outline',
    tone: 'blue',
  });
  add({
    id: 'seed-current-notebook',
    title: 'Study notebook',
    amountMinor: 8_900,
    monthOffset: 0,
    day: 12,
    kind: 'expense',
    sourceWalletId: 'wallet-cash',
    sourceContainerId: 'container-school',
    icon: 'journal-outline',
    tone: 'violet',
  });
  add({
    id: 'seed-current-printing',
    title: 'Printing',
    amountMinor: 7_100,
    monthOffset: 0,
    day: 14,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-school',
    icon: 'print-outline',
    tone: 'violet',
  });
  add({
    id: 'seed-current-book',
    title: 'Reference book',
    amountMinor: 20_000,
    monthOffset: 0,
    day: 16,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-school',
    icon: 'book-outline',
    tone: 'violet',
  });
  add({
    id: 'seed-current-movie',
    title: 'Movie with friends',
    amountMinor: 25_000,
    monthOffset: 0,
    day: 17,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-fun',
    icon: 'film-outline',
    tone: 'amber',
  });
  add({
    id: 'seed-current-game',
    title: 'Game pass',
    amountMinor: 23_000,
    monthOffset: 0,
    day: 18,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-fun',
    icon: 'game-controller-outline',
    tone: 'amber',
  });
  add({
    id: 'seed-current-weekend',
    title: 'Weekend meals',
    amountMinor: 41_050,
    monthOffset: 0,
    day: 19,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-food',
    icon: 'restaurant-outline',
    tone: 'coral',
  });
  add({
    id: 'seed-current-snack',
    title: 'After-class snack',
    amountMinor: 14_500,
    monthOffset: 0,
    day: 19,
    kind: 'expense',
    sourceWalletId: 'wallet-gcash',
    sourceContainerId: 'container-food',
    icon: 'fast-food-outline',
    tone: 'coral',
  });
  add({
    id: 'seed-current-reversed',
    title: 'Duplicate snack purchase',
    amountMinor: 4_500,
    monthOffset: 0,
    day: 20,
    kind: 'expense',
    sourceWalletId: 'wallet-cash',
    sourceContainerId: 'container-fun',
    icon: 'alert-circle-outline',
    tone: 'amber',
    status: 'reversed',
  });

  return {
    wallets,
    containers,
    transactions,
  };
}

function monthlyLabels(
  months: string[],
  label: ContainerLabel,
): Record<string, ContainerLabel> {
  return Object.fromEntries(months.map((month) => [month, { ...label }]));
}

function monthlyLimits(months: string[], currentLimitMinor: number): Record<string, number> {
  const factors = [0.8, 0.9, 1, 0.95, 1.05, 1];
  return Object.fromEntries(
    months.map((month, index) => [
      month,
      Math.round(currentLimitMinor * (factors[index] ?? 1)),
    ]),
  );
}
