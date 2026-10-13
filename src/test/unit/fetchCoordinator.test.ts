import { describe, expect, it, vi } from 'vitest';

import { FetchCoordinator } from '../../state/fetchCoordinator';

describe('FetchCoordinator', () => {
  it('does not schedule a timer if period is zero or negative', () => {
    vi.useFakeTimers();
    let calls = 0;
    const coordinator = new FetchCoordinator(
      () => {
        calls++;
        return Promise.resolve({ ok: true, payload: { bytes_downloaded: 0, repaired_files: [] } });
      },
      {
        getPeriodSeconds: () => 0,
      },
    );

    coordinator.start();
    vi.advanceTimersByTime(100000);
    expect(calls).toBe(0);

    coordinator.dispose();
    vi.useRealTimers();
  });

  it('runs periodically according to the configured period', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const coordinator = new FetchCoordinator(
      () => {
        calls++;
        return Promise.resolve({ ok: true, payload: { bytes_downloaded: 0, repaired_files: [] } });
      },
      {
        getPeriodSeconds: () => 60,
      },
    );

    coordinator.start();
    expect(calls).toBe(0);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(2);

    coordinator.dispose();
    vi.useRealTimers();
  });

  it('skips execution when isBlocked returns true', async () => {
    vi.useFakeTimers();
    let calls = 0;
    let blocked = true;
    const coordinator = new FetchCoordinator(
      () => {
        calls++;
        return Promise.resolve({ ok: true, payload: { bytes_downloaded: 0, repaired_files: [] } });
      },
      {
        getPeriodSeconds: () => 30,
        isBlocked: () => blocked,
      },
    );

    coordinator.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toBe(0);

    blocked = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toBe(1);

    coordinator.dispose();
    vi.useRealTimers();
  });

  it('prevents concurrent executions if previous fetch is still in flight', async () => {
    vi.useFakeTimers();
    let resolveFirst: (() => void) | undefined;
    let invocations = 0;

    const coordinator = new FetchCoordinator(
      () => {
        invocations++;
        if (invocations === 1) {
          return new Promise((res) => {
            resolveFirst = () =>
              res({ ok: true, payload: { bytes_downloaded: 0, repaired_files: [] } });
          });
        }
        return Promise.resolve({ ok: true, payload: { bytes_downloaded: 0, repaired_files: [] } });
      },
      {
        getPeriodSeconds: () => 10,
      },
    );

    coordinator.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(invocations).toBe(1);

    // Trigger timer again while first is pending
    await vi.advanceTimersByTimeAsync(10_000);
    // Should still be 1 because first is in flight
    expect(invocations).toBe(1);

    // Now resolve first
    resolveFirst!();
    await Promise.resolve();

    // Next tick should invoke
    await vi.advanceTimersByTimeAsync(10_000);
    expect(invocations).toBe(2);

    coordinator.dispose();
    vi.useRealTimers();
  });

  it('restart resets the timer to new period', async () => {
    vi.useFakeTimers();
    let period = 60;
    let calls = 0;

    const coordinator = new FetchCoordinator(
      () => {
        calls++;
        return Promise.resolve({ ok: true, payload: { bytes_downloaded: 0, repaired_files: [] } });
      },
      {
        getPeriodSeconds: () => period,
      },
    );

    coordinator.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toBe(0);

    period = 10;
    coordinator.restart();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(1);

    coordinator.dispose();
    vi.useRealTimers();
  });
});
