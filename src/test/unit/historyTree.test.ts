import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FxvCommands } from '../../cli/commands';
import type { CommitElement } from '../../providers/historyItems';
import { HistoryTreeProvider } from '../../providers/historyTree';

describe('HistoryTreeProvider', () => {
  let fxv: { history: ReturnType<typeof vi.fn>; changeinfo: ReturnType<typeof vi.fn> };
  let provider: HistoryTreeProvider;

  beforeEach(() => {
    fxv = { history: vi.fn(), changeinfo: vi.fn() };
    provider = new HistoryTreeProvider(fxv as unknown as FxvCommands, () => 50);
  });

  it('loads root commits from history, honoring the configured limit', async () => {
    fxv.history.mockResolvedValue({
      ok: true,
      payload: {
        entries: [
          {
            commit: { branch: 'main', type: 'published', revision: 11 },
            timestamp_millis_since_epoch_utc: Date.now(),
            author_id: 'u1',
            author_display_name: 'Ada',
            author_details: { type: 'Local' },
            description: 'Fix the thing',
          },
        ],
      },
    });

    const children = await provider.getChildren();

    expect(fxv.history).toHaveBeenCalledWith({ count: 50 });
    expect(children).toHaveLength(1);
    expect((children[0] as CommitElement).spec).toBe('main.11');
  });

  it('returns no commits when history fails, rather than throwing', async () => {
    fxv.history.mockResolvedValue({ ok: false, message: 'boom', exitCode: 1 });

    const children = await provider.getChildren();

    expect(children).toEqual([]);
  });

  it('loads a commit node children from changeinfo', async () => {
    const commit: CommitElement = {
      kind: 'commit',
      commit: {
        commit: { branch: 'main', type: 'published', revision: 11 },
        timestamp_millis_since_epoch_utc: Date.now(),
        author_id: 'u1',
        author_display_name: 'Ada',
        author_details: { type: 'Local' },
      },
      spec: 'main.11',
    };
    fxv.changeinfo.mockResolvedValue({
      ok: true,
      payload: {
        commit: commit.commit.commit,
        timestamp_millis_since_epoch_utc: Date.now(),
        author_id: 'u1',
        author_display_name: 'Ada',
        author_details: { type: 'Local' },
        summary: { total_changed: 1, added: 1, modified: 0, deleted: 0 },
        changes: [{ path: 'src/a.txt', action: 'added' }],
      },
    });

    const children = await provider.getChildren(commit);

    expect(fxv.changeinfo).toHaveBeenCalledWith('main.11');
    expect(children).toEqual([
      { kind: 'change', commitSpec: 'main.11', path: 'src/a.txt', action: 'added' },
    ]);
  });

  it('a change leaf has no children', async () => {
    const change = {
      kind: 'change' as const,
      commitSpec: 'main.11',
      path: 'a.txt',
      action: 'added' as const,
    };
    expect(await provider.getChildren(change)).toEqual([]);
  });

  it('getTreeItem builds an expandable item for a commit with a diff-opening command on a change', () => {
    const commit: CommitElement = {
      kind: 'commit',
      commit: {
        commit: { branch: 'main', type: 'published', revision: 11 },
        timestamp_millis_since_epoch_utc: Date.now(),
        author_id: 'u1',
        author_display_name: 'Ada',
        author_details: { type: 'Local' },
        description: 'Fix the thing',
      },
      spec: 'main.11',
    };
    const commitItem = provider.getTreeItem(commit);
    expect(commitItem.label).toBe('Fix the thing');
    expect(commitItem.contextValue).toBe('flexvaultHistoryCommit');

    const change = {
      kind: 'change' as const,
      commitSpec: 'main.11',
      path: 'src/a.txt',
      action: 'added' as const,
    };
    const changeItem = provider.getTreeItem(change);
    expect(changeItem.label).toBe('a.txt');
    expect((changeItem.command as { command: string }).command).toBe('flexvault.historyOpenChange');
  });

  it('getParent resolves a change leaf back to its owning commit, needed for TreeView.reveal', async () => {
    fxv.history.mockResolvedValue({
      ok: true,
      payload: {
        entries: [
          {
            commit: { branch: 'main', type: 'published', revision: 11 },
            timestamp_millis_since_epoch_utc: Date.now(),
            author_id: 'u1',
            author_display_name: 'Ada',
            author_details: { type: 'Local' },
            description: 'Fix the thing',
          },
        ],
      },
    });
    const [commit] = await provider.getChildren();

    expect(provider.getParent(commit as CommitElement)).toBeUndefined();

    const change = {
      kind: 'change' as const,
      commitSpec: 'main.11',
      path: 'a.txt',
      action: 'added' as const,
    };
    expect(provider.getParent(change)).toBe(commit);
  });

  it('refresh fires onDidChangeTreeData', () => {
    const listener = vi.fn();
    provider.onDidChangeTreeData(listener);
    provider.refresh();
    expect(listener).toHaveBeenCalledWith(undefined);
  });
});
