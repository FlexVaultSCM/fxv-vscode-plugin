import * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FxvCommands } from '../../cli/commands';
import type { StatusPayload } from '../../cli/types.generated';
import { clearCacheCommand, diffAgainstBaseCommand } from '../../commands/diff';
import type { CommandContext } from '../../commands/types';
import type { ContentCache } from '../../providers/contentCache';
import { toFxvUri } from '../../providers/fxvUri';
import { FlexVaultQuickDiffProvider } from '../../scm/quickDiff';
import type { ResourceDescriptor } from '../../scm/resources';
import type { StatusCache } from '../../state/statusCache';

describe('diffAgainstBaseCommand', () => {
  const rootUri = vscode.Uri.file('C:/workspace');

  const status: StatusPayload = {
    current_branch: 'main',
    head_commit: {
      state: 'parented_draft',
      local_snapshot: {
        commit: { branch: 'main', type: 'draft', revision: 10, draft_revision: 2 },
        author_id: 'u1',
        author_display_name: 'User 1',
        author_details: { type: 'Local' },
        timestamp_millis_since_epoch_utc: 1000,
      },
      published_head: {
        commit: { branch: 'main', type: 'published', revision: 10 },
        author_id: 'u1',
        author_display_name: 'User 1',
        author_details: { type: 'Local' },
        timestamp_millis_since_epoch_utc: 1000,
      },
    },
    files: [
      { path: 'modified.txt', workspace_state: 'modified' },
      { path: 'added.txt', workspace_state: 'added' },
      { path: 'deleted.txt', workspace_state: 'deleted' },
    ],
    file_change_counts: { total: 3, unpublished: 0, workspace_need_snapshot: 3 },
  };

  let ctx: CommandContext;
  let contentCache: ContentCache;

  beforeEach(() => {
    vi.clearAllMocks();

    contentCache = {
      clear: vi.fn().mockResolvedValue(undefined),
    } as unknown as ContentCache;

    const statusCache = {
      status,
    } as unknown as StatusCache;

    ctx = {
      fxv: {} as unknown as FxvCommands,
      statusCache,
      scmProvider: undefined,
      contentCache,
      log: undefined,
      context: {} as unknown as vscode.ExtensionContext,
      rootUri,
    };
  });

  it('opens diff against local snapshot for workspace group changes', async () => {
    const execSpy = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    const fileUri = vscode.Uri.joinPath(rootUri, 'modified.txt');
    const descriptor: ResourceDescriptor = {
      path: 'modified.txt',
      group: 'workspace',
      badge: 'M',
      tooltip: 'Modified',
      strikeThrough: false,
      isDeleted: false,
      themeColorId: 'gitDecoration.modifiedResourceForeground',
      file: { path: 'modified.txt', workspace_state: 'modified' },
    };

    await diffAgainstBaseCommand(ctx, fileUri, descriptor);

    const expectedBaseUri = toFxvUri('modified.txt', 'main.10.2');
    expect(execSpy).toHaveBeenCalledWith(
      'vscode.diff',
      expectedBaseUri,
      fileUri,
      'modified.txt (main.10.2 ↔ Working Tree)',
    );
  });

  it('opens diff against published head for unpublished group changes', async () => {
    const execSpy = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    const fileUri = vscode.Uri.joinPath(rootUri, 'modified.txt');
    const descriptor: ResourceDescriptor = {
      path: 'modified.txt',
      group: 'unpublished',
      badge: 'M',
      tooltip: 'Unpublished',
      strikeThrough: false,
      isDeleted: false,
      themeColorId: 'gitDecoration.modifiedResourceForeground',
      file: { path: 'modified.txt', unpublished_state: 'modified' },
    };

    await diffAgainstBaseCommand(ctx, fileUri, descriptor);

    const expectedBaseUri = toFxvUri('modified.txt', 'main.10');
    expect(execSpy).toHaveBeenCalledWith(
      'vscode.diff',
      expectedBaseUri,
      fileUri,
      'modified.txt (main.10 ↔ Working Tree)',
    );
  });

  it('opens newly added file directly if clicked from SCM', async () => {
    // Override head_commit to empty_branch so there is no base revision
    const emptyStatus: StatusPayload = {
      current_branch: 'main',
      head_commit: { state: 'empty_branch', branch: 'main' },
      files: [{ path: 'new.txt', workspace_state: 'added' }],
      file_change_counts: { total: 1, unpublished: 0, workspace_need_snapshot: 1 },
    };
    (ctx.statusCache as { status: StatusPayload }).status = emptyStatus;

    const execSpy = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    const fileUri = vscode.Uri.joinPath(rootUri, 'new.txt');
    const descriptor: ResourceDescriptor = {
      path: 'new.txt',
      group: 'workspace',
      badge: 'A',
      tooltip: 'Added',
      strikeThrough: false,
      isDeleted: false,
      themeColorId: 'gitDecoration.addedResourceForeground',
      changeKind: 'added',
      file: { path: 'new.txt', workspace_state: 'added' },
    };

    await diffAgainstBaseCommand(ctx, fileUri, descriptor);

    expect(execSpy).toHaveBeenCalledWith('vscode.open', fileUri);
  });

  it('shows information message if file is deleted', async () => {
    const infoSpy = vi
      .spyOn(vscode.window, 'showInformationMessage')
      .mockResolvedValue(undefined as never);
    const fileUri = vscode.Uri.joinPath(rootUri, 'deleted.txt');
    const descriptor: ResourceDescriptor = {
      path: 'deleted.txt',
      group: 'workspace',
      badge: 'D',
      tooltip: 'Deleted',
      strikeThrough: true,
      isDeleted: true,
      themeColorId: 'gitDecoration.deletedResourceForeground',
      changeKind: 'deleted',
      file: { path: 'deleted.txt', workspace_state: 'deleted' },
    };

    await diffAgainstBaseCommand(ctx, fileUri, descriptor);

    expect(infoSpy).toHaveBeenCalledWith('Cannot diff deleted file deleted.txt.');
  });
});

