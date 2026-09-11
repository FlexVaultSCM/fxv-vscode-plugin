import type { CommitInfo } from './types.generated';

/**
 * Revision specs, built and parsed in one place. Nothing else in the extension
 * assembles one from parts.
 *
 * Three forms: `main.11` for a published revision, `main.11.123` for a draft on
 * top of published revision 11, and `main.-.1` for a draft with no published
 * parent. The `-` stands in for the missing published revision and has to be
 * written out, because the CLI prints that form and accepts it back.
 */

/** The placeholder for a draft whose branch has no published revision yet. */
export const NO_PUBLISHED_REVISION = '-';

export interface RevisionSpec {
  readonly branch: string;
  /** Absent on a draft with no published parent, which is the `-` form. */
  readonly revision?: number;
  /** Present on a draft, absent on a published revision. */
  readonly draftRevision?: number;
}

export function specFromCommitInfo(commit: CommitInfo): string {
  if (commit.type === 'draft' && commit.draft_revision === undefined) {
    // Falling through would build `main.11`, which is a different commit: the
    // published revision this draft sits on rather than the draft itself.
    throw new Error(`A draft commit on branch "${commit.branch}" has no draft revision.`);
  }
  return specFromRevision(commit.branch, commit.revision, commit.draft_revision);
}

export function specFromRevision(
  branch: string,
  revision: number | undefined,
  draftRevision?: number | undefined,
): string {
  if (branch.length === 0) {
    throw new Error('A revision spec needs a branch. Take it from the payload.');
  }
  if (draftRevision !== undefined) {
    const parent = revision === undefined ? NO_PUBLISHED_REVISION : String(revision);
    return `${branch}.${parent}.${draftRevision}`;
  }
  if (revision === undefined) {
    throw new Error(
      `Cannot build a revision spec for branch "${branch}": a published revision has no revision number.`,
    );
  }
  return `${branch}.${revision}`;
}

// The branch group is greedy, which is only unambiguous because a branch name
// cannot contain a dot: fxv-core restricts it to `[a-zA-Z0-9_- ]{1,64}`. If that
// ever widens, `release.2.5` becomes two readings and this needs the branch
// passed in rather than inferred.
const DRAFT_SPEC = /^(.+)\.(\d+|-)\.(\d+)$/;
const PUBLISHED_SPEC = /^(.+)\.(\d+)$/;

/** Parses a spec back into its parts, or undefined if it is not one. */
export function parseSpec(spec: string): RevisionSpec | undefined {
  const trimmed = spec.trim();

  const draft = DRAFT_SPEC.exec(trimmed);
  if (draft) {
    const [, branch, parent, draftRevision] = draft;
    return {
      branch: branch as string,
      ...(parent === NO_PUBLISHED_REVISION ? {} : { revision: Number(parent) }),
      draftRevision: Number(draftRevision),
    };
  }

  const published = PUBLISHED_SPEC.exec(trimmed);
  if (published) {
    return { branch: published[1] as string, revision: Number(published[2]) };
  }

  return undefined;
}
