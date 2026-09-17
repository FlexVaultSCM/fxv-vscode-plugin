import { describe, expect, it, vi } from 'vitest';

import type { StatusPayload } from '../../cli/types.generated';
import { StatusCoordinator } from '../../state/statusCoordinator';

function dummyStatus(branch = 'main'): StatusPayload {
  return {
    current_branch: branch,
    head_commit: { state: 'empty_branch', branch },
    files: [],
    file_change_counts: { total: 0, unpublished: 0, workspace_need_snapshot: 0 },
  };
}

describe('StatusCoordinator', () => {
  it('debounces multiple rapid calls into a single invocation passing skipRemoteUpdate: true', async () => {
    vi.useFakeTimers();
    const calls: boolean[] = [];

    const fetcher = (skip: boolean) => {
      calls.push(skip);
      return Promise.resolve(dummyStatus());
    };

    const coordinator = new StatusCoordinator(fetcher, () => 300);

    coordinator.scheduleRefresh({ debounce: true, skipRemoteUpdate: true });
    coordinator.scheduleRefresh({ debounce: true, skipRemoteUpdate: true });
    coordinator.scheduleRefresh({ debounce: true, skipRemoteUpdate: true });

    expect(calls).toHaveLength(0);

    // Fast-forward through the debounce window
    vi.advanceTimersByTime(300);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(true);

    coordinator.dispose();
    vi.useRealTimers();
  });

  it('runs immediately when debounce is false and cancels any pending timer', async () => {
    vi.useFakeTimers();
    const calls: boolean[] = [];

    const fetcher = (skip: boolean) => {
      calls.push(skip);
      return Promise.resolve(dummyStatus());
    };

    const coordinator = new StatusCoordinator(fetcher, () => 300);

    coordinator.scheduleRefresh({ debounce: true });
    expect(calls).toHaveLength(0);

    // Immediate refresh
    coordinator.scheduleRefresh({ debounce: false, skipRemoteUpdate: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(false);

    // Advancing timers should not trigger another call because the timer was cancelled
    vi.advanceTimersByTime(500);
    expect(calls).toHaveLength(1);

    coordinator.dispose();
    vi.useRealTimers();
  });

  it('coalesces overlapping refreshes and preserves skipRemoteUpdate: false', async () => {
    const calls: boolean[] = [];
    let resolveFirst: ((status: StatusPayload) => void) | undefined;

    const fetcher = (skip: boolean) => {
      calls.push(skip);
      if (calls.length === 1) {
        return new Promise<StatusPayload>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(dummyStatus());
    };

    const coordinator = new StatusCoordinator(fetcher, () => 0);

    // First call starts and is in flight
    const p1 = coordinator.refresh({ skipRemoteUpdate: true });
    expect(calls).toEqual([true]);

    // Second call arrives while first is in flight, requesting full check (skipRemoteUpdate: false)
    const p2 = coordinator.refresh({ skipRemoteUpdate: false });

    // Third call arrives while first is in flight, requesting debounced check (skipRemoteUpdate: true)
    const p3 = coordinator.refresh({ skipRemoteUpdate: true });

    // Still only 1 call dispatched so far
    expect(calls).toHaveLength(1);

    // Complete the first call
    resolveFirst!(dummyStatus());
    await p1;
    await p2;
    await p3;

    // The queued calls should have coalesced into exactly ONE subsequent call
    // and that subsequent call MUST have skipRemoteUpdate: false
    expect(calls).toEqual([true, false]);

    coordinator.dispose();
  });
});
