import * as path from 'path';
import * as vscode from 'vscode';

import type { FileStatus, StatusPayload } from '../cli/types.generated';
import {
  CONFLICT_THEME_COLOR_ID,
  getChangeKindBadge,
  getChangeKindThemeColorId,
  getChangeKindTooltip,
  getConflictDetail,
} from './resources';

export interface FileDecorationData {
  readonly badge: string;
  readonly tooltip: string;
  readonly color: vscode.ThemeColor;
  readonly propagate: boolean;
}

export function computeFileDecorationData(file: FileStatus): FileDecorationData | undefined {
  if (file.conflict_state) {
    return {
      badge: '!',
      tooltip: `Conflict: ${getConflictDetail(file.conflict_state)}`,
      color: new vscode.ThemeColor(CONFLICT_THEME_COLOR_ID),
      propagate: true,
    };
  }

  const effectiveChange = file.workspace_state ?? file.unpublished_state;
  if (effectiveChange) {
    return {
      badge: getChangeKindBadge(effectiveChange),
      tooltip: getChangeKindTooltip(effectiveChange),
      color: new vscode.ThemeColor(getChangeKindThemeColorId(effectiveChange)),
      propagate: true,
    };
  }

  return undefined;
}

const isCaseInsensitive = process.platform === 'win32' || process.platform === 'darwin';

export const IGNORED_THEME_COLOR_ID = 'gitDecoration.ignoredResourceForeground';

/**
 * Provides file decorations for the Explorer and SCM views.
 */
export class FlexVaultDecorationProvider
  implements vscode.FileDecorationProvider, vscode.Disposable
{
  private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  private decorationsByPath = new Map<string, vscode.FileDecoration>();
  private rootPath: string | undefined;
  private ignoreChecker: ((relPath: string) => boolean) | undefined;

  /**
   * Registers a callback used to grey out files ignored by .fxvignore, mirroring
   * how the built-in Git extension dims gitignored files in the Explorer.
   */
  setIgnoreChecker(checker: ((relPath: string) => boolean) | undefined): void {
    this.ignoreChecker = checker;
    this._onDidChangeFileDecorations.fire(undefined);
  }

  /**
   * Forces the Explorer/SCM views to re-query decorations, e.g. after .fxvignore rules change.
   */
  refresh(): void {
    this._onDidChangeFileDecorations.fire(undefined);
  }

  update(status: StatusPayload | undefined, rootUri: vscode.Uri | undefined): void {
    this.decorationsByPath.clear();
    this.rootPath = rootUri?.fsPath;

    if (status && this.rootPath) {
      for (const file of status.files) {
        const data = computeFileDecorationData(file);
        if (data) {
          const dec = new vscode.FileDecoration(data.badge, data.tooltip, data.color);
          dec.propagate = data.propagate;
          const normalized = file.path.replace(/\\/g, '/');
          const key = isCaseInsensitive ? normalized.toLowerCase() : normalized;
          this.decorationsByPath.set(key, dec);
        }
      }
    }

    this._onDidChangeFileDecorations.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!this.rootPath || uri.scheme !== 'file') {
      return undefined;
    }

    const rel = path.relative(this.rootPath, uri.fsPath).replace(/\\/g, '/');
    if (!rel || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) {
      return undefined;
    }

    const key = isCaseInsensitive ? rel.toLowerCase() : rel;
    const existing = this.decorationsByPath.get(key);
    if (existing) {
      return existing;
    }

    if (this.ignoreChecker?.(rel)) {
      return {
        color: new vscode.ThemeColor(IGNORED_THEME_COLOR_ID),
      };
    }

    return undefined;
  }

  dispose(): void {
    this._onDidChangeFileDecorations.dispose();
    this.decorationsByPath.clear();
  }
}
