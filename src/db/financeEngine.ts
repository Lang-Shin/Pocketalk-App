import type {
  ContainerKind,
  ContainerLabel,
  ContainerMonthResult,
  ContainerSnapshot,
  MonthSummary,
  Transaction,
  TransactionDirection,
  TransactionKind,
  WalletKind,
  WalletSnapshot,
} from '@/data/models';
import { captureRecordedStamp } from '@/lib/date';
import type { IconName } from '@/lib/icons';
import {
  getCalendarMonth,
  isValidDateKey,
  isValidMonthKey,
  monthKeyForDateKey,
  shiftMonthKey,
  toLocalDateKey,
} from '@/lib/period';
import type { Tone } from '@/theme';

import { FinanceError } from './errors';
import {
  FinanceRepository,
  type ContainerRow,
  type MetadataRow,
  type NewPostingRow,
  type NewTransactionRow,
  type PostingRow,
  type TransactionRow,
  type WalletRow,
} from './financeRepository';
import type { SqlDatabase } from './sqlDatabase';
import {
  ensureSystemSavingsContainer,
  ensureSystemUnallocatedContainer,
  SAVINGS_CONTAINER_ID,
  SAVINGS_SYSTEM_KEY,
  UNALLOCATED_CONTAINER_ID,
  UNALLOCATED_SYSTEM_KEY,
} from './systemContainers';

export interface FinanceEngineOptions {
  now?: () => Date;
  idFactory?: (prefix: string) => string;
}

export interface CreateWalletInput {
  id?: string;
  name: string;
  kind: WalletKind;
  icon: IconName;
  tone: Tone;
  sortOrder?: number;
  idempotencyKey: string;
}

export interface CreateContainerInput {
  id?: string;
  name: string;
  description?: string;
  icon: IconName;
  tone: Tone;
  kind?: ContainerKind;
  limitMinor?: number;
  idempotencyKey: string;
}

export interface UpdateContainerMetadataInput {
  containerId: string;
  effectiveMonthKey?: string;
  name: string;
  description?: string;
  icon: IconName;
  tone: Tone;
  idempotencyKey: string;
}

export interface SetBudgetLimitInput {
  containerId: string;
  monthKey?: string;
  limitMinor: number;
  idempotencyKey: string;
}

export interface ContainerMutationInput {
  containerId: string;
  idempotencyKey: string;
}

export interface CreateTransactionInput {
  kind: TransactionKind;
  title: string;
  amountMinor: number;
  effectiveDate: string;
  walletId?: string;
  containerId?: string;
  destinationWalletId?: string;
  destinationContainerId?: string;
  idempotencyKey: string;
}

type TransactionDetails = Omit<CreateTransactionInput, 'idempotencyKey'>;

export interface RecordIncomeInput {
  title: string;
  amountMinor: number;
  effectiveDate: string;
  walletId: string;
  containerId?: string;
  idempotencyKey: string;
}

export interface AllocateToContainerInput {
  containerId: string;
  amountMinor: number;
  effectiveDate: string;
  title?: string;
  idempotencyKey: string;
}

export interface ReturnToUnallocatedInput {
  containerId: string;
  amountMinor: number;
  effectiveDate: string;
  title?: string;
  idempotencyKey: string;
}

export interface TransferBetweenContainersInput {
  sourceContainerId: string;
  destinationContainerId: string;
  amountMinor: number;
  effectiveDate: string;
  title?: string;
  idempotencyKey: string;
}

export interface ContributeToSavingsInput {
  sourceContainerId: string;
  amountMinor: number;
  effectiveDate: string;
  title?: string;
  idempotencyKey: string;
}

export interface WithdrawFromSavingsInput {
  destinationContainerId: string;
  amountMinor: number;
  effectiveDate: string;
  title?: string;
  idempotencyKey: string;
}

export interface ReverseTransactionInput {
  transactionId: string;
  reason?: string;
  idempotencyKey: string;
}

export interface CorrectTransactionInput {
  transactionId: string;
  reason?: string;
  replacement: Omit<CreateTransactionInput, 'idempotencyKey'>;
  idempotencyKey: string;
}

export interface TransactionMutationResult {
  transactionId: string;
}

export interface ReversalResult {
  reversalId: string;
}

export interface CorrectionResult {
  reversalId: string;
  replacementId: string;
}

export interface ContainerMutationResult {
  containerId: string;
}

export interface WalletMutationResult {
  walletId: string;
}

export interface RolloverResult {
  processedMonths: string[];
  transactionIds: string[];
}

interface OperationContext {
  recordedAt: string;
  recordedTimeZone: string;
  recordedOffsetMinutes: number;
  todayDateKey: string;
  todayMonthKey: string;
}

interface PostingDraft {
  accountType: 'wallet' | 'container';
  accountId: string;
  amountMinor: number;
}

interface PreparedTransaction {
  row: NewTransactionRow;
  postings: PostingDraft[];
}

interface ClosedMonthActivity {
  effectiveMonthKey: string;
  postings: readonly PostingDraft[];
}

const TONES: readonly Tone[] = ['emerald', 'amber', 'coral', 'blue', 'violet'];
const CONTAINER_KINDS: readonly ContainerKind[] = ['budget', 'savings'];
const WALLET_KINDS: readonly WalletKind[] = ['cash', 'virtual_gcash'];
const TRANSFER_ICON: IconName = 'swap-horizontal-outline';
const SAVINGS_ICON: IconName = 'wallet-outline';
const ROLLOVER_IDEMPOTENCY_PREFIX = 'rollover:';

let fallbackIdSequence = 0;

export class FinanceEngine {
  readonly repository: FinanceRepository;

  private readonly database: SqlDatabase;
  private readonly now: () => Date;
  private readonly idFactory: (prefix: string) => string;
  private activeRolloverPromise: Promise<RolloverResult> | null = null;

  constructor(
    database: SqlDatabase,
    options: FinanceEngineOptions = {},
  ) {
    this.database = database;
    this.repository = new FinanceRepository(database);
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? defaultIdFactory;
  }

  async createWallet(input: CreateWalletInput): Promise<WalletMutationResult> {
    const context = this.operationContext();
    const key = requireIdempotencyKey(input.idempotencyKey);
    const name = requireText(input.name, 'Wallet name', 40);
    if (!WALLET_KINDS.includes(input.kind)) {
      throw new FinanceError('VALIDATION', 'Choose a valid wallet kind.');
    }
    requireIcon(input.icon);
    requireTone(input.tone);
    if (input.sortOrder !== undefined && !Number.isInteger(input.sortOrder)) {
      throw new FinanceError('VALIDATION', 'Wallet sort order must be an integer.');
    }
    const providedId = input.id?.trim() || null;

    const fingerprint = fingerprintOf({
      operation: 'create_wallet',
      id: providedId,
      name,
      kind: input.kind,
      icon: input.icon,
      tone: input.tone,
      sortOrder: input.sortOrder ?? null,
    });

    return this.runIdempotent(
      'create_wallet',
      key,
      fingerprint,
      context,
      async () => {
        const wallets = await this.repository.listWallets();
        const id = providedId ?? this.idFactory('wallet');
        if (wallets.some((wallet) => wallet.id === id)) {
          throw new FinanceError(
            'VALIDATION',
            'A wallet with that ID already exists.',
          );
        }
        const sortOrder =
          input.sortOrder ??
          wallets.reduce((max, wallet) => Math.max(max, wallet.sortOrder), 0) + 1;
        await this.repository.insertWallet({
          id,
          name,
          kind: input.kind,
          icon: input.icon,
          tone: input.tone,
          sortOrder,
          createdAt: context.recordedAt,
        });
        return { walletId: id };
      },
    );
  }

