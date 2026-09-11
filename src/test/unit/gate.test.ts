import { describe, expect, it } from 'vitest';

import { MutationGate, type GateMode } from '../../cli/gate';

/** Records the order acquisitions happen in, holding each until released. */
function tracker(gate: MutationGate, order: string[]) {
  return async (name: string, mode: GateMode, hold: Promise<void>) => {
    await gate.acquire(mode);
    order.push(`${name}:start`);
    await hold;
    order.push(`${name}:end`);
    gate.release(mode);
  };
}

/** Lets every queued continuation run, which a single tick does not. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('MutationGate', () => {
  it('lets reads run together', async () => {
    const gate = new MutationGate();
    const order: string[] = [];
    const run = tracker(gate, order);
    const first = deferred();
    const second = deferred();

    const runs = [run('a', 'read', first.promise), run('b', 'read', second.promise)];
    await flush();
    expect(order).toEqual(['a:start', 'b:start']);

    first.resolve();
    second.resolve();
    await Promise.all(runs);
  });

  it('holds a write until the reads in flight have finished', async () => {
    const gate = new MutationGate();
    const order: string[] = [];
    const run = tracker(gate, order);
    const read = deferred();
    const write = deferred();

    const runs = [run('read', 'read', read.promise), run('write', 'write', write.promise)];
    await flush();
    expect(order).toEqual(['read:start']);

    read.resolve();
    await flush();
    expect(order).toContain('write:start');

    write.resolve();
    await Promise.all(runs);
    expect(order).toEqual(['read:start', 'read:end', 'write:start', 'write:end']);
  });

  it('runs mutations one at a time', async () => {
    const gate = new MutationGate();
    const order: string[] = [];
    const run = tracker(gate, order);
    const first = deferred();
    const second = deferred();

    const runs = [run('a', 'write', first.promise), run('b', 'write', second.promise)];
    await flush();
    expect(order).toEqual(['a:start']);
    expect(gate.busy).toBe(true);

    first.resolve();
    await flush();
    expect(order).toContain('b:start');

    second.resolve();
    await Promise.all(runs);
    expect(gate.busy).toBe(false);
  });

  it('serves waiters in arrival order, so reads cannot starve a write', async () => {
    const gate = new MutationGate();
    const order: string[] = [];
    const run = tracker(gate, order);
    const first = deferred();
    const write = deferred();
    const late = deferred();

    const runs = [
      run('read1', 'read', first.promise),
      run('write', 'write', write.promise),
      run('read2', 'read', late.promise),
    ];
    await flush();
    expect(order).toEqual(['read1:start']);

    first.resolve();
    await flush();
    // The later read waits behind the queued write rather than jumping it.
    expect(order).toEqual(['read1:start', 'read1:end', 'write:start']);

    write.resolve();
    late.resolve();
    await Promise.all(runs);
    expect(order.at(-1)).toBe('read2:end');
  });
});
