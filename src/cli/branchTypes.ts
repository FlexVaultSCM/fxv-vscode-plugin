/**
 * DTOs and parameter types for the `fxv branch` command family.
 *
 * Corresponds to schemas `branch_info.schema.json` and `branch_list.schema.json`
 * in `fxv-core`.
 */

export interface BranchInfo {
  readonly branch: string;
  readonly branch_unique_id: string;
  readonly branch_type: 'global' | 'user';
  readonly owner?: string;
  readonly published_head?: string;
  readonly draft_head?: string;
  readonly local_only: boolean;
  readonly retired: boolean;
}

export interface BranchListPayload {
  readonly branches: readonly BranchInfo[];
}

export interface BranchListOptions {
  readonly all?: boolean;
  readonly mine?: boolean;
  readonly global?: boolean;
  readonly includeRetired?: boolean;
}

export interface BranchNewOptions {
  readonly name: string;
  readonly global?: boolean;
  readonly from?: string;
  readonly empty?: boolean;
  readonly noSwitch?: boolean;
}

export interface BranchNewPayload {
  readonly branch: string;
  readonly branch_type: 'global' | 'user';
  readonly revision: string;
  readonly source_revision?: string;
  readonly switched: boolean;
}
