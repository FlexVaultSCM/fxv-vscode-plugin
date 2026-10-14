import * as path from 'path';
import * as vscode from 'vscode';

import type { FlexVaultResourceState } from '../scm/provider';
import type { ResourceDescriptor } from '../scm/resources';
import { collectResourceItems } from './resources';
import type { CommandContext } from './types';

export interface OpenFileTarget {
  readonly uri: vscode.Uri;
  readonly relPath?: string | undefined;
  readonly descriptor?: ResourceDescriptor | undefined;
}

export function extractOpenFileTargets(ctx: CommandContext, items: unknown[]): OpenFileTarget[] {
  const targets: OpenFileTarget[] = [];
  const seenUris = new Set<string>();

  for (const item of items) {
    const target = extractSingleOpenFileTarget(ctx, item);
    if (target) {
      const key = target.uri.toString();
      if (!seenUris.has(key)) {
        seenUris.add(key);
        targets.push(target);
      }
    }
  }

  return targets;
}

export function extractSingleOpenFileTarget(
  ctx: CommandContext,
  item: unknown,
): OpenFileTarget | undefined {
  if (!item || typeof item !== 'object') {
    return undefined;
  }

  // FlexVaultResourceState or SourceControlResourceState with resourceUri
  if ('resourceUri' in item) {
    const res = item as vscode.SourceControlResourceState;
    const uri = res.resourceUri;
    if (!uri) {
      return undefined;
    }
    const descriptor =
      'descriptor' in item ? (item as FlexVaultResourceState).descriptor : undefined;
    const relPath =
      descriptor?.path ??
      (ctx.rootUri ? path.relative(ctx.rootUri.fsPath, uri.fsPath).replace(/\\/g, '/') : undefined);
    return { uri, relPath, descriptor };
  }

  // Direct vscode.Uri
  if ('scheme' in item && 'fsPath' in item) {
    const uri = item as vscode.Uri;
    const relPath = ctx.rootUri
      ? path.relative(ctx.rootUri.fsPath, uri.fsPath).replace(/\\/g, '/')
      : undefined;
    return { uri, relPath };
  }

  // Object with descriptor
  if ('descriptor' in item) {
    const descriptor = (item as { descriptor: ResourceDescriptor }).descriptor;
    if (descriptor?.path && ctx.rootUri) {
      const normalized = descriptor.path.replace(/\\/g, '/');
      const uri = vscode.Uri.joinPath(ctx.rootUri, ...normalized.split('/'));
      return { uri, relPath: descriptor.path, descriptor };
    }
  }

  return undefined;
}

export async function openFileCommand(
  ctx: CommandContext,
  resource?: unknown,
  ...selected: unknown[]
): Promise<void> {
  const rawArgs = resource !== undefined ? [resource, ...selected] : selected;
  const items = collectResourceItems(rawArgs);
  let targets = extractOpenFileTargets(ctx, items);

  if (targets.length === 0) {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri && activeUri.scheme === 'file') {
      const relPath = ctx.rootUri
        ? path.relative(ctx.rootUri.fsPath, activeUri.fsPath).replace(/\\/g, '/')
        : undefined;
      targets = [{ uri: activeUri, relPath }];
    }
  }

  if (targets.length === 0) {
    return;
  }

  const status = ctx.statusCache?.status;

  for (const target of targets) {
    const relPath = target.relPath;
    const descriptor = target.descriptor;
    const file =
      descriptor?.file ??
      (relPath ? status?.files.find((f) => f.path.replace(/\\/g, '/') === relPath) : undefined);

    const isDeleted =
      descriptor?.isDeleted ??
      (file?.workspace_state === 'deleted' ||
        (file?.unpublished_state === 'deleted' && !file.workspace_state));

    if (isDeleted) {
      const fileName = relPath ? path.basename(relPath) : path.basename(target.uri.fsPath);
      void vscode.window.showInformationMessage(`Cannot open deleted file ${fileName}.`);
      continue;
    }

    await vscode.commands.executeCommand('vscode.open', target.uri);
  }
}
