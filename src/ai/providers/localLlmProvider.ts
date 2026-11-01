import type {
  AssistantContext,
  AssistantPendingIntent,
  AssistantResult,
} from '../localAssistant';
import type {
  LocalModelPromptBuilder,
  LocalModelResponseParser,
  LocalModelRuntime,
} from '../runtime';
import type {
  AssistantProvider,
  AssistantProviderInfo,
} from './assistantProvider';

export interface LocalLlmProviderOptions {
  info: AssistantProviderInfo;
  promptBuilder: LocalModelPromptBuilder;
  responseParser: LocalModelResponseParser;
}

export class LocalLlmProvider implements AssistantProvider {
  constructor(
    private readonly runtime: LocalModelRuntime,
    private readonly options: LocalLlmProviderOptions,
  ) {}

  get info(): AssistantProviderInfo {
    return this.options.info;
  }

  load(): Promise<void> {
    return this.runtime.load();
  }

  unload(): Promise<void> {
    return this.runtime.unload();
  }

  async interpret(
    text: string,
    context: AssistantContext,
  ): Promise<AssistantResult> {
    await this.ensureReady();
    const response = await this.runtime.generate({
      prompt: this.options.promptBuilder.interpretationPrompt(text, context),
    });
    return this.options.responseParser.parse(response, context);
  }

  async resolveContainerChoice(
    containerId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): Promise<AssistantResult> {
    await this.ensureReady();
    const response = await this.runtime.generate({
      prompt: this.options.promptBuilder.containerChoicePrompt(
        containerId,
        pending,
        context,
      ),
    });
    return this.options.responseParser.parse(response, context);
  }

  async resolveWalletChoice(
    walletId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): Promise<AssistantResult> {
    await this.ensureReady();
    const response = await this.runtime.generate({
      prompt: this.options.promptBuilder.walletChoicePrompt(
        walletId,
        pending,
        context,
      ),
    });
    return this.options.responseParser.parse(response, context);
  }

  private async ensureReady(): Promise<void> {
    const status = this.runtime.status();
    if (status === 'unloaded' || status === 'error') {
      await this.runtime.load();
    }
    const nextStatus = this.runtime.status();
    if (nextStatus !== 'ready') {
      throw new Error(`Local model runtime is ${nextStatus}.`);
    }
  }
}
