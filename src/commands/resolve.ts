import * as path from 'path';
import * as vscode from 'vscode';

import type { ResolveStrategy, ResolveTarget } from '../cli/commands';
import type { FlexVaultResourceState } from '../scm/provider';
import { assertSafeToMutate } from '../state/safetyGuards';
import { withMutationProgress } from '../ui/progress';
import { handleCommandFailure } from './errorHandler';
import type { CommandContext } from './types';

export async function resolveCommand(
  ctx: CommandContext,
  strategy: ResolveStrategy,
  resource?: FlexVaultResourceState | vscode.SourceControlResourceState | vscode.Uri,
  selected?: (FlexVaultResourceState | vscode.SourceControlResourceState | vscode.Uri)[],
): Promise<void> {
  if (!ctx.rootUri) {
    void vscode.window.showErrorMessage('No FlexVault workspace is currently open.');
    return;
  }

  // Safety guards checked before modal confirmation
  const safe = await assertSafeToMutate({ rootUri: ctx.rootUri });
  if (!safe) {
    return;
  }

  const hasTargetArgs = resource !== undefined || (Array.isArray(selected) && selected.length > 0);
  const paths = extractPaths(ctx, resource, selected);
  let target: ResolveTarget;

  if (paths.length > 0) {
    // resolve --theirs is destructive: warn before running it
    if (strategy === 'theirs') {
      const count = paths.length;
      const fileWord = count === 1 ? 'file' : 'files';
      const choice = await vscode.window.showWarningMessage(
        `Resolving ${count} ${fileWord} using 'theirs' will overwrite your local changes. Continue?`,
        { modal: true },
        'Resolve With Theirs',
      );
      if (choice !== 'Resolve With Theirs') {
        return;
      }
    }
    target = { paths };
  } else if (!hasTargetArgs) {
    const choice = await vscode.window.showWarningMessage(
      `Resolve all conflicts using '${strategy}'?`,
      { modal: true },
      `Resolve All (${strategy})`,
    );
    if (choice !== `Resolve All (${strategy})`) {
      return;
    }
    target = { all: true };
  } else {
    void vscode.window.showErrorMessage('Unable to determine files to resolve.');
    return;
  }

  const result = await withMutationProgress(`Resolving conflicts (${strategy})...`, async () => {
    return await ctx.fxv.resolve(strategy, target);
  });

  if (!result.ok) {
    handleCommandFailure('Resolve', result, ctx, () =>
      resolveCommand(ctx, strategy, resource, selected),
    );
    return;
  }

  const conflicts = result.payload.conflicted_files;
  if (conflicts && conflicts.length > 0) {
    void vscode.window.showWarningMessage(
      `Resolved, but ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} remain.`,
    );
  } else if (result.payload.error_count > 0) {
    void vscode.window.showWarningMessage(
      `Resolved, but ${result.payload.error_count} file${result.payload.error_count === 1 ? '' : 's'} could not be updated.`,
    );
  } else {
    void vscode.window.showInformationMessage('Conflicts resolved successfully.');
  }

  await ctx.statusCache?.refresh({ skipRemoteUpdate: true });
}

function extractPaths(ctx: CommandContext, resource?: unknown, selected?: unknown[]): string[] {
  if (Array.isArray(selected) && selected.length > 0) {
    return selected
      .map((item) => extractSinglePath(ctx, item))
      .filter((p): p is string => p !== undefined);
  }
  if (resource) {
    const p = extractSinglePath(ctx, resource);
    return p ? [p] : [];
  }
  return [];
}

function extractSinglePath(ctx: CommandContext, item: unknown): string | undefined {
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
