import type {
  AssistantContext,
  AssistantPendingIntent,
  AssistantResult,
} from '../localAssistant';
import { validateAssistantResult } from '../validation';
import type {
  AssistantProvider,
  AssistantProviderInfo,
} from './assistantProvider';

export class ValidatedAssistantProvider implements AssistantProvider {
  constructor(private readonly provider: AssistantProvider) {}

  get info(): AssistantProviderInfo {
    return this.provider.info;
  }

  load(): Promise<void> {
    return this.provider.load();
  }

  unload(): Promise<void> {
    return this.provider.unload();
  }

  async interpret(
    text: string,
    context: AssistantContext,
  ): Promise<AssistantResult> {
    return validateAssistantResult(
      await this.provider.interpret(text, context),
      context,
    );
  }

  async resolveContainerChoice(
    containerId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): Promise<AssistantResult> {
    return validateAssistantResult(
      await this.provider.resolveContainerChoice(
        containerId,
        pending,
        context,
      ),
      context,
    );
  }

  async resolveWalletChoice(
    walletId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): Promise<AssistantResult> {
    return validateAssistantResult(
      await this.provider.resolveWalletChoice(
        walletId,
        pending,
        context,
      ),
      context,
    );
  }
}
