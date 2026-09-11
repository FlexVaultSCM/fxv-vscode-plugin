/* eslint-disable */
/**
 * Generated from the fxv-api-rs schemas by scripts/generate-types.mjs.
 * Do not edit by hand: run `npm run types:generate` and commit the result.
 */

export type HeadCommit =
  | {
      state: 'empty_branch';
      branch: string;
    }
  | {
      state: 'unparented_draft';
      local_snapshot: CommitRef;
    }
  | {
      state: 'parented_draft';
      local_snapshot: CommitRef;
      published_head: CommitRef;
    };
/**
 * A commit reference on its own: the commitRefFields, with nothing else permitted. Use this wherever a commit reference is a whole value (a history entry, status's head commits, a created revision).
 */
export type CommitRef = CommitRefFields;
/**
 * Resolved author info, serialized as an internally-tagged enum keyed by "type".
 */
export type AuthorDetails =
  | {
      type: 'Local';
    }
  | {
      type: 'Service';
    }
  | {
      type: 'FxvUser';
      id: number;
      username: string;
      display_name: string;
    }
  | {
      type: 'GitUser';
      name: string;
      email: string;
    }
  | {
      type: 'P4User';
      username: string;
      email: string;
      display_name: string;
    }
  | {
      type: 'Error';
      message: string;
    };
/**
 * Source-specific import provenance, present only for imported commits.
 */
export type ImportInfo =
  | {
      type: 'Git';
      commit_hash: string;
      repo_id?: string | null;
    }
  | {
      type: 'Perforce';
      changelist: number;
      user_name: string;
      client_workspace: string;
      depot_path: string;
      stream?: string | null;
    };
/**
 * The kind of change to a file. 'maybe_changed' only arises on a workspace-axis change.
 */
export type ChangeKind = 'added' | 'modified' | 'deleted' | 'maybe_changed';
/**
 * The kind of change to a file. 'maybe_changed' only arises on a workspace-axis change.
 */
export type ChangeKind1 = 'added' | 'modified' | 'deleted' | 'maybe_changed';
/**
 * Payload schema for the changeinfo command's JSON output: a commit reference (flattened into the payload) plus the change summary and file list.
 */
export type ChangeInfoPayload = CommitRefFields & {
  summary: {
    total_changed: number;
    added: number;
    modified: number;
    deleted: number;
  };
  changes: {
    /**
     * Workspace-relative path with '/' separators.
     */
    path: string;
    action: ChangeKind2;
    /**
     * File size in bytes, if available.
     */
    size?: number | null;
    /**
     * Previous content/tree address before change.
     */
    old_hash?: string | null;
    /**
     * New content/tree address after change.
     */
    new_hash?: string | null;
  }[];
};
/**
 * The kind of change to a file. 'maybe_changed' only arises on a workspace-axis change.
 */
export type ChangeKind2 = 'added' | 'modified' | 'deleted' | 'maybe_changed';
/**
 * Describes a sync/goto/revert/resolve that was interrupted before it finished, leaving the workspace in an inconsistent state. Only ever a detail payload, riding in an error envelope's `error_data` (with `kind` of `interrupted-sync`, alongside exit code 98) when a command refuses to run because of it. `fxv resume` recovers rather than reports, so asking what state a workspace is in is `fxv status`'s job.
 */
export type InterruptedSyncPayload =
  | {
      state: 'recoverable';
      /**
       * The command that was interrupted.
       */
      operation: 'sync' | 'goto' | 'revert' | 'resolve' | 'rollback';
      /**
       * A ready-to-display sentence describing what the run was doing, phrased per operation, e.g. "Was syncing from main.11 to main.12."
       */
      summary: string;
      /**
       * Revision spec the interrupted run was moving to, and where a continue finishes.
       */
      target_revision: string;
      /**
       * Revision spec the workspace is still recorded as synced to, and where a rollback returns to. Absent when the interrupted run was a checkout into a workspace that had never synced.
       */
      source_revision?: string;
      /**
       * File changes in the interrupted run's plan.
       */
      total_entries: number;
      completed_entries: number;
      /**
       * Entries whose locally-modified file was moved aside rather than overwritten.
       */
      preserved_entries: number;
      failed_entries: number;
      /**
       * Entries that never reached a terminal state, and which a continue re-drives.
       */
      remaining_entries: number;
      /**
       * A capped sample of the unfinished paths; `remaining_entries` is the true count.
       */
      sampled_unfinished_paths: string[];
    }
  | {
      state: 'unreadable';
      journal_path: string;
      reason: string;
    };

