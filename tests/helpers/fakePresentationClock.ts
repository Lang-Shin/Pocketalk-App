import type { PresentationScheduler } from '../../src/features/assistant/responsePresentation';

export class FakePresentationClock implements PresentationScheduler {
  time = 0;
  private next = 0;
  private tasks = new Map<number, { at: number; callback: () => void }>();

  now = () => this.time;

  schedule = (callback: () => void, delay: number) => {
    const id = ++this.next;
    this.tasks.set(id, { at: this.time + delay, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  cancel = (timer: ReturnType<typeof setTimeout>) => {
    this.tasks.delete(timer as unknown as number);
  };

  advance(ms: number): void {
    this.time += ms;
    for (const [id, task] of this.tasks) {
      if (task.at <= this.time) {
        this.tasks.delete(id);
        task.callback();
      }
    }
  }

  get pending(): number {
    return this.tasks.size;
  }
}