  async createContainer(
    input: CreateContainerInput,
  ): Promise<ContainerMutationResult> {
    const context = this.operationContext();
    const key = requireIdempotencyKey(input.idempotencyKey);
    const name = requireText(input.name, 'Container name', 40);
    const description = optionalText(input.description, 'Description', 90);
    requireIcon(input.icon);
    requireTone(input.tone);
    const kind = input.kind ?? 'budget';
    if (!CONTAINER_KINDS.includes(kind)) {
      throw new FinanceError('VALIDATION', 'Choose a valid container kind.');
    }
    const limitMinor = input.limitMinor ?? 0;
    requireNonNegativeInteger(limitMinor, 'Monthly limit');
    const providedId = input.id?.trim() || null;

    const fingerprint = fingerprintOf({
      operation: 'create_container',
      id: providedId,
      name,
      description,
      icon: input.icon,
      tone: input.tone,
      kind,
      limitMinor,
    });

    return this.runIdempotent(
      'create_container',
      key,
      fingerprint,
      context,
      async () => {
        const id = providedId ?? this.idFactory('container');
        if (
          id === UNALLOCATED_CONTAINER_ID ||
          id === SAVINGS_CONTAINER_ID
        ) {
          throw new FinanceError(
            'SYSTEM_CONTAINER',
            'That container ID is reserved for an account managed by the app.',
          );
        }
        if (await this.repository.getContainer(id, true)) {
          throw new FinanceError(
            'VALIDATION',
            'A container with that ID already exists.',
          );
        }
        const sortOrder = await this.repository.nextContainerSortOrder();
        await this.repository.insertContainer({
          id,
          kind,
          status: 'active',
          sortOrder,
          createdMonthKey: context.todayMonthKey,
          createdAt: context.recordedAt,
          archivedAt: null,
          deletedAt: null,
          systemKey: null,
        });
        await this.repository.insertMetadata(
          metadataRow(id, context.todayMonthKey, {
            name,
            description,
            icon: input.icon,
            tone: input.tone,
          }, context.recordedAt),
        );
        if (limitMinor > 0) {
          await this.repository.upsertBudgetLimit(
            id,
            context.todayMonthKey,
            limitMinor,
            context.recordedAt,
          );
        }
        await this.repository.insertLifecycleEvent({
          id: 0,
          containerId: id,
          eventType: 'created',
          effectiveMonthKey: context.todayMonthKey,
          recordedAt: context.recordedAt,
          detailsJson: JSON.stringify({ kind, limitMinor }),
        });
        return { containerId: id };
      },
    );
  }

  async updateContainerMetadata(
    input: UpdateContainerMetadataInput,
  ): Promise<ContainerMutationResult> {
    const context = this.operationContext();
    const key = requireIdempotencyKey(input.idempotencyKey);
    const containerId = requireEntityId(input.containerId, 'container');
    const name = requireText(input.name, 'Container name', 40);
    const description = optionalText(input.description, 'Description', 90);
    requireIcon(input.icon);
    requireTone(input.tone);
    const effectiveMonthKey = input.effectiveMonthKey ?? context.todayMonthKey;
    requireEditableMonth(effectiveMonthKey, context.todayMonthKey);

    const fingerprint = fingerprintOf({
      operation: 'update_container_metadata',
      containerId,
      effectiveMonthKey,
      name,
      description,
      icon: input.icon,
      tone: input.tone,
    });

    return this.runIdempotent(
      'update_container_metadata',
      key,
      fingerprint,
      context,
      async () => {
        const container = await this.requireActiveContainer(containerId);
        this.requireUserContainer(container);
        if (effectiveMonthKey < container.createdMonthKey) {
          throw new FinanceError(
            'VALIDATION',
            'The selected month is before this container existed.',
          );
        }
        await this.repository.upsertMetadata(
          metadataRow(
            container.id,
            effectiveMonthKey,
            {
              name,
              description,
              icon: input.icon,
              tone: input.tone,
            },
            context.recordedAt,
          ),
        );
        await this.repository.insertLifecycleEvent({
          id: 0,
          containerId: container.id,
          eventType: 'metadata_changed',
          effectiveMonthKey,
          recordedAt: context.recordedAt,
          detailsJson: JSON.stringify({
            name,
            description,
            icon: input.icon,
            tone: input.tone,
          }),
        });
        return { containerId: container.id };
      },
    );
  }

  async setBudgetLimit(input: SetBudgetLimitInput): Promise<ContainerMutationResult> {
    const context = this.operationContext();
    const key = requireIdempotencyKey(input.idempotencyKey);
    const containerId = requireEntityId(input.containerId, 'container');
    requireNonNegativeInteger(input.limitMinor, 'Monthly limit');
    const monthKey = input.monthKey ?? context.todayMonthKey;
    requireEditableMonth(monthKey, context.todayMonthKey);

    const fingerprint = fingerprintOf({
      operation: 'set_budget_limit',
      containerId,
      monthKey,
      limitMinor: input.limitMinor,
    });

    return this.runIdempotent(
      'set_budget_limit',
      key,
      fingerprint,
      context,
      async () => {
        const container = await this.requireActiveContainer(containerId);
        this.requireUserContainer(container);
        if (monthKey < container.createdMonthKey) {
          throw new FinanceError(
            'VALIDATION',
            'The selected month is before this container existed.',
          );
        }
        await this.repository.upsertBudgetLimit(
          container.id,
          monthKey,
          input.limitMinor,
          context.recordedAt,
        );
        await this.repository.insertLifecycleEvent({
          id: 0,
          containerId: container.id,
          eventType: 'limit_changed',
          effectiveMonthKey: monthKey,
          recordedAt: context.recordedAt,
          detailsJson: JSON.stringify({ limitMinor: input.limitMinor }),
        });
        return { containerId: container.id };
      },
    );
  }

  async archiveContainer(
    input: ContainerMutationInput,
  ): Promise<ContainerMutationResult> {
    const context = this.operationContext();
    const key = requireIdempotencyKey(input.idempotencyKey);
    const containerId = requireEntityId(input.containerId, 'container');
    const fingerprint = fingerprintOf({
      operation: 'archive_container',
      containerId,
    });

    return this.runIdempotent(
      'archive_container',
      key,
      fingerprint,
      context,
      async () => {
        const container = await this.requireExistingContainer(containerId);
        this.requireUserContainer(container);
        if (container.status === 'archived') {
          throw new FinanceError(
            'INVALID_STATE',
            'That container is already archived.',
          );
        }
        await this.repository.setContainerArchived(
          container.id,
          context.recordedAt,
        );
        await this.repository.insertLifecycleEvent({
          id: 0,
          containerId: container.id,
          eventType: 'archived',
          effectiveMonthKey: context.todayMonthKey,
          recordedAt: context.recordedAt,
          detailsJson: '{}',
        });
        return { containerId: container.id };
      },
    );
  }

  async reactivateContainer(
    input: ContainerMutationInput,
  ): Promise<ContainerMutationResult> {
    const context = this.operationContext();
    const key = requireIdempotencyKey(input.idempotencyKey);
    const containerId = requireEntityId(input.containerId, 'container');
    const fingerprint = fingerprintOf({
      operation: 'reactivate_container',
      containerId,
    });

    return this.runIdempotent(
      'reactivate_container',
      key,
      fingerprint,
      context,
      async () => {
        const container = await this.requireExistingContainer(containerId);
        this.requireUserContainer(container);
        if (container.status === 'active') {
          throw new FinanceError(
            'INVALID_STATE',
            'That container is already active.',
          );
        }
        await this.repository.setContainerArchived(container.id, null);
        await this.repository.insertLifecycleEvent({
          id: 0,
          containerId: container.id,
          eventType: 'reactivated',
          effectiveMonthKey: context.todayMonthKey,
          recordedAt: context.recordedAt,
          detailsJson: '{}',
        });
        return { containerId: container.id };
      },
    );
  }

  async deleteContainer(
    input: ContainerMutationInput,
  ): Promise<ContainerMutationResult> {
    const context = this.operationContext();
    const key = requireIdempotencyKey(input.idempotencyKey);
    const containerId = requireEntityId(input.containerId, 'container');
    const fingerprint = fingerprintOf({
      operation: 'delete_container',
      containerId,
    });

    return this.runIdempotent(
      'delete_container',
      key,
      fingerprint,
      context,
      async () => {
        const container = await this.repository.getContainer(containerId);
        if (!container) {
          throw new FinanceError(
            'NOT_FOUND',
            'That container no longer exists.',
          );
        }
        this.requireUserContainer(container);
        if (await this.repository.hasContainerFinancialHistory(container.id)) {
          throw new FinanceError(
            'INVALID_STATE',
            'This container has a balance or financial history and cannot be deleted. Move any remaining balance, then archive it instead.',
          );
        }
        await this.repository.setContainerDeleted(
          container.id,
          context.recordedAt,
        );
        await this.repository.insertLifecycleEvent({
          id: 0,
          containerId: container.id,
          eventType: 'deleted',
          effectiveMonthKey: context.todayMonthKey,
          recordedAt: context.recordedAt,
          detailsJson: '{}',
        });
        return { containerId: container.id };
      },
    );
  }