describe('clearCacheCommand', () => {
  it('calls clear on content cache and shows notification', async () => {
    const clearMock = vi.fn().mockResolvedValue(undefined);
    const infoSpy = vi
      .spyOn(vscode.window, 'showInformationMessage')
      .mockResolvedValue(undefined as never);

    const ctx: CommandContext = {
      fxv: {} as unknown as FxvCommands,
      statusCache: undefined,
      scmProvider: undefined,
      contentCache: { clear: clearMock } as unknown as ContentCache,
      log: undefined,
      context: {} as unknown as vscode.ExtensionContext,
      rootUri: vscode.Uri.file('/workspace'),
    };

    await clearCacheCommand(ctx);

    expect(clearMock).toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith('FlexVault content cache cleared.');
  });
});

describe('FlexVaultQuickDiffProvider', () => {
  const rootUri = vscode.Uri.file('C:/workspace');

  it('resolves original resource for a file in the workspace', () => {
    const statusCache = {
      status: {
        current_branch: 'main',
        head_commit: {
          state: 'parented_draft',
          local_snapshot: {
            commit: { branch: 'main', type: 'draft', revision: 1, draft_revision: 1 },
            author_id: 'u',
            author_display_name: 'U',
            author_details: { type: 'Local' },
            timestamp_millis_since_epoch_utc: 1000,
          },
          published_head: {
            commit: { branch: 'main', type: 'published', revision: 1 },
            author_id: 'u',
            author_display_name: 'U',
            author_details: { type: 'Local' },
            timestamp_millis_since_epoch_utc: 1000,
          },
        },
        files: [],
        file_change_counts: { total: 0, unpublished: 0, workspace_need_snapshot: 0 },
      } as StatusPayload,
    } as unknown as StatusCache;

    const provider = new FlexVaultQuickDiffProvider(rootUri, statusCache);
    const fileUri = vscode.Uri.joinPath(rootUri, 'src/code.ts');
    const token = new vscode.CancellationTokenSource().token;

    const original = provider.provideOriginalResource(fileUri, token);
    expect(original).toEqual(toFxvUri('src/code.ts', 'main.1'));
  });

  it('returns undefined for non-file schemes or files outside root', () => {
    const provider = new FlexVaultQuickDiffProvider(rootUri, {
      status: undefined,
    } as unknown as StatusCache);
    const outsideUri = vscode.Uri.file('D:/other/file.ts');
    const token = new vscode.CancellationTokenSource().token;

    expect(provider.provideOriginalResource(outsideUri, token)).toBeUndefined();
    expect(
      provider.provideOriginalResource(vscode.Uri.parse('untitled:new.txt'), token),
    ).toBeUndefined();
  });
});
