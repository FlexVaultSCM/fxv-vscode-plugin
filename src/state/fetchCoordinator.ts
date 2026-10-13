import type { FetchPayload } from '../cli/commands';

export type FetchRunner = () => Promise<{ ok: boolean; payload?: FetchPayload; problem?: string }>;

export interface FetchCoordinatorOptions {
  readonly getPeriodSeconds: () => number;
  readonly isBlocked?: () => boolean;
  readonly onFetchSuccess?: (payload: FetchPayload) => void;
  readonly onFetchError?: (err: unknown) => void;
}

export class FetchCoordinator {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private disposed = false;

  constructor(
    private readonly runner: FetchRunner,
    private readonly options: FetchCoordinatorOptions,
  ) {}

  start(): void {
    if (this.disposed) {
      return;
    }
    this.restart();
  }

  restart(): void {
    this.stop();
    if (this.disposed) {
      return;
    }
    const seconds = this.options.getPeriodSeconds();
    if (seconds <= 0) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.tick();
    }, seconds * 1000);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const periodSeconds = this.options.getPeriodSeconds();
    if (periodSeconds <= 0) {
      return;
    }

    if (this.options.isBlocked && this.options.isBlocked()) {
      this.reschedule();
      return;
    }

    if (this.inFlight) {
      this.reschedule();
      return;
    }

    this.inFlight = true;
    try {
      const res = await this.runner();
      if (res.ok && res.payload) {
        this.options.onFetchSuccess?.(res.payload);
      }
    } catch (err: unknown) {
      this.options.onFetchError?.(err);
    } finally {
      this.inFlight = false;
      this.reschedule();
    }
  }

  private reschedule(): void {
    if (this.disposed) {
      return;
    }
    const seconds = this.options.getPeriodSeconds();
    if (seconds <= 0) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.tick();
    }, seconds * 1000);
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }
}
