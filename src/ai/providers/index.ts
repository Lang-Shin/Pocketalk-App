import { MockAssistantProvider } from './mockAssistantProvider';
import type { AssistantProvider } from './assistantProvider';
import { ValidatedAssistantProvider } from './validatedAssistantProvider';

export function createAssistantProvider(
  provider: AssistantProvider = new MockAssistantProvider(),
): AssistantProvider {
  return new ValidatedAssistantProvider(provider);
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
export { ValidatedAssistantProvider } from './validatedAssistantProvider';
