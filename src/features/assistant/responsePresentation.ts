export interface PresentationScheduler {
  now(): number;
  schedule(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  cancel(timer: ReturnType<typeof setTimeout>): void;
}

const defaultScheduler: PresentationScheduler = {
  now: () => globalThis.performance?.now?.() ?? Date.now(),
  schedule: (callback, delay) => setTimeout(callback, delay),
  cancel: (timer) => clearTimeout(timer),
};

/** Coordinates presentation only; it does not execute or cancel ledger writes. */
export class ResponsePresentation {
  private active = false;
  private generation = 0;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private releaseWait: (() => void) | null = null;

  constructor(private readonly scheduler: PresentationScheduler = defaultScheduler) {}

  activate(): void {
    this.disposed = false;
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.active = false;
    if (this.timer !== null) this.scheduler.cancel(this.timer);
    this.timer = null;
    this.releaseWait?.();
    this.releaseWait = null;
  }

  async run<T>(
    operation: () => Promise<T>,
    callbacks: { start: () => void; success: (value: T) => void; error: () => void; finish: () => void },
    minimumMs = 500,
  ): Promise<boolean> {
    if (this.active || this.disposed) return false;
    this.active = true;
    const generation = ++this.generation;
    const current = () => !this.disposed && generation === this.generation;
    const started = this.scheduler.now();
    callbacks.start();
    try {
      const result = await operation();
      if (!current()) return true;
      const remaining = Math.max(0, minimumMs - (this.scheduler.now() - started));
      if (remaining > 0) {
        await new Promise<void>((resolve) => {
          this.releaseWait = resolve;
          this.timer = this.scheduler.schedule(() => {
            this.timer = null;
            this.releaseWait = null;
            resolve();
          }, remaining);
        });
      }
      if (current()) callbacks.success(result);
    } catch {
      if (current()) callbacks.error();
    } finally {
      if (current()) {
        this.active = false;
        callbacks.finish();
      }
    }
    return true;
  }
}
