import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import { publishCommand } from '../../commands/publish';
import type { CommandContext } from '../../commands/types';
import type { FxvCommands } from '../../cli/commands';
import type { CommitRef, StatusPayload } from '../../cli/types.generated';
import type { StatusCache } from '../../state/statusCache';
import type { FlexVaultScmProvider } from '../../scm/provider';

function createMockContext(statusOverride?: {
  [K in keyof StatusPayload]?: StatusPayload[K] | undefined;
}): {
  ctx: CommandContext;
  snapshotCalls: (string | undefined)[];
  publishCalls: string[];
  syncCalls: (string | undefined)[];
  refreshes: { skipRemoteUpdate?: boolean }[];
  inputBox: { value: string };
  errors: string[];
  infos: string[];
  warnings: string[];
} {
  const snapshotCalls: (string | undefined)[] = [];
  const publishCalls: string[] = [];
  const syncCalls: (string | undefined)[] = [];
  const refreshes: { skipRemoteUpdate?: boolean }[] = [];
  const errors: string[] = [];
  const infos: string[] = [];
  const warnings: string[] = [];
  const inputBox = { value: '' };

  const defaultStatus: StatusPayload = {
    current_branch: 'main',
    current_user: 'alice',
    head_commit: {
      state: 'parented_draft',
      local_snapshot: {} as unknown as CommitRef,
      published_head: {} as unknown as CommitRef,
    },
    files: [],
    file_change_counts: { total: 0, unpublished: 0, workspace_need_snapshot: 0 },
  };

  if (statusOverride) {
    Object.assign(defaultStatus, statusOverride);
    if ('current_user' in statusOverride && statusOverride.current_user === undefined) {
      delete defaultStatus.current_user;
    }
  }

  const fxv = {
    snapshot: (desc?: string) => {
      snapshotCalls.push(desc);
      return Promise.resolve({ ok: true as const, payload: undefined, text: '' });
    },
    publish: (desc: string) => {
      publishCalls.push(desc);
      return Promise.resolve({ ok: true as const, payload: undefined, text: '' });
    },
    sync: (spec?: string) => {
      syncCalls.push(spec);
      return Promise.resolve({
        ok: true as const,
        payload: {
          target_revision: 'main.10',
          files_updated_count: 1,
          error_count: 0,
          files_updated: [],
        },
        text: '',
      });
    },
  } as unknown as FxvCommands;

  const statusCache = {
    status: defaultStatus,
    refresh: (opts: { skipRemoteUpdate?: boolean }) => {
      refreshes.push(opts);
      return Promise.resolve(defaultStatus);
    },
  } as unknown as StatusCache;

  const scmProvider = {
    inputBox,
  } as unknown as FlexVaultScmProvider;

  // Mock vscode UI methods
  vi.spyOn(vscode.window, 'showErrorMessage').mockImplementation(((msg: string) => {
    errors.push(msg);
    return Promise.resolve(undefined);
  }) as never);
  vi.spyOn(vscode.window, 'showInformationMessage').mockImplementation(((msg: string) => {
    infos.push(msg);
    return Promise.resolve(undefined);
  }) as never);
  vi.spyOn(vscode.window, 'showWarningMessage').mockImplementation(((msg: string) => {
    warnings.push(msg);
    return Promise.resolve('Sync and Continue');
  }) as never);

  const ctx: CommandContext = {
    fxv,
    statusCache,
    scmProvider,
    log: undefined,
    context: {
      workspaceState: {
        get: () => undefined,
        update: () => Promise.resolve(),
      },
    } as unknown as vscode.ExtensionContext,
    rootUri: vscode.Uri.file('/workspace'),
  };

  return {
    ctx,
    snapshotCalls,
    publishCalls,
    syncCalls,
    refreshes,
    inputBox,
    errors,
    infos,
    warnings,
  };
}