  async recordTransaction(
    input: CreateTransactionInput,
  ): Promise<TransactionMutationResult> {
    return this.recordTransactionInternal(input, false);
  }

  async recordIncome(
    input: RecordIncomeInput,
  ): Promise<TransactionMutationResult> {
    return this.recordTransactionInternal(
      {
        kind: 'income',
        title: input.title,
        amountMinor: input.amountMinor,
        effectiveDate: input.effectiveDate,
        walletId: input.walletId,
        containerId: input.containerId,
        idempotencyKey: input.idempotencyKey,
      },
      false,
    );
  }

  async allocateToContainer(
    input: AllocateToContainerInput,
  ): Promise<TransactionMutationResult> {
    const containerId = requireEntityId(input.containerId, 'container');
    if (containerId === UNALLOCATED_CONTAINER_ID) {
      throw new FinanceError(
        'VALIDATION',
        'Choose a user-owned container to receive an allocation.',
      );
    }
    return this.recordTransactionInternal(
      {
        kind: 'container_transfer',
        title:
          optionalText(input.title, 'Description', 80) || 'Allocate to container',
        amountMinor: input.amountMinor,
        effectiveDate: input.effectiveDate,
        containerId: UNALLOCATED_CONTAINER_ID,
        destinationContainerId: containerId,
        idempotencyKey: input.idempotencyKey,
      },
      true,
      true,
    );
  }

  async returnToUnallocated(
    input: ReturnToUnallocatedInput,
  ): Promise<TransactionMutationResult> {
    const containerId = requireEntityId(input.containerId, 'container');
    if (containerId === UNALLOCATED_CONTAINER_ID) {
      throw new FinanceError(
        'VALIDATION',
        'Choose a user-owned container to return funds from.',
      );
    }
    return this.recordTransactionInternal(
      {
        kind: 'container_transfer',
        title:
          optionalText(input.title, 'Description', 80) || 'Return to Unallocated',
        amountMinor: input.amountMinor,
        effectiveDate: input.effectiveDate,
        containerId,
        destinationContainerId: UNALLOCATED_CONTAINER_ID,
        idempotencyKey: input.idempotencyKey,
      },
      true,
    );
  }

  async transferBetweenContainers(
    input: TransferBetweenContainersInput,
  ): Promise<TransactionMutationResult> {
    const sourceContainerId = requireEntityId(
      input.sourceContainerId,
      'source container',
    );
    const destinationContainerId = requireEntityId(
      input.destinationContainerId,
      'destination container',
    );
    if (
      sourceContainerId === UNALLOCATED_CONTAINER_ID ||
      destinationContainerId === UNALLOCATED_CONTAINER_ID
    ) {
      throw new FinanceError(
        'VALIDATION',
        'Use the allocation operations to move money between Unallocated and a container.',
      );
    }
    return this.recordTransactionInternal(
      {
        kind: 'container_transfer',
        title:
          optionalText(input.title, 'Description', 80) || 'Container transfer',
        amountMinor: input.amountMinor,
        effectiveDate: input.effectiveDate,
        containerId: sourceContainerId,
        destinationContainerId,
        idempotencyKey: input.idempotencyKey,
      },
      true,
    );
  }

  async contributeToSavings(
    input: ContributeToSavingsInput,
  ): Promise<TransactionMutationResult> {
    const sourceContainerId = requireEntityId(
      input.sourceContainerId,
      'source container',
    );
    if (sourceContainerId === SAVINGS_CONTAINER_ID) {
      throw new FinanceError(
        'VALIDATION',
        'Choose Unallocated or a budget container as the source of a Savings contribution.',
      );
    }
    const source = await this.repository.getContainer(sourceContainerId);
    if (source?.kind === 'savings') {
      throw new FinanceError(
        'VALIDATION',
        'Choose Unallocated or a budget container as the source of a Savings contribution.',
      );
    }
    return this.recordTransactionInternal(
      {
        kind: 'savings',
        title: optionalText(input.title, 'Description', 80) || 'Add to Savings',
        amountMinor: input.amountMinor,
        effectiveDate: input.effectiveDate,
        containerId: sourceContainerId,
        destinationContainerId: SAVINGS_CONTAINER_ID,
        idempotencyKey: input.idempotencyKey,
      },
      true,
    );
  }

  async withdrawFromSavings(
    input: WithdrawFromSavingsInput,
  ): Promise<TransactionMutationResult> {
    const destinationContainerId = requireEntityId(
      input.destinationContainerId,
      'destination container',
    );
    if (destinationContainerId === SAVINGS_CONTAINER_ID) {
      throw new FinanceError(
        'VALIDATION',
        'Choose Unallocated or a budget container as the destination of a Savings withdrawal.',
      );
    }
    if (destinationContainerId !== UNALLOCATED_CONTAINER_ID) {
      const destination = await this.repository.getContainer(
        destinationContainerId,
      );
      if (destination && destination.kind !== 'budget') {
        throw new FinanceError(
          'VALIDATION',
          'Savings can only be moved to Unallocated or a budget container.',
        );
      }
    }
    return this.recordTransactionInternal(
      {
        kind: 'savings',
        title:
          optionalText(input.title, 'Description', 80) ||
          'Withdraw from Savings',
        amountMinor: input.amountMinor,
        effectiveDate: input.effectiveDate,
        containerId: SAVINGS_CONTAINER_ID,
        destinationContainerId,
        idempotencyKey: input.idempotencyKey,
      },
      true,
    );
  }

  private async recordTransactionInternal(
    input: CreateTransactionInput,
    allowSystemContainerTransfers: boolean,
    requireBudgetDestination = false,
  ): Promise<TransactionMutationResult> {
    const context = this.operationContext();
    const key = requireIdempotencyKey(input.idempotencyKey);
    const resolvedInput = await this.resolveUnallocatedInput(input);
    const normalized = normalizeTransactionInput(resolvedInput);
    const fingerprint = fingerprintOf({
      operation: 'record_transaction',
      ...normalized,
    });

    return this.runIdempotent(
      'record_transaction',
      key,
      fingerprint,
      context,
      async () => {
        const transactionId = this.idFactory('txn');
        const prepared = await this.buildForwardTransaction(
          context,
          resolvedInput,
          {
            transactionId,
            idempotencyKey: key,
            requestFingerprint: fingerprint,
            allowSystemContainerTransfers,
            requireBudgetDestination,
          },
        );
        await this.insertPreparedTransaction(prepared);
        await this.reconcileClosedMonthActivity(context, [
          {
            effectiveMonthKey: prepared.row.effectiveMonthKey,
            postings: prepared.postings,
          },
        ]);
        await this.assertLedgerInvariant();
        return { transactionId };
      },
    );
  }

  async reverseTransaction(
    input: ReverseTransactionInput,
  ): Promise<ReversalResult> {
    const context = this.operationContext();
    const key = requireIdempotencyKey(input.idempotencyKey);
    const reason = optionalText(input.reason, 'Reason', 200);
    const fingerprint = fingerprintOf({
      operation: 'reverse_transaction',
      transactionId: input.transactionId,
      reason,
    });

    return this.runIdempotent(
      'reverse_transaction',
      key,
      fingerprint,
      context,
      async () => {
        const reversalId = await this.reverseTransactionInternal(
          context,
          input.transactionId,
          fingerprint,
        );
        await this.reconcileClosedMonthTransactions(context, [reversalId]);
        await this.assertLedgerInvariant();
        return { reversalId };
      },
    );
  }

