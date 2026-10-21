import type {
  ContainerLabel,
  ContainerKind,
  ContainerMonthResult,
  ContainerSnapshot,
  ContainerStatus,
  MonthSummary,
  Transaction,
  TransactionDirection,
  TransactionKind,
  TransactionStatus,
  WalletKind,
  WalletSnapshot,
} from '@/data/models';
import type { IconName } from '@/lib/icons';
import { getCalendarMonth } from '@/lib/period';
import type { Tone } from '@/theme';

import type { SqlDatabase, SqlValue } from './sqlDatabase';

export type AccountType = 'wallet' | 'container';

export interface WalletRow {
  id: string;
  name: string;
  kind: WalletKind;
  icon: IconName;
  tone: Tone;
  sortOrder: number;
  createdAt: string;
}

export interface ContainerRow {
  id: string;
  kind: ContainerKind;
  status: ContainerStatus;
  sortOrder: number;
  createdMonthKey: string;
  createdAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
}

export interface MetadataRow {
  id: number;
  containerId: string;
  effectiveMonthKey: string;
  label: ContainerLabel;
  recordedAt: string;
}

export interface TransactionRow {
  id: string;
  idempotencyKey: string;
  requestFingerprint: string;
  kind: TransactionKind;
  title: string;
  category: string;
  direction: TransactionDirection;
  amountMinor: number;
  effectiveDate: string;
  effectiveMonthKey: string;
  recordedAt: string;
  recordedTimeZone: string;
  recordedOffsetMinutes: number;
  status: TransactionStatus;
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
  reversalOfId: string | null;
  correctionOfId: string | null;
  createdAt: string;
}

export type NewTransactionRow = TransactionRow;

export interface PostingRow {
  id: number;
  transactionId: string;
  accountType: AccountType;
  accountId: string;
  amountMinor: number;
  recordedAt: string;
}

export interface NewPostingRow {
  transactionId: string;
  accountType: AccountType;
  accountId: string;
  amountMinor: number;
  recordedAt: string;
}

export interface ReceiptRow {
  idempotencyKey: string;
  operationType: string;
  requestFingerprint: string;
  resultJson: string;
  createdAt: string;
}

export interface LifecycleEventRow {
  id: number;
  containerId: string;
  eventType: string;
  effectiveMonthKey: string;
  recordedAt: string;
  detailsJson: string;
}

interface WalletRowResult {
  id: string;
  name: string;
  kind: WalletKind;
  icon: IconName;
  tone: Tone;
  sort_order: number;
  created_at: string;
  balance_minor?: number;
}

interface ContainerRowResult {
  id: string;
  kind: ContainerKind;
  status: ContainerStatus;
  sort_order: number;
  created_month_key: string;
  created_at: string;
  archived_at: string | null;
  deleted_at: string | null;
}

interface MetadataRowResult {
  id: number;
  container_id: string;
  effective_month_key: string;
  name: string;
  description: string;
  icon: IconName;
  tone: Tone;
  recorded_at: string;
}

interface TransactionRowResult {
  id: string;
  idempotency_key: string;
  request_fingerprint: string;
  kind: TransactionKind;
  title: string;
  category: string;
  direction: TransactionDirection;
  amount_minor: number;
  effective_date: string;
  effective_month_key: string;
  recorded_at: string;
  recorded_time_zone: string;
  recorded_offset_minutes: number;
  status: TransactionStatus;
  source_wallet_id: string | null;
  destination_wallet_id: string | null;
  source_container_id: string | null;
  destination_container_id: string | null;
  source_wallet_name: string | null;
  destination_wallet_name: string | null;
  source_container_name: string | null;
  destination_container_name: string | null;
  icon: IconName;
  tone: Tone;
  reversal_of_id: string | null;
  correction_of_id: string | null;
  created_at: string;
}

interface PostingRowResult {
  id: number;
  transaction_id: string;
  account_type: AccountType;
  account_id: string;
  amount_minor: number;
  recorded_at: string;
}

interface ReceiptRowResult {
  idempotency_key: string;
  operation_type: string;
  request_fingerprint: string;
  result_json: string;
  created_at: string;
}

