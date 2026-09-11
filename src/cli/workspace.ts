import * as fs from 'fs';

import * as vscode from 'vscode';

import type { Log } from '../ui/log';
import { findWorkspaceRoot } from './workspacePaths';

export { WORKSPACE_MARKER } from './workspacePaths';

export interface WorkspaceRoot {
  /** Absolute path of the directory holding `.fxv_workspace`. */
  readonly path: string;
  /** The folder the walk started from. */
  readonly folder: vscode.WorkspaceFolder;
}

/**
 * Resolves the FlexVault root for the open window and caches it per folder.
 *
 * v1 works against a single root. When open folders resolve to different roots
 * the first one wins and the rest are named in the log, which is a state the
 * SCM provider has no way to render yet.
 */
export class WorkspaceRoots {
  private readonly cache = new Map<string, string | undefined>();

  constructor(private readonly log?: Log) {}

  /** The root every invocation runs in, or undefined outside a workspace. */
  primary(): WorkspaceRoot | undefined {
    const [first, ...rest] = this.all();
    if (!first) {
      return undefined;
    }
    const others = rest.filter((root) => root.path !== first.path);
    if (others.length > 0) {
      this.log?.error(
        `The open folders belong to more than one FlexVault workspace. ${first.path} is in use; ${others
          .map((root) => root.path)
          .join(', ')} will be ignored.`,
      );
    }
    return first;
  }

  /** Every open folder that resolves to a root, in workspace-folder order. */
  all(): WorkspaceRoot[] {
    const roots: WorkspaceRoot[] = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      // A folder on a remote or virtual filesystem has no path to walk, and the
      // extension only runs where it can spawn a process anyway.
      if (folder.uri.scheme !== 'file') {
        continue;
      }
      const path = this.forFolder(folder);
      if (path) {
        roots.push({ path, folder });
      }
    }
    return roots;
  }

  /**
   * Drops the cache. Call on `onDidChangeWorkspaceFolders`, and whenever a
   * `.fxv_workspace` could have appeared, which is what `fxv init` in the
   * terminal does.
   */
  invalidate(): void {
    this.cache.clear();
  }

  private forFolder(folder: vscode.WorkspaceFolder): string | undefined {
    const key = folder.uri.fsPath;
    const cached = this.cache.get(key);
    if (cached !== undefined || this.cache.has(key)) {
      return cached;
    }

    const root = findWorkspaceRoot({
      start: key,
      platform: process.platform,
      isDirectory,
    });
    this.cache.set(key, root);
    if (root) {
      this.log?.debug(`Resolved the FlexVault root for ${key} to ${root}.`);
    } else {
      this.log?.debug(`No FlexVault workspace found at or above ${key}.`);
    }
    return root;
  }
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}
