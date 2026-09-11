import * as nodePath from 'path';

/**
 * The parent walk that finds a FlexVault root, as a pure function of a starting
 * directory and a predicate over the file system. The editor-facing half lives
 * in `workspace.ts` next to this file.
 */

/** The directory `fxv init` creates at the root of a workspace. */
export const WORKSPACE_MARKER = '.fxv_workspace';

export interface RootSearch {
  readonly start: string;
  readonly platform?: NodeJS.Platform | string;
  /** True when the path is a directory. */
  readonly isDirectory: (candidate: string) => boolean;
}

/**
 * Walks up from `start` and returns the first directory holding a
 * `.fxv_workspace`, which is the repo root and the `cwd` for every invocation.
 * Undefined when the walk reaches the filesystem root without finding one.
 */
export function findWorkspaceRoot(search: RootSearch): string | undefined {
  const pathApi = search.platform === 'win32' ? nodePath.win32 : nodePath.posix;
  let current = pathApi.resolve(search.start);

  for (;;) {
    if (search.isDirectory(pathApi.join(current, WORKSPACE_MARKER))) {
      return current;
    }
    const parent = pathApi.dirname(current);
    if (parent === current) {
      // `dirname` is a fixed point at the root of the drive, and on Windows at
      // the root of a UNC share, which is where the walk has to stop.
      return undefined;
    }
    current = parent;
  }
}
