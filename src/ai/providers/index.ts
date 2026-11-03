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
export { ValidatedAssistantProvider } from './validatedAssistantProvider';