interface LifecycleEventRowResult {
  id: number;
  container_id: string;
  event_type: string;
  effective_month_key: string;
  recorded_at: string;
  details_json: string;
}

interface ContainerSnapshotRowResult extends ContainerRowResult {
  name: string;
  description: string;
  icon: IconName;
  tone: Tone;
  limit_minor: number;
  balance_minor: number;
  spent_minor: number;
  has_month_activity: number;
}

interface MonthTotalsRowResult {
  income_minor: number;
  expense_minor: number;
  savings_minor: number;
  transaction_count: number;
}

export class FinanceRepository {
  constructor(private readonly database: SqlDatabase) {}

  async listWallets(): Promise<WalletRow[]> {
    const rows = await this.database.getAllAsync<WalletRowResult>(
      `SELECT id, name, kind, icon, tone, sort_order, created_at
       FROM wallets
       ORDER BY sort_order ASC, name ASC`,
    );
    return rows.map(mapWalletRow);
  }

  async getWallet(walletId: string): Promise<WalletRow | null> {
    const row = await this.database.getFirstAsync<WalletRowResult>(
      `SELECT id, name, kind, icon, tone, sort_order, created_at
       FROM wallets
       WHERE id = ?`,
      [walletId],
    );
    return row ? mapWalletRow(row) : null;
  }

