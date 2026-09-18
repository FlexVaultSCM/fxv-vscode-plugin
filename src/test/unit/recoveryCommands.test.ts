import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import type { FxvCommands } from '../../cli/commands';
import { resumeCommand } from '../../commands/recovery';
import type { CommandContext } from '../../commands/types';
import type { StatusCache } from '../../state/statusCache';

function createHarness() {
  const resumeCalls: { mode?: 'continue' | 'rollback' }[] = [];
  const refreshes: { skipRemoteUpdate?: boolean }[] = [];

  const fxv = {
    resume: (options: { mode?: 'continue' | 'rollback' } = {}) => {
      resumeCalls.push(options);
      return Promise.resolve({
        ok: true as const,
        payload: {
          target_revision: 'main.-.6',
          files_updated_count: 4,
          error_count: 0,
          files_updated: [],
        },
        text: '',
      });
    },
  } as unknown as FxvCommands;

  const statusCache = {
    refresh: (opts: { skipRemoteUpdate?: boolean }) => {
      refreshes.push(opts);
      return Promise.resolve(undefined);
    },
  } as unknown as StatusCache;

  const ctx: CommandContext = {
    fxv,
    statusCache,
    scmProvider: undefined,
    log: undefined,
    context: {} as unknown as vscode.ExtensionContext,
    rootUri: vscode.Uri.file('/workspace'),
  };

  return { ctx, resumeCalls, refreshes };
}

describe('resumeCommand', () => {
  it('runs resume --continue and refreshes status', async () => {
    const harness = createHarness();
    await resumeCommand(harness.ctx, 'continue');

    expect(harness.resumeCalls).toEqual([{ mode: 'continue' }]);
    expect(harness.refreshes).toEqual([{ skipRemoteUpdate: true }]);
  });

  it('runs resume --rollback', async () => {
    const harness = createHarness();
    await resumeCommand(harness.ctx, 'rollback');

    expect(harness.resumeCalls).toEqual([{ mode: 'rollback' }]);
  });

  it('does nothing without a workspace root', async () => {
    const harness = createHarness();
    const ctx = { ...harness.ctx, rootUri: undefined };
    const errorSpy = vi.spyOn(vscode.window, 'showErrorMessage');

    await resumeCommand(ctx, 'continue');

    expect(harness.resumeCalls).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('surfaces lock contention with a Retry action', async () => {
    const harness = createHarness();
    vi.spyOn(harness.ctx.fxv, 'resume').mockResolvedValue({
      ok: false,
      failure: 'error-envelope',
      message: "Workspace is locked by another process (PID: 1234, Command: 'fxv.exe').",
      exitCode: 99,
      exitClass: 'locked',
      raw: '',
    });
    const warnSpy = vi.spyOn(vscode.window, 'showWarningMessage');

    await resumeCommand(harness.ctx, 'continue');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('locked by fxv (PID 1234)'),
      'Retry',
      'Show Log',
    );
  });
});
