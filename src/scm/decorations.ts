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

  if (file.workspace_state) {
    return {
      badge: getChangeKindBadge(file.workspace_state),
      tooltip: `Workspace: ${getChangeKindTooltip(file.workspace_state)}`,
      color: new vscode.ThemeColor(getChangeKindThemeColorId(file.workspace_state)),
      propagate: true,
    };
  }

  if (file.unpublished_state) {
    return {
      badge: getChangeKindBadge(file.unpublished_state),
      tooltip: `Unpublished: ${getChangeKindTooltip(file.unpublished_state)}`,
      color: new vscode.ThemeColor(getChangeKindThemeColorId(file.unpublished_state)),
      propagate: true,
    };
  }

  return undefined;
}

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
          this.decorationsByPath.set(normalized, dec);
        }
      }
    }

    this._onDidChangeFileDecorations.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!this.rootPath) {
      return undefined;
    }

    const fileFsPath = uri.fsPath;
    if (!fileFsPath.toLowerCase().startsWith(this.rootPath.toLowerCase())) {
      return undefined;
    }

    const rel = path.relative(this.rootPath, fileFsPath).replace(/\\/g, '/');
    if (!rel || rel === '.') {
      return undefined;
    }

    return this.decorationsByPath.get(rel);
  }

  dispose(): void {
    this._onDidChangeFileDecorations.dispose();
    this.decorationsByPath.clear();
  }
}
