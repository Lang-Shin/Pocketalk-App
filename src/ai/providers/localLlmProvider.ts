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
import {
  ApproximateCharacterPromptTokenEstimator,
  DEFAULT_MAX_CONTEXT_TOKENS,
  DEFAULT_OUTPUT_TOKEN_ALLOWANCE,
  DEFAULT_PROMPT_SAFETY_MARGIN_TOKENS,
  PromptBudgetExceededError,
  type LocalPromptTokenEstimator,
} from './promptBudget';

export interface LocalLlmProviderOptions {
  info: AssistantProviderInfo;
  promptBuilder: LocalModelPromptBuilder;
  responseParser: LocalModelResponseParser;
  promptTokenEstimator?: LocalPromptTokenEstimator;
  maxContextTokens?: number;
  outputTokenAllowance?: number;
  promptSafetyMarginTokens?: number;
}

export class LocalLlmProvider implements AssistantProvider {
  private readonly promptTokenEstimator: LocalPromptTokenEstimator;
  private readonly maxContextTokens: number;
  private readonly outputTokenAllowance: number;
  private readonly promptSafetyMarginTokens: number;

  constructor(
    private readonly runtime: LocalModelRuntime,
    private readonly options: LocalLlmProviderOptions,
  ) {
    this.promptTokenEstimator =
      options.promptTokenEstimator ??
      new ApproximateCharacterPromptTokenEstimator();
    this.maxContextTokens =
      options.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
    this.outputTokenAllowance =
      options.outputTokenAllowance ?? DEFAULT_OUTPUT_TOKEN_ALLOWANCE;
    this.promptSafetyMarginTokens =
      options.promptSafetyMarginTokens ??
      DEFAULT_PROMPT_SAFETY_MARGIN_TOKENS;

    assertPositiveInteger(this.maxContextTokens, 'maxContextTokens');
    assertPositiveInteger(this.outputTokenAllowance, 'outputTokenAllowance');
    assertNonNegativeInteger(
      this.promptSafetyMarginTokens,
      'promptSafetyMarginTokens',
    );
    if (
      this.outputTokenAllowance + this.promptSafetyMarginTokens >=
      this.maxContextTokens
    ) {
      throw new RangeError(
        'Output allowance and safety margin must leave room for the prompt.',
      );
    }
  }

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
    return this.generate(
      this.options.promptBuilder.interpretationPrompt(text, context),
      context,
    );
  }

  async resolveContainerChoice(
    containerId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): Promise<AssistantResult> {
    return this.generate(
      this.options.promptBuilder.containerChoicePrompt(
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
    return this.generate(
      this.options.promptBuilder.walletChoicePrompt(
        walletId,
        pending,
        context,
      ),
      context,
    );
  }

  private async generate(
    prompt: string,
    context: AssistantContext,
  ): Promise<AssistantResult> {
    this.assertPromptWithinBudget(prompt);
    await this.ensureReady();
    const response = await this.runtime.generate({
      prompt,
      maxTokens: this.outputTokenAllowance,
    });
    return this.options.responseParser.parse(response, context);
  }

  private assertPromptWithinBudget(prompt: string): void {
    const estimatedPromptTokens = this.promptTokenEstimator.estimate(prompt);
    if (
      !Number.isSafeInteger(estimatedPromptTokens) ||
      estimatedPromptTokens < 0
    ) {
      throw new Error(
        'Prompt token estimator returned an invalid token count.',
      );
    }
    const maxPromptTokens =
      this.maxContextTokens -
      this.outputTokenAllowance -
      this.promptSafetyMarginTokens;
    if (estimatedPromptTokens > maxPromptTokens) {
      throw new PromptBudgetExceededError(
        estimatedPromptTokens,
        maxPromptTokens,
        this.maxContextTokens,
        this.outputTokenAllowance,
        this.promptSafetyMarginTokens,
      );
    }
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

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}
