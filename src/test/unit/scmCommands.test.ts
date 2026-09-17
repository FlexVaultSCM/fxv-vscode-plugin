import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import { loginCommand, logoutCommand } from '../../commands/auth';
import { gotoCommand } from '../../commands/goto';
import { resolveCommand } from '../../commands/resolve';
import { revertCommand } from '../../commands/revert';
import { syncCommand } from '../../commands/sync';
import type { CommandContext } from '../../commands/types';
import type { FxvCommands } from '../../cli/commands';
import type { StatusCache } from '../../state/statusCache';
import type { FlexVaultResourceState, FlexVaultScmProvider } from '../../scm/provider';

function createMockHarness() {
  const snapshotCalls: (string | undefined)[] = [];
  const syncCalls: (string | undefined)[] = [];
  const gotoCalls: string[] = [];
  const revertCalls: unknown[] = [];
  const resolveCalls: { strategy: string; target: unknown }[] = [];
  const loginCalls: string[] = [];
  let logoutCalls = 0;
  const refreshes: { skipRemoteUpdate?: boolean }[] = [];

  const stateStore = new Map<string, unknown>();

  const fxv = {
    snapshot: (desc?: string) => {
      snapshotCalls.push(desc);
      return Promise.resolve({ ok: true as const, payload: undefined, text: '' });
    },
    sync: (spec?: string) => {
      syncCalls.push(spec);
      return Promise.resolve({
        ok: true as const,
        payload: {
          target_revision: 'main.5',
          files_updated_count: 2,
          error_count: 0,
          files_updated: [],
        },
        text: '',
      });
    },
    goto: (spec: string) => {
      gotoCalls.push(spec);
      return Promise.resolve({
        ok: true as const,
        payload: {
          target_revision: spec,
          files_updated_count: 1,
          error_count: 0,
          files_updated: [],
        },
        text: '',
      });
    },
    revert: (target: unknown) => {
      revertCalls.push(target);
      return Promise.resolve({
        ok: true as const,
        payload: {
          target_revision: 'main.-.1',
          files_updated_count: 3,
          error_count: 0,
          files_updated: [],
        },
        text: '',
      });
    },
    resolve: (strategy: string, target: unknown) => {
      resolveCalls.push({ strategy, target });
      return Promise.resolve({
        ok: true as const,
        payload: {
          target_revision: 'main.-.2',
          files_updated_count: 1,
          error_count: 0,
          files_updated: [],
        },
        text: '',
      });
    },
    login: (username: string) => {
      loginCalls.push(username);
      return Promise.resolve({
        ok: true as const,
        payload: { username },
        text: '',
      });
    },
    logout: () => {
      logoutCalls++;
      return Promise.resolve({
        ok: true as const,
        payload: { was_logged_in: true, username: 'bob' },
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

  const inputBox = { value: '' };
  const scmProvider = { inputBox } as unknown as FlexVaultScmProvider;

  const ctx: CommandContext = {
    fxv,
    statusCache,
    scmProvider,
    log: undefined,
    context: {
      workspaceState: {
        get: (k: string) => stateStore.get(k),
        update: (k: string, v: unknown) => {
          stateStore.set(k, v);
          return Promise.resolve();
        },
      },
    } as unknown as vscode.ExtensionContext,
    rootUri: vscode.Uri.file('/workspace'),
  };

  return {
    ctx,
    snapshotCalls,
    syncCalls,
    gotoCalls,
    revertCalls,
    resolveCalls,
    loginCalls,
    getLogoutCalls: () => logoutCalls,
    refreshes,
    inputBox,
    stateStore,
  };
}

describe('syncCommand', () => {
  it('runs sync and refreshes status', async () => {
    const harness = createMockHarness();
    await syncCommand(harness.ctx, 'main.12');

    expect(harness.syncCalls).toEqual(['main.12']);
    expect(harness.refreshes.length).toBe(1);
  });

  it('handles exit 99 lock contention', async () => {
    const harness = createMockHarness();
    vi.spyOn(harness.ctx.fxv, 'sync').mockResolvedValue({
      ok: false,
      failure: 'error-envelope',
      message: "Workspace is locked by another process (PID: 1234, Command: 'fxv.exe').",
      exitCode: 99,
      exitClass: 'locked',
      raw: '',
    });

    const warnSpy = vi.spyOn(vscode.window, 'showWarningMessage');
    await syncCommand(harness.ctx);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('locked by fxv (PID 1234)'),
      'Retry',
      'Show Log',
    );
  });
});

describe('gotoCommand', () => {
  it('prompts modal warning and calls goto on confirmation', async () => {
    const harness = createMockHarness();
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Switch Revision' as never);

    await gotoCommand(harness.ctx, 'main.8');

    expect(harness.gotoCalls).toEqual(['main.8']);
    expect(harness.refreshes.length).toBe(1);
  });

  it('cancels goto if user cancels modal warning', async () => {
    const harness = createMockHarness();
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Cancel' as never);

    await gotoCommand(harness.ctx, 'main.8');

    expect(harness.gotoCalls.length).toBe(0);
  });
});

describe('revertCommand', () => {
  it('reverts specified paths with modal confirmation', async () => {
    const harness = createMockHarness();
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Revert' as never);

    const resource1 = { descriptor: { path: 'a.txt' } } as unknown as FlexVaultResourceState;
    const resource2 = { descriptor: { path: 'b.txt' } } as unknown as FlexVaultResourceState;

    await revertCommand(harness.ctx, resource1, [resource1, resource2]);

    expect(harness.revertCalls).toEqual([{ paths: ['a.txt', 'b.txt'] }]);
    expect(harness.refreshes.length).toBe(1);
  });

  it('reverts all when no resources are provided', async () => {
    const harness = createMockHarness();
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Revert All Changes' as never);

    await revertCommand(harness.ctx);

    expect(harness.revertCalls).toEqual([{ all: true }]);
    expect(harness.refreshes.length).toBe(1);
  });

  it('does not revert all when resource target cannot be resolved', async () => {
    const harness = createMockHarness();
    const errorSpy = vi.spyOn(vscode.window, 'showErrorMessage');

    // Passing an unrecognized resource object
    await revertCommand(harness.ctx, {} as unknown as FlexVaultResourceState);

    expect(harness.revertCalls.length).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith('Unable to determine files to revert.');
  });
});

describe('resolveCommand', () => {
  it('runs resolve --mine on designated paths', async () => {
    const harness = createMockHarness();
    const resource = { descriptor: { path: 'conflict.txt' } } as unknown as FlexVaultResourceState;

    await resolveCommand(harness.ctx, 'mine', resource);

    expect(harness.resolveCalls).toEqual([
      { strategy: 'mine', target: { paths: ['conflict.txt'] } },
    ]);
    expect(harness.refreshes.length).toBe(1);
  });

  it('warns modally before resolving with theirs', async () => {
    const harness = createMockHarness();
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Resolve With Theirs' as never);
    const resource = { descriptor: { path: 'conflict.txt' } } as unknown as FlexVaultResourceState;

    await resolveCommand(harness.ctx, 'theirs', resource);

    expect(harness.resolveCalls).toEqual([
      { strategy: 'theirs', target: { paths: ['conflict.txt'] } },
    ]);
  });

  it('does not resolve all when targeted resource cannot be resolved', async () => {
    const harness = createMockHarness();
    const errorSpy = vi.spyOn(vscode.window, 'showErrorMessage');

    await resolveCommand(harness.ctx, 'mine', {} as unknown as FlexVaultResourceState);

    expect(harness.resolveCalls.length).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith('Unable to determine files to resolve.');
  });
});

describe('loginCommand and logoutCommand', () => {
  it('prompts for username and updates workspaceState', async () => {
    const harness = createMockHarness();
    vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('charlie');

    await loginCommand(harness.ctx);

    expect(harness.loginCalls).toEqual(['charlie']);
    expect(harness.stateStore.get('flexvault.lastUsername')).toBe('charlie');
    expect(harness.refreshes.some((r) => r.skipRemoteUpdate === false)).toBe(true);
  });

  it('runs logout and reports the logged-out username', async () => {
    const harness = createMockHarness();
    const infoSpy = vi.spyOn(vscode.window, 'showInformationMessage');

    await logoutCommand(harness.ctx);

    expect(harness.getLogoutCalls()).toBe(1);
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('bob'));
    expect(harness.refreshes.some((r) => r.skipRemoteUpdate === false)).toBe(true);
  });
});