  async correctTransaction(
    input: CorrectTransactionInput,
  ): Promise<CorrectionResult> {
    const context = this.operationContext();
    const key = requireIdempotencyKey(input.idempotencyKey);
    const reason = optionalText(input.reason, 'Reason', 200);
    const resolvedReplacement = await this.resolveUnallocatedInput(
      input.replacement,
    );
    const replacement = normalizeTransactionInput(resolvedReplacement);
    const fingerprint = fingerprintOf({
      operation: 'correct_transaction',
      transactionId: input.transactionId,
      reason,
      replacement,
    });

    return this.runIdempotent(
      'correct_transaction',
      key,
      fingerprint,
      context,
      async () => {
        const reversalId = await this.reverseTransactionInternal(
          context,
          input.transactionId,
          fingerprint,
        );
        const replacementId = this.idFactory('txn');
        const prepared = await this.buildForwardTransaction(
          context,
          resolvedReplacement,
          {
            transactionId: replacementId,
            idempotencyKey: `correction:${replacementId}`,
            requestFingerprint: fingerprint,
            correctionOfId: input.transactionId,
            allowArchivedContainers: true,
            allowSystemContainerTransfers: true,
          },
        );
        await this.insertPreparedTransaction(prepared);
        await this.reconcileClosedMonthTransactions(context, [
          reversalId,
          replacementId,
        ]);
        await this.assertLedgerInvariant();
        return { reversalId, replacementId };
      },
    );
  }

  async listWallets(): Promise<WalletRow[]> {
    return this.repository.listWallets();
  }

  async listContainers(
    includeDeleted = false,
    includeSystem = false,
  ): Promise<ContainerRow[]> {
    return this.repository.listContainers(includeDeleted, includeSystem);
  }

  async ensureUnallocatedContainer(): Promise<{ containerId: string }> {
    const context = this.operationContext();
    return ensureSystemUnallocatedContainer(this.database, {
      recordedAt: context.recordedAt,
    });
  }

  async getUnallocatedContainer(): Promise<ContainerRow> {
    await this.ensureRolloverCurrent();
    const { containerId } = await this.ensureUnallocatedContainer();
    const container = await this.repository.getContainer(containerId, true);
    if (!container || container.systemKey !== UNALLOCATED_SYSTEM_KEY) {
      throw new FinanceError(
        'INVALID_STATE',
        'The system Unallocated container is unavailable.',
      );
    }
    return container;
  }

  async ensureSavingsContainer(): Promise<{ containerId: string }> {
    const context = this.operationContext();
    return ensureSystemSavingsContainer(this.database, {
      recordedAt: context.recordedAt,
    });
  }

  async getSavingsContainer(): Promise<ContainerRow> {
    await this.ensureRolloverCurrent();
    const { containerId } = await this.ensureSavingsContainer();
    const container = await this.repository.getContainer(containerId, true);
    if (!container || container.systemKey !== SAVINGS_SYSTEM_KEY) {
      throw new FinanceError(
        'INVALID_STATE',
        'The system Savings container is unavailable.',
      );
    }
    return container;
  }

  async initialize(): Promise<void> {
    await this.ensureSystemContainers();
    await this.processDueRollovers();
  }

  async processDueRollovers(): Promise<RolloverResult> {
    if (this.activeRolloverPromise) {
      return this.activeRolloverPromise;
    }

    const task = (async (): Promise<RolloverResult> => {
      const context = this.operationContext();
      await this.ensureSystemContainers();

      return await this.database.withTransactionAsync(async () => {
        const previousMonthKey = shiftMonthKey(context.todayMonthKey, -1);
        const lastRolloverMonthKey =
          await this.repository.getLastRolloverMonthKey();
        let monthKey =
          lastRolloverMonthKey === null
            ? previousMonthKey
            : shiftMonthKey(lastRolloverMonthKey, 1);
        const processedMonths: string[] = [];
        const transactionIds: string[] = [];

        while (monthKey <= previousMonthKey) {
          const existing = await this.repository.getRolloverRun(monthKey);
          if (!existing) {
            const nextMonthKey = shiftMonthKey(monthKey, 1);
            const sweepTransactionIds = await this.createRolloverSweeps(
              context,
              monthKey,
              getCalendarMonth(nextMonthKey).startDateKey,
              1,
            );
            await this.repository.upsertRolloverRun({
              monthKey,
              processedAt: context.recordedAt,
              sweepTransactionIds,
              revision: 1,
            });
            processedMonths.push(monthKey);
            transactionIds.push(...sweepTransactionIds);
          }
          monthKey = shiftMonthKey(monthKey, 1);
        }

        if (processedMonths.length > 0) {
          await this.assertLedgerInvariant();
        }
        return { processedMonths, transactionIds };
      });
    })();

    this.activeRolloverPromise = task;
    try {
      return await task;
    } finally {
      this.activeRolloverPromise = null;
    }
  }

  async getMetadataHistory(containerId: string): Promise<MetadataRow[]> {
    return this.repository.listMetadataHistory(containerId);
  }

  async getLifecycleEvents(containerId: string) {
    return this.repository.listLifecycleEvents(containerId);
  }

  async getWalletSnapshots(asOfDateKey: string): Promise<WalletSnapshot[]> {
    requireDateKey(asOfDateKey, 'As-of date');
    await this.ensureRolloverCurrent();
    return this.repository.getWalletSnapshots(asOfDateKey);
  }

  async getContainerSnapshots(
    monthKey: string,
    includeEmptyArchived = false,
  ): Promise<ContainerSnapshot[]> {
    requireMonthKey(monthKey);
    await this.ensureRolloverCurrent();
    return this.repository.getContainerSnapshots(
      monthKey,
      includeEmptyArchived,
    );
  }

  async getUnallocatedSnapshot(
    monthKey: string,
  ): Promise<ContainerSnapshot | null> {
    requireMonthKey(monthKey);
    await this.ensureRolloverCurrent();
    await this.ensureUnallocatedContainer();
    const snapshots = await this.repository.getContainerSnapshots(monthKey);
    return (
      snapshots.find(
        (container) => container.systemKey === UNALLOCATED_SYSTEM_KEY,
      ) ?? null
    );
  }

  async getSavingsSnapshot(
    monthKey: string,
  ): Promise<ContainerSnapshot | null> {
    requireMonthKey(monthKey);
    await this.ensureRolloverCurrent();
    await this.ensureSavingsContainer();
    const snapshots = await this.repository.getContainerSnapshots(monthKey);
    return (
      snapshots.find(
        (container) => container.systemKey === SAVINGS_SYSTEM_KEY,
      ) ?? null
    );
  }

  async getContainerMonthResults(monthKey: string): Promise<ContainerMonthResult[]> {
    requireMonthKey(monthKey);
    await this.ensureRolloverCurrent();
    return this.repository.getContainerMonthResults(monthKey);
  }

  async getMonthSummary(
    monthKey: string,
    activeMonthKey: string,
  ): Promise<MonthSummary> {
    requireMonthKey(monthKey);
    requireMonthKey(activeMonthKey);
    await this.ensureRolloverCurrent();
    return this.repository.getMonthSummary(monthKey, activeMonthKey);
  }

  async getTransactionsForMonth(monthKey: string): Promise<Transaction[]> {
    requireMonthKey(monthKey);
    await this.ensureRolloverCurrent();
    return this.repository.getTransactionsForMonth(monthKey);
  }

  async getRecentTransactions(limit = 20): Promise<Transaction[]> {
    await this.ensureRolloverCurrent();
    return this.repository.getRecentTransactions(limit);
  }

  async getTransaction(transactionId: string): Promise<TransactionRow | null> {
    return this.repository.getTransaction(transactionId);
  }

  async getWalletBalances(asOfDateKey: string): Promise<Record<string, number>> {
    requireDateKey(asOfDateKey, 'As-of date');
    await this.ensureRolloverCurrent();
    const wallets = await this.repository.getWalletSnapshots(asOfDateKey);
    return Object.fromEntries(
      wallets.map((wallet) => [wallet.id, wallet.balanceMinor]),
    );
  }

  async getContainerBalances(
    asOfDateKey: string,
  ): Promise<Record<string, number>> {
    requireDateKey(asOfDateKey, 'As-of date');
    await this.ensureRolloverCurrent();
    const containers = await this.repository.listContainers(false, true);
    const balances = await Promise.all(
      containers.map(async (container) => [
        container.id,
        await this.repository.getContainerBalance(container.id, asOfDateKey),
      ] as const),
    );
    return Object.fromEntries(balances);
  }

  private async ensureSystemContainers(): Promise<void> {
    const context = this.operationContext();
    await ensureSystemUnallocatedContainer(this.database, {
      recordedAt: context.recordedAt,
    });
    await ensureSystemSavingsContainer(this.database, {
      recordedAt: context.recordedAt,
    });
  }

