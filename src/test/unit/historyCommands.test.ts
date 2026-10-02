import * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  historyCopyRevisionCommand,
  historyFilterCommand,
  historyFilterDescription,
  historyGotoRevisionCommand,
  historyOpenChangeCommand,
  historyShowChangesCommand,
} from '../../commands/history';
import type { CommandContext } from '../../commands/types';
import { toFxvUri } from '../../providers/fxvUri';
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

  it('opens a diff against previous revision for a changed file', async () => {
    const element: ChangeElement = {
      kind: 'change',
      commitSpec: 'main.11',
      previousCommitSpec: 'main.10',
      path: 'src/a.txt',
      action: 'modified',
    };

    await historyOpenChangeCommand(ctx, element);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      toFxvUri('src/a.txt', 'main.10'),
      toFxvUri('src/a.txt', 'main.11'),
      'a.txt (main.10 ↔ main.11)',
    );
  });

  it('diffs deleted file against previous revision', async () => {
    const element: ChangeElement = {
      kind: 'change',
      commitSpec: 'main.11',
      previousCommitSpec: 'main.10',
      path: 'assets/removed.png',
      action: 'deleted',
    };

    await historyOpenChangeCommand(ctx, element);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      toFxvUri('assets/removed.png', 'main.10'),
      toFxvUri('assets/removed.png', 'main.11'),
      'removed.png (main.10 ↔ main.11)',
    );
  });

  it('infers previous revision from commitSpec when previousCommitSpec is omitted', async () => {
    const element: ChangeElement = {
      kind: 'change',
      commitSpec: 'main.11',
      path: 'src/a.txt',
      action: 'modified',
    };

    await historyOpenChangeCommand(ctx, element);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      toFxvUri('src/a.txt', 'main.10'),
      toFxvUri('src/a.txt', 'main.11'),
      'a.txt (main.10 ↔ main.11)',
    );
  });

  it('opens the historical content directly when no previous revision exists', async () => {
    const element: ChangeElement = {
      kind: 'change',
      commitSpec: 'main.0',
      path: 'src/initial.txt',
      action: 'added',
    };

    await historyOpenChangeCommand(ctx, element);

    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      toFxvUri('src/initial.txt', 'main.0'),
    );
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'vscode.diff',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('reports a deleted file when no previous revision exists', async () => {
    const element: ChangeElement = {
      kind: 'change',
      commitSpec: 'main.0',
      path: 'src/root-deleted.txt',
      action: 'deleted',
    };

    await historyOpenChangeCommand(ctx, element);

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('root-deleted.txt was deleted in revision main.0'),
    );
  });
});

describe('historyFilterDescription', () => {
  it('returns Drafts for draft filter', () => {
    expect(historyFilterDescription('draft')).toBe('Drafts');
  });

  it('returns Published for published filter', () => {
    expect(historyFilterDescription('published')).toBe('Published');
  });

  it('returns empty string for all filter', () => {
    expect(historyFilterDescription('all')).toBe('');
  });
});

describe('historyFilterCommand', () => {
  let ctx: CommandContext;
  let treeView: { description: string | undefined };
  let historyProvider: {
    getFilter: ReturnType<typeof vi.fn>;
    setFilter: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    treeView = { description: undefined };
    historyProvider = {
      getFilter: vi.fn().mockReturnValue('all'),
      setFilter: vi.fn(),
    };
    ctx = {
      fxv: {} as CommandContext['fxv'],
      statusCache: undefined,
      scmProvider: undefined,
      historyTreeView: treeView as unknown as CommandContext['historyTreeView'],
      historyProvider: historyProvider as unknown as CommandContext['historyProvider'],
      log: undefined,
      context: {} as CommandContext['context'],
      rootUri: vscode.Uri.file('C:/workspace') as unknown as CommandContext['rootUri'],
    };
  });

  it('directly applies valid filter without opening QuickPick', async () => {
    await historyFilterCommand(ctx, 'draft');

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(historyProvider.setFilter).toHaveBeenCalledWith('draft');
    expect(treeView.description).toBe('Drafts');
  });

  it('opens QuickPick when invoked with no target filter and applies selection', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({
      label: 'Published Only',
      filter: 'published',
    } as unknown as vscode.QuickPickItem);

    await historyFilterCommand(ctx);

    expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(1);
    expect(historyProvider.setFilter).toHaveBeenCalledWith('published');
    expect(treeView.description).toBe('Published');
  });

  it('does nothing when QuickPick is cancelled', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined);

    await historyFilterCommand(ctx);

    expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(1);
    expect(historyProvider.setFilter).not.toHaveBeenCalled();
    expect(treeView.description).toBeUndefined();
  });
});
