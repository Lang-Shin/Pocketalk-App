import { MockAssistantProvider } from './mockAssistantProvider';
import type { AssistantProvider } from './assistantProvider';

export function createAssistantProvider(): AssistantProvider {
  return new MockAssistantProvider();
}

export const assistantProvider: AssistantProvider = createAssistantProvider();

export type {
  AssistantProvider,
  AssistantProviderInfo,
  AssistantProviderKind,
} from './assistantProvider';
export { MockAssistantProvider } from './mockAssistantProvider';