export interface FxvSchemas {
  envelope: Envelope;
  statuspayload: StatusPayload;
  historypayload: HistoryPayload;
  changeinfopayload: ChangeInfoPayload;
  workspacesyncpayload: WorkspaceSyncPayload;
  errorpayload: ErrorPayload;
  loginpayload: LoginPayload;
  logoutpayload: LogoutPayload;
  doctorpayload: DoctorPayload;
  interruptedsyncpayload: InterruptedSyncPayload;
}
/**
 * Schema describing the structured output emitted by the flexvault content, including program metadata and task progress details.
 */
export interface Envelope {
  /**
   * Metadata about the command line utility producing this output.
   */
  program: {
    /**
     * Human readable name of the program.
     */
    name: string;
    /**
     * Program version identifier.
     */
    version: string;
    /**
     * Fully qualified executable path or command name.
     */
    executable: string;
    /**
     * Ordered argument vector used for this invocation.
     */
    arguments: string[];
    /**
     * Timestamp capturing when the program was launched.
     */
    invoked_at: string;
    /**
     * Host on which the program is executing.
     */
    hostname?: string;
    /**
     * Operating system process identifier, if available.
     */
    pid?: number;
    /**
     * Directory from which the command was executed.
     */
    working_directory?: string;
  };
  /**
   * Envelope containing the command's output payload and task progress indicators.
   */
  message: {
    [k: string]: unknown;
  };
}
/**
 * Payload schema for the status command's JSON output.
 */
export interface StatusPayload {
  /**
   * Name of the workspace's current branch.
   */
  current_branch: string;
  /**
   * Username of the user currently logged in to this workspace via `fxv login`, if any. Absent when logged out.
   */
  current_user?: string;
  head_commit: HeadCommit;
  sync_status?: SyncStatus;
  files: FileStatus[];
  file_change_counts: FileChangeCounts;
}
/**
 * The fields of a commit reference: where the commit sits on its branch, plus the commit's own description, timestamp, author and import provenance. Deliberately NOT sealed, so a payload that flattens a commit reference alongside its own fields (changeinfo) can compose this under allOf and seal the result with unevaluatedProperties. Reference `commitRef` instead unless you are doing exactly that.
 */
export interface CommitRefFields {
  commit: CommitInfo;
  /**
   * Hex-encoded commit hash. Omitted where the caller doesn't have one to hand (e.g. `history`).
   */
  commit_hash?: string;
  /**
   * Commit description, omitted when the commit was made without one.
   */
  description?: string;
  /**
   * Commit timestamp in milliseconds since the epoch (UTC). For an imported commit this is the original authoring time, not when the import ran.
   */
  timestamp_millis_since_epoch_utc: number;
  /**
   * Stable display identifier for the author.
   */
  author_id: string;
  /**
   * Human-readable author display name.
   */
  author_display_name: string;
  author_details: AuthorDetails;
  import_info?: ImportInfo;
}
export interface CommitInfo {
  /**
   * Branch name.
   */
  branch: string;
  /**
   * Published revision number. For a draft, the published parent it is based on; omitted for a draft with no published parent.
   */
  revision?: number;
  /**
   * Whether this is a published or draft commit.
   */
  type: 'published' | 'draft';
  /**
   * Draft-specific revision number, present only for draft commits.
   */
  draft_revision?: number;
}
/**
 * Present only for a parented draft with a known synced revision.
 */
export interface SyncStatus {
  up_to_date: boolean;
  revisions_behind: number;
  published_head_revision: number;
  synced_revision: number | null;
}
export interface FileStatus {
  /**
   * Workspace-relative path with '/' separators.
   */
  path: string;
  unpublished_state?: ChangeKind;
  workspace_state?: ChangeKind1;
  /**
   * Conflict details for the file if a conflict exists; present only when the file has a conflict.
   */
  conflict_state?: {};
  /**
   * File size in bytes, if available.
   */
  size?: number | null;
}
export interface FileChangeCounts {
  /**
   * Total number of changed files.
   */
  total: number;
  /**
   * Number of entries carrying unpublished_state.
   */
  unpublished: number;
  /**
   * Number of entries carrying workspace_state.
   */
  workspace_need_snapshot: number;
}
/**
 * Payload schema for the history command's JSON output.
 */
