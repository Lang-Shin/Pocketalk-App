import type {
  ContainerMonthResult,
  ContainerSnapshot,
  MonthRolloverSummary,
  MonthSummary,
  Transaction,
  WalletSnapshot,
} from './models';
import { FinanceError } from '@/db/errors';
import {
  FinanceEngine,
  type ContainerMutationResult,
  type CorrectionResult,
  type TransactionMutationResult,
} from '@/db/financeEngine';
import {
  SAVINGS_CONTAINER_ID,
  UNALLOCATED_CONTAINER_ID,
} from '@/db/systemContainers';
import { ensureDefaultWallets } from '@/db/defaultWallets';
import type { IconName } from '@/lib/icons';
import {
  getMonthKeysBack,
  isValidDateKey,
  monthKeyForDateKey,
  shiftMonthKey,
  toLocalDateKey,
} from '@/lib/period';
import type { Tone } from '@/theme';

export type EntryMode =
  | 'expense'
  | 'income'
  | 'wallet_transfer'
  | 'container_transfer';

export interface MoneyEntryInput {
  mode: EntryMode;
  amountMinor: number;
  title: string;
  effectiveDate: string;
  walletId?: string;
  containerId?: string;
  destinationWalletId?: string;
  destinationContainerId?: string;
  idempotencyKey?: string;
}

export interface ContainerInput {
  name: string;
  description: string;
  icon: IconName;
  tone: Tone;
  limitMinor: number;
  monthKey: string;
  idempotencyKey?: string;
}

export interface UpdateContainerInput extends ContainerInput {
  id: string;
}

export interface ActionResult {
  ok: boolean;
  message?: string;
}

export interface MonthView {
  monthKey: string;
  containers: ContainerSnapshot[];
  results: ContainerMonthResult[];
  summary: MonthSummary;
  transactions: Transaction[];
}

export interface WalletView {
  wallets: WalletSnapshot[];
  recentTransactions: Transaction[];
  totalBalanceMinor: number;
}

export interface HistoryView {
  monthKey: string;
  summary: MonthSummary;
  previous: MonthSummary;
  results: ContainerMonthResult[];
  transactions: Transaction[];
  rollover: MonthRolloverSummary | null;
  availableMonths: string[];
}

export interface FinanceServiceOptions {
  now?: () => Date;
}

const DEFAULT_TITLES: Partial<Record<EntryMode, string>> = {
  income: 'Income',
  expense: 'Expense',
};

let operationSequence = 0;

