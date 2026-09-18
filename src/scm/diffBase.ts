import { specFromCommitInfo } from '../cli/revision';
import type { CommitRef, FileStatus, HeadCommit, StatusPayload } from '../cli/types.generated';
import type { ResourceGroupType } from './resources';

export function getLocalSnapshot(head: HeadCommit | undefined): CommitRef | undefined {
  if (!head || head.state === 'empty_branch') {
    return undefined;
  }
  return head.local_snapshot;
}

function getPublishedHead(head: HeadCommit | undefined): CommitRef | undefined {
  if (!head || head.state !== 'parented_draft') {
    return undefined;
  }
  return head.published_head;
}

function specFromCommitRef(commitRef: CommitRef | undefined): string | undefined {
  return commitRef ? specFromCommitInfo(commitRef.commit) : undefined;
}

function resolvePublishedThenLocal(head: HeadCommit | undefined): string | undefined {
  return specFromCommitRef(getPublishedHead(head) ?? getLocalSnapshot(head));
}

function resolveLocalThenPublished(head: HeadCommit | undefined): string | undefined {
  return specFromCommitRef(getLocalSnapshot(head) ?? getPublishedHead(head));
}

/**
 * Resolves the base revision spec to diff a file against, according to its axis (PLAN.md 5.3):
 * - Workspace axis (pending snapshot): diff against local snapshot first, falling back to published head.
 * - Unpublished axis: diff against published head first, falling back to local snapshot (unparented draft or new branch).
 * - Conflicts: prefer published head, falling back to local snapshot.
 * - General/unspecified: infer axis from file status or default to published head -> local snapshot.
 */
export function resolveDiffBaseRevision(options: {
  readonly file?: FileStatus | undefined;
  readonly group?: ResourceGroupType | undefined;
  readonly status?: StatusPayload | undefined;
}): string | undefined {
  const { file, group, status } = options;
  if (!status || !status.head_commit) {
    return undefined;
  }

  // 1. Explicit group known
  if (group === 'workspace') {
    return resolveLocalThenPublished(status.head_commit);
  }

  if (group === 'unpublished' || group === 'conflicts') {
    return resolvePublishedThenLocal(status.head_commit);
  }

  // 2. Infer from file status if group was not explicitly provided (e.g. from editor title diff)
  if (file?.workspace_state) {
    return resolveLocalThenPublished(status.head_commit);
  }

  if (file?.unpublished_state) {
    return resolvePublishedThenLocal(status.head_commit);
  }

  // 3. Fallback: published head first, then local snapshot
  return resolvePublishedThenLocal(status.head_commit);
}

/**
 * Resolves the base revision spec for Quick Diff gutter indicators (PLAN.md 5.2, 6.2).
 * Resolves to published base (head_commit.published_head), falling back to local snapshot
 * on unparented drafts or empty branches.
 */
export function resolveQuickDiffBaseRevision(
  status: StatusPayload | undefined,
): string | undefined {
  if (!status || !status.head_commit) {
    return undefined;
  }

  return resolvePublishedThenLocal(status.head_commit);
}
