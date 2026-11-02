import type {
  AssistantContext,
  AssistantContainerOption,
  AssistantProposal,
} from '@/ai/localAssistant';
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

export class AssistantProposalEligibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantProposalEligibilityError';
  }
}

export interface AssistantFinanceExecutor {
  executeMoneyEntry(
    input: MoneyEntryInput,
  ): Promise<MoneyEntryExecutionResult>;
}

export interface AssistantExecutionRequest {
  proposal: AssistantProposal;
  context: AssistantContext;
  confirmed: boolean;
}

export interface AssistantExecutionCoordinator {
  execute(
    request: AssistantExecutionRequest,
  ): Promise<MoneyEntryExecutionResult>;
}

export function createAssistantExecutionCoordinator(
  executor: AssistantFinanceExecutor,
): AssistantExecutionCoordinator {
  return new Coordinator(executor);
}

class Coordinator implements AssistantExecutionCoordinator {
  private readonly inFlight = new Map<
    string,
    Promise<MoneyEntryExecutionResult>
  >();

  constructor(private readonly executor: AssistantFinanceExecutor) {}

  execute(
    request: AssistantExecutionRequest,
  ): Promise<MoneyEntryExecutionResult> {
    if (request.confirmed !== true) {
      return Promise.resolve({
        ok: false,
        message: 'Explicit confirmation is required before execution.',
      });
    }

    const existing = this.inFlight.get(request.proposal.id);
    if (existing) return existing;

    const operation = this.executeConfirmed(request).finally(() => {
      this.inFlight.delete(request.proposal.id);
    });
    this.inFlight.set(request.proposal.id, operation);
    return operation;
  }

  private async executeConfirmed(
    request: AssistantExecutionRequest,
  ): Promise<MoneyEntryExecutionResult> {
    let input: MoneyEntryInput;
    try {
      input = assistantProposalToMoneyEntry(request.proposal);
      validateAssistantExecutionEligibility(
        request.proposal.action,
        input,
        request.context,
      );
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : 'The assistant proposal could not be executed safely.',
      };
    }

    try {
      return await this.executor.executeMoneyEntry(input);
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
}

const sharedCoordinators = new WeakMap<
  AssistantFinanceExecutor,
  AssistantExecutionCoordinator
>();

export function executeConfirmedAssistantProposal(
  request: AssistantExecutionRequest,
  executor: AssistantFinanceExecutor,
): Promise<MoneyEntryExecutionResult> {
  let coordinator = sharedCoordinators.get(executor);
  if (!coordinator) {
    coordinator = createAssistantExecutionCoordinator(executor);
    sharedCoordinators.set(executor, coordinator);
  }
  return coordinator.execute(request);
}

export function validateAssistantExecutionEligibility(
  action: AssistantProposal['action'],
  input: MoneyEntryInput,
  context: AssistantContext,
): void {
  if (input.effectiveDate > context.todayDateKey) {
    throw new AssistantProposalEligibilityError(
      'Future-dated assistant entries cannot be executed.',
    );
  }
  if (monthKeyForDateKey(input.effectiveDate) !== context.activeMonthKey) {
    throw new AssistantProposalEligibilityError(
      'The assistant can only execute entries for the active month.',
    );
  }

  if (action === 'expense' || action === 'income') {
    const walletId = requiredId(input.walletId, 'wallet');
    requireWallet(walletId, context);

    const container = requireActiveContainer(
      requiredId(input.containerId, 'container'),
      context,
    );
    if (action === 'expense' && container.systemKey) {
      throw new AssistantProposalEligibilityError(
        'Expenses cannot be recorded directly against a system container.',
      );
    }
    if (action === 'income' && container.systemKey === 'savings') {
      throw new AssistantProposalEligibilityError(
        'Income cannot be recorded directly into Savings.',
      );
    }
    return;
  }

  if (action === 'wallet_transfer') {
    const sourceWalletId = requiredId(input.walletId, 'source wallet');
    const destinationWalletId = requiredId(
      input.destinationWalletId,
      'destination wallet',
    );
    requireWallet(sourceWalletId, context);
    requireWallet(destinationWalletId, context);
    return;
  }

  const source = requireActiveContainer(
    requiredId(input.containerId, 'source container'),
    context,
  );
  const destination = requireActiveContainer(
    requiredId(input.destinationContainerId, 'destination container'),
    context,
  );

  if (action === 'container_transfer') {
    if (source.systemKey || destination.systemKey) {
      throw new AssistantProposalEligibilityError(
        'Use a Savings action for transfers involving a system container.',
      );
    }
    return;
  }

  if (action === 'savings_contribution') {
    if (source.systemKey === 'savings') {
      throw new AssistantProposalEligibilityError(
        'Savings cannot be the source of a Savings contribution.',
      );
    }
    if (destination.systemKey !== 'savings') {
      throw new AssistantProposalEligibilityError(
        'A Savings contribution must go into the Savings container.',
      );
    }
    return;
  }

  if (action === 'savings_withdrawal') {
    if (source.systemKey !== 'savings') {
      throw new AssistantProposalEligibilityError(
        'A Savings withdrawal must come from the Savings container.',
      );
    }
    if (destination.systemKey === 'savings') {
      throw new AssistantProposalEligibilityError(
        'Savings cannot be the destination of a Savings withdrawal.',
      );
    }
    return;
  }

  throw new AssistantProposalEligibilityError(
    'The assistant action is not eligible for execution.',
  );
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
  if (monthKeyForDateKey(proposal.effectiveDate) !== proposal.monthKey) {
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
      const containerId = requireId(proposal.containerId, 'source container');
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

function requireWallet(
  walletId: string,
  context: AssistantContext,
): void {
  if (!context.wallets.some((wallet) => wallet.id === walletId)) {
    throw new AssistantProposalEligibilityError(
      'The selected wallet is no longer available.',
    );
  }
}

function requireActiveContainer(
  containerId: string,
  context: AssistantContext,
): AssistantContainerOption {
  const container = context.containers.find(
    (candidate) => candidate.id === containerId,
  );
  if (!container) {
    throw new AssistantProposalEligibilityError(
      'The selected container is no longer available.',
    );
  }
  if (container.status !== 'active') {
    throw new AssistantProposalEligibilityError(
      'Archived containers cannot receive new activity.',
    );
  }
  return container;
}

function requiredId(value: string | undefined, label: string): string {
  if (!value || !value.trim()) {
    throw new AssistantProposalEligibilityError(
      `The proposal is missing its ${label}.`,
    );
  }
  return value;
}

function requireId(value: string | undefined, label: string): string {
  if (!value || !value.trim()) {
    throw new AssistantProposalMappingError(
      `The proposal is missing its ${label}.`,
    );
  }
  return value;
}
