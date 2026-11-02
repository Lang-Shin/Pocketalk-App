import type { AssistantProposal } from '@/ai/localAssistant';
import type {
  MoneyEntryExecutionResult,
  MoneyEntryInput,
} from '@/data/financeService';
import { isValidDateKey, monthKeyForDateKey } from '@/lib/period';

export class AssistantProposalMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantProposalMappingError';
  }
}

export interface AssistantFinanceExecutor {
  executeMoneyEntry(
    input: MoneyEntryInput,
  ): Promise<MoneyEntryExecutionResult>;
}

export interface AssistantExecutionRequest {
  proposal: AssistantProposal;
  confirmed: boolean;
}

export async function executeConfirmedAssistantProposal(
  request: AssistantExecutionRequest,
  executor: AssistantFinanceExecutor,
): Promise<MoneyEntryExecutionResult> {
  if (request.confirmed !== true) {
    return {
      ok: false,
      message: 'Explicit confirmation is required before execution.',
    };
  }

  let input: MoneyEntryInput;
  try {
    input = assistantProposalToMoneyEntry(request.proposal);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : 'The assistant proposal could not be mapped to a finance entry.',
    };
  }

  try {
    return await executor.executeMoneyEntry(input);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : 'The finance operation could not be completed.',
    };
  }
}

export function assistantProposalToMoneyEntry(
  proposal: AssistantProposal,
): MoneyEntryInput {
  if (
    !Number.isSafeInteger(proposal.amountMinor) ||
    proposal.amountMinor <= 0
  ) {
    throw new AssistantProposalMappingError(
      'The proposal amount must be a positive integer in centavos.',
    );
  }
  if (!isValidDateKey(proposal.effectiveDate)) {
    throw new AssistantProposalMappingError(
      'The proposal has an invalid effective date.',
    );
  }
  if (
    monthKeyForDateKey(proposal.effectiveDate) !== proposal.monthKey
  ) {
    throw new AssistantProposalMappingError(
      'The proposal date does not match its monthly period.',
    );
  }
  if (!proposal.title.trim()) {
    throw new AssistantProposalMappingError(
      'The proposal description is required.',
    );
  }
  if (!proposal.id.trim()) {
    throw new AssistantProposalMappingError(
      'The proposal identifier is required.',
    );
  }

  const base = {
    amountMinor: proposal.amountMinor,
    title: proposal.title,
    effectiveDate: proposal.effectiveDate,
    idempotencyKey: `assistant:${proposal.id}`,
  };

  switch (proposal.action) {
    case 'expense':
      return {
        ...base,
        mode: 'expense',
        walletId: requireId(proposal.walletId, 'source wallet'),
        containerId: requireId(proposal.containerId, 'expense container'),
      };
    case 'income':
      return {
        ...base,
        mode: 'income',
        walletId: requireId(proposal.walletId, 'destination wallet'),
        containerId: requireId(
          proposal.destinationContainerId,
          'income container',
        ),
      };
    case 'wallet_transfer': {
      const walletId = requireId(proposal.sourceWalletId, 'source wallet');
      const destinationWalletId = requireId(
        proposal.destinationWalletId,
        'destination wallet',
      );
      if (walletId === destinationWalletId) {
        throw new AssistantProposalMappingError(
          'Choose two different wallets for a transfer.',
        );
      }
      return {
        ...base,
        mode: 'wallet_transfer',
        walletId,
        destinationWalletId,
      };
    }
    case 'container_transfer':
    case 'savings_contribution':
    case 'savings_withdrawal': {
      const containerId = requireId(
        proposal.containerId,
        'source container',
      );
      const destinationContainerId = requireId(
        proposal.destinationContainerId,
        'destination container',
      );
      if (containerId === destinationContainerId) {
        throw new AssistantProposalMappingError(
          'Choose two different containers for a transfer.',
        );
      }
      return {
        ...base,
        mode: 'container_transfer',
        containerId,
        destinationContainerId,
      };
    }
    default:
      throw new AssistantProposalMappingError(
        'The assistant action is not supported by execution.',
      );
  }
}

function requireId(value: string | undefined, label: string): string {
  if (!value || !value.trim()) {
    throw new AssistantProposalMappingError(
      `The proposal is missing its ${label}.`,
    );
  }
  return value;
}
