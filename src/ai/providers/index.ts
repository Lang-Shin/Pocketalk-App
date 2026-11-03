import type {
  LocalModelPromptBuilder,
  LocalModelResponseParser,
  LocalModelRuntime,
} from '../runtime';
import { MockAssistantProvider } from './mockAssistantProvider';
import type {
  AssistantProvider,
  AssistantProviderInfo,
} from './assistantProvider';
import { LocalLlmProvider } from './localLlmProvider';
import { PocketaLocalPromptBuilder } from './localPromptBuilder';
import { PocketaLocalResponseParser } from './localResponseParser';
import type { LocalPromptTokenEstimator } from './promptBudget';
import { ValidatedAssistantProvider } from './validatedAssistantProvider';

export function createAssistantProvider(
  provider: AssistantProvider = new MockAssistantProvider(),
): AssistantProvider {
  return new ValidatedAssistantProvider(provider);
}

export interface LocalAssistantProviderOptions {
  info: AssistantProviderInfo;
  promptBuilder?: LocalModelPromptBuilder;
  responseParser?: LocalModelResponseParser;
  promptTokenEstimator?: LocalPromptTokenEstimator;
  maxContextTokens?: number;
  outputTokenAllowance?: number;
  promptSafetyMarginTokens?: number;
}

export function createLocalAssistantProvider(
  runtime: LocalModelRuntime,
  options: LocalAssistantProviderOptions,
): AssistantProvider {
  return createAssistantProvider(
    new LocalLlmProvider(runtime, {
      info: options.info,
      promptBuilder:
        options.promptBuilder ?? new PocketaLocalPromptBuilder(),
      responseParser:
        options.responseParser ?? new PocketaLocalResponseParser(),
      promptTokenEstimator: options.promptTokenEstimator,
      maxContextTokens: options.maxContextTokens,
      outputTokenAllowance: options.outputTokenAllowance,
      promptSafetyMarginTokens: options.promptSafetyMarginTokens,
    }),
  );
}

export const assistantProvider: AssistantProvider = createAssistantProvider();

export type {
  AssistantProvider,
  AssistantProviderInfo,
  AssistantProviderKind,
} from './assistantProvider';
export { MockAssistantProvider } from './mockAssistantProvider';
export { LocalLlmProvider } from './localLlmProvider';
export type { LocalLlmProviderOptions } from './localLlmProvider';
export {
  LOCAL_PROMPT_VERSION,
  PocketaLocalPromptBuilder,
} from './localPromptBuilder';
export { PocketaLocalResponseParser } from './localResponseParser';
export {
  ApproximateCharacterPromptTokenEstimator,
  DEFAULT_MAX_CONTEXT_TOKENS,
  DEFAULT_OUTPUT_TOKEN_ALLOWANCE,
  DEFAULT_PROMPT_SAFETY_MARGIN_TOKENS,
  PromptBudgetExceededError,
} from './promptBudget';
export type { LocalPromptTokenEstimator } from './promptBudget';
export { ValidatedAssistantProvider } from './validatedAssistantProvider';
