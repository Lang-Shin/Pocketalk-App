import type { AssistantProposal } from '@/ai/localAssistant';
import type { MoneyEntryExecutionResult } from '@/data/financeService';

export type ProposalExecution =
  | { status: 'executing' }
  | { status: 'success'; transactionId: string }
  | { status: 'error'; message: string };

export interface PendingConfirmation {
  messageId: string;
  proposal: AssistantProposal;
}

export interface ConfirmationCandidate {
  id: string;
  proposal?: AssistantProposal;
  execution?: ProposalExecution;
}

export function createPendingConfirmation(
  message: ConfirmationCandidate,
): PendingConfirmation | null {
  if (
    !message.proposal ||
    message.execution?.status === 'executing' ||
    message.execution?.status === 'success'
  ) {
    return null;
  }
  return {
    messageId: message.id,
    proposal: message.proposal,
  };
}

export function claimExecution(
  activeExecutions: Set<string>,
  proposalId: string,
): boolean {
  if (activeExecutions.has(proposalId)) return false;
  activeExecutions.add(proposalId);
  return true;
}

export function releaseExecution(
  activeExecutions: Set<string>,
  proposalId: string,
): void {
  activeExecutions.delete(proposalId);
}

export function executionFromResult(
  result: MoneyEntryExecutionResult,
): ProposalExecution {
  if (result.ok) {
    return { status: 'success', transactionId: result.transactionId };
  }
  return { status: 'error', message: result.message };
}

export function executionFromError(error: unknown): ProposalExecution {
  return {
    status: 'error',
    message:
      error instanceof Error
        ? error.message
        : 'The transaction could not be saved. Nothing was changed.',
  };
}
