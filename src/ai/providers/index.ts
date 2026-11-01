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
export { ValidatedAssistantProvider } from './validatedAssistantProvider';
