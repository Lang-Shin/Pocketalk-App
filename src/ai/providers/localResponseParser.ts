import type { AssistantContext, AssistantResult } from '../localAssistant';
import type {
  LocalModelResponse,
  LocalModelResponseParser,
} from '../runtime';
import { isValidDateKey, monthKeyForDateKey } from '@/lib/period';
import {
  AssistantValidationError,
  validateAssistantResult,
} from '../validation';

let proposalSequence = 0;

export class PocketaLocalResponseParser implements LocalModelResponseParser {
  parse(response: LocalModelResponse, context: AssistantContext): AssistantResult {
    const parsed = parseJsonObject(response.text);
    const withId = withGeneratedProposalId(parsed);
    const candidate = normalizeEntityReferences(withId, context);
    assertActiveMonth(candidate, context);
    return validateAssistantResult(candidate, context);
  }
}

function parseJsonObject(text: string): unknown {
  if (!text.trim()) {
    throw new AssistantValidationError(
      'Local model response is empty; expected one JSON object.',
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new AssistantValidationError(
      'Local model response is not valid JSON; markdown and code fences are not accepted.',
    );
  }
}

function withGeneratedProposalId(value: unknown): unknown {
  if (!isRecord(value) || value.kind !== 'proposal') return value;
  if (!isRecord(value.proposal)) return value;

  proposalSequence += 1;
  const id = `assistant-local-${Date.now().toString(36)}-${proposalSequence}`;

  return {
    ...value,
    proposal: {
      ...value.proposal,
      id,
    },
  };
}

function assertActiveMonth(
  value: unknown,
  context: AssistantContext,
): void {
  if (!isRecord(value)) return;

  const dates: unknown[] = [];
  const interpretation = isRecord(value.interpretation)
    ? value.interpretation
    : undefined;
  dates.push(interpretation?.effectiveDate);

  if (value.kind === 'proposal' && isRecord(value.proposal)) {
    dates.push(value.proposal.effectiveDate);
  }
  if (value.kind === 'clarification' && isRecord(value.clarification)) {
    const pending = isRecord(value.clarification.pending)
      ? value.clarification.pending
      : undefined;
    dates.push(pending?.effectiveDate);
  }

  for (const date of dates) {
    if (
      typeof date === 'string' &&
      isValidDateKey(date) &&
      monthKeyForDateKey(date) !== context.activeMonthKey
    ) {
      throw new AssistantValidationError(
        'Effective dates must stay within the active month.',
      );
    }
  }
}

function normalizeEntityReferences(
  value: unknown,
  context: AssistantContext,
): unknown {
  if (!isRecord(value)) return value;

  if (value.kind === 'proposal') {
    return {
      ...value,
      proposal: normalizeProposalLabels(
        value.proposal,
        value.interpretation,
        context,
      ),
      interpretation: normalizeInterpretation(value.interpretation, context),
    };
  }

  if (value.kind === 'clarification') {
    return {
      ...value,
      clarification: normalizeClarificationOptions(
        value.clarification,
        context,
      ),
      interpretation: normalizeInterpretation(value.interpretation, context),
    };
  }

  if (value.kind === 'answer' || value.kind === 'refusal') {
    return {
      ...value,
      interpretation: normalizeInterpretation(value.interpretation, context),
    };
  }

  return value;
}

function normalizeProposalLabels(
  value: unknown,
  interpretation: unknown,
  context: AssistantContext,
): unknown {
  if (!isRecord(value)) return value;

  const interpretationRecord = isRecord(interpretation)
    ? interpretation
    : undefined;

  return {
    ...value,
    walletLabel:
      resolveWalletName(value.walletId, context) ?? value.walletLabel,
    sourceWalletLabel:
      resolveWalletName(value.sourceWalletId, context) ??
      resolveWalletName(
        entityId(interpretationRecord?.sourceWallet),
        context,
      ) ??
      value.sourceWalletLabel,
    destinationWalletLabel:
      resolveWalletName(value.destinationWalletId, context) ??
      resolveWalletName(
        entityId(interpretationRecord?.destinationWallet),
        context,
      ) ??
      value.destinationWalletLabel,
    containerLabel:
      resolveContainerName(value.containerId, context) ??
      resolveContainerName(
        entityId(interpretationRecord?.sourceContainer),
        context,
      ) ??
      value.containerLabel,
    destinationContainerLabel:
      resolveContainerName(value.destinationContainerId, context) ??
      resolveContainerName(
        entityId(interpretationRecord?.destinationContainer),
        context,
      ) ??
      value.destinationContainerLabel,
  };
}

function normalizeInterpretation(
  value: unknown,
  context: AssistantContext,
): unknown {
  if (!isRecord(value)) return value;

  return {
    ...value,
    sourceWallet: normalizeEntityRef(value.sourceWallet, context),
    destinationWallet: normalizeEntityRef(value.destinationWallet, context),
    sourceContainer: normalizeEntityRef(value.sourceContainer, context),
    destinationContainer: normalizeEntityRef(
      value.destinationContainer,
      context,
    ),
  };
}

function normalizeClarificationOptions(
  value: unknown,
  context: AssistantContext,
): unknown {
  if (!isRecord(value)) return value;

  return {
    ...value,
    options: Array.isArray(value.options)
      ? value.options.map((option) =>
          normalizeOptionName(
            option,
            resolveContainerName(entityId(option), context),
          ),
        )
      : value.options,
    walletOptions: Array.isArray(value.walletOptions)
      ? value.walletOptions.map((option) =>
          normalizeOptionName(
            option,
            resolveWalletName(entityId(option), context),
          ),
        )
      : value.walletOptions,
  };
}

function normalizeEntityRef(
  value: unknown,
  context: AssistantContext,
): unknown {
  if (!isRecord(value)) return value;

  const name =
    resolveWalletName(value.id, context) ??
    resolveContainerName(value.id, context);
  if (!name) return value;

  return {
    ...value,
    name,
  };
}

function normalizeOptionName(
  value: unknown,
  name: string | undefined,
): unknown {
  if (!isRecord(value) || !name) return value;
  return {
    ...value,
    name,
  };
}

function entityId(value: unknown): unknown {
  return isRecord(value) ? value.id : undefined;
}

function resolveWalletName(
  id: unknown,
  context: AssistantContext,
): string | undefined {
  if (typeof id !== 'string') return undefined;
  return context.wallets.find((wallet) => wallet.id === id)?.name;
}

function resolveContainerName(
  id: unknown,
  context: AssistantContext,
): string | undefined {
  if (typeof id !== 'string') return undefined;
  return context.containers.find((container) => container.id === id)?.name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