  async insertWallet(wallet: WalletRow): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO wallets (id, name, kind, icon, tone, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        wallet.id,
        wallet.name,
        wallet.kind,
        wallet.icon,
        wallet.tone,
        wallet.sortOrder,
        wallet.createdAt,
      ],
    );
  }

  async nextContainerSortOrder(): Promise<number> {
    const row = await this.database.getFirstAsync<{ sort_order: number | null }>(
      'SELECT MAX(sort_order) AS sort_order FROM containers',
    );
    return (row?.sort_order ?? 0) + 1;
  }

  async listContainers(includeDeleted = false): Promise<ContainerRow[]> {
    const rows = await this.database.getAllAsync<ContainerRowResult>(
      `SELECT id, kind, status, sort_order, created_month_key, created_at,
              archived_at, deleted_at
       FROM containers
       ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'}
       ORDER BY sort_order ASC, created_at ASC`,
    );
    return rows.map(mapContainerRow);
  }

  async getContainer(
    containerId: string,
    includeDeleted = false,
  ): Promise<ContainerRow | null> {
    const row = await this.database.getFirstAsync<ContainerRowResult>(
      `SELECT id, kind, status, sort_order, created_month_key, created_at,
              archived_at, deleted_at
       FROM containers
       WHERE id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`,
      [containerId],
    );
    return row ? mapContainerRow(row) : null;
  }

  async insertContainer(container: ContainerRow): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO containers (
         id, kind, status, sort_order, created_month_key, created_at,
         archived_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        container.id,
        container.kind,
        container.status,
        container.sortOrder,
        container.createdMonthKey,
        container.createdAt,
        container.archivedAt,
        container.deletedAt,
      ],
    );
  }

  async setContainerArchived(
    containerId: string,
    archivedAt: string | null,
  ): Promise<void> {
    await this.database.runAsync(
      `UPDATE containers
       SET status = ?, archived_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [archivedAt ? 'archived' : 'active', archivedAt, containerId],
    );
  }

  async setContainerDeleted(containerId: string, deletedAt: string): Promise<void> {
    await this.database.runAsync(
      'UPDATE containers SET deleted_at = ? WHERE id = ?',
      [deletedAt, containerId],
    );
  }

  async getMetadataAsOf(
    containerId: string,
    monthKey: string,
  ): Promise<MetadataRow | null> {
    const row = await this.database.getFirstAsync<MetadataRowResult>(
      `SELECT id, container_id, effective_month_key, name, description,
              icon, tone, recorded_at
       FROM container_metadata_history
       WHERE container_id = ? AND effective_month_key <= ?
       ORDER BY effective_month_key DESC
       LIMIT 1`,
      [containerId, monthKey],
    );
    return row ? mapMetadataRow(row) : null;
  }

  async listMetadataHistory(containerId: string): Promise<MetadataRow[]> {
    const rows = await this.database.getAllAsync<MetadataRowResult>(
      `SELECT id, container_id, effective_month_key, name, description,
              icon, tone, recorded_at
       FROM container_metadata_history
       WHERE container_id = ?
       ORDER BY effective_month_key ASC`,
      [containerId],
    );
    return rows.map(mapMetadataRow);
  }

  async insertMetadata(metadata: MetadataRow): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO container_metadata_history (
         container_id, effective_month_key, name, description, icon, tone,
         recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        metadata.containerId,
        metadata.effectiveMonthKey,
        metadata.label.name,
        metadata.label.description,
        metadata.label.icon,
        metadata.label.tone,
        metadata.recordedAt,
      ],
    );
  }

  async upsertMetadata(metadata: MetadataRow): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO container_metadata_history (
         container_id, effective_month_key, name, description, icon, tone,
         recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (container_id, effective_month_key) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         icon = excluded.icon,
         tone = excluded.tone,
         recorded_at = excluded.recorded_at`,
      [
        metadata.containerId,
        metadata.effectiveMonthKey,
        metadata.label.name,
        metadata.label.description,
        metadata.label.icon,
        metadata.label.tone,
        metadata.recordedAt,
      ],
    );
  }

  async getBudgetLimit(
    containerId: string,
    monthKey: string,
  ): Promise<number> {
    const row = await this.database.getFirstAsync<{ limit_minor: number }>(
      'SELECT limit_minor FROM budget_limits WHERE container_id = ? AND month_key = ?',
      [containerId, monthKey],
    );
    return row?.limit_minor ?? 0;
  }

  async upsertBudgetLimit(
    containerId: string,
    monthKey: string,
    limitMinor: number,
    updatedAt: string,
  ): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO budget_limits (container_id, month_key, limit_minor, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (container_id, month_key) DO UPDATE SET
         limit_minor = excluded.limit_minor,
         updated_at = excluded.updated_at`,
      [containerId, monthKey, limitMinor, updatedAt],
    );
  }

  async insertLifecycleEvent(event: LifecycleEventRow): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO container_lifecycle_events (
         container_id, event_type, effective_month_key, recorded_at, details_json
       ) VALUES (?, ?, ?, ?, ?)`,
      [
        event.containerId,
        event.eventType,
        event.effectiveMonthKey,
        event.recordedAt,
        event.detailsJson,
      ],
    );
  }

  async listLifecycleEvents(containerId: string): Promise<LifecycleEventRow[]> {
    const rows = await this.database.getAllAsync<LifecycleEventRowResult>(
      `SELECT id, container_id, event_type, effective_month_key, recorded_at,
              details_json
       FROM container_lifecycle_events
       WHERE container_id = ?
       ORDER BY id ASC`,
      [containerId],
    );
    return rows.map((row) => ({
      id: row.id,
      containerId: row.container_id,
      eventType: row.event_type,
      effectiveMonthKey: row.effective_month_key,
      recordedAt: row.recorded_at,
      detailsJson: row.details_json,
    }));
  }

  async hasContainerFinancialHistory(containerId: string): Promise<boolean> {
    const row = await this.database.getFirstAsync<{ has_history: number }>(
      `SELECT CASE
         WHEN EXISTS (
           SELECT 1 FROM transactions
           WHERE source_container_id = ? OR destination_container_id = ?
         ) THEN 1
         WHEN EXISTS (
           SELECT 1 FROM budget_limits
           WHERE container_id = ? AND limit_minor <> 0
         ) THEN 1
         ELSE 0
       END AS has_history`,
      [containerId, containerId, containerId],
    );
    return row?.has_history === 1;
  }

  async getContainerBalance(containerId: string, asOfDateKey: string): Promise<number> {
    const row = await this.database.getFirstAsync<{ balance_minor: number }>(
      `SELECT COALESCE(SUM(p.amount_minor), 0) AS balance_minor
       FROM postings p
       JOIN transactions t ON t.id = p.transaction_id
       WHERE p.container_id = ? AND t.effective_date <= ?`,
      [containerId, asOfDateKey],
    );
    return row?.balance_minor ?? 0;
  }

  async getWalletBalance(walletId: string, asOfDateKey: string): Promise<number> {
    const row = await this.database.getFirstAsync<{ balance_minor: number }>(
      `SELECT COALESCE(SUM(p.amount_minor), 0) AS balance_minor
       FROM postings p
       JOIN transactions t ON t.id = p.transaction_id
       WHERE p.wallet_id = ? AND t.effective_date <= ?`,
      [walletId, asOfDateKey],
    );
    return row?.balance_minor ?? 0;
  }

  async getWalletSnapshots(asOfDateKey: string): Promise<WalletSnapshot[]> {
    const rows = await this.database.getAllAsync<WalletRowResult>(
      `SELECT w.id, w.name, w.kind, w.icon, w.tone, w.sort_order, w.created_at,
              COALESCE((
                SELECT SUM(p.amount_minor)
                FROM postings p
                JOIN transactions t ON t.id = p.transaction_id
                WHERE p.wallet_id = w.id AND t.effective_date <= ?
              ), 0) AS balance_minor
       FROM wallets w
       ORDER BY w.sort_order ASC, w.name ASC`,
      [asOfDateKey],
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      icon: row.icon,
      tone: row.tone,
      balanceMinor: row.balance_minor ?? 0,
    }));
  }

  async getContainerSnapshots(monthKey: string): Promise<ContainerSnapshot[]> {
    const month = getCalendarMonth(monthKey);
    const rows = await this.database.getAllAsync<ContainerSnapshotRowResult>(
      `SELECT c.id, c.kind, c.status, c.sort_order, c.created_month_key,
              c.created_at, c.archived_at, c.deleted_at,
              m.name, m.description, m.icon, m.tone,
              COALESCE(bl.limit_minor, 0) AS limit_minor,
              COALESCE((
                SELECT SUM(p.amount_minor)
                FROM postings p
                JOIN transactions t ON t.id = p.transaction_id
                WHERE p.container_id = c.id AND t.effective_date <= ?
              ), 0) AS balance_minor,
              COALESCE((
                SELECT SUM(t.amount_minor)
                FROM transactions t
                WHERE t.source_container_id = c.id
                  AND t.kind = 'expense'
                  AND t.status = 'posted'
                  AND t.reversal_of_id IS NULL
                  AND t.effective_month_key = ?
              ), 0) AS spent_minor,
              CASE WHEN EXISTS (
                SELECT 1
                FROM postings p
                JOIN transactions t ON t.id = p.transaction_id
                WHERE p.container_id = c.id AND t.effective_month_key = ?
              ) THEN 1 ELSE 0 END AS has_month_activity
       FROM containers c
       JOIN container_metadata_history m ON m.id = (
         SELECT m2.id
         FROM container_metadata_history m2
         WHERE m2.container_id = c.id AND m2.effective_month_key <= ?
         ORDER BY m2.effective_month_key DESC
         LIMIT 1
       )
       LEFT JOIN budget_limits bl
         ON bl.container_id = c.id AND bl.month_key = ?
       WHERE c.deleted_at IS NULL AND c.created_month_key <= ?
       ORDER BY c.sort_order ASC, m.name ASC`,
      [month.endDateKey, monthKey, monthKey, monthKey, monthKey, monthKey],
    );

    return rows
      .filter(
        (row) =>
          row.limit_minor > 0 ||
          row.spent_minor > 0 ||
          row.balance_minor !== 0 ||
          row.has_month_activity === 1,
      )
      .map((row) => {
        const label: ContainerLabel = {
          name: row.name,
          description: row.description,
          icon: row.icon,
          tone: row.tone,
        };
        return {
          id: row.id,
          ...label,
          kind: row.kind,
          status: row.status,
          sortOrder: row.sort_order,
          createdMonthKey: row.created_month_key,
          ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
          limitsByMonth: { [monthKey]: row.limit_minor },
          labelsByMonth: { [monthKey]: label },
          balanceMinor: row.balance_minor,
          limitMinor: row.limit_minor,
          spentMinor: row.spent_minor,
          remainingMinor: row.limit_minor - row.spent_minor,
          hasActivity:
            row.spent_minor > 0 ||
            row.limit_minor > 0 ||
            row.has_month_activity === 1,
        };
      });
  }

  async getContainerMonthResults(monthKey: string): Promise<ContainerMonthResult[]> {
    const snapshots = await this.getContainerSnapshots(monthKey);
    return snapshots.map((container) => ({
      containerId: container.id,
      name: container.name,
      icon: container.icon,
      tone: container.tone,
      kind: container.kind,
      status: container.status,
      limitMinor: container.limitMinor,
      spentMinor: container.spentMinor,
      remainingMinor: container.remainingMinor,
      endingBalanceMinor: container.balanceMinor,
      hasActivity: container.hasActivity,
    }));
  }

  async getMonthSummary(
    monthKey: string,
    activeMonthKey: string,
  ): Promise<MonthSummary> {
    const totals = await this.database.getFirstAsync<MonthTotalsRowResult>(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_minor ELSE 0 END), 0)
           AS income_minor,
         COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_minor ELSE 0 END), 0)
           AS expense_minor,
         COALESCE(SUM(CASE WHEN kind = 'savings' THEN amount_minor ELSE 0 END), 0)
           AS savings_minor,
         COUNT(*) AS transaction_count
       FROM transactions
       WHERE effective_month_key = ?
         AND status = 'posted'
         AND reversal_of_id IS NULL`,
      [monthKey],
    );
    const containers = await this.getContainerSnapshots(monthKey);
    const totalLimitMinor = containers.reduce(
      (total, container) => total + container.limitMinor,
      0,
    );
    const totalSpentMinor = containers.reduce(
      (total, container) => total + container.spentMinor,
      0,
    );
    const savingsEndingBalanceMinor = containers
      .filter((container) => container.kind === 'savings')
      .reduce((total, container) => total + container.balanceMinor, 0);
    const incomeMinor = totals?.income_minor ?? 0;
    const expenseMinor = totals?.expense_minor ?? 0;
    const postedTransactionCount = totals?.transaction_count ?? 0;

    return {
      monthKey,
      isCurrent: monthKey === activeMonthKey,
      incomeMinor,
      expenseMinor,
      netSavingsMinor: incomeMinor - expenseMinor,
      totalLimitMinor,
      totalSpentMinor,
      totalRemainingMinor: totalLimitMinor - totalSpentMinor,
      savingsContributionsMinor: totals?.savings_minor ?? 0,
      savingsEndingBalanceMinor,
      postedTransactionCount,
      hasActivity: postedTransactionCount > 0 || totalLimitMinor > 0,
    };
  }

  async getTransaction(transactionId: string): Promise<TransactionRow | null> {
    const row = await this.database.getFirstAsync<TransactionRowResult>(
      `${TRANSACTION_SELECT} WHERE id = ?`,
      [transactionId],
    );
    return row ? mapTransactionRow(row) : null;
  }

  async getPostingsForTransaction(transactionId: string): Promise<PostingRow[]> {
    const rows = await this.database.getAllAsync<PostingRowResult>(
      `SELECT id, transaction_id, account_type, account_id, amount_minor,
              recorded_at
       FROM postings
       WHERE transaction_id = ?
       ORDER BY id ASC`,
      [transactionId],
    );
    return rows.map(mapPostingRow);
  }

  async insertTransaction(transaction: NewTransactionRow): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO transactions (
         id, idempotency_key, request_fingerprint, kind, title, category,
         direction, amount_minor, effective_date, effective_month_key,
         recorded_at, recorded_time_zone, recorded_offset_minutes, status,
         source_wallet_id, destination_wallet_id, source_container_id,
         destination_container_id, source_wallet_name, destination_wallet_name,
         source_container_name, destination_container_name, icon, tone,
         reversal_of_id, correction_of_id, created_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?
       )`,
      [
        transaction.id,
        transaction.idempotencyKey,
        transaction.requestFingerprint,
        transaction.kind,
        transaction.title,
        transaction.category,
        transaction.direction,
        transaction.amountMinor,
        transaction.effectiveDate,
        transaction.effectiveMonthKey,
        transaction.recordedAt,
        transaction.recordedTimeZone,
        transaction.recordedOffsetMinutes,
        transaction.status,
        transaction.sourceWalletId,
        transaction.destinationWalletId,
        transaction.sourceContainerId,
        transaction.destinationContainerId,
        transaction.sourceWalletName,
        transaction.destinationWalletName,
        transaction.sourceContainerName,
        transaction.destinationContainerName,
        transaction.icon,
        transaction.tone,
        transaction.reversalOfId,
        transaction.correctionOfId,
        transaction.createdAt,
      ],
    );
  }

  async insertPostings(postings: readonly NewPostingRow[]): Promise<void> {
    for (const posting of postings) {
      await this.database.runAsync(
        `INSERT INTO postings (
           transaction_id, account_type, account_id, wallet_id, container_id,
           amount_minor, recorded_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          posting.transactionId,
          posting.accountType,
          posting.accountId,
          posting.accountType === 'wallet' ? posting.accountId : null,
          posting.accountType === 'container' ? posting.accountId : null,
          posting.amountMinor,
          posting.recordedAt,
        ],
      );
    }
  }

  async markTransactionReversed(transactionId: string): Promise<void> {
    await this.database.runAsync(
      `UPDATE transactions SET status = 'reversed'
       WHERE id = ? AND status = 'posted'`,
      [transactionId],
    );
  }

  async getTransactionsForMonth(monthKey: string): Promise<Transaction[]> {
    const rows = await this.database.getAllAsync<TransactionRowResult>(
      `${TRANSACTION_SELECT}
       WHERE effective_month_key = ?
       ORDER BY effective_date DESC, recorded_at DESC, id DESC`,
      [monthKey],
    );
    return rows.map(mapTransaction);
  }

  async getRecentTransactions(limit = 20): Promise<Transaction[]> {
    const safeLimit = Math.max(0, Math.min(Math.trunc(limit), 200));
    const rows = await this.database.getAllAsync<TransactionRowResult>(
      `${TRANSACTION_SELECT}
       ORDER BY recorded_at DESC, effective_date DESC, id DESC
       LIMIT ?`,
      [safeLimit],
    );
    return rows.map(mapTransaction);
  }

  async getTotalWalletBalance(asOfDateKey: string): Promise<number> {
    const row = await this.database.getFirstAsync<{ total: number }>(
      `SELECT COALESCE(SUM(p.amount_minor), 0) AS total
       FROM postings p
       JOIN transactions t ON t.id = p.transaction_id
       WHERE p.account_type = 'wallet' AND t.effective_date <= ?`,
      [asOfDateKey],
    );
    return row?.total ?? 0;
  }

  async getTotalContainerBalance(asOfDateKey: string): Promise<number> {
    const row = await this.database.getFirstAsync<{ total: number }>(
      `SELECT COALESCE(SUM(p.amount_minor), 0) AS total
       FROM postings p
       JOIN transactions t ON t.id = p.transaction_id
       WHERE p.account_type = 'container' AND t.effective_date <= ?`,
      [asOfDateKey],
    );
    return row?.total ?? 0;
  }

  async getReceipt(idempotencyKey: string): Promise<ReceiptRow | null> {
    const row = await this.database.getFirstAsync<ReceiptRowResult>(
      `SELECT idempotency_key, operation_type, request_fingerprint, result_json,
              created_at
       FROM operation_receipts
       WHERE idempotency_key = ?`,
      [idempotencyKey],
    );
    return row
      ? {
          idempotencyKey: row.idempotency_key,
          operationType: row.operation_type,
          requestFingerprint: row.request_fingerprint,
          resultJson: row.result_json,
          createdAt: row.created_at,
        }
      : null;
  }

  async insertReceipt(receipt: ReceiptRow): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO operation_receipts (
         idempotency_key, operation_type, request_fingerprint, result_json,
         created_at
       ) VALUES (?, ?, ?, ?, ?)`,
      [
        receipt.idempotencyKey,
        receipt.operationType,
        receipt.requestFingerprint,
        receipt.resultJson,
        receipt.createdAt,
      ],
    );
  }

  async allWalletContainerTotalsMatch(asOfDateKey: string): Promise<boolean> {
    const walletTotal = await this.getTotalWalletBalance(asOfDateKey);
    const containerTotal = await this.getTotalContainerBalance(asOfDateKey);
    return walletTotal === containerTotal;
  }

  async maxEffectiveDate(): Promise<string | null> {
    const row = await this.database.getFirstAsync<{ effective_date: string | null }>(
      'SELECT MAX(effective_date) AS effective_date FROM transactions',
    );
    return row?.effective_date ?? null;
  }
}

