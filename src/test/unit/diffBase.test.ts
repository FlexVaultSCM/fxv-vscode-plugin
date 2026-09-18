import { describe, expect, it } from 'vitest';

import type { CommitRef, StatusPayload } from '../../cli/types.generated';
import { resolveDiffBaseRevision, resolveQuickDiffBaseRevision } from '../../scm/diffBase';

function createMockCommit(
  branch: string,
  type: 'published' | 'draft',
  revision?: number,
  draftRevision?: number,
): CommitRef {
  return {
    commit: {
      branch,
      type,
      ...(revision !== undefined ? { revision } : {}),
      ...(draftRevision !== undefined ? { draft_revision: draftRevision } : {}),
    },
    author_id: 'test-user',
    author_display_name: 'Test User',
    author_details: { type: 'Local' },
    timestamp_millis_since_epoch_utc: 1700000000,
  };
}

describe('diffBase resolution', () => {
  const publishedHead = createMockCommit('main', 'published', 10);
  const localSnapshot = createMockCommit('main', 'draft', 10, 5);

  const parentedStatus: StatusPayload = {
    current_branch: 'main',
    head_commit: {
      state: 'parented_draft',
      local_snapshot: localSnapshot,
      published_head: publishedHead,
    },
    files: [],
    file_change_counts: { total: 0, unpublished: 0, workspace_need_snapshot: 0 },
  };

  const unparentedSnapshot = createMockCommit('feature', 'draft', undefined, 2);
  const unparentedStatus: StatusPayload = {
    current_branch: 'feature',
    head_commit: {
      state: 'unparented_draft',
      local_snapshot: unparentedSnapshot,
    },
    files: [],
    file_change_counts: { total: 0, unpublished: 0, workspace_need_snapshot: 0 },
  };

  const emptyStatus: StatusPayload = {
    current_branch: 'main',
    head_commit: {
      state: 'empty_branch',
      branch: 'main',
    },
    files: [],
    file_change_counts: { total: 0, unpublished: 0, workspace_need_snapshot: 0 },
  };

  describe('resolveDiffBaseRevision', () => {
    it('resolves workspace group to local snapshot first', () => {
      const spec = resolveDiffBaseRevision({
        group: 'workspace',
        status: parentedStatus,
      });
      expect(spec).toBe('main.10.5');
    });

    it('resolves unpublished group to published head first', () => {
      const spec = resolveDiffBaseRevision({
        group: 'unpublished',
        status: parentedStatus,
      });
      expect(spec).toBe('main.10');
    });

    it('resolves conflicts group to published head first', () => {
      const spec = resolveDiffBaseRevision({
        group: 'conflicts',
        status: parentedStatus,
      });
      expect(spec).toBe('main.10');
    });

    it('falls back to local snapshot when unparented draft has no published head', () => {
      const spec = resolveDiffBaseRevision({
        group: 'unpublished',
        status: unparentedStatus,
      });
      expect(spec).toBe('feature.-.2');
    });

    it('returns undefined on empty branch', () => {
      const spec = resolveDiffBaseRevision({
        group: 'workspace',
        status: emptyStatus,
      });
      expect(spec).toBeUndefined();
    });

    it('infers axis from file status when group is not specified', () => {
      const specWorkspace = resolveDiffBaseRevision({
        file: { path: 'file.txt', workspace_state: 'modified' },
        status: parentedStatus,
      });
      expect(specWorkspace).toBe('main.10.5');

      const specUnpublished = resolveDiffBaseRevision({
        file: { path: 'file.txt', unpublished_state: 'modified' },
        status: parentedStatus,
      });
      expect(specUnpublished).toBe('main.10');
    });
  });

  describe('resolveQuickDiffBaseRevision', () => {
    it('resolves to published head on parented draft', () => {
      expect(resolveQuickDiffBaseRevision(parentedStatus)).toBe('main.10');
    });

    it('falls back to local snapshot on unparented draft', () => {
      expect(resolveQuickDiffBaseRevision(unparentedStatus)).toBe('feature.-.2');
    });

    it('returns undefined on empty branch', () => {
      expect(resolveQuickDiffBaseRevision(emptyStatus)).toBeUndefined();
    });

    it('returns undefined when status is undefined', () => {
      expect(resolveQuickDiffBaseRevision(undefined)).toBeUndefined();
    });
  });
});
