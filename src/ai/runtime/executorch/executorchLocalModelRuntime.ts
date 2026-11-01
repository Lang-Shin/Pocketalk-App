import type {
  LLMChatSession,
  LLMChatTurnResult,
} from 'react-native-executorch';
import {
  LocalModelCancelledError,
  type LocalModelMetrics,
  type LocalModelRequest,
  type LocalModelResponse,
  type LocalModelRuntime,
  type LocalModelRuntimeStatus,
} from '../types';
import {
  validateExecuTorchRuntimeConfig,
  type ExecuTorchRuntimeConfig,
} from './config';

export type ExecuTorchSessionFactory = (
  config: ExecuTorchRuntimeConfig,
) => Promise<LLMChatSession>;

export interface ExecuTorchLocalModelRuntimeOptions {
  createSession?: ExecuTorchSessionFactory;
  now?: () => number;
}

export class ExecuTorchLocalModelRuntime implements LocalModelRuntime {
  private currentStatus: LocalModelRuntimeStatus = 'unloaded';
  private currentMetrics: LocalModelMetrics | null = null;
  private session: LLMChatSession | null = null;
  private activeGeneration: Promise<LocalModelResponse> | null = null;
  private cancelRequested = false;
  private readonly createSession: ExecuTorchSessionFactory;
  private readonly now: () => number;

  constructor(
    private readonly config: ExecuTorchRuntimeConfig,
    options: ExecuTorchLocalModelRuntimeOptions = {},
  ) {
    validateExecuTorchRuntimeConfig(config);
    this.createSession = options.createSession ?? createDefaultSession;
    this.now = options.now ?? Date.now;
  }

  status(): LocalModelRuntimeStatus {
    return this.currentStatus;
  }

  metrics(): LocalModelMetrics | null {
    return this.currentMetrics;
  }

  async load(): Promise<void> {
    if (this.session) return;
    if (this.currentStatus === 'generating') {
      throw new Error('Cannot load while generation is active.');
    }

    this.currentStatus = 'loading';
    const startedAt = this.now();
    try {
      this.session = await this.createSession(this.config);
      this.currentMetrics = {
        loadMs: this.now() - startedAt,
      };
      this.currentStatus = 'ready';
    } catch (error) {
      this.currentStatus = 'error';
      this.session = null;
      throw error;
    }
  }

  async generate(
    request: LocalModelRequest,
  ): Promise<LocalModelResponse> {
    const session = this.session;
    if (!session || this.currentStatus !== 'ready') {
      throw new Error('ExecuTorch local model runtime is not ready.');
    }

    this.currentStatus = 'generating';
    this.cancelRequested = false;
    const generation = this.runGeneration(session, request);
    this.activeGeneration = generation;

    try {
      return await generation;
    } finally {
      this.activeGeneration = null;
    }
  }

  async cancel(): Promise<void> {
    if (this.currentStatus !== 'generating') return;
    this.cancelRequested = true;
    this.session?.stop();
  }

  async unload(): Promise<void> {
    if (this.activeGeneration) {
      this.cancelRequested = true;
      this.session?.stop();
      try {
        await this.activeGeneration;
      } catch {
        // Generation errors are handled by the generation call itself.
      }
    }

    this.disposeSession();
    this.currentMetrics = null;
    this.currentStatus = 'unloaded';
  }

  private async runGeneration(
    session: LLMChatSession,
    request: LocalModelRequest,
  ): Promise<LocalModelResponse> {
    try {
      const turn = await session.sendMessage(
        request.prompt,
        undefined,
        generationOptions(this.config, request),
      );
      if (this.cancelRequested) {
        throw new LocalModelCancelledError();
      }

      this.updateMetrics(turn);
      return {
        text: contentToText(lastAssistantContent(turn)),
      };
    } catch (error) {
      if (this.cancelRequested) {
        this.currentStatus = 'unloaded';
        throw new LocalModelCancelledError();
      }
      this.currentStatus = 'error';
      throw error;
    } finally {
      this.disposeSession();
      if (this.currentStatus === 'generating') {
        this.currentStatus = 'unloaded';
      }
    }
  }

  private updateMetrics(turn: LLMChatTurnResult): void {
    const stats = turn.stats[turn.stats.length - 1];
    if (!stats) return;
    this.currentMetrics = {
      ...this.currentMetrics,
      timeToFirstTokenMs: stats.firstTokenMs - stats.inferenceStartMs,
      totalMs: stats.inferenceEndMs - stats.inferenceStartMs,
      promptTokens: stats.numPromptTokens,
      outputTokens: stats.numGeneratedTokens,
    };
  }

  private disposeSession(): void {
    const session = this.session;
    this.session = null;
    session?.dispose();
  }
}

function generationOptions(
  config: ExecuTorchRuntimeConfig,
  request: LocalModelRequest,
): { maxNewTokens?: number; temperature?: number } {
  const maxNewTokens = request.maxTokens ?? config.maxNewTokens;
  return {
    ...(maxNewTokens === undefined ? {} : { maxNewTokens }),
    ...(config.temperature === undefined
      ? {}
      : { temperature: config.temperature }),
  };
}

function lastAssistantContent(turn: LLMChatTurnResult): unknown {
  const assistant = [...turn.messages]
    .reverse()
    .find((message) => message.role === 'assistant');
  return assistant?.content;
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (typeof part === 'string' ? part : ''))
    .join('');
}

async function createDefaultSession(
  config: ExecuTorchRuntimeConfig,
): Promise<LLMChatSession> {
  const { createLLMChatSession } = await import('react-native-executorch');
  return createLLMChatSession({
    modelPath: config.modelPath,
    tokenizerPath: config.tokenizerPath,
    tokenizerConfigPath: config.tokenizerConfigPath,
  });
}
