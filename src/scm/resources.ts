import type { ChangeKind, ConflictState, FileStatus, StatusPayload } from '../cli/types.generated';

export type ResourceGroupType = 'conflicts' | 'unpublished' | 'workspace';

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
  readonly unpublished: ResourceDescriptor[];
  readonly workspace: ResourceDescriptor[];
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
    case 'maybe_changed':
      return 'Modified';
    case 'deleted':
      return 'Deleted';
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
 * Maps a StatusPayload to Conflicts, Unpublished, and Workspace resource groups.
 * Fan-out across axes without deduplication.
 * Runs in unit tests without the VS Code runtime.
 */
export function mapStatusToResourceDescriptors(status: StatusPayload): ResourceGroupsDescriptor {
  const conflicts: ResourceDescriptor[] = [];
  const unpublished: ResourceDescriptor[] = [];
  const workspace: ResourceDescriptor[] = [];

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

    if (file.unpublished_state) {
      const isDeleted = file.unpublished_state === 'deleted';
      unpublished.push({
        path: file.path,
        group: 'unpublished',
        badge: getChangeKindBadge(file.unpublished_state),
        tooltip: `Unpublished: ${getChangeKindTooltip(file.unpublished_state)}`,
        strikeThrough: isDeleted,
        isDeleted,
        themeColorId: getChangeKindThemeColorId(file.unpublished_state),
        changeKind: file.unpublished_state,
        file,
      });
    }

    if (file.workspace_state) {
      const isDeleted = file.workspace_state === 'deleted';
      workspace.push({
        path: file.path,
        group: 'workspace',
        badge: getChangeKindBadge(file.workspace_state),
        tooltip: `Pending Snapshot: ${getChangeKindTooltip(file.workspace_state)}`,
        strikeThrough: isDeleted,
        isDeleted,
        themeColorId: getChangeKindThemeColorId(file.workspace_state),
        changeKind: file.workspace_state,
        file,
      });
    }
  }

  return {
    conflicts,
    unpublished,
    workspace,
    conflictCount,
  };
}