  private async ensureRolloverCurrent(): Promise<void> {
    if (this.activeRolloverPromise) {
      await this.activeRolloverPromise;
      return;
    }
    const context = this.operationContext();
    const previousMonthKey = shiftMonthKey(context.todayMonthKey, -1);
    const lastRolloverMonthKey =
      await this.repository.getLastRolloverMonthKey();
    if (
      lastRolloverMonthKey !== null &&
      lastRolloverMonthKey >= previousMonthKey
    ) {
      return;
    }
    await this.processDueRollovers();
  }

  private async createRolloverSweeps(
    context: OperationContext,
    closedMonthKey: string,
    effectiveDate: string,
    revision: number,
  ): Promise<string[]> {
    const month = getCalendarMonth(closedMonthKey);
    const containers = await this.repository.listContainers(false, true);
    const candidates = containers.filter(
      (container) =>
        container.systemKey === null && container.kind === 'budget',
    );
    const destinationLabel = await this.requireContainerLabel(
      UNALLOCATED_CONTAINER_ID,
      closedMonthKey,
    );
    const transactionIds: string[] = [];

    for (const source of candidates) {
      const amountMinor = await this.repository.getContainerBalance(
        source.id,
        month.endDateKey,
      );
      if (amountMinor <= 0) continue;

      const sourceLabel = await this.requireContainerLabel(
        source.id,
        closedMonthKey,
      );
      const transactionId = this.idFactory('txn');
      const row = makeTransactionRow(
        {
          id: transactionId,
          idempotencyKey: `${ROLLOVER_IDEMPOTENCY_PREFIX}${closedMonthKey}:${source.id}:r${revision}`,
          requestFingerprint: fingerprintOf({
            operation: 'month_rollover',
            closedMonthKey,
            sourceContainerId: source.id,
            amountMinor,
            effectiveDate,
            revision,
          }),
          amountMinor,
          effectiveDate,
          effectiveMonthKey: monthKeyForDateKey(effectiveDate),
          recordedAt: context.recordedAt,
          recordedTimeZone: context.recordedTimeZone,
          recordedOffsetMinutes: context.recordedOffsetMinutes,
          status: 'posted',
          reversalOfId: null,
          correctionOfId: null,
          createdAt: context.recordedAt,
        },
        {
          kind: 'container_transfer',
          title: `Rollover: ${sourceLabel.name}`,
          category: 'Monthly rollover',
          direction: 'neutral',
          sourceWalletId: null,
          destinationWalletId: null,
          sourceContainerId: source.id,
          destinationContainerId: UNALLOCATED_CONTAINER_ID,
          sourceWalletName: null,
          destinationWalletName: null,
          sourceContainerName: sourceLabel.name,
          destinationContainerName: destinationLabel.name,
          icon: TRANSFER_ICON,
          tone: 'violet',
        },
      );

      await this.insertPreparedTransaction({
        row,
        postings: [
          {
            accountType: 'container',
            accountId: source.id,
            amountMinor: -amountMinor,
          },
          {
            accountType: 'container',
            accountId: UNALLOCATED_CONTAINER_ID,
            amountMinor,
          },
        ],
      });
      transactionIds.push(transactionId);
    }

    return transactionIds;
  }

  private async reconcileClosedMonthTransactions(
    context: OperationContext,
    transactionIds: readonly string[],
  ): Promise<void> {
    const entries: ClosedMonthActivity[] = [];
    for (const transactionId of transactionIds) {
      const transaction = await this.repository.getTransaction(transactionId);
      if (!transaction) {
        throw new FinanceError(
          'INVALID_STATE',
          'A posted transaction could not be read back for rollover reconciliation.',
        );
      }
      const postings = await this.repository.getPostingsForTransaction(
        transactionId,
      );
      entries.push({
        effectiveMonthKey: transaction.effectiveMonthKey,
        postings: postings.map((posting) => ({
          accountType: posting.accountType,
          accountId: posting.accountId,
          amountMinor: posting.amountMinor,
        })),
      });
    }
    await this.reconcileClosedMonthActivity(context, entries);
  }

  private async reconcileClosedMonthActivity(
    context: OperationContext,
    entries: readonly ClosedMonthActivity[],
  ): Promise<void> {
    const previousMonthKey = shiftMonthKey(context.todayMonthKey, -1);
    const lastRolloverMonthKey =
      await this.repository.getLastRolloverMonthKey();
    if (lastRolloverMonthKey === null) return;

    let earliestAffectedMonth: string | null = null;
    for (const entry of entries) {
      if (
        entry.effectiveMonthKey > previousMonthKey ||
        entry.effectiveMonthKey > lastRolloverMonthKey
      ) {
        continue;
      }
      for (const posting of entry.postings) {
        if (posting.accountType !== 'container') continue;
        const container = await this.repository.getContainer(
          posting.accountId,
          true,
        );
        if (
          container &&
          container.systemKey === null &&
          container.kind === 'budget'
        ) {
          if (
            earliestAffectedMonth === null ||
            entry.effectiveMonthKey < earliestAffectedMonth
          ) {
            earliestAffectedMonth = entry.effectiveMonthKey;
          }
          break;
        }
      }
    }

    if (earliestAffectedMonth !== null) {
      await this.replayRolloversFrom(context, earliestAffectedMonth);
    }
  }

  private async replayRolloversFrom(
    context: OperationContext,
    fromMonthKey: string,
  ): Promise<void> {
    const runs = await this.repository.listRolloverRunsFrom(fromMonthKey);
    if (runs.length === 0) return;

    for (const run of runs) {
      for (const sweepTransactionId of run.sweepTransactionIds) {
        const sweep = await this.repository.getTransaction(sweepTransactionId);
        if (!sweep) {
          throw new FinanceError(
            'INVALID_STATE',
            'A monthly rollover transfer is missing.',
          );
        }
        if (sweep.status === 'reversed') continue;
        await this.reverseTransactionInternal(
          context,
          sweepTransactionId,
          fingerprintOf({
            operation: 'replay_month_rollover',
            monthKey: run.monthKey,
            sweepTransactionId,
          }),
          true,
        );
      }
    }

    for (const run of runs) {
      const revision = run.revision + 1;
      const nextMonthKey = shiftMonthKey(run.monthKey, 1);
      const sweepTransactionIds = await this.createRolloverSweeps(
        context,
        run.monthKey,
        getCalendarMonth(nextMonthKey).startDateKey,
        revision,
      );
      await this.repository.upsertRolloverRun({
        monthKey: run.monthKey,
        processedAt: context.recordedAt,
        sweepTransactionIds,
        revision,
      });
    }

    const checkDates = new Set<string>([
      ...(await this.repository.listPostingDateKeys(
        getCalendarMonth(fromMonthKey).startDateKey,
        context.todayDateKey,
      )),
      context.todayDateKey,
    ]);
    await this.assertNoNegativeBalances([...checkDates]);
  }

