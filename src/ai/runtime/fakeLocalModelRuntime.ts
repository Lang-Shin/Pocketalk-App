import {
  LocalModelCancelledError,
  type LocalModelMetrics,
  type LocalModelRequest,
  type LocalModelResponse,
  type LocalModelRuntime,
  type LocalModelRuntimeStatus,
} from './types';

interface FakeLocalModelRuntimeOptions {
  responses?: (LocalModelResponse | Error)[];
  holdGeneration?: boolean;
  loadError?: Error;
  unloadError?: Error;
}

export class FakeLocalModelRuntime implements LocalModelRuntime {
  private currentStatus: LocalModelRuntimeStatus = 'unloaded';
  private currentMetrics: LocalModelMetrics | null = null;
  private readonly responses: (LocalModelResponse | Error)[];
  private readonly holdGeneration: boolean;
  private readonly loadError?: Error;
  private readonly unloadError?: Error;
  private pending:
    | {
        resolve: (response: LocalModelResponse) => void;
        reject: (error: Error) => void;
      }
    | undefined;

  loadCalls = 0;
  unloadCalls = 0;
  cancelCalls = 0;
  generateCalls = 0;

  constructor(options: FakeLocalModelRuntimeOptions = {}) {
    this.responses = [...(options.responses ?? [])];
    this.holdGeneration = options.holdGeneration ?? false;
    this.loadError = options.loadError;
    this.unloadError = options.unloadError;
  }

  status(): LocalModelRuntimeStatus {
    return this.currentStatus;
  }

  metrics(): LocalModelMetrics | null {
    return this.currentMetrics;
  }

  async load(): Promise<void> {
    this.loadCalls += 1;
    if (this.loadError) {
      this.currentStatus = 'error';
      throw this.loadError;
    }
    this.currentStatus = 'ready';
  }

  async generate(request: LocalModelRequest): Promise<LocalModelResponse> {
    if (this.currentStatus !== 'ready') {
      throw new Error('Fake local runtime is not ready.');
    }

    this.generateCalls += 1;
    this.currentStatus = 'generating';
    this.currentMetrics = {
      totalMs: 0,
      promptTokens: request.prompt.length,
      outputTokens: 0,
    };

    if (this.holdGeneration) {
      try {
        return await new Promise<LocalModelResponse>((resolve, reject) => {
          this.pending = { resolve, reject };
        });
      } finally {
        this.pending = undefined;
        if (this.currentStatus === 'generating') {
          this.currentStatus = 'ready';
        }
      }
    }

    try {
      const response = this.responses.shift();
      if (response instanceof Error) throw response;
      if (!response) {
        throw new Error('No fake local-model response is queued.');
      }
      return response;
    } finally {
      this.currentStatus = 'ready';
    }
  }

  async cancel(): Promise<void> {
    this.cancelCalls += 1;
    if (this.pending) {
      this.pending.reject(new LocalModelCancelledError());
      this.pending = undefined;
    }
    this.currentStatus = 'ready';
  }

  async unload(): Promise<void> {
    this.unloadCalls += 1;
    if (this.unloadError) {
      this.currentStatus = 'error';
      throw this.unloadError;
    }
    if (this.pending) {
      this.pending.reject(new LocalModelCancelledError());
      this.pending = undefined;
    }
    this.currentStatus = 'unloaded';
    this.currentMetrics = null;
  }
}
