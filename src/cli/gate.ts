/**
 * A readers-writer gate over one workspace.
 *
 * Mutating commands run one at a time and never alongside a read, because the
 * CLI takes a workspace lock and a second caller gets exit 99 rather than a
 * wait. Reads run together. Waiters are served in arrival order, so a steady
 * stream of reads cannot starve a queued write.
 */
export class MutationGate {
  private writing = false;
  private readers = 0;
  private readonly waiting: Waiter[] = [];

  get busy(): boolean {
    return this.writing;
  }

  async acquire(mode: GateMode): Promise<void> {
    if (this.waiting.length === 0 && this.canStart(mode)) {
      this.start(mode);
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiting.push({ mode, resume: resolve });
    });
  }

  release(mode: GateMode): void {
    if (mode === 'write') {
      this.writing = false;
    } else {
      this.readers -= 1;
    }
    this.admit();
  }

  private admit(): void {
    while (this.waiting.length > 0) {
      const next = this.waiting[0] as Waiter;
      if (!this.canStart(next.mode)) {
        return;
      }
      this.waiting.shift();
      this.start(next.mode);
      next.resume();
    }
  }

  private canStart(mode: GateMode): boolean {
    return mode === 'write' ? !this.writing && this.readers === 0 : !this.writing;
  }

  private start(mode: GateMode): void {
    if (mode === 'write') {
      this.writing = true;
    } else {
      this.readers += 1;
    }
  }
}

export type GateMode = 'read' | 'write';

interface Waiter {
  readonly mode: GateMode;
  readonly resume: () => void;
}
