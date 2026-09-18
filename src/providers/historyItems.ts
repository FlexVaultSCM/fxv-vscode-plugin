import { specFromCommitInfo } from '../cli/revision';
import type {
  ChangeKind,
  CommitRef,
  HistoryPayload,
  ChangeInfoPayload,
} from '../cli/types.generated';

/**
 * Pure data shaping for the history TreeView. Kept free of the `vscode` API
 * so it can be unit tested without the extension host; the TreeDataProvider
 * in historyTree.ts turns these into TreeItems.
 */

export interface CommitElement {
  readonly kind: 'commit';
  readonly commit: CommitRef;
  /** Branch-qualified revision spec, e.g. main.11 or main.-.1. */
  readonly spec: string;
}

export interface ChangeElement {
  readonly kind: 'change';
  readonly commitSpec: string;
  readonly path: string;
  readonly action: ChangeKind;
}

export type HistoryTreeElement = CommitElement | ChangeElement;

export function commitsFromHistoryPayload(payload: HistoryPayload): CommitElement[] {
  const elements: CommitElement[] = [];
  for (const commit of payload.entries) {
    try {
      elements.push({ kind: 'commit', commit, spec: specFromCommitInfo(commit.commit) });
    } catch {
      // A commit whose spec cannot be built (malformed draft ref) is skipped
      // rather than breaking the whole history view.
    }
  }
  return elements;
}

export function changesFromChangeInfoPayload(
  commitSpec: string,
  payload: ChangeInfoPayload,
): ChangeElement[] {
  return payload.changes.map((change) => ({
    kind: 'change',
    commitSpec,
    path: change.path,
    action: change.action,
  }));
}

export function commitLabel(commit: CommitRef): string {
  const description = commit.description?.trim();
  return description && description.length > 0 ? description : '(no description)';
}

export function commitDescription(element: CommitElement): string {
  return `${element.commit.author_display_name} · ${formatRelativeTime(element.commit.timestamp_millis_since_epoch_utc)} · ${element.spec}`;
}

export interface CommitSyncInfo {
  /** A snapshot not yet published, as opposed to a published revision. */
  readonly isDraft: boolean;
  /** The published revision the workspace is currently synced to. */
  readonly isSynced: boolean;
}

/**
 * Classifies a commit against the workspace's `sync_status.synced_revision`.
 * A draft is never "synced": that field names a published revision, and a
 * draft's own `revision` is the published parent it sits on, not itself.
 */
export function commitSyncInfo(
  element: CommitElement,
  syncedRevision: number | undefined,
): CommitSyncInfo {
  const isDraft = element.commit.commit.type === 'draft';
  const isSynced =
    !isDraft && syncedRevision !== undefined && element.commit.commit.revision === syncedRevision;
  return { isDraft, isSynced };
}

export function commitStatusSuffix(info: CommitSyncInfo): string {
  if (info.isSynced) {
    return ' · Synced';
  }
  if (info.isDraft) {
    return ' · Draft';
  }
  return '';
}

export function commitTooltip(element: CommitElement): string {
  const { commit } = element;
  const lines = [
    commitLabel(commit),
    `Revision: ${element.spec}`,
    `Author: ${commit.author_display_name}`,
    `Date: ${new Date(commit.timestamp_millis_since_epoch_utc).toLocaleString()}`,
  ];
  if (commit.author_details.type === 'Error') {
    lines.push(`Author resolution error: ${commit.author_details.message}`);
  }
  return lines.join('\n');
}

export function changeFileName(element: ChangeElement): string {
  const parts = element.path.split('/');
  return parts[parts.length - 1] || element.path;
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 1000 * 60 * 60 * 24 * 365],
  ['month', 1000 * 60 * 60 * 24 * 30],
  ['day', 1000 * 60 * 60 * 24],
  ['hour', 1000 * 60 * 60],
  ['minute', 1000 * 60],
];

/** Relative-time phrasing (e.g. "3 days ago"), falling back to "just now" under a minute. */
export function formatRelativeTime(epochMillis: number, now: number = Date.now()): string {
  const diff = now - epochMillis;
  for (const [unit, ms] of RELATIVE_UNITS) {
    const value = Math.floor(diff / ms);
    if (value >= 1) {
      const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
      return rtf.format(-value, unit);
    }
  }
  return 'just now';
}