  private async buildForwardTransaction(
    context: OperationContext,
    input: TransactionDetails,
    meta: {
      transactionId: string;
      idempotencyKey: string;
      requestFingerprint: string;
      correctionOfId?: string;
      allowArchivedContainers?: boolean;
      allowSystemContainerTransfers?: boolean;
      requireBudgetDestination?: boolean;
    },
  ): Promise<PreparedTransaction> {
    const title = requireText(input.title, 'Description', 80);
    requirePositiveInteger(input.amountMinor, 'Amount');
    requireDateKey(input.effectiveDate, 'Effective date');
    if (input.effectiveDate > context.todayDateKey) {
      throw new FinanceError(
        'VALIDATION',
        'Future-dated entries are not allowed.',
      );
    }
    const effectiveMonthKey = monthKeyForDateKey(input.effectiveDate);
    const recorded = {
      id: meta.transactionId,
      idempotencyKey: meta.idempotencyKey,
      requestFingerprint: meta.requestFingerprint,
      amountMinor: input.amountMinor,
      effectiveDate: input.effectiveDate,
      effectiveMonthKey,
      recordedAt: context.recordedAt,
      recordedTimeZone: context.recordedTimeZone,
      recordedOffsetMinutes: context.recordedOffsetMinutes,
      status: 'posted' as const,
      reversalOfId: null,
      correctionOfId: meta.correctionOfId ?? null,
      createdAt: context.recordedAt,
    };

    if (input.kind === 'expense' || input.kind === 'income') {
      const wallet = await this.requireWallet(input.walletId);
      const container = await this.requireContainer(
        input.containerId,
        effectiveMonthKey,
        meta.allowArchivedContainers ?? false,
      );
      if (input.kind === 'expense' && container.systemKey) {
        throw new FinanceError(
          'SYSTEM_CONTAINER',
          `${container.systemKey === 'savings' ? 'Savings' : 'Unallocated'} funds cannot be spent directly. Move money to an active budget container before recording an expense.`,
        );
      }
      const label = await this.requireContainerLabel(
        container.id,
        effectiveMonthKey,
      );

      if (input.kind === 'expense') {
        await this.requireSufficientWalletBalance(
          wallet.id,
          input.amountMinor,
          input.effectiveDate,
        );
        await this.requireSufficientContainerBalance(
          container.id,
          input.amountMinor,
          input.effectiveDate,
        );
      }

      const isIncome = input.kind === 'income';
      const row = makeTransactionRow(recorded, {
        kind: input.kind,
        title,
        category: label.name,
        direction: isIncome ? 'in' : 'out',
        sourceWalletId: isIncome ? null : wallet.id,
        destinationWalletId: isIncome ? wallet.id : null,
        sourceContainerId: isIncome ? null : container.id,
        destinationContainerId: isIncome ? container.id : null,
        sourceWalletName: isIncome ? null : wallet.name,
        destinationWalletName: isIncome ? wallet.name : null,
        sourceContainerName: isIncome ? null : label.name,
        destinationContainerName: isIncome ? label.name : null,
        icon: isIncome ? 'arrow-down' : label.icon,
        tone: isIncome ? 'emerald' : label.tone,
      });
      const signedAmount = isIncome ? input.amountMinor : -input.amountMinor;
      return {
        row,
        postings: [
          {
            accountType: 'wallet',
            accountId: wallet.id,
            amountMinor: signedAmount,
          },
          {
            accountType: 'container',
            accountId: container.id,
            amountMinor: signedAmount,
          },
        ],
      };
    }

    if (input.kind === 'wallet_transfer') {
      const source = await this.requireWallet(input.walletId);
      const destination = await this.requireWallet(input.destinationWalletId);
      if (source.id === destination.id) {
        throw new FinanceError(
          'VALIDATION',
          'Choose two different wallets for a transfer.',
        );
      }
      await this.requireSufficientWalletBalance(
        source.id,
        input.amountMinor,
        input.effectiveDate,
      );
      const row = makeTransactionRow(recorded, {
        kind: 'wallet_transfer',
        title,
        category: 'Wallet transfer',
        direction: 'neutral',
        sourceWalletId: source.id,
        destinationWalletId: destination.id,
        sourceContainerId: null,
        destinationContainerId: null,
        sourceWalletName: source.name,
        destinationWalletName: destination.name,
        sourceContainerName: null,
        destinationContainerName: null,
        icon: TRANSFER_ICON,
        tone: 'blue',
      });
      return {
        row,
        postings: [
          {
            accountType: 'wallet',
            accountId: source.id,
            amountMinor: -input.amountMinor,
          },
          {
            accountType: 'wallet',
            accountId: destination.id,
            amountMinor: input.amountMinor,
          },
        ],
      };
    }

    if (input.kind !== 'container_transfer' && input.kind !== 'savings') {
      throw new FinanceError('VALIDATION', 'Choose a valid transaction type.');
    }

    const source = await this.requireContainer(
      input.containerId,
      effectiveMonthKey,
      meta.allowArchivedContainers ?? false,
    );
    const destination = await this.requireContainer(
      input.destinationContainerId,
      effectiveMonthKey,
      meta.allowArchivedContainers ?? false,
    );
    if (source.id === destination.id) {
      throw new FinanceError(
        'VALIDATION',
        'Choose two different containers for a transfer.',
      );
    }
    if (
      (source.systemKey || destination.systemKey) &&
      !meta.allowSystemContainerTransfers
    ) {
      throw new FinanceError(
        'SYSTEM_CONTAINER',
        'Use the Unallocated or Savings operations to move money with a system account.',
      );
    }
    if (meta.requireBudgetDestination && destination.kind !== 'budget') {
      throw new FinanceError(
        'VALIDATION',
        'Allocate Unallocated funds to a budget container. Use a Savings operation for savings.',
      );
    }
    const destinationLabel = await this.requireContainerLabel(
      destination.id,
      effectiveMonthKey,
    );
    const kind: TransactionKind =
      source.kind === 'savings' || destination.kind === 'savings'
        ? 'savings'
        : 'container_transfer';
    if (input.kind === 'savings' && kind !== 'savings') {
      throw new FinanceError(
        'VALIDATION',
        'Savings contributions must go into a savings container.',
      );
    }
    await this.requireSufficientContainerBalance(
      source.id,
      input.amountMinor,
      input.effectiveDate,
    );
    const row = makeTransactionRow(recorded, {
      kind,
      title,
      category: kind === 'savings' ? 'Savings transfer' : 'Container transfer',
      direction: 'neutral',
      sourceWalletId: null,
      destinationWalletId: null,
      sourceContainerId: source.id,
      destinationContainerId: destination.id,
      sourceWalletName: null,
      destinationWalletName: null,
      sourceContainerName: destinationLabel.name,
      destinationContainerName: destinationLabel.name,
      icon: kind === 'savings' ? SAVINGS_ICON : TRANSFER_ICON,
      tone: kind === 'savings' ? 'emerald' : 'violet',
    });

    const sourceLabel = await this.requireContainerLabel(
      source.id,
      effectiveMonthKey,
    );
    row.sourceContainerName = sourceLabel.name;

    return {
      row,
      postings: [
        {
          accountType: 'container',
          accountId: source.id,
          amountMinor: -input.amountMinor,
        },
        {
          accountType: 'container',
          accountId: destination.id,
          amountMinor: input.amountMinor,
        },
      ],
    };
  }

  private async insertPreparedTransaction(
    prepared: PreparedTransaction,
  ): Promise<void> {
    validatePostingSet(
      prepared.row.kind,
      prepared.row.amountMinor,
      prepared.postings,
    );
    await this.repository.insertTransaction(prepared.row);
    await this.repository.insertPostings(
      prepared.postings.map<NewPostingRow>((posting) => ({
        transactionId: prepared.row.id,
        accountType: posting.accountType,
        accountId: posting.accountId,
        amountMinor: posting.amountMinor,
        recordedAt: prepared.row.recordedAt,
      })),
    );
  }

  private async reverseTransactionInternal(
    context: OperationContext,
    transactionId: string,
    requestFingerprint: string,
    allowRolloverReversal = false,
  ): Promise<string> {
    const original = await this.repository.getTransaction(transactionId);
    if (!original) {
      throw new FinanceError('NOT_FOUND', 'That transaction no longer exists.');
    }
    if (
      original.idempotencyKey.startsWith(ROLLOVER_IDEMPOTENCY_PREFIX) &&
      !allowRolloverReversal
    ) {
      throw new FinanceError(
        'INVALID_STATE',
        'Monthly rollover transfers are managed automatically and cannot be reversed or corrected directly.',
      );
    }
    if (original.reversalOfId) {
      throw new FinanceError(
        'INVALID_STATE',
        'A reversal transaction cannot itself be reversed.',
      );
    }
    if (original.status !== 'posted') {
      throw new FinanceError(
        'INVALID_STATE',
        'That transaction has already been reversed.',
      );
    }
    const originalPostings = await this.repository.getPostingsForTransaction(
      original.id,
    );
    if (originalPostings.length !== 2) {
      throw new FinanceError(
        'INVALID_STATE',
        'The original transaction does not have a valid posting set.',
      );
    }

    const reversalId = this.idFactory('txn');
    const title = `Reversal: ${original.title}`.slice(0, 80);
    const reversal = makeTransactionRow(
      {
        id: reversalId,
        idempotencyKey: `reversal:${reversalId}`,
        requestFingerprint,
        amountMinor: original.amountMinor,
        effectiveDate: original.effectiveDate,
        effectiveMonthKey: original.effectiveMonthKey,
        recordedAt: context.recordedAt,
        recordedTimeZone: context.recordedTimeZone,
        recordedOffsetMinutes: context.recordedOffsetMinutes,
        status: 'posted',
        reversalOfId: original.id,
        correctionOfId: null,
        createdAt: context.recordedAt,
      },
      {
        kind: original.kind,
        title,
        category: original.category,
        direction: original.direction,
        sourceWalletId: original.sourceWalletId,
        destinationWalletId: original.destinationWalletId,
        sourceContainerId: original.sourceContainerId,
        destinationContainerId: original.destinationContainerId,
        sourceWalletName: original.sourceWalletName,
        destinationWalletName: original.destinationWalletName,
        sourceContainerName: original.sourceContainerName,
        destinationContainerName: original.destinationContainerName,
        icon: original.icon,
        tone: original.tone,
      },
    );

    validateReversalPostings(
      originalPostings,
      originalPostings.map<PostingDraft>((posting) => ({
        accountType: posting.accountType,
        accountId: posting.accountId,
        amountMinor: -posting.amountMinor,
      })),
    );
    await this.repository.insertTransaction(reversal);
    await this.repository.insertPostings(
      originalPostings.map<NewPostingRow>((posting) => ({
        transactionId: reversalId,
        accountType: posting.accountType,
        accountId: posting.accountId,
        amountMinor: -posting.amountMinor,
        recordedAt: context.recordedAt,
      })),
    );
    await this.repository.markTransactionReversed(original.id);
    return reversalId;
  }

