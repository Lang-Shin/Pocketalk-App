import { FinanceError } from '@/db/errors';
import { FinanceEngine } from '@/db/financeEngine';
import type { SqlDatabase } from '@/db/sqlDatabase';
import { monthKeyForDateKey, toLocalDateKey } from '@/lib/period';

import {
  FinanceService,
  type ActionResult,
  type ContainerInput,
  type MoneyEntryInput,
  type UpdateContainerInput,
} from './financeService';

export type FinanceStatus = 'loading' | 'ready' | 'error';

export interface FinanceSessionState {
  status: FinanceStatus;
  error: string | null;
  service: FinanceService | null;
  activeMonthKey: string;
  todayDateKey: string;
  revision: number;
}

export interface FinanceSessionOptions {
  openDatabase: () => Promise<SqlDatabase>;
  createService?: (database: SqlDatabase) => FinanceService;
  now?: () => Date;
}

export class FinanceSession {
  private readonly openDatabase: () => Promise<SqlDatabase>;
  private readonly createService: (database: SqlDatabase) => FinanceService;
  private readonly now: () => Date;
  private readonly listeners = new Set<() => void>();
  private state: FinanceSessionState;
  private startupPromise: Promise<void> | null = null;

  constructor(options: FinanceSessionOptions) {
    this.openDatabase = options.openDatabase;
    this.createService =
      options.createService ??
      ((database) => new FinanceService(new FinanceEngine(database)));
    this.now = options.now ?? (() => new Date());

    const todayDateKey = toLocalDateKey(this.now());
    this.state = {
      status: 'loading',
      error: null,
      service: null,
      activeMonthKey: monthKeyForDateKey(todayDateKey),
      todayDateKey,
      revision: 0,
    };
  }

  readonly getState = (): FinanceSessionState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  start(): Promise<void> {
    if (!this.startupPromise) {
      this.startupPromise = this.startInternal();
    }
    return this.startupPromise;
  }

  readonly retry = (): void => {
    this.startupPromise = null;
    this.update({ status: 'loading', error: null });
    void this.start();
  };

  readonly refresh = (): void => {
    this.update({ revision: this.state.revision + 1 });
  };

  refreshDate(now: Date = this.now()): boolean {
    const nextDateKey = toLocalDateKey(now);
    if (nextDateKey === this.state.todayDateKey) return false;

    this.update({
      todayDateKey: nextDateKey,
      activeMonthKey: monthKeyForDateKey(nextDateKey),
      revision: this.state.revision + 1,
    });
    return true;
  }

  readonly recordMoneyEntry = (
    input: MoneyEntryInput,
  ): Promise<ActionResult> =>
    this.perform((service) => service.recordMoneyEntry(input));

  readonly createContainer = (input: ContainerInput): Promise<ActionResult> =>
    this.perform((service) => service.createContainer(input));

  readonly updateContainer = (
    input: UpdateContainerInput,
  ): Promise<ActionResult> =>
    this.perform((service) => service.updateContainer(input));

  readonly archiveContainer = (
    containerId: string,
    idempotencyKey?: string,
  ): Promise<ActionResult> =>
    this.perform((service) =>
      service.archiveContainer(containerId, idempotencyKey),
    );

  readonly reactivateContainer = (
    containerId: string,
    idempotencyKey?: string,
  ): Promise<ActionResult> =>
    this.perform((service) =>
      service.reactivateContainer(containerId, idempotencyKey),
    );

  readonly deleteContainer = (
    containerId: string,
    idempotencyKey?: string,
  ): Promise<ActionResult> =>
    this.perform((service) =>
      service.deleteContainer(containerId, idempotencyKey),
    );

  private async startInternal(): Promise<void> {
    try {
      const database = await this.openDatabase();
      const service = this.createService(database);
      await service.initialize();
      const todayDateKey = toLocalDateKey(this.now());
      this.update({
        status: 'ready',
        error: null,
        service,
        todayDateKey,
        activeMonthKey: monthKeyForDateKey(todayDateKey),
      });
    } catch (startupError) {
      this.startupPromise = null;
      this.update({
        status: 'error',
        error: toMessage(startupError),
        service: null,
      });
    }
  }

  private async perform(
    operation: (service: FinanceService) => Promise<unknown>,
  ): Promise<ActionResult> {
    const current = this.state.service;
    if (!current) {
      return {
        ok: false,
        message: 'The local ledger is still opening. Try again in a moment.',
      };
    }

    try {
      await operation(current);
      this.update({ revision: this.state.revision + 1 });
      return { ok: true };
    } catch (operationError) {
      return { ok: false, message: toMessage(operationError) };
    }
  }

  private update(patch: Partial<FinanceSessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

function toMessage(error: unknown): string {
  if (error instanceof FinanceError) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Something went wrong while updating the local ledger.';
}
