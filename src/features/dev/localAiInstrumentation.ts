import type {
  AssistantContext,
  AssistantPendingIntent,
} from '@/ai/localAssistant';
import { PocketaLocalPromptBuilder } from '@/ai/providers/localPromptBuilder';
import type {
  LocalModelMetrics,
  LocalModelPromptBuilder,
  LocalModelRequest,
  LocalModelResponse,
  LocalModelRuntime,
  LocalModelRuntimeStatus,
} from '@/ai/runtime';

export type OutputLimitStatus =
  | 'not-reached'
  | 'reached-or-met'
  | 'unknown';

export interface InstrumentedCaseMetrics {
  loadMs: number | null;
  promptPreparationMs: number | null;
  promptCharacters: number | null;
  generationMs: number | null;
  timeToFirstTokenMs: number | null;
  unloadMs: number | null;
  promptTokens: number | null;
  outputTokens: number | null;
  runtimeStatusAfterGeneration: LocalModelRuntimeStatus | null;
  maxTokens: number | null;
  outputLimitStatus: OutputLimitStatus;
  generationStats: LocalModelMetrics | null;
}

export interface InstrumentedPromptBuilderOptions {
  now?: () => number;
  delegate?: LocalModelPromptBuilder;
}

export class InstrumentedPromptBuilder implements LocalModelPromptBuilder {
  private readonly now: () => number;
  private readonly delegate: LocalModelPromptBuilder;
  promptPreparationMs: number | null = null;
  promptCharacters: number | null = null;

  constructor(options: InstrumentedPromptBuilderOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.delegate = options.delegate ?? new PocketaLocalPromptBuilder();
  }

  resetCase(): void {
    this.promptPreparationMs = null;
    this.promptCharacters = null;
  }

  interpretationPrompt(text: string, context: AssistantContext): string {
    return this.measure(() =>
      this.delegate.interpretationPrompt(text, context),
    );
  }

  containerChoicePrompt(
    containerId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): string {
    return this.measure(() =>
      this.delegate.containerChoicePrompt(containerId, pending, context),
    );
  }

  walletChoicePrompt(
    walletId: string,
    pending: AssistantPendingIntent,
    context: AssistantContext,
  ): string {
    return this.measure(() =>
      this.delegate.walletChoicePrompt(walletId, pending, context),
    );
  }

  private measure(operation: () => string): string {
    const startedAt = this.now();
    let prompt = '';
    try {
      prompt = operation();
      return prompt;
    } finally {
      this.promptPreparationMs = this.now() - startedAt;
      this.promptCharacters = prompt.length;
    }
  }
}

export interface InstrumentedRuntimeOptions {
  now?: () => number;
}

export class InstrumentedLocalModelRuntime implements LocalModelRuntime {
  private readonly now: () => number;
  loadMs: number | null = null;
  generationMs: number | null = null;
  unloadMs: number | null = null;
  lastResponse: LocalModelResponse | null = null;
  generationStats: LocalModelMetrics | null = null;
  runtimeStatusAfterGeneration: LocalModelRuntimeStatus | null = null;
  maxTokens: number | null = null;

  constructor(
    private readonly delegate: LocalModelRuntime,
    options: InstrumentedRuntimeOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
  }

  resetCase(): void {
    this.loadMs = null;
    this.generationMs = null;
    this.unloadMs = null;
    this.lastResponse = null;
    this.generationStats = null;
    this.runtimeStatusAfterGeneration = null;
    this.maxTokens = null;
  }

  status(): LocalModelRuntimeStatus {
    return this.delegate.status();
  }

  metrics(): LocalModelMetrics | null {
    return this.delegate.metrics();
  }

  async load(): Promise<void> {
    const startedAt = this.now();
    try {
      await this.delegate.load();
    } finally {
      this.loadMs = this.now() - startedAt;
    }
  }

  async generate(
    request: LocalModelRequest,
  ): Promise<LocalModelResponse> {
    this.maxTokens = request.maxTokens ?? null;
    const startedAt = this.now();
    try {
      const response = await this.delegate.generate(request);
      this.lastResponse = response;
      return response;
    } finally {
      this.generationMs = this.now() - startedAt;
      this.generationStats = this.delegate.metrics();
      this.runtimeStatusAfterGeneration = this.delegate.status();
    }
  }

  cancel(): Promise<void> {
    return this.delegate.cancel();
  }

  async unload(): Promise<void> {
    const startedAt = this.now();
    try {
      await this.delegate.unload();
    } finally {
      this.unloadMs = this.now() - startedAt;
    }
  }
}

export async function unloadRuntimeSafely(
  runtime: LocalModelRuntime | null | undefined,
): Promise<void> {
  if (!runtime) return;
  await runtime.unload().catch(() => undefined);
}

export function instrumentedCaseMetrics(
  runtime: InstrumentedLocalModelRuntime,
  promptBuilder: InstrumentedPromptBuilder,
): InstrumentedCaseMetrics {
  const generationStats = runtime.generationStats;
  return {
    loadMs: runtime.loadMs,
    promptPreparationMs: promptBuilder.promptPreparationMs,
    promptCharacters: promptBuilder.promptCharacters,
    generationMs: runtime.generationMs,
    timeToFirstTokenMs: generationStats?.timeToFirstTokenMs ?? null,
    unloadMs: runtime.unloadMs,
    promptTokens: generationStats?.promptTokens ?? null,
    outputTokens: generationStats?.outputTokens ?? null,
    runtimeStatusAfterGeneration: runtime.runtimeStatusAfterGeneration,
    maxTokens: runtime.maxTokens,
    outputLimitStatus: outputLimitStatus(
      generationStats,
      runtime.maxTokens,
    ),
    generationStats,
  };
}

function outputLimitStatus(
  metrics: LocalModelMetrics | null,
  maxTokens: number | null,
): OutputLimitStatus {
  if (
    !metrics ||
    metrics.outputTokens === undefined ||
    maxTokens === null
  ) {
    return 'unknown';
  }
  return metrics.outputTokens >= maxTokens
    ? 'reached-or-met'
    : 'not-reached';
}