  private async assertLedgerInvariant(): Promise<void> {
    const matches = await this.repository.allWalletContainerTotalsMatch(
      '9999-12-31',
    );
    if (!matches) {
      throw new FinanceError(
        'INVALID_STATE',
        'The wallet and container totals do not match.',
      );
    }
  }

  private async assertNoNegativeBalances(
    asOfDateKeys: readonly string[],
  ): Promise<void> {
    const containers = await this.repository.listContainers(true, true);
    const wallets = await this.repository.listWallets();
    for (const asOfDateKey of asOfDateKeys) {
      for (const container of containers) {
        const balance = await this.repository.getContainerBalance(
          container.id,
          asOfDateKey,
        );
        if (balance < 0) {
          throw new FinanceError(
            'INSUFFICIENT_FUNDS',
            'This change would make a container balance negative because rolled-over funds have already been used. Restore those funds before correcting the closed month.',
          );
        }
      }

      for (const wallet of wallets) {
        const balance = await this.repository.getWalletBalance(
          wallet.id,
          asOfDateKey,
        );
        if (balance < 0) {
          throw new FinanceError(
            'INSUFFICIENT_FUNDS',
            'This change would make a wallet balance negative.',
          );
        }
      }
    }
  }

  private async requireWallet(walletId: string | undefined): Promise<WalletRow> {
    if (!walletId) {
      throw new FinanceError('VALIDATION', 'Choose a wallet.');
    }
    const wallet = await this.repository.getWallet(walletId);
    if (!wallet) {
      throw new FinanceError('NOT_FOUND', 'That wallet no longer exists.');
    }
    return wallet;
  }

  private async requireContainer(
    containerId: string | undefined,
    effectiveMonthKey: string,
    allowArchived: boolean,
  ): Promise<ContainerRow> {
    if (!containerId) {
      throw new FinanceError('VALIDATION', 'Choose a container.');
    }
    const container = await this.repository.getContainer(containerId);
    if (!container) {
      throw new FinanceError('NOT_FOUND', 'That container no longer exists.');
    }
    if (container.createdMonthKey > effectiveMonthKey) {
      throw new FinanceError(
        'VALIDATION',
        'That container did not exist on the selected date.',
      );
    }
    if (container.status === 'archived' && !allowArchived) {
      throw new FinanceError(
        'ARCHIVED_CONTAINER',
        'Archived containers cannot receive new activity.',
      );
    }
    return container;
  }

  private async requireExistingContainer(
    containerId: string,
  ): Promise<ContainerRow> {
    const container = await this.repository.getContainer(containerId);
    if (!container) {
      throw new FinanceError('NOT_FOUND', 'That container no longer exists.');
    }
    return container;
  }

  private async requireActiveContainer(containerId: string): Promise<ContainerRow> {
    const container = await this.requireExistingContainer(containerId);
    if (container.status === 'archived') {
      throw new FinanceError(
        'ARCHIVED_CONTAINER',
        'Reactivate this container before changing it.',
      );
    }
    return container;
  }

  private requireUserContainer(container: ContainerRow): void {
    if (container.systemKey) {
      const name = container.systemKey === 'savings' ? 'Savings' : 'Unallocated';
      throw new FinanceError(
        'SYSTEM_CONTAINER',
        `The system ${name} account is managed by the app and cannot be renamed, archived, limited, or deleted.`,
      );
    }
  }

  private async resolveUnallocatedInput(
    input: TransactionDetails,
  ): Promise<TransactionDetails> {
    const containerId = input.containerId?.trim();
    const destinationContainerId = input.destinationContainerId?.trim();
    const needsDefaultContainer =
      input.kind === 'income' && !containerId;
    const referencesUnallocated =
      ((input.kind === 'income' || input.kind === 'expense') &&
        containerId === UNALLOCATED_CONTAINER_ID) ||
      ((input.kind === 'container_transfer' || input.kind === 'savings') &&
        (containerId === UNALLOCATED_CONTAINER_ID ||
          destinationContainerId === UNALLOCATED_CONTAINER_ID));

    if (!needsDefaultContainer && !referencesUnallocated) {
      return input;
    }

    const { containerId: systemContainerId } =
      await this.ensureUnallocatedContainer();
    return needsDefaultContainer
      ? { ...input, containerId: systemContainerId }
      : input;
  }

  private async requireContainerLabel(
    containerId: string,
    effectiveMonthKey: string,
  ): Promise<ContainerLabel> {
    const metadata = await this.repository.getMetadataAsOf(
      containerId,
      effectiveMonthKey,
    );
    if (!metadata) {
      throw new FinanceError(
        'INVALID_STATE',
        'Historical container details are missing.',
      );
    }
    return metadata.label;
  }

  private async requireSufficientWalletBalance(
    walletId: string,
    amountMinor: number,
    effectiveDate: string,
  ): Promise<void> {
    const balance = await this.repository.getWalletBalance(
      walletId,
      effectiveDate,
    );
    if (balance < amountMinor) {
      throw new FinanceError(
        'INSUFFICIENT_FUNDS',
        'That wallet does not have enough money on the selected date.',
      );
    }
  }

  private async requireSufficientContainerBalance(
    containerId: string,
    amountMinor: number,
    effectiveDate: string,
  ): Promise<void> {
    const balance = await this.repository.getContainerBalance(
      containerId,
      effectiveDate,
    );
    if (balance < amountMinor) {
      throw new FinanceError(
        'INSUFFICIENT_FUNDS',
        'That container does not have enough money on the selected date.',
      );
    }
  }

  private operationContext(): OperationContext {
    const now = this.now();
    const stamp = captureRecordedStamp(now);
    const todayDateKey = toLocalDateKey(now);
    return {
      recordedAt: stamp.recordedAt,
      recordedTimeZone: stamp.recordedTimeZone,
      recordedOffsetMinutes: stamp.recordedOffsetMinutes,
      todayDateKey,
      todayMonthKey: monthKeyForDateKey(todayDateKey),
    };
  }

  private async runIdempotent<T>(
    operationType: string,
    idempotencyKey: string,
    requestFingerprint: string,
    context: OperationContext,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      await this.ensureRolloverCurrent();
      return await this.database.withTransactionAsync(async () => {
        const existing = await this.repository.getReceipt(idempotencyKey);
        if (existing) {
          if (
            existing.operationType !== operationType ||
            existing.requestFingerprint !== requestFingerprint
          ) {
            throw new FinanceError(
              'IDEMPOTENCY_CONFLICT',
              'That idempotency key was already used for a different operation.',
            );
          }
          try {
            return JSON.parse(existing.resultJson) as T;
          } catch (error) {
            throw new FinanceError(
              'DATABASE',
              'The stored operation receipt is invalid.',
              { cause: error },
            );
          }
        }

        const result = await work();
        await this.repository.insertReceipt({
          idempotencyKey,
          operationType,
          requestFingerprint,
          resultJson: JSON.stringify(result),
          createdAt: context.recordedAt,
        });
        return result;
      });
    } catch (error) {
      if (error instanceof FinanceError) throw error;
      throw new FinanceError(
        'DATABASE',
        'The database operation failed and was rolled back.',
        { cause: error },
      );
    }
  }
}

