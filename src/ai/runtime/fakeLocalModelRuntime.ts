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
  holdLoad?: boolean;
  holdGeneration?: boolean;
  holdCancellation?: boolean;
  loadError?: Error;
  loadErrorOnce?: Error;
  unloadError?: Error;
  unloadErrorOnce?: Error;
  cancelError?: Error;
  cancelErrorOnce?: Error;
}

export class FakeLocalModelRuntime implements LocalModelRuntime {
  private currentStatus: LocalModelRuntimeStatus = 'unloaded';
  private currentMetrics: LocalModelMetrics | null = null;
  private readonly responses: (LocalModelResponse | Error)[];
  private readonly holdLoad: boolean;
  private readonly holdGeneration: boolean;
  private readonly holdCancellation: boolean;
  private readonly loadError?: Error;
  private loadErrorOnce?: Error;
  private readonly unloadError?: Error;
  private unloadErrorOnce?: Error;
  private readonly cancelError?: Error;
  private cancelErrorOnce?: Error;
  private pendingLoad:
    | {
        resolve: () => void;
        reject: (error: Error) => void;
      }
    | undefined;
  private pendingCancellation: (() => void) | undefined;
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
  readonly requests: LocalModelRequest[] = [];

  constructor(options: FakeLocalModelRuntimeOptions = {}) {
    this.responses = [...(options.responses ?? [])];
    this.holdLoad = options.holdLoad ?? false;
    this.holdGeneration = options.holdGeneration ?? false;
    this.holdCancellation = options.holdCancellation ?? false;
    this.loadError = options.loadError;
    this.loadErrorOnce = options.loadErrorOnce;
    this.unloadError = options.unloadError;
    this.unloadErrorOnce = options.unloadErrorOnce;
    this.cancelError = options.cancelError;
    this.cancelErrorOnce = options.cancelErrorOnce;
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
    if (this.loadErrorOnce) {
      const error = this.loadErrorOnce;
      this.loadErrorOnce = undefined;
      this.currentStatus = 'error';
      throw error;
    }
    this.currentStatus = 'loading';
    if (this.holdLoad) {
      try {
        await new Promise<void>((resolve, reject) => {
          this.pendingLoad = { resolve, reject };
        });
        this.currentStatus = 'ready';
      } catch (error) {
        this.currentStatus = 'error';
        throw error;
      } finally {
        this.pendingLoad = undefined;
      }
      return;
    }
    this.currentStatus = 'ready';
  }

  releaseLoad(): void {
    const pendingLoad = this.pendingLoad;
    if (!pendingLoad) {
      throw new Error('No held load is pending.');
    }
    pendingLoad.resolve();
  }

  releaseGeneration(response: LocalModelResponse): void {
    const pending = this.pending;
    if (!pending) {
      throw new Error('No held generation is pending.');
    }
    pending.resolve(response);
  }

  async generate(request: LocalModelRequest): Promise<LocalModelResponse> {
    if (this.currentStatus !== 'ready') {
      throw new Error('Fake local runtime is not ready.');
    }

    this.generateCalls += 1;
    this.requests.push(request);
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
    if (this.cancelError) throw this.cancelError;
    if (this.cancelErrorOnce) {
      const error = this.cancelErrorOnce;
      this.cancelErrorOnce = undefined;
      throw error;
    }
    if (this.pending && this.holdCancellation) {
      await new Promise<void>((resolve) => {
        this.pendingCancellation = resolve;
      });
      return;
    }
    if (this.pending) {
      this.pending.reject(new LocalModelCancelledError());
      this.pending = undefined;
    }
    this.currentStatus = 'ready';
  }

  releaseCancellation(): void {
    const pendingCancellation = this.pendingCancellation;
    if (!pendingCancellation) {
      throw new Error('No held cancellation is pending.');
    }
    pendingCancellation();
    this.pendingCancellation = undefined;
  }

  async unload(): Promise<void> {
    this.unloadCalls += 1;
    if (this.unloadError) {
      this.currentStatus = 'error';
      throw this.unloadError;
    }
    if (this.unloadErrorOnce) {
      const error = this.unloadErrorOnce;
      this.unloadErrorOnce = undefined;
      this.currentStatus = 'error';
      throw error;
    }
    if (this.pending) {
      this.pending.reject(new LocalModelCancelledError());
      this.pending = undefined;
    }
    if (this.pendingLoad) {
      this.pendingLoad.reject(new Error('Fake runtime unloaded while loading.'));
      this.pendingLoad = undefined;
    }
    if (this.pendingCancellation) {
      const pendingCancellation = this.pendingCancellation;
      this.pendingCancellation = undefined;
      pendingCancellation();
    }
    this.currentStatus = 'unloaded';
    this.currentMetrics = null;
  }
}
