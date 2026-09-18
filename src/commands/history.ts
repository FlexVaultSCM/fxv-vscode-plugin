import * as path from 'path';
import * as vscode from 'vscode';

import type { ChangeElement, CommitElement } from '../providers/historyItems';
import { toFxvUri } from '../providers/fxvUri';
import type { CommandContext } from './types';

/**
 * Per-entry history actions: show changes, go to revision, and copy revision.
 * "Show changes" reveals the commit's node rather than duplicating
 * loadChanges, since expanding it already drives the same fetch.
 */

export async function historyShowChangesCommand(
  ctx: CommandContext,
  element: CommitElement,
): Promise<void> {
  await ctx.historyTreeView?.reveal(element, { expand: true, focus: true, select: true });
}

export async function historyGotoRevisionCommand(
  _ctx: CommandContext,
  element: CommitElement,
): Promise<void> {
  await vscode.commands.executeCommand('flexvault.goto', element.spec);
}

export async function historyCopyRevisionCommand(
  _ctx: CommandContext,
  element: CommitElement,
): Promise<void> {
  await vscode.env.clipboard.writeText(element.spec);
  void vscode.window.showInformationMessage(`Copied ${element.spec} to the clipboard.`);
}

/**
 * Opens a diff between a changed file at the commit that changed it and the
 * current working-tree copy, reusing the fxv: content provider.
 * A file the commit deleted has no content to read back at that revision, so
 * there is nothing to diff.
 */
export async function historyOpenChangeCommand(
  ctx: CommandContext,
  element: ChangeElement,
): Promise<void> {
  if (!ctx.rootUri) {
    return;
  }

  const fileName = path.basename(element.path);

  if (element.action === 'deleted') {
    void vscode.window.showInformationMessage(
      `${fileName} was deleted in revision ${element.commitSpec}.`,
    );
    return;
  }

  const historicalUri = toFxvUri(element.path, element.commitSpec);
  const localUri = vscode.Uri.joinPath(ctx.rootUri, ...element.path.split('/'));

  let localExists = true;
  try {
    await vscode.workspace.fs.stat(localUri);
  } catch {
    localExists = false;
  }

  if (!localExists) {
    await vscode.window.showTextDocument(historicalUri);
    return;
  }

  const title = `${fileName} (${element.commitSpec} ↔ Working Tree)`;
  await vscode.commands.executeCommand('vscode.diff', historicalUri, localUri, title);
}