const TRANSACTION_SELECT = `
  SELECT id, idempotency_key, request_fingerprint, kind, title, category,
         direction, amount_minor, effective_date, effective_month_key,
         recorded_at, recorded_time_zone, recorded_offset_minutes, status,
         source_wallet_id, destination_wallet_id, source_container_id,
         destination_container_id, source_wallet_name, destination_wallet_name,
         source_container_name, destination_container_name, icon, tone,
         reversal_of_id, correction_of_id, created_at
  FROM transactions`;

function mapWalletRow(row: WalletRowResult): WalletRow {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    icon: row.icon,
    tone: row.tone,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

function mapContainerRow(row: ContainerRowResult): ContainerRow {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    sortOrder: row.sort_order,
    createdMonthKey: row.created_month_key,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
  };
}

function mapMetadataRow(row: MetadataRowResult): MetadataRow {
  return {
    id: row.id,
    containerId: row.container_id,
    effectiveMonthKey: row.effective_month_key,
    label: {
      name: row.name,
      description: row.description,
      icon: row.icon,
      tone: row.tone,
    },
    recordedAt: row.recorded_at,
  };
}

function mapTransactionRow(row: TransactionRowResult): TransactionRow {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    kind: row.kind,
    title: row.title,
    category: row.category,
    direction: row.direction,
    amountMinor: row.amount_minor,
    effectiveDate: row.effective_date,
    effectiveMonthKey: row.effective_month_key,
    recordedAt: row.recorded_at,
    recordedTimeZone: row.recorded_time_zone,
    recordedOffsetMinutes: row.recorded_offset_minutes,
    status: row.status,
    sourceWalletId: row.source_wallet_id,
    destinationWalletId: row.destination_wallet_id,
    sourceContainerId: row.source_container_id,
    destinationContainerId: row.destination_container_id,
    sourceWalletName: row.source_wallet_name,
    destinationWalletName: row.destination_wallet_name,
    sourceContainerName: row.source_container_name,
    destinationContainerName: row.destination_container_name,
    icon: row.icon,
    tone: row.tone,
    reversalOfId: row.reversal_of_id,
    correctionOfId: row.correction_of_id,
    createdAt: row.created_at,
  };
}

