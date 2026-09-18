import { describe, expect, it, vi } from 'vitest';

import type { ErrorPayload } from '../../cli/types.generated';
import { RecoveryManager } from '../../state/recovery';

function recoverableError(overrides: Record<string, unknown> = {}): ErrorPayload {
  return {
    message: 'A previous `fxv goto` was interrupted before it finished.',
    exit_code: 98,
    error_data: {
      kind: 'interrupted-sync',
      version: '1.0',
      payload: {
        state: 'recoverable',
        operation: 'goto',
        summary: 'Was going from main.-.6 to main.-.8.',
        target_revision: 'main.-.8',
        source_revision: 'main.-.6',
        total_entries: 6,
        completed_entries: 2,
        remaining_entries: 4,
        failed_entries: 0,
        preserved_entries: 0,
        sampled_unfinished_paths: ['a.txt', 'f3.txt'],
        ...overrides,
      },
    },
  } as unknown as ErrorPayload;
}

function unreadableError(): ErrorPayload {
  return {
    message: 'The sync journal could not be read.',
    exit_code: 98,
    error_data: {
      kind: 'interrupted-sync',
      version: '1.0',
      payload: {
        state: 'unreadable',
        journal_path: '/repo/.fxv_workspace/journal',
        reason: 'corrupt header',
      },
    },
  } as unknown as ErrorPayload;
}

describe('RecoveryManager', () => {
  it('shows a banner with the summary and counts for a recoverable interruption', async () => {
    let seenMessage = '';
    let seenItems: string[] = [];
    const manager = new RecoveryManager({
      showWarningMessage: (message, ...items) => {
        seenMessage = message;
        seenItems = items;
        return Promise.resolve(undefined);
      },
    });

    manager.handleInterrupted(recoverableError());
    await Promise.resolve();
    await Promise.resolve();

    expect(seenMessage).toContain('Was going from main.-.6 to main.-.8.');
    expect(seenMessage).toContain('2 of 6 file changes applied, 4 remaining');
    expect(seenItems).toEqual(['Finish', 'Undo', 'Show Log']);
  });

  it('does not show a second banner while one is already showing', () => {
    const showWarningMessage = vi.fn().mockReturnValue(new Promise(() => {}));
    const manager = new RecoveryManager({ showWarningMessage });

    manager.handleInterrupted(recoverableError());
    manager.handleInterrupted(recoverableError());
    manager.handleInterrupted(recoverableError());

    expect(showWarningMessage).toHaveBeenCalledTimes(1);
  });

  it('runs flexvault.resume when Finish is chosen', async () => {
    const executeCommand = vi.fn();
    const manager = new RecoveryManager({
      showWarningMessage: () => Promise.resolve('Finish'),
      executeCommand,
    });

    manager.handleInterrupted(recoverableError());
    await Promise.resolve();
    await Promise.resolve();

    expect(executeCommand).toHaveBeenCalledWith('flexvault.resume');
  });

  it('runs flexvault.resumeRollback when Undo is chosen', async () => {
    const executeCommand = vi.fn();
    const manager = new RecoveryManager({
      showWarningMessage: () => Promise.resolve('Undo'),
      executeCommand,
    });

    manager.handleInterrupted(recoverableError());
    await Promise.resolve();
    await Promise.resolve();

    expect(executeCommand).toHaveBeenCalledWith('flexvault.resumeRollback');
  });

  it('renders the unreadable arm without counts and offers no Finish/Undo', async () => {
    let seenMessage = '';
    let seenItems: string[] = [];
    const manager = new RecoveryManager({
      showWarningMessage: (message, ...items) => {
        seenMessage = message;
        seenItems = items;
        return Promise.resolve(undefined);
      },
    });

    manager.handleInterrupted(unreadableError());
    await Promise.resolve();
    await Promise.resolve();

    expect(seenMessage).toContain('corrupt header');
    expect(seenMessage).toContain('resume --full');
    expect(seenItems).toEqual(['Show Log']);
  });

  it('allows the banner to show again after clear()', async () => {
    const showWarningMessage = vi.fn().mockResolvedValue(undefined);
    const manager = new RecoveryManager({ showWarningMessage });

    manager.handleInterrupted(recoverableError());
    await Promise.resolve();
    await Promise.resolve();
    manager.clear();
    manager.handleInterrupted(recoverableError());
    await Promise.resolve();
    await Promise.resolve();

    expect(showWarningMessage).toHaveBeenCalledTimes(2);
  });
});
