import type { AssistantContext, AssistantResult } from '../localAssistant';
import type {
  LocalModelResponse,
  LocalModelResponseParser,
} from '../runtime';
import {
  AssistantValidationError,
  validateAssistantResult,
} from '../validation';

let proposalSequence = 0;

export class PocketaLocalResponseParser implements LocalModelResponseParser {
  parse(response: LocalModelResponse, context: AssistantContext): AssistantResult {
    const parsed = parseJsonObject(response.text);
    const candidate = withGeneratedProposalId(parsed);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