function makeTransactionRow(
  base: {
    id: string;
    idempotencyKey: string;
    requestFingerprint: string;
    amountMinor: number;
    effectiveDate: string;
    effectiveMonthKey: string;
    recordedAt: string;
    recordedTimeZone: string;
    recordedOffsetMinutes: number;
    status: 'posted';
    reversalOfId: string | null;
    correctionOfId: string | null;
    createdAt: string;
  },
  fields: {
    kind: TransactionKind;
    title: string;
    category: string;
    direction: TransactionDirection;
    sourceWalletId: string | null;
    destinationWalletId: string | null;
    sourceContainerId: string | null;
    destinationContainerId: string | null;
    sourceWalletName: string | null;
    destinationWalletName: string | null;
    sourceContainerName: string | null;
    destinationContainerName: string | null;
    icon: IconName;
    tone: Tone;
  },
): NewTransactionRow {
  return {
    ...base,
    ...fields,
  };
}

function metadataRow(
  containerId: string,
  effectiveMonthKey: string,
  label: ContainerLabel,
  recordedAt: string,
): MetadataRow {
  return {
    id: 0,
    containerId,
    effectiveMonthKey,
    label,
    recordedAt,
  };
}

function validatePostingSet(
  kind: TransactionKind,
  amountMinor: number,
  postings: readonly PostingDraft[],
): void {
  if (postings.length !== 2) {
    throw new FinanceError(
      'INVALID_STATE',
      'A transaction must create exactly two postings.',
    );
  }
  for (const posting of postings) {
    if (!Number.isInteger(posting.amountMinor) || posting.amountMinor === 0) {
      throw new FinanceError(
        'INVALID_STATE',
        'Every posting must be a non-zero integer amount.',
      );
    }
  }

  const walletPostings = postings.filter(
    (posting) => posting.accountType === 'wallet',
  );
  const containerPostings = postings.filter(
    (posting) => posting.accountType === 'container',
  );

  if (kind === 'income') {
    if (
      walletPostings.length !== 1 ||
      containerPostings.length !== 1 ||
      postings.some((posting) => posting.amountMinor !== amountMinor)
    ) {
      throw new FinanceError('INVALID_STATE', 'Invalid income postings.');
    }
    return;
  }

  if (kind === 'expense') {
    if (
      walletPostings.length !== 1 ||
      containerPostings.length !== 1 ||
      postings.some((posting) => posting.amountMinor !== -amountMinor)
    ) {
      throw new FinanceError('INVALID_STATE', 'Invalid expense postings.');
    }
    return;
  }

  if (kind === 'wallet_transfer') {
    if (
      walletPostings.length !== 2 ||
      containerPostings.length !== 0 ||
      walletPostings[0]?.accountId === walletPostings[1]?.accountId
    ) {
      throw new FinanceError(
        'INVALID_STATE',
        'Invalid wallet transfer postings.',
      );
    }
  } else if (
    containerPostings.length !== 2 ||
    walletPostings.length !== 0 ||
    containerPostings[0]?.accountId === containerPostings[1]?.accountId
  ) {
    throw new FinanceError(
      'INVALID_STATE',
      'Invalid container transfer postings.',
    );
  }

  const total = postings.reduce(
    (sum, posting) => sum + posting.amountMinor,
    0,
  );
  if (total !== 0) {
    throw new FinanceError(
      'INVALID_STATE',
      'Transfer postings must balance to zero.',
    );
  }
}

function validateReversalPostings(
  original: readonly PostingRow[],
  reversal: readonly PostingDraft[],
): void {
  if (original.length !== 2 || reversal.length !== 2) {
    throw new FinanceError(
      'INVALID_STATE',
      'A reversal must mirror exactly two original postings.',
    );
  }

  for (const [index, originalPosting] of original.entries()) {
    const reversalPosting = reversal[index];
    if (
      !reversalPosting ||
      reversalPosting.accountType !== originalPosting.accountType ||
      reversalPosting.accountId !== originalPosting.accountId ||
      reversalPosting.amountMinor !== -originalPosting.amountMinor ||
      reversalPosting.amountMinor === 0
    ) {
      throw new FinanceError(
        'INVALID_STATE',
        'Reversal postings must exactly negate the original postings.',
      );
    }
  }
}

function normalizeTransactionInput(input: TransactionDetails) {
  return {
    kind: input.kind,
    title: input.title.trim(),
    amountMinor: input.amountMinor,
    effectiveDate: input.effectiveDate,
    walletId: input.walletId?.trim() ?? null,
    containerId: input.containerId?.trim() ?? null,
    destinationWalletId: input.destinationWalletId?.trim() ?? null,
    destinationContainerId: input.destinationContainerId?.trim() ?? null,
  };
}

function requireIdempotencyKey(value: string): string {
  const key = value.trim();
  if (!key || key.length > 200) {
    throw new FinanceError(
      'VALIDATION',
      'An idempotency key between 1 and 200 characters is required.',
    );
  }
  return key;
}

function requireEntityId(value: string, label: string): string {
  const id = value.trim();
  if (!id || id.length > 120) {
    throw new FinanceError(
      'VALIDATION',
      `A valid ${label} ID is required.`,
    );
  }
  return id;
}

function requireText(value: string, label: string, maxLength: number): string {
  const text = value.trim();
  if (!text) {
    throw new FinanceError('VALIDATION', `Add a ${label.toLowerCase()}.`);
  }
  if (text.length > maxLength) {
    throw new FinanceError(
      'VALIDATION',
      `${label} must be ${maxLength} characters or fewer.`,
    );
  }
  return text;
}

function optionalText(
  value: string | undefined,
  label: string,
  maxLength: number,
): string {
  const text = value?.trim() ?? '';
  if (text.length > maxLength) {
    throw new FinanceError(
      'VALIDATION',
      `${label} must be ${maxLength} characters or fewer.`,
    );
  }
  return text;
}

function requireIcon(icon: string): void {
  if (!icon.trim()) {
    throw new FinanceError('VALIDATION', 'Choose an icon.');
  }
}

function requireTone(tone: string): asserts tone is Tone {
  if (!TONES.includes(tone as Tone)) {
    throw new FinanceError('VALIDATION', 'Choose a valid theme tone.');
  }
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new FinanceError(
      'VALIDATION',
      `${label} must be a whole number of centavos greater than zero.`,
    );
  }
}

function requireNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FinanceError(
      'VALIDATION',
      `${label} must be zero or more centavos.`,
    );
  }
}

function requireDateKey(value: string, label: string): void {
  if (!isValidDateKey(value)) {
    throw new FinanceError(
      'VALIDATION',
      `${label} must be a valid date in YYYY-MM-DD format.`,
    );
  }
}

function requireMonthKey(value: string): void {
  if (!isValidMonthKey(value)) {
    throw new FinanceError(
      'VALIDATION',
      'Use a valid calendar month in YYYY-MM format.',
    );
  }
}

function requireEditableMonth(monthKey: string, todayMonthKey: string): void {
  requireMonthKey(monthKey);
  if (monthKey < todayMonthKey) {
    throw new FinanceError(
      'VALIDATION',
      'Past months are read-only. Choose the current or a future month.',
    );
  }
}

function fingerprintOf(value: unknown): string {
  return stableSerialize(value);
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? 'null' : serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .filter((key) => record[key] !== undefined)
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableSerialize(record[key])}`,
    )
    .join(',')}}`;
}

function defaultIdFactory(prefix: string): string {
  const cryptoObject = globalThis.crypto as
    | { randomUUID?: () => string }
    | undefined;
  if (cryptoObject?.randomUUID) {
    return `${prefix}-${cryptoObject.randomUUID()}`;
  }
  fallbackIdSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${fallbackIdSequence.toString(
    36,
  )}-${Math.random().toString(36).slice(2, 10)}`;
}
