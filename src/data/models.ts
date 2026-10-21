import type { IconName } from '@/lib/icons';
import type { Tone } from '@/theme';

export type WalletKind = 'cash' | 'virtual_gcash';
export type ContainerKind = 'budget' | 'savings';
export type ContainerStatus = 'active' | 'archived';
export type SystemContainerKey = 'unallocated';

export interface Wallet {
  id: string;
  name: string;
  kind: WalletKind;
  icon: IconName;
  tone: Tone;
}

export interface ContainerLabel {
  name: string;
  description: string;
  icon: IconName;
  tone: Tone;
}

export interface BudgetContainer {
  id: string;
  name: string;
  description: string;
  icon: IconName;
  tone: Tone;
  kind: ContainerKind;
  status: ContainerStatus;
  sortOrder: number;
  createdMonthKey: string;
  archivedAt?: string;
  systemKey?: SystemContainerKey | null;
  limitsByMonth: Record<string, number>;
  labelsByMonth: Record<string, ContainerLabel>;
}

export interface SavingsGoal {
  id: string;
  name: string;
  containerId: string;
  targetMinor: number;
  icon: IconName;
  tone: Tone;
}

export type TransactionKind =
  | 'expense'
  | 'income'
  | 'wallet_transfer'
  | 'container_transfer'
  | 'savings';

export type TransactionDirection = 'in' | 'out' | 'neutral';
export type TransactionStatus = 'posted' | 'pending' | 'reversed';

export interface Transaction {
  id: string;
  title: string;
  category: string;
  kind: TransactionKind;
  direction: TransactionDirection;
  amountMinor: number;
  effectiveDate: string;
  recordedAt: string;
  recordedTimeZone: string;
  recordedOffsetMinutes: number;
  status: TransactionStatus;
  sourceWalletId?: string;
  destinationWalletId?: string;
  sourceContainerId?: string;
  destinationContainerId?: string;
  sourceWalletName?: string;
  destinationWalletName?: string;
  sourceContainerName?: string;
  destinationContainerName?: string;
  icon: IconName;
  tone: Tone;
  reversalOfId?: string;
}

export interface FinanceState {
  wallets: Wallet[];
  containers: BudgetContainer[];
  transactions: Transaction[];
}

export interface WalletSnapshot extends Wallet {
  balanceMinor: number;
}

export interface ContainerSnapshot extends BudgetContainer {
  balanceMinor: number;
  limitMinor: number;
  spentMinor: number;
  remainingMinor: number;
  hasActivity: boolean;
}

export interface ContainerMonthResult {
  containerId: string;
  name: string;
  icon: IconName;
  tone: Tone;
  kind: ContainerKind;
  status: ContainerStatus;
  systemKey?: SystemContainerKey | null;
  limitMinor: number;
  spentMinor: number;
  remainingMinor: number;
  endingBalanceMinor: number;
  hasActivity: boolean;
}

export interface MonthSummary {
  monthKey: string;
  isCurrent: boolean;
  incomeMinor: number;
  expenseMinor: number;
  netSavingsMinor: number;
  totalLimitMinor: number;
  totalSpentMinor: number;
  totalRemainingMinor: number;
  savingsContributionsMinor: number;
  savingsEndingBalanceMinor: number;
  postedTransactionCount: number;
  hasActivity: boolean;
}

export interface ProposedTransactionDraft {
  action: 'expense' | 'income' | 'transfer';
  title: string;
  amountMinor: number;
  sourceLabel?: string;
  destinationLabel?: string;
  dateLabel: string;
  note: string;
}

export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  createdAt: string;
  draft?: ProposedTransactionDraft;
}

export interface ProfileData {
  name: string;
  firstName: string;
  initials: string;
  subtitle: string;
  goalLabel: string;
  joinedLabel: string;
}