describe('publishCommand', () => {
  it('refuses to publish when unresolved conflicts exist', async () => {
    const { ctx, snapshotCalls, errors } = createMockContext({
      files: [
        {
          path: 'foo.txt',
          conflict_state: { kind: 'content' },
        },
      ],
    });

    await publishCommand(ctx);

    expect(snapshotCalls.length).toBe(0);
    expect(errors.some((e) => e.includes('unresolved conflicts'))).toBe(true);
  });

  it('refuses to publish when user is logged out', async () => {
    const { ctx, snapshotCalls, errors } = createMockContext({
      current_user: undefined,
    });

    await publishCommand(ctx);

    expect(snapshotCalls.length).toBe(0);
    expect(errors.some((e) => e.includes('No user is logged in'))).toBe(true);
  });

  it('prompts for description when input box is empty, and cancels if input box was dismissed', async () => {
    const { ctx, snapshotCalls } = createMockContext();
    vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue(undefined);

    await publishCommand(ctx);

    expect(snapshotCalls.length).toBe(0);
  });

  it('executes full happy path: uses SCM input box, snapshots, publishes, and clears input box', async () => {
    const { ctx, snapshotCalls, publishCalls, inputBox, infos, refreshes } = createMockContext();
    inputBox.value = 'Fix player movement speed';

    await publishCommand(ctx);

    expect(snapshotCalls).toEqual(['Fix player movement speed']);
    expect(publishCalls).toEqual(['Fix player movement speed']);
    expect(inputBox.value).toBe('');
    expect(infos.some((i) => i.includes('Successfully published'))).toBe(true);
    expect(refreshes.some((r) => r.skipRemoteUpdate === false)).toBe(true);
  });

  it('stops if snapshot fails, preserving nothing published', async () => {
    const { ctx, publishCalls, errors } = createMockContext();
    ctx.scmProvider!.inputBox.value = 'My commit';

    vi.spyOn(ctx.fxv, 'snapshot').mockResolvedValue({
      ok: false,
      failure: 'error-envelope',
      message: 'Disk full',
      exitCode: 1,
      exitClass: 'general',
      raw: 'Disk full',
    });

    await publishCommand(ctx);

    expect(publishCalls.length).toBe(0);
    expect(errors.some((e) => e.includes('Snapshot failed: Disk full'))).toBe(true);
  });

  it('handles behind-remote: prompts to sync, syncs, then completes publish', async () => {
    const { ctx, snapshotCalls, syncCalls, publishCalls } = createMockContext({
      sync_status: {
        up_to_date: false,
        revisions_behind: 2,
        published_head_revision: 5,
        synced_revision: 3,
      },
    });
    ctx.scmProvider!.inputBox.value = 'New feature';

    await publishCommand(ctx);

    expect(snapshotCalls).toEqual(['New feature']);
    expect(syncCalls.length).toBe(1);
    expect(publishCalls).toEqual(['New feature']);
  });

  it('handles behind-remote cancellation: cancels publish and notes draft preservation', async () => {
    const { ctx, snapshotCalls, syncCalls, publishCalls, infos } = createMockContext({
      sync_status: {
        up_to_date: false,
        revisions_behind: 2,
        published_head_revision: 5,
        synced_revision: 3,
      },
    });
    ctx.scmProvider!.inputBox.value = 'New feature';

    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Cancel' as never);

    await publishCommand(ctx);

    expect(snapshotCalls).toEqual(['New feature']);
    expect(syncCalls.length).toBe(0);
    expect(publishCalls.length).toBe(0);
    expect(infos.some((i) => i.includes('unpublished draft'))).toBe(true);
  });

  it('aborts publish if sync produces conflicts, routing to Conflicts group', async () => {
    const { ctx, snapshotCalls, publishCalls, errors } = createMockContext({
      sync_status: {
        up_to_date: false,
        revisions_behind: 1,
        published_head_revision: 2,
        synced_revision: 1,
      },
    });
    ctx.scmProvider!.inputBox.value = 'Feature with conflicts';

    vi.spyOn(ctx.fxv, 'sync').mockResolvedValue({
      ok: true,
      payload: {
        target_revision: 'main.2',
        files_updated_count: 1,
        error_count: 0,
        files_updated: [],
        conflicted_files: ['player.ts'],
      },
      text: '',
    });

    await publishCommand(ctx);

    expect(snapshotCalls.length).toBe(1);
    expect(publishCalls.length).toBe(0);
    expect(errors.some((e) => e.includes('Sync produced 1 conflict'))).toBe(true);
  });
});
