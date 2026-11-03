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
  DEFAULT_POLICY_MAX_CONTEXT_TOKENS,
  DEFAULT_POLICY_OUTPUT_TOKEN_ALLOWANCE,
  DEFAULT_POLICY_PROMPT_SAFETY_MARGIN_TOKENS,
  PromptBudgetExceededError,
  type LocalPromptTokenEstimator,
} from './promptBudget';

export const DEFAULT_MAX_PENDING_REQUESTS = 16;

export interface LocalLlmProviderOptions {
  info: AssistantProviderInfo;
  promptBuilder: LocalModelPromptBuilder;
  responseParser: LocalModelResponseParser;
  promptTokenEstimator?: LocalPromptTokenEstimator;
  maxContextTokens?: number;
  outputTokenAllowance?: number;
  promptSafetyMarginTokens?: number;
  maxPendingRequests?: number;
}

export class LocalModelUnloadingError extends Error {
  constructor() {
    super('Local model is unloading and cannot start a new interpretation.');
    this.name = 'LocalModelUnloadingError';
  }
}

export class LocalModelQueueFullError extends Error {
  constructor(readonly maxPendingRequests: number) {
    super(
      `Local model request queue is full (${maxPendingRequests} pending operations).`,
    );
    this.name = 'LocalModelQueueFullError';
  }
}

class LocalProviderLifecycleCoordinator {
  private queue: Promise<void> = Promise.resolve();
  private pendingOperations = 0;
  private activeGeneration: Promise<unknown> | null = null;
  private unloading = false;
  private pendingUnload: Promise<void> | null = null;

  constructor(private readonly maxPendingRequests: number) {}

  enqueue<T>(
    operation: () => Promise<T>,
    bypassLimit = false,
  ): Promise<T> {
    if (!bypassLimit && this.pendingOperations >= this.maxPendingRequests) {
      return Promise.reject(
        new LocalModelQueueFullError(this.maxPendingRequests),
      );
    }

    this.pendingOperations += 1;
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => {
        this.pendingOperations -= 1;
      },
      () => {
        this.pendingOperations -= 1;
      },
    );
    return result;
  }

  isUnloading(): boolean {
    return this.unloading;
  }

  beginGeneration(generation: Promise<unknown>): void {
    this.activeGeneration = generation;
  }

  endGeneration(generation: Promise<unknown>): void {
    if (this.activeGeneration === generation) {
      this.activeGeneration = null;
    }
  }

  requestUnload(
    cancelGeneration: () => Promise<void>,
    unloadRuntime: () => Promise<void>,
  ): Promise<void> {
    if (this.pendingUnload) return this.pendingUnload;

    this.unloading = true;
    const activeGeneration = this.activeGeneration;
    let cancellationFailed = false;
    let cancellationError: unknown;

    const cancellation = activeGeneration
      ? (async () => {
          try {
            await cancelGeneration();
          } catch (error) {
            cancellationFailed = true;
            cancellationError = error;
            try {
              await unloadRuntime();
            } catch {
              // Preserve the cancellation failure; cleanup is best-effort.
            }
          }
        })()
      : Promise.resolve();

    const unload = this.enqueue(async () => {
      let unloadError: unknown;
      let unloadFailed = false;
      try {
        await cancellation;
        if (activeGeneration) {
          try {
            await activeGeneration;
          } catch {
            // Generation settlement is reported by the generation caller.
          }
        }
        try {
          await unloadRuntime();
        } catch (error) {
          unloadFailed = true;
          unloadError = error;
        }
      } finally {
        this.unloading = false;
        this.pendingUnload = null;
      }

      if (cancellationFailed) throw cancellationError;
      if (unloadFailed) throw unloadError;
    }, true);
    this.pendingUnload = unload;
    return unload;
  }
}

export class LocalLlmProvider implements AssistantProvider {
  private readonly promptTokenEstimator: LocalPromptTokenEstimator;
  private readonly maxContextTokens: number;
  private readonly outputTokenAllowance: number;
  private readonly promptSafetyMarginTokens: number;
  private readonly lifecycle: LocalProviderLifecycleCoordinator;

  constructor(
    private readonly runtime: LocalModelRuntime,
    private readonly options: LocalLlmProviderOptions,
  ) {
    const maxPendingRequests =
      options.maxPendingRequests ?? DEFAULT_MAX_PENDING_REQUESTS;
    assertPositiveInteger(maxPendingRequests, 'maxPendingRequests');
    this.lifecycle = new LocalProviderLifecycleCoordinator(
      maxPendingRequests,
    );
    this.promptTokenEstimator =
      options.promptTokenEstimator ??
      new ApproximateCharacterPromptTokenEstimator();
    this.maxContextTokens =
      options.maxContextTokens ?? DEFAULT_POLICY_MAX_CONTEXT_TOKENS;
    this.outputTokenAllowance =
      options.outputTokenAllowance ?? DEFAULT_POLICY_OUTPUT_TOKEN_ALLOWANCE;
    this.promptSafetyMarginTokens =
      options.promptSafetyMarginTokens ??
      DEFAULT_POLICY_PROMPT_SAFETY_MARGIN_TOKENS;

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
    return this.lifecycle.enqueue(() => this.ensureReady());
  }

  unload(): Promise<void> {
    return this.lifecycle.requestUnload(
      () => this.runtime.cancel(),
      () => this.runtime.unload(),
    );
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

  private generate(
    prompt: string,
    context: AssistantContext,
  ): Promise<AssistantResult> {
    return this.lifecycle.enqueue(() => this.runPrompt(prompt, context));
  }

  private async runPrompt(
    prompt: string,
    context: AssistantContext,
  ): Promise<AssistantResult> {
    if (this.lifecycle.isUnloading()) {
      throw new LocalModelUnloadingError();
    }
    this.assertPromptWithinBudget(prompt);
    await this.ensureReady();
    if (this.lifecycle.isUnloading()) {
      throw new LocalModelUnloadingError();
    }

    const generation = this.runtime.generate({
      prompt,
      maxTokens: this.outputTokenAllowance,
    });
    this.lifecycle.beginGeneration(generation);
    try {
      const response = await generation;
      if (this.lifecycle.isUnloading()) {
        throw new LocalModelUnloadingError();
      }
      return this.options.responseParser.parse(response, context);
    } finally {
      this.lifecycle.endGeneration(generation);
    }
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