function mapPostingRow(row: PostingRowResult): PostingRow {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    accountType: row.account_type,
    accountId: row.account_id,
    amountMinor: row.amount_minor,
    recordedAt: row.recorded_at,
  };
}

function mapTransaction(row: TransactionRowResult): Transaction {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    kind: row.kind,
    direction: row.direction,
    amountMinor: row.amount_minor,
    effectiveDate: row.effective_date,
    recordedAt: row.recorded_at,
    recordedTimeZone: row.recorded_time_zone,
    recordedOffsetMinutes: row.recorded_offset_minutes,
    status: row.status,
    ...(row.source_wallet_id
      ? { sourceWalletId: row.source_wallet_id }
      : {}),
    ...(row.destination_wallet_id
      ? { destinationWalletId: row.destination_wallet_id }
      : {}),
    ...(row.source_container_id
      ? { sourceContainerId: row.source_container_id }
      : {}),
    ...(row.destination_container_id
      ? { destinationContainerId: row.destination_container_id }
      : {}),
    ...(row.source_wallet_name
      ? { sourceWalletName: row.source_wallet_name }
      : {}),
    ...(row.destination_wallet_name
      ? { destinationWalletName: row.destination_wallet_name }
      : {}),
    ...(row.source_container_name
      ? { sourceContainerName: row.source_container_name }
      : {}),
    ...(row.destination_container_name
      ? { destinationContainerName: row.destination_container_name }
      : {}),
    icon: row.icon,
    tone: row.tone,
    ...(row.reversal_of_id ? { reversalOfId: row.reversal_of_id } : {}),
  };
}

export function toSqlValues(values: readonly unknown[]): SqlValue[] {
  return values.map((value) => {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      value instanceof Uint8Array
    ) {
      return value;
    }
    throw new TypeError(`Unsupported SQLite parameter: ${typeof value}`);
  });
}
