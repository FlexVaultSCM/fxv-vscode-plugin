import * as path from 'path';
import * as vscode from 'vscode';

export interface DocumentPath {
  readonly scheme: string;
  readonly fsPath: string;
}

export function isPathUnderRoot(filePath: string, rootPath: string): boolean {
  const rel = path.relative(rootPath, filePath);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function filterDirtyDocsUnderRoot<T extends DocumentPath>(
  docs: readonly T[],
  rootPath: string,
): T[] {
  return docs.filter((doc) => {
    if (doc.scheme !== 'file') {
      return false;
    }
    return isPathUnderRoot(doc.fsPath, rootPath);
  });
}

export interface SafetyGuardOptions {
  /** The workspace root URI. */
  readonly rootUri?: vscode.Uri | undefined;
  /** Active debug session check override for testing. */
  readonly getActiveDebugSession?: (() => boolean) | undefined;
  /** Dirty text document list override for testing. */
  readonly getDirtyDocuments?: (() => readonly vscode.TextDocument[]) | undefined;
  /** Function to save all dirty documents, defaults to vscode.workspace.saveAll. */
  readonly saveAll?: (() => Thenable<boolean> | Promise<boolean>) | undefined;
  /** Warning message prompt override for testing. */
  readonly showWarningMessage?:
    | ((
        message: string,
        options: vscode.MessageOptions,
        ...items: string[]
      ) => Thenable<string | undefined> | Promise<string | undefined>)
    | undefined;
}

/**
 * Checks safety guards prior to executing a mutating command.
 *
 * Rules:
 * 1. Block while a debug session is active: sync or goto can pull files out
 *    from under a running process.
 * 2. Block while there are dirty editors under the workspace root, offering
 *    "Save All and Continue".
 *
 * Returns true if safe to proceed, false if blocked or cancelled by the user.
 */
export async function assertSafeToMutate(options: SafetyGuardOptions): Promise<boolean> {
  const showWarning = options.showWarningMessage ?? vscode.window.showWarningMessage;

  // 1. Active debug session guard
  const hasDebugSession = options.getActiveDebugSession
    ? options.getActiveDebugSession()
    : vscode.debug.activeDebugSession !== undefined;

  if (hasDebugSession) {
    void showWarning('Cannot perform mutating operation while a debug session is active.', {
      modal: false,
    });
    return false;
  }

  // 2. Dirty editors under the root
  if (options.rootUri) {
    const dirtyDocs = options.getDirtyDocuments
      ? options.getDirtyDocuments()
      : vscode.workspace.textDocuments.filter((doc) => doc.isDirty);

    const dirtyUnderRoot = filterDirtyDocsUnderRoot(
      dirtyDocs.map((d) => ({ scheme: d.uri.scheme, fsPath: d.uri.fsPath })),
      options.rootUri.fsPath,
    );

    if (dirtyUnderRoot.length > 0) {
      const count = dirtyUnderRoot.length;
      const fileWord = count === 1 ? 'file' : 'files';
      const choice = await showWarning(
        `You have ${count} unsaved ${fileWord} in the workspace. Save before continuing?`,
        { modal: true },
        'Save All and Continue',
      );

      if (choice !== 'Save All and Continue') {
        return false;
      }

      const saveAll = options.saveAll ?? (() => vscode.workspace.saveAll(false));
      const saved = await saveAll();
      if (!saved) {
        return false;
      }
    }
  }

  return true;
}