export interface HistoryPayload {
  /**
   * The commits in the requested history, newest first. A history entry carries nothing beyond the commit reference itself, so entries are plain commitRefs.
   */
  entries: CommitRef[];
}
/**
 * Shared payload schema for the workspace-sync family of commands (goto, revert, sync): the outcome of moving the workspace to a target tree.
 */
export interface WorkspaceSyncPayload {
  /**
   * Spec of the revision the workspace was moved to (e.g. 'main.8' or 'main.-.5').
   */
  target_revision: string;
  /**
   * Snapshots created by the operation, in creation order: the pre-sync snapshot before the preserved-files snapshot. Omitted when none were created.
   */
  created_revisions?: CommitRef[];
  /**
   * Number of successfully updated files.
   */
  files_updated_count: number;
  /**
   * Number of files whose change could not be applied to the working tree.
   */
  error_count: number;
  /**
   * The successfully updated files, each with the change the sync applied on the workspace axis.
   */
  files_updated: FileStatus[];
  /**
   * Workspace-relative paths ('/'-separated) of unresolved conflicts in the target tree, which block publishing until resolved. Omitted when there are none.
   */
  conflicted_files?: string[];
}
/**
 * Payload schema emitted under a message kind of `error` when a command fails. Any command can produce this payload instead of its own; the process exit code is carried in `exit_code`.
 */
export interface ErrorPayload {
  /**
   * Human readable description of the failure - the same text the human output format prints to stderr.
   */
  message: string;
  /**
   * The process exit code the CLI returns for this failure. 1 is a general error; 98 means a previous sync was interrupted and the workspace must be recovered with `fxv resume`; 99 means the workspace was locked by another process.
   */
  exit_code: number;
  /**
   * Backtrace captured at the point the error was raised. Present only when backtrace capture was enabled (e.g. RUST_BACKTRACE=1) and a backtrace was available.
   */
  backtrace?: string;
  error_data?: ErrorData;
}
/**
 * Machine-readable detail for failures that have some, so a consumer can act without parsing `message`. Absent for most errors.
 */
export interface ErrorData {
  /**
   * Identifies the payload's shape, and therefore which schema describes it. `interrupted-sync` is described by urn:fxv:schema:interrupted-sync:v1.
   */
  kind: string;
  /**
   * The payload's own major.minor schema version, independent of the error envelope's.
   */
  version: string;
  /**
   * The detail itself; its shape is determined by `kind`.
   */
  payload: {};
}
/**
 * Payload schema for the `fxv login` command's JSON output.
 */
export interface LoginPayload {
  /**
   * The username now logged in to the workspace.
   */
  username: string;
}
/**
 * Payload schema for the `fxv logout` command's JSON output.
 */
export interface LogoutPayload {
  /**
   * Whether the workspace had a user logged in before this logout.
   */
  was_logged_in: boolean;
  /**
   * The username that was logged out. Present if and only if was_logged_in is true.
   */
  username?: string;
}
/**
 * Payload schema for the `fxv doctor` and `fxv doctor bundle` commands' JSON output.
 */
export interface DoctorPayload {
  /**
   * One entry per diagnostic check that was run or skipped, in catalog order.
   */
  checks: {
    /**
     * Stable machine identifier for this check, e.g. 'workspace.lock'.
     */
    id: string;
    /**
     * Which check group this belongs to, e.g. 'environment', 'agent', 'workspace', 'repo'.
     */
    group: string;
    /**
     * Human-readable label for this check.
     */
    name: string;
    /**
     * Outcome of this check.
     */
    status: 'ok' | 'warn' | 'fail' | 'skipped';
    /**
     * One-line explanation of the check's outcome.
     */
    detail: string;
    /**
     * Suggested remediation, present when the check is actionable (warn/fail).
     */
    fix_hint?: string;
    /**
     * Present only when --fix ran: whether a remediation was actually applied to this check.
     */
    fixed?: boolean;
  }[];
  /**
   * Counts of checks by outcome across the whole run.
   */
  summary: {
    ok: number;
    warn: number;
    fail: number;
    skipped: number;
  };
  /**
   * Present only for `fxv doctor bundle`: the archive that was written.
   */
  bundle?: {
    path: string;
    size_bytes: number;
  };
}
