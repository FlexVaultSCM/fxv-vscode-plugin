import type { StatusPayload } from '../cli/types.generated';

export interface StatusRefreshRequest {
  readonly skipRemoteUpdate: boolean;
}

export interface RefreshOptions {
  readonly skipRemoteUpdate?: boolean | undefined;
  readonly debounce?: boolean | undefined;
}

export type StatusFetcher = (skipRemoteUpdate: boolean) => Promise<StatusPayload | undefined>;

interface QueuedExecution {
  skipRemoteUpdate: boolean;
  promise: Promise<StatusPayload | undefined>;
  resolve: (val: StatusPayload | undefined) => void;
  reject: (err: unknown) => void;
}

/**
 * Handles debouncing and coalescing of status refresh requests.
 * Pure logic decoupled from VS Code APIs.
 */
export class StatusCoordinator {
  private inFlightRefresh: Promise<StatusPayload | undefined> | null = null;
  private inFlightSkipRemoteUpdate = true;
  private queuedRefresh: QueuedExecution | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly fetcher: StatusFetcher,
    private readonly getDebounceMs: () => number,
  ) {}

  scheduleRefresh(
    opts?: { skipRemoteUpdate?: boolean; debounce?: boolean },
    onComplete?: (status: StatusPayload | undefined) => void,
  ): void {
    const debounce = opts?.debounce ?? true;
    const skipRemoteUpdate = opts?.skipRemoteUpdate ?? true;

    if (!debounce) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      void this.refresh({ skipRemoteUpdate }).then(onComplete);
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    const delay = Math.max(0, this.getDebounceMs());
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.refresh({ skipRemoteUpdate: true }).then(onComplete);
    }, delay);
  }

  async refresh(opts?: { skipRemoteUpdate?: boolean }): Promise<StatusPayload | undefined> {
    const skipRemoteUpdate = opts?.skipRemoteUpdate ?? true;

    if (this.inFlightRefresh) {
      // If caller only needs quick check and current in-flight is sufficient and nothing queued,
      // coalesce into current in-flight.
      if (skipRemoteUpdate && !this.queuedRefresh && this.inFlightSkipRemoteUpdate) {
        return this.inFlightRefresh;
      }

      // If caller needs a full check or a queued execution already exists, queue or join the next execution
      if (!this.queuedRefresh) {
        let resolve!: (val: StatusPayload | undefined) => void;
        let reject!: (err: unknown) => void;
        const promise = new Promise<StatusPayload | undefined>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        this.queuedRefresh = {
          skipRemoteUpdate,
          promise,
          resolve,
          reject,
        };
      } else if (!skipRemoteUpdate) {
        // Upgrade queued execution to skipRemoteUpdate: false if any caller requires it
        this.queuedRefresh.skipRemoteUpdate = false;
      }

      return this.queuedRefresh.promise;
    }

    this.inFlightSkipRemoteUpdate = skipRemoteUpdate;
    this.inFlightRefresh = this.executeRun(skipRemoteUpdate);
    return this.inFlightRefresh;
  }

  private async executeRun(skipRemoteUpdate: boolean): Promise<StatusPayload | undefined> {
    let result: StatusPayload | undefined;
    let error: unknown;

    try {
      result = await this.fetcher(skipRemoteUpdate);
    } catch (err) {
      error = err;
    } finally {
      this.inFlightRefresh = null;
      const next = this.queuedRefresh;
      this.queuedRefresh = null;
      if (next) {
        void this.refresh({ skipRemoteUpdate: next.skipRemoteUpdate }).then(
          next.resolve,
          next.reject,
        );
      }
    }

    if (error) {
      throw error;
    }
    return result;
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
