import * as path from 'path';
import * as vscode from 'vscode';

import { toFxvUri } from '../providers/fxvUri';
import { resolveDiffBaseRevision } from '../scm/diffBase';
import type { ResourceDescriptor } from '../scm/resources';
import { toRelPathUnderRoot } from '../state/safetyGuards';
import type { CommandContext } from './types';

export interface DiffTargetInput {
  readonly uri?: vscode.Uri;
  readonly descriptor?: ResourceDescriptor;
}

function isUri(value: unknown): value is vscode.Uri {
  return typeof value === 'object' && value !== null && 'scheme' in value && 'path' in value;
}

function resolveDiffTarget(
  arg0: unknown,
  arg1: unknown,
): { uri: vscode.Uri | undefined; descriptor: ResourceDescriptor | undefined } {
  // Case 1: called from SCM resource item command with arguments [uri, descriptor]
  if (isUri(arg0)) {
    const descriptor = (arg1 && typeof arg1 === 'object' && 'group' in arg1 ? arg1 : undefined) as
      ResourceDescriptor | undefined;
    return { uri: arg0, descriptor };
  }

  // Case 2: called from editor/title or palette
  const activeEditor = vscode.window.activeTextEditor;
  return { uri: activeEditor?.document.uri, descriptor: undefined };
}

/**
 * Command to diff a file against its base revision (PLAN.md 5.3).
 * Axis-aware base selection:
 * - Workspace changes -> local snapshot first, then published head.
 * - Unpublished changes -> published head first, then local snapshot.
 * - Conflicts -> published head first, then local snapshot.
 */
export async function diffAgainstBaseCommand(
  ctx: CommandContext,
  arg0?: unknown,
  arg1?: unknown,
): Promise<void> {
  const { uri, descriptor } = resolveDiffTarget(arg0, arg1);

  if (!uri || uri.scheme !== 'file') {
    return;
  }

  if (!ctx.rootUri) {
    return;
  }

  const relPath = descriptor?.path ?? toRelPathUnderRoot(uri.fsPath, ctx.rootUri.fsPath);

  if (!relPath) {
    return;
  }

  const status = ctx.statusCache?.status;
  const file =
    descriptor?.file ?? status?.files.find((f) => f.path.replace(/\\/g, '/') === relPath);

  // If the file was deleted in the working copy, there is no file to open in a working copy diff
  if (
    descriptor?.isDeleted ||
    file?.workspace_state === 'deleted' ||
    file?.unpublished_state === 'deleted'
  ) {
    void vscode.window.showInformationMessage(
      `Cannot diff deleted file ${path.basename(relPath)}.`,
    );
    return;
  }

  const baseSpec = resolveDiffBaseRevision({
    file,
    group: descriptor?.group,
    status,
  });

  if (!baseSpec) {
    // If newly added without any prior base revision, there is nothing to diff against,
    // so just open the file directly regardless of how the command was invoked.
    if (descriptor?.changeKind === 'added' || file?.workspace_state === 'added') {
      await vscode.commands.executeCommand('vscode.open', uri);
      return;
    }

    void vscode.window.showInformationMessage(
      `No base revision available to compare ${path.basename(relPath)} against.`,
    );
    return;
  }

  const baseUri = toFxvUri(relPath, baseSpec);
  const fileName = path.basename(relPath);
  const title = `${fileName} (${baseSpec} ↔ Working Tree)`;

  await vscode.commands.executeCommand('vscode.diff', baseUri, uri, title);
}

/**
 * Command to purge the on-disk and in-memory content cache on demand (PLAN.md 5.2).
 */
export async function clearCacheCommand(ctx: CommandContext): Promise<void> {
  if (ctx.contentCache) {
    await ctx.contentCache.clear();
    ctx.log?.info('Cleared FlexVault content cache.');
    void vscode.window.showInformationMessage('FlexVault content cache cleared.');
  }
}
