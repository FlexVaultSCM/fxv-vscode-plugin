import type { ChangeKind, ConflictState, FileStatus, StatusPayload } from '../cli/types.generated';

export type ResourceGroupType = 'conflicts' | 'changes';

export type ThemeColorId =
  | 'gitDecoration.addedResourceForeground'
  | 'gitDecoration.modifiedResourceForeground'
  | 'gitDecoration.deletedResourceForeground'
  | 'gitDecoration.conflictingResourceForeground';

export interface ResourceDescriptor {
  readonly path: string;
  readonly group: ResourceGroupType;
  readonly badge: string;
  readonly tooltip: string;
  readonly strikeThrough: boolean;
  readonly isDeleted: boolean;
  readonly themeColorId: ThemeColorId;
  readonly conflictDetail?: string | undefined;
  readonly changeKind?: ChangeKind | undefined;
  readonly file: FileStatus;
}

export interface ResourceGroupsDescriptor {
  readonly conflicts: ResourceDescriptor[];
  readonly changes: ResourceDescriptor[];
  readonly conflictCount: number;
}

/**
 * Returns human-readable conflict explanation based on conflict_state.kind.
 */
export function getConflictDetail(conflict: ConflictState): string {
  switch (conflict.kind) {
    case 'content':
      return 'Both sides changed the file content';
    case 'deleted':
      return 'One side deleted the path and the other changed it';
    case 'type_change':
      return 'One side has a file where the other has a directory';
    default:
      return 'In conflict';
  }
}

export function getChangeKindBadge(kind: ChangeKind): string {
  switch (kind) {
    case 'added':
      return 'A';
    case 'modified':
    case 'maybe_changed':
      return 'M';
    case 'deleted':
      return 'D';
  }
}

export function getChangeKindTooltip(kind: ChangeKind): string {
  switch (kind) {
    case 'added':
      return 'Added';
    case 'modified':
      return 'Modified';
    case 'deleted':
      return 'Deleted';
    case 'maybe_changed':
      return 'May be unchanged';
  }
}

export function getChangeKindThemeColorId(kind: ChangeKind): ThemeColorId {
  switch (kind) {
    case 'added':
      return 'gitDecoration.addedResourceForeground';
    case 'modified':
    case 'maybe_changed':
      return 'gitDecoration.modifiedResourceForeground';
    case 'deleted':
      return 'gitDecoration.deletedResourceForeground';
  }
}

export const CONFLICT_THEME_COLOR_ID: ThemeColorId = 'gitDecoration.conflictingResourceForeground';

/**
 * Maps a StatusPayload to Conflicts and a single unified Changes resource group.
 * Runs in unit tests without the VS Code runtime.
 */
export function mapStatusToResourceDescriptors(status: StatusPayload): ResourceGroupsDescriptor {
  const conflicts: ResourceDescriptor[] = [];
  const changes: ResourceDescriptor[] = [];

  let conflictCount = 0;

  for (const file of status.files) {
    if (file.conflict_state) {
      conflictCount += 1;
      const detail = getConflictDetail(file.conflict_state);
      const isDeleted = file.workspace_state === 'deleted' || file.unpublished_state === 'deleted';
      conflicts.push({
        path: file.path,
        group: 'conflicts',
        badge: '!',
        tooltip: `Conflict: ${detail}`,
        strikeThrough: isDeleted,
        isDeleted,
        themeColorId: CONFLICT_THEME_COLOR_ID,
        conflictDetail: detail,
        changeKind: file.workspace_state ?? file.unpublished_state,
        file,
      });
    }

    // Collapse workspace and unpublished into a single Changes entry per file,
    // prioritizing workspace_state since it represents latest disk modifications.
    const effectiveChange = file.workspace_state ?? file.unpublished_state;
    if (effectiveChange) {
      const isDeleted = effectiveChange === 'deleted';
      changes.push({
        path: file.path,
        group: 'changes',
        badge: getChangeKindBadge(effectiveChange),
        tooltip: getChangeKindTooltip(effectiveChange),
        strikeThrough: isDeleted,
        isDeleted,
        themeColorId: getChangeKindThemeColorId(effectiveChange),
        changeKind: effectiveChange,
        file,
      });
    }
  }

  return {
    conflicts,
    changes,
    conflictCount,
  };
}
