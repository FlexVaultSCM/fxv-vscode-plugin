import type { StatusPayload } from '../cli/types.generated';

export interface StatusRefreshRequest {
  readonly skipRemoteUpdate: boolean;
}

export interface RefreshOptions {
  readonly skipRemoteUpdate?: boolean | undefined;
  readonly debounce?: boolean | undefined;
}

export type StatusFetcher = (skipRemoteUpdate: boolean) => Promise<StatusPayload | undefined>;

/**
 * Handles debouncing and coalescing of status refresh requests.
 * Pure logic decoupled from VS Code APIs.
 */
export class StatusCoordinator {
  private inFlightRefresh: Promise<StatusPayload | undefined> | null = null;
  private queuedRefresh: StatusRefreshRequest | null = null;
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
      // If any concurrent request needed full remote check (skipRemoteUpdate: false), preserve it
      if (this.queuedRefresh) {
        this.queuedRefresh = {
          skipRemoteUpdate: this.queuedRefresh.skipRemoteUpdate && skipRemoteUpdate,
        };
      } else {
        this.queuedRefresh = { skipRemoteUpdate };
      }
      return this.inFlightRefresh;
    }

    this.inFlightRefresh = this.fetcher(skipRemoteUpdate).finally(() => {
      this.inFlightRefresh = null;
      if (this.queuedRefresh) {
        const next = this.queuedRefresh;
        this.queuedRefresh = null;
        void this.refresh(next);
      }
    });

    return this.inFlightRefresh;
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
