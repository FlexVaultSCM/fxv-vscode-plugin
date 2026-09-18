import * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  historyCopyRevisionCommand,
  historyGotoRevisionCommand,
  historyOpenChangeCommand,
  historyShowChangesCommand,
} from '../../commands/history';
import type { CommandContext } from '../../commands/types';
import type { ChangeElement, CommitElement } from '../../providers/historyItems';

describe('history per-entry commands', () => {
  const commit: CommitElement = {
    kind: 'commit',
    commit: {
      commit: { branch: 'main', type: 'published', revision: 11 },
      timestamp_millis_since_epoch_utc: Date.now(),
      author_id: 'u1',
      author_display_name: 'Ada Lovelace',
      author_details: { type: 'FxvUser', id: 1, username: 'ada', display_name: 'Ada Lovelace' },
    },
    spec: 'main.11',
  };

  let ctx: CommandContext;
  let treeView: { reveal: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    treeView = { reveal: vi.fn().mockResolvedValue(undefined) };
    ctx = {
      fxv: {} as CommandContext['fxv'],
      statusCache: undefined,
      scmProvider: undefined,
      historyTreeView: treeView as unknown as CommandContext['historyTreeView'],
      log: undefined,
      context: {} as CommandContext['context'],
      rootUri: vscode.Uri.file('C:/workspace') as unknown as CommandContext['rootUri'],
    };
  });

  it('historyShowChanges reveals and expands the commit node', async () => {
    await historyShowChangesCommand(ctx, commit);
    expect(treeView.reveal).toHaveBeenCalledWith(commit, {
      expand: true,
      focus: true,
      select: true,
    });
  });

  it('historyGotoRevision delegates to flexvault.goto with the spec', async () => {
    await historyGotoRevisionCommand(ctx, commit);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('flexvault.goto', 'main.11');
  });

  it('historyCopyRevision writes the spec to the clipboard', async () => {
    await historyCopyRevisionCommand(ctx, commit);
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('main.11');
  });
});

describe('historyOpenChangeCommand', () => {
  let ctx: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = {
      fxv: {} as CommandContext['fxv'],
      statusCache: undefined,
      scmProvider: undefined,
      log: undefined,
      context: {} as CommandContext['context'],
      rootUri: vscode.Uri.file('C:/workspace') as unknown as CommandContext['rootUri'],
    };
  });

  it('reports a deleted file rather than diffing it', async () => {
    const element: ChangeElement = {
      kind: 'change',
      commitSpec: 'main.11',
      path: 'assets/removed.png',
      action: 'deleted',
    };

    await historyOpenChangeCommand(ctx, element);

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('removed.png'),
    );
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'vscode.diff',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('opens a diff against the working tree when the local file exists', async () => {
    const element: ChangeElement = {
      kind: 'change',
      commitSpec: 'main.11',
      path: 'src/a.txt',
      action: 'modified',
    };

    (vscode.workspace.fs.stat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});

    await historyOpenChangeCommand(ctx, element);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      expect.anything(),
      expect.anything(),
      expect.stringContaining('main.11'),
    );
  });

  it('opens the historical content read-only when the local file no longer exists', async () => {
    const element: ChangeElement = {
      kind: 'change',
      commitSpec: 'main.11',
      path: 'src/gone.txt',
      action: 'modified',
    };

    (vscode.workspace.fs.stat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('ENOENT'),
    );

    await historyOpenChangeCommand(ctx, element);

    expect(vscode.window.showTextDocument).toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'vscode.diff',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});
