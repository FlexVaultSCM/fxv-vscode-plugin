import * as path from 'path';
import * as vscode from 'vscode';

import type { FlexVaultResourceState } from '../scm/provider';
import type { CommandContext } from './types';

export function collectResourceItems(args: unknown[]): unknown[] {
  const items: unknown[] = [];
  for (const arg of args) {
    if (Array.isArray(arg)) {
      items.push(...collectResourceItems(arg));
    } else if (arg !== undefined && arg !== null) {
      items.push(arg);
    }
  }
  return items;
}

export function extractPaths(ctx: CommandContext, items: unknown[]): string[] {
  const paths: string[] = [];
  for (const item of items) {
    const p = extractSinglePath(ctx, item);
    if (p && !paths.includes(p)) {
      paths.push(p);
    }
  }
  return paths;
}

export function extractSinglePath(ctx: CommandContext, item: unknown): string | undefined {
  if (!item || typeof item !== 'object') {
    return undefined;
  }
  if ('descriptor' in item) {
    const desc = (item as FlexVaultResourceState).descriptor;
    if (desc?.path) {
      return desc.path;
    }
  }
  if ('resourceUri' in item) {
    const resUri = (item as vscode.SourceControlResourceState).resourceUri;
    if (resUri && ctx.rootUri) {
      const rel = path.relative(ctx.rootUri.fsPath, resUri.fsPath);
      return rel.replace(/\\/g, '/');
    }
  }
  if ('fsPath' in item && ctx.rootUri) {
    const uri = item as vscode.Uri;
    const rel = path.relative(ctx.rootUri.fsPath, uri.fsPath);
    return rel.replace(/\\/g, '/');
  }
  return undefined;
}
