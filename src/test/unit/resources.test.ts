import { describe, expect, it } from 'vitest';

import type { StatusPayload } from '../../cli/types.generated';
import {
  getChangeKindBadge,
  getChangeKindTooltip,
  getConflictDetail,
  mapStatusToResourceDescriptors,
} from '../../scm/resources';

describe('SCM Resources Mapping', () => {
  it('maps conflicts, unpublished, and workspace groups with fan-out and no deduplication', () => {
    const status: StatusPayload = {
      current_branch: 'main',
      head_commit: {
        state: 'parented_draft',
        local_snapshot: {
          commit: { branch: 'main', type: 'draft', revision: 2 },
          timestamp_millis_since_epoch_utc: 1000,
          author_id: 'user:1',
          author_display_name: 'Alice',
          author_details: { type: 'Local' },
        },
        published_head: {
          commit: { branch: 'main', type: 'published', revision: 1 },
          timestamp_millis_since_epoch_utc: 900,
          author_id: 'user:1',
          author_display_name: 'Alice',
          author_details: { type: 'Local' },
        },
      },
      files: [
        {
          // File with changes on both unpublished and workspace axes
          path: 'both_axes.txt',
          unpublished_state: 'added',
          workspace_state: 'modified',
        },
        {
          // Unpublished only
          path: 'unpub.txt',
          unpublished_state: 'added',
        },
        {
          // Workspace only
          path: 'work.txt',
          workspace_state: 'deleted',
        },
        {
          // Conflicted file with unpublished state
          path: 'conflict.txt',
          unpublished_state: 'modified',
          conflict_state: { kind: 'content' },
        },
      ],
      file_change_counts: {
        total: 4,
        unpublished: 3,
        workspace_need_snapshot: 2,
      },
    };

    const result = mapStatusToResourceDescriptors(status);

    // Conflicts group
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.path).toBe('conflict.txt');
    expect(result.conflicts[0]!.badge).toBe('!');
    expect(result.conflicts[0]!.tooltip).toBe('Conflict: Both sides changed the file content');
    expect(result.conflictCount).toBe(1);

    // Unpublished group
    expect(result.unpublished).toHaveLength(3);
    const unpublishedPaths = result.unpublished.map((r) => r.path);
    expect(unpublishedPaths).toEqual(['both_axes.txt', 'unpub.txt', 'conflict.txt']);

    // Workspace group
    expect(result.workspace).toHaveLength(2);
    const workspacePaths = result.workspace.map((r) => r.path);
    expect(workspacePaths).toEqual(['both_axes.txt', 'work.txt']);

    // Crucial check: both_axes.txt is present in BOTH groups (no deduplication)
    expect(unpublishedPaths).toContain('both_axes.txt');
    expect(workspacePaths).toContain('both_axes.txt');
  });

  it('handles a conflicted path with neither change axis (e.g. directory clash)', () => {
    const status: StatusPayload = {
      current_branch: 'main',
      head_commit: {
        state: 'empty_branch',
        branch: 'main',
      },
      files: [
        {
          path: 'gamma_dir',
          conflict_state: { kind: 'type_change' },
        },
        {
          path: 'gamma_dir/inner.txt',
          unpublished_state: 'added',
        },
      ],
      file_change_counts: {
        total: 2,
        unpublished: 1,
        workspace_need_snapshot: 0,
      },
    };

    const result = mapStatusToResourceDescriptors(status);

    // gamma_dir is in Conflicts
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.path).toBe('gamma_dir');
    expect(result.conflicts[0]!.tooltip).toBe(
      'Conflict: One side has a file where the other has a directory',
    );

    // gamma_dir has no change axis, so it is NOT in Unpublished or Workspace
    expect(result.unpublished.map((r) => r.path)).not.toContain('gamma_dir');
    expect(result.workspace.map((r) => r.path)).not.toContain('gamma_dir');

    // inner.txt is in Unpublished
    expect(result.unpublished.map((r) => r.path)).toContain('gamma_dir/inner.txt');
  });

  it('formats conflict details for all three kinds', () => {
    expect(getConflictDetail({ kind: 'content' })).toBe('Both sides changed the file content');
    expect(getConflictDetail({ kind: 'deleted' })).toBe(
      'One side deleted the path and the other changed it',
    );
    expect(getConflictDetail({ kind: 'type_change' })).toBe(
      'One side has a file where the other has a directory',
    );
  });

  it('maps change kinds to badges and tooltips', () => {
    expect(getChangeKindBadge('added')).toBe('A');
    expect(getChangeKindBadge('modified')).toBe('M');
    expect(getChangeKindBadge('deleted')).toBe('D');
    expect(getChangeKindBadge('maybe_changed')).toBe('M');

    expect(getChangeKindTooltip('added')).toBe('Added');
    expect(getChangeKindTooltip('modified')).toBe('Modified');
    expect(getChangeKindTooltip('deleted')).toBe('Deleted');
    expect(getChangeKindTooltip('maybe_changed')).toBe('May be unchanged');
  });

  it('sets strikeThrough and isDeleted for deleted files', () => {
    const status: StatusPayload = {
      current_branch: 'main',
      head_commit: { state: 'empty_branch', branch: 'main' },
      files: [
        {
          path: 'removed.txt',
          workspace_state: 'deleted',
        },
        {
          path: 'kept.txt',
          workspace_state: 'modified',
        },
      ],
      file_change_counts: { total: 2, unpublished: 0, workspace_need_snapshot: 2 },
    };

    const result = mapStatusToResourceDescriptors(status);
    const removed = result.workspace.find((r) => r.path === 'removed.txt')!;
    const kept = result.workspace.find((r) => r.path === 'kept.txt')!;

    expect(removed.strikeThrough).toBe(true);
    expect(removed.isDeleted).toBe(true);
    expect(kept.strikeThrough).toBe(false);
    expect(kept.isDeleted).toBe(false);
  });
});
