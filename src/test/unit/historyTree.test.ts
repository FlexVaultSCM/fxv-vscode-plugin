import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FxvCommands } from '../../cli/commands';
import type { CommitElement } from '../../providers/historyItems';
import { HistoryTreeProvider } from '../../providers/historyTree';

/** A parented_draft head whose local_snapshot is parented on `revision`. */
function parentedHead(revision: number) {
  return {
    head_commit: {
      state: 'parented_draft' as const,
      local_snapshot: {
        commit: { branch: 'main', type: 'draft' as const, revision, draft_revision: 1 },
        timestamp_millis_since_epoch_utc: Date.now(),
        author_id: 'u1',
        author_display_name: 'Ada',
        author_details: { type: 'Local' as const },
      },
      published_head: {
        commit: { branch: 'main', type: 'published' as const, revision },
        timestamp_millis_since_epoch_utc: Date.now(),
        author_id: 'u1',
        author_display_name: 'Ada',
        author_details: { type: 'Local' as const },
      },
    },
  };
}

describe('HistoryTreeProvider', () => {
  let fxv: {
    history: ReturnType<typeof vi.fn>;
    changeinfo: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
  };
  let provider: HistoryTreeProvider;

  beforeEach(() => {
    fxv = {
      history: vi.fn(),
      changeinfo: vi.fn(),
      status: vi
        .fn()
        .mockResolvedValue({
          ok: true,
          payload: { head_commit: { state: 'empty_branch', branch: 'main' } },
        }),
    };
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
    expect(fxv.status).toHaveBeenCalledWith({ skipRemoteUpdate: true });
    expect(children).toHaveLength(1);
    expect((children[0] as CommitElement).spec).toBe('main.11');
  });

  it("marks the published revision the workspace's current head is parented on as Synced", async () => {
    fxv.status.mockResolvedValue({ ok: true, payload: parentedHead(11) });
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
          },
          {
            commit: { branch: 'main', type: 'published', revision: 9 },
            timestamp_millis_since_epoch_utc: Date.now(),
            author_id: 'u1',
            author_display_name: 'Ada',
            author_details: { type: 'Local' },
          },
        ],
      },
    });

    const [synced, notSynced] = (await provider.getChildren()) as CommitElement[];
    const syncedItem = provider.getTreeItem(synced!);
    const notSyncedItem = provider.getTreeItem(notSynced!);

    expect(syncedItem.description).toContain('Synced');
    expect((syncedItem.iconPath as { id: string }).id).toBe('check');
    expect(notSyncedItem.description).not.toContain('Synced');
    expect((notSyncedItem.iconPath as { id: string }).id).toBe('git-commit');
    expect((notSyncedItem.iconPath as { color?: unknown }).color).toBeUndefined();
  });

  it('marks a draft commit as Draft rather than Synced, even sharing the synced revision as its parent', async () => {
    fxv.status.mockResolvedValue({ ok: true, payload: parentedHead(11) });
    fxv.history.mockResolvedValue({
      ok: true,
      payload: {
        entries: [
          {
            commit: { branch: 'main', type: 'draft', revision: 11, draft_revision: 3 },
            timestamp_millis_since_epoch_utc: Date.now(),
            author_id: 'u1',
            author_display_name: 'Ada',
            author_details: { type: 'Local' },
          },
        ],
      },
    });

    const [draft] = (await provider.getChildren()) as CommitElement[];
    const draftItem = provider.getTreeItem(draft!);

    expect(draftItem.description).toContain('Draft');
    expect(draftItem.description).not.toContain('Synced');
    expect((draftItem.iconPath as { color?: { id: string } }).color?.id).toBe(
      'gitDecoration.modifiedResourceForeground',
    );
  });

  it('moves the Synced badge on the next refresh after goto changes the head, not sync_status', async () => {
    // Regression: sync_status.synced_revision only moves on an actual `fxv
    // sync`, so goto-ing to a draft parented elsewhere must not leave the
    // badge stuck on whatever was last genuinely synced.
    const commits = {
      ok: true,
      payload: {
        entries: [
          {
            commit: { branch: 'main', type: 'published', revision: 9 },
            timestamp_millis_since_epoch_utc: Date.now(),
            author_id: 'u1',
            author_display_name: 'Ada',
            author_details: { type: 'Local' },
          },
          {
            commit: { branch: 'main', type: 'published', revision: 11 },
            timestamp_millis_since_epoch_utc: Date.now(),
            author_id: 'u1',
            author_display_name: 'Ada',
            author_details: { type: 'Local' },
          },
        ],
      },
    };
    fxv.history.mockResolvedValue(commits);
    fxv.status.mockResolvedValue({ ok: true, payload: parentedHead(9) });

    const [at9] = (await provider.getChildren()) as CommitElement[];
    expect(provider.getTreeItem(at9!).description).toContain('Synced');

    // goto main.11.* happened; the CLI runner completed and history refreshed.
    fxv.status.mockResolvedValue({ ok: true, payload: parentedHead(11) });
    const [, at11] = (await provider.getChildren()) as CommitElement[];

    expect(provider.getTreeItem(at9!).description).not.toContain('Synced');
    expect(provider.getTreeItem(at11!).description).toContain('Synced');
  });

  it('leaves the description and icon plain when the status read fails', async () => {
    fxv.status.mockResolvedValue({ ok: false, message: 'boom', exitCode: 1 });
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
          },
        ],
      },
    });

    const [commit] = (await provider.getChildren()) as CommitElement[];
    const item = provider.getTreeItem(commit!);

    expect(item.description).not.toContain('Synced');
    expect((item.iconPath as { color?: unknown }).color).toBeUndefined();
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

  it('gives commit and change items a stable id, so expansion survives a refresh', async () => {
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
          },
        ],
      },
    });
    const [commit] = (await provider.getChildren()) as CommitElement[];
    expect(provider.getTreeItem(commit!).id).toBe('main.11');

    const change = {
      kind: 'change' as const,
      commitSpec: 'main.11',
      path: 'a/b.txt',
      action: 'added' as const,
    };
    expect(provider.getTreeItem(change).id).toBe('main.11::a/b.txt');
  });

  it('dispose tears down the change-data emitter', () => {
    provider.dispose();
    expect(() => provider.refresh()).not.toThrow();
  });
});