export function createOperationKey(prefix: string): string {
  operationSequence += 1;
  return `${prefix}:${Date.now().toString(36)}:${operationSequence}:${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export class FinanceService {
  readonly engine: FinanceEngine;
  private readonly now: () => Date;

  constructor(engine: FinanceEngine, options: FinanceServiceOptions = {}) {
    this.engine = engine;
    this.now = options.now ?? (() => new Date());
  }

  get todayDateKey(): string {
    return toLocalDateKey(this.now());
  }

  get activeMonthKey(): string {
    return monthKeyForDateKey(this.todayDateKey);
  }

  async initialize(): Promise<void> {
    await this.engine.initialize();
    await ensureDefaultWallets(this.engine);
  }

  async getMonthView(monthKey: string): Promise<MonthView> {
    const summary = await this.engine.getMonthSummary(
      monthKey,
      this.activeMonthKey,
    );
    const containers = await this.engine.getContainerSnapshots(
      monthKey,
      monthKey === this.activeMonthKey,
    );
    const results = await this.engine.getContainerMonthResults(monthKey);
    const transactions = await this.engine.getTransactionsForMonth(monthKey);

    return {
      monthKey,
      containers,
      results,
      summary,
      transactions,
    };
  }

  async getWalletView(): Promise<WalletView> {
    const wallets = await this.engine.getWalletSnapshots(this.todayDateKey);
    const recentTransactions = await this.engine.getRecentTransactions(50);

    return {
      wallets,
      recentTransactions,
      totalBalanceMinor: wallets.reduce(
        (total, wallet) => total + wallet.balanceMinor,
        0,
      ),
    };
  }

  async getHistoryView(monthKey: string): Promise<HistoryView> {
    const summary = await this.engine.getMonthSummary(
      monthKey,
      this.activeMonthKey,
    );
    const previous = await this.engine.getMonthSummary(
      shiftMonthKey(monthKey, -1),
      this.activeMonthKey,
    );
    const results = await this.engine.getContainerMonthResults(monthKey);
    const transactions = await this.engine.getTransactionsForMonth(monthKey);
    const rollover = await this.engine.getMonthRollover(monthKey);
    const availableMonths: string[] = [];

    for (const candidate of getMonthKeysBack(6, this.activeMonthKey)) {
      const candidateSummary = await this.engine.getMonthSummary(
        candidate,
        this.activeMonthKey,
      );
      const candidateResults = await this.engine.getContainerMonthResults(
        candidate,
      );
      const hasContainerReport = candidateResults.some(
        (result) =>
          result.systemKey === null &&
          (result.hasActivity ||
            result.endingBalanceMinor !== 0 ||
            result.status === 'archived'),
      );

      if (
        candidateSummary.hasActivity ||
        candidateSummary.savingsEndingBalanceMinor !== 0 ||
        hasContainerReport
      ) {
        availableMonths.push(candidate);
      }
    }

    return {
      monthKey,
      summary,
      previous,
      results,
      transactions,
      rollover,
      availableMonths: availableMonths.reverse(),
    };
  }

  async recordMoneyEntry(
    input: MoneyEntryInput,
  ): Promise<TransactionMutationResult> {
    const amountMinor = requirePositiveAmount(input.amountMinor);
    const trimmedTitle = input.title.trim();
    const title = trimmedTitle || DEFAULT_TITLES[input.mode] || trimmedTitle;
    const effectiveDate = input.effectiveDate;
    if (!isValidDateKey(effectiveDate)) {
      throw new FinanceError(
        'VALIDATION',
        'Use a valid date in YYYY-MM-DD format.',
      );
    }
    const idempotencyKey =
      input.idempotencyKey ?? createOperationKey(`entry-${input.mode}`);

    if (input.mode === 'expense') {
      return this.engine.recordTransaction({
        kind: 'expense',
        title,
        amountMinor,
        effectiveDate,
        walletId: input.walletId,
        containerId: input.containerId,
        idempotencyKey,
      });
    }

    if (input.mode === 'income') {
      return this.engine.recordIncome({
        title,
        amountMinor,
        effectiveDate,
        walletId: requireValue(input.walletId, 'Choose a wallet.'),
        containerId: input.containerId,
        idempotencyKey,
      });
    }

    if (input.mode === 'wallet_transfer') {
      return this.engine.recordTransaction({
        kind: 'wallet_transfer',
        title,
        amountMinor,
        effectiveDate,
        walletId: input.walletId,
        destinationWalletId: input.destinationWalletId,
        idempotencyKey,
      });
    }

    return this.recordContainerTransfer(
      input,
      amountMinor,
      title,
      effectiveDate,
      idempotencyKey,
    );
  }

  async createContainer(input: ContainerInput): Promise<ContainerMutationResult> {
    this.requireActiveMonth(input.monthKey);
    return this.engine.createContainer({
      name: input.name,
      description: input.description,
      icon: input.icon,
      tone: input.tone,
      kind: 'budget',
      limitMinor: input.limitMinor,
      idempotencyKey: input.idempotencyKey ?? createOperationKey('container-create'),
    });
  }

  async updateContainer(
    input: UpdateContainerInput,
  ): Promise<ContainerMutationResult> {
    this.requireActiveMonth(input.monthKey);
    const baseKey =
      input.idempotencyKey ?? createOperationKey('container-update');

    await this.engine.updateContainerMetadata({
      containerId: input.id,
      effectiveMonthKey: input.monthKey,
      name: input.name,
      description: input.description,
      icon: input.icon,
      tone: input.tone,
      idempotencyKey: `${baseKey}:metadata`,
    });
    await this.engine.setBudgetLimit({
      containerId: input.id,
      monthKey: input.monthKey,
      limitMinor: input.limitMinor,
      idempotencyKey: `${baseKey}:limit`,
    });

    return { containerId: input.id };
  }

  async archiveContainer(
    containerId: string,
    idempotencyKey = createOperationKey('container-archive'),
  ): Promise<ContainerMutationResult> {
    return this.engine.archiveContainer({ containerId, idempotencyKey });
  }

  async reactivateContainer(
    containerId: string,
    idempotencyKey = createOperationKey('container-reactivate'),
  ): Promise<ContainerMutationResult> {
    return this.engine.reactivateContainer({ containerId, idempotencyKey });
  }

  async deleteContainer(
    containerId: string,
    idempotencyKey = createOperationKey('container-delete'),
  ): Promise<ContainerMutationResult> {
    return this.engine.deleteContainer({ containerId, idempotencyKey });
  }

  async reverseTransaction(
    transactionId: string,
    reason?: string,
    idempotencyKey = createOperationKey('transaction-reverse'),
  ): Promise<{ reversalId: string }> {
    return this.engine.reverseTransaction({
      transactionId,
      reason,
      idempotencyKey,
    });
  }

  async correctTransaction(
    transactionId: string,
    replacement: Parameters<FinanceEngine['correctTransaction']>[0]['replacement'],
    reason?: string,
    idempotencyKey = createOperationKey('transaction-correct'),
  ): Promise<CorrectionResult> {
    return this.engine.correctTransaction({
      transactionId,
      reason,
      replacement,
      idempotencyKey,
    });
  }

  private async recordContainerTransfer(
    input: MoneyEntryInput,
    amountMinor: number,
    title: string,
    effectiveDate: string,
    idempotencyKey: string,
  ): Promise<TransactionMutationResult> {
    const sourceContainerId = requireValue(
      input.containerId,
      'Choose the container to move money from.',
    );
    const destinationContainerId = requireValue(
      input.destinationContainerId,
      'Choose the container to move money to.',
    );

    if (sourceContainerId === destinationContainerId) {
      throw new FinanceError(
        'VALIDATION',
        'Choose two different containers.',
      );
    }

    if (destinationContainerId === SAVINGS_CONTAINER_ID) {
      return this.engine.contributeToSavings({
        sourceContainerId,
        amountMinor,
        effectiveDate,
        title,
        idempotencyKey,
      });
    }

    if (sourceContainerId === SAVINGS_CONTAINER_ID) {
      return this.engine.withdrawFromSavings({
        destinationContainerId,
        amountMinor,
        effectiveDate,
        title,
        idempotencyKey,
      });
    }

    if (
      sourceContainerId === UNALLOCATED_CONTAINER_ID &&
      destinationContainerId === UNALLOCATED_CONTAINER_ID
    ) {
      throw new FinanceError(
        'VALIDATION',
        'Choose two different containers.',
      );
    }

    if (sourceContainerId === UNALLOCATED_CONTAINER_ID) {
      return this.engine.allocateToContainer({
        containerId: destinationContainerId,
        amountMinor,
        effectiveDate,
        title,
        idempotencyKey,
      });
    }

    if (destinationContainerId === UNALLOCATED_CONTAINER_ID) {
      return this.engine.returnToUnallocated({
        containerId: sourceContainerId,
        amountMinor,
        effectiveDate,
        title,
        idempotencyKey,
      });
    }

    return this.engine.transferBetweenContainers({
      sourceContainerId,
      destinationContainerId,
      amountMinor,
      effectiveDate,
      title,
      idempotencyKey,
    });
  }

  private requireActiveMonth(monthKey: string): void {
    if (monthKey !== this.activeMonthKey) {
      throw new FinanceError(
        'VALIDATION',
        'Only the current calendar month can be changed.',
      );
    }
  }
}

function requirePositiveAmount(amountMinor: number): number {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new FinanceError(
      'VALIDATION',
      'Enter an amount greater than zero.',
    );
  }
  return amountMinor;
}

function requireValue(value: string | undefined, message: string): string {
  if (!value) throw new FinanceError('VALIDATION', message);
  return value;
}
