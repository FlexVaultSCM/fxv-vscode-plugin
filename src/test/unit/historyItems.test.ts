import { describe, expect, it } from 'vitest';

import type { ChangeInfoPayload, CommitRef, HistoryPayload } from '../../cli/types.generated';
import {
  changeFileName,
  changesFromChangeInfoPayload,
  type CommitElement,
  commitDescription,
  commitLabel,
  commitsFromHistoryPayload,
  commitStatusSuffix,
  commitSyncInfo,
  commitTooltip,
  formatRelativeTime,
} from '../../providers/historyItems';

function commitRef(
  overrides: Partial<Record<keyof CommitRef, CommitRef[keyof CommitRef] | undefined>> = {},
): CommitRef {
  return {
    commit: { branch: 'main', type: 'published', revision: 11 },
    timestamp_millis_since_epoch_utc: Date.now() - 60_000,
    author_id: 'u1',
    author_display_name: 'Ada Lovelace',
    author_details: { type: 'FxvUser', id: 1, username: 'ada', display_name: 'Ada Lovelace' },
    description: 'Fix the thing',
    ...overrides,
  } as CommitRef;
}

describe('commitsFromHistoryPayload', () => {
  it('builds a commit element per entry, spec from the nested commit info', () => {
    const payload: HistoryPayload = {
      entries: [
        commitRef({ commit: { branch: 'main', type: 'published', revision: 11 } }),
        commitRef({ commit: { branch: 'main', type: 'draft', draft_revision: 1 } }),
      ],
    };

    const elements = commitsFromHistoryPayload(payload);

    expect(elements).toHaveLength(2);
    expect(elements[0]!.spec).toBe('main.11');
    expect(elements[1]!.spec).toBe('main.-.1');
    expect(elements[0]!.kind).toBe('commit');
  });

  it('skips an entry whose spec cannot be built rather than throwing', () => {
    const payload: HistoryPayload = {
      entries: [
        // A draft with revision but no draft_revision: specFromCommitInfo refuses it.
        commitRef({ commit: { branch: 'main', type: 'draft', revision: 11 } }),
        commitRef({ commit: { branch: 'main', type: 'published', revision: 5 } }),
      ],
    };

    const elements = commitsFromHistoryPayload(payload);

    expect(elements).toHaveLength(1);
    expect(elements[0]!.spec).toBe('main.5');
  });
});

describe('changesFromChangeInfoPayload', () => {
  it('carries the commit spec onto each change entry', () => {
    const payload: ChangeInfoPayload = {
      commit: { branch: 'main', type: 'published', revision: 11 },
      timestamp_millis_since_epoch_utc: Date.now(),
      author_id: 'u1',
      author_display_name: 'Ada Lovelace',
      author_details: { type: 'FxvUser', id: 1, username: 'ada', display_name: 'Ada Lovelace' },
      summary: { total_changed: 2, added: 1, modified: 0, deleted: 1 },
      changes: [
        { path: 'src/a.txt', action: 'added' },
        { path: 'assets/b.png', action: 'deleted' },
      ],
    };

    const changes = changesFromChangeInfoPayload('main.11', payload);

    expect(changes).toEqual([
      { kind: 'change', commitSpec: 'main.11', path: 'src/a.txt', action: 'added' },
      { kind: 'change', commitSpec: 'main.11', path: 'assets/b.png', action: 'deleted' },
    ]);
  });
});

describe('commitLabel', () => {
  it('uses the description when present', () => {
    expect(commitLabel(commitRef({ description: 'Fix the thing' }))).toBe('Fix the thing');
  });

  it('falls back to a placeholder for a description-less commit', () => {
    expect(commitLabel(commitRef({ description: undefined }))).toBe('(no description)');
  });

  it('falls back for a blank description too', () => {
    expect(commitLabel(commitRef({ description: '   ' }))).toBe('(no description)');
  });
});

describe('commitDescription and commitTooltip', () => {
  it('reads author, relative time, and spec into the description line', () => {
    const element: CommitElement = {
      kind: 'commit',
      commit: commitRef({ timestamp_millis_since_epoch_utc: Date.now() - 60_000 }),
      spec: 'main.11',
    };

    expect(commitDescription(element)).toContain('Ada Lovelace');
    expect(commitDescription(element)).toContain('main.11');
  });

  it('surfaces the author-resolution error in the tooltip for the Error variant', () => {
    const element: CommitElement = {
      kind: 'commit',
      commit: commitRef({ author_details: { type: 'Error', message: 'no such user' } }),
      spec: 'main.11',
    };

    expect(commitTooltip(element)).toContain('no such user');
  });
});

describe('commitSyncInfo and commitStatusSuffix', () => {
  const publishedAt = (revision: number): CommitElement => ({
    kind: 'commit',
    commit: commitRef({ commit: { branch: 'main', type: 'published', revision } }),
    spec: `main.${revision}`,
  });

  const draftOnParent = (revision: number): CommitElement => ({
    kind: 'commit',
    commit: commitRef({
      commit: { branch: 'main', type: 'draft', revision, draft_revision: 3 },
    }),
    spec: `main.${revision}.3`,
  });

  it('marks the published revision matching synced_revision as synced', () => {
    const info = commitSyncInfo(publishedAt(11), 11);
    expect(info).toEqual({ isDraft: false, isSynced: true });
    expect(commitStatusSuffix(info)).toBe(' · Synced');
  });

  it('leaves an older published revision unmarked', () => {
    const info = commitSyncInfo(publishedAt(9), 11);
    expect(info).toEqual({ isDraft: false, isSynced: false });
    expect(commitStatusSuffix(info)).toBe('');
  });

  it('is never synced with no known synced_revision', () => {
    expect(commitSyncInfo(publishedAt(11), undefined).isSynced).toBe(false);
  });

  it('marks a draft as draft, never as synced, even sharing the synced revision as its parent', () => {
    const info = commitSyncInfo(draftOnParent(11), 11);
    expect(info).toEqual({ isDraft: true, isSynced: false });
    expect(commitStatusSuffix(info)).toBe(' · Draft');
  });
});

describe('changeFileName', () => {
  it('takes the last path segment', () => {
    expect(
      changeFileName({
        kind: 'change',
        commitSpec: 'main.11',
        path: 'a/b/c.txt',
        action: 'modified',
      }),
    ).toBe('c.txt');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-09-18T12:00:00Z');

  it('reads under a minute as just now', () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe('just now');
  });

  it('picks the largest whole unit', () => {
    expect(formatRelativeTime(now - 2 * 60 * 60 * 1000, now)).toBe('2 hours ago');
    expect(formatRelativeTime(now - 3 * 24 * 60 * 60 * 1000, now)).toBe('3 days ago');
  });
});
