import * as path from 'path';
import * as vscode from 'vscode';

import type { ResolveStrategy, ResolveTarget } from '../cli/commands';
import type { FlexVaultResourceState } from '../scm/provider';
import { assertSafeToMutate } from '../state/safetyGuards';
import { withMutationProgress } from '../ui/progress';
import type { CommandContext } from './types';

export async function resolveCommand(
  ctx: CommandContext,
  strategy: ResolveStrategy,
  resource?: FlexVaultResourceState | vscode.SourceControlResourceState,
  selected?: (FlexVaultResourceState | vscode.SourceControlResourceState)[],
): Promise<void> {
  const paths = extractPaths(ctx, resource, selected);
  let target: ResolveTarget;

  if (paths.length > 0) {
    // resolve --theirs is destructive: warn per PLAN.md 4.3
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
  } else {
    const choice = await vscode.window.showWarningMessage(
      `Resolve all conflicts using '${strategy}'?`,
      { modal: true },
      `Resolve All (${strategy})`,
    );
    if (choice !== `Resolve All (${strategy})`) {
      return;
    }
    target = { all: true };
  }

  const safe = await assertSafeToMutate({ rootUri: ctx.rootUri });
  if (!safe) {
    return;
  }

  const result = await withMutationProgress(`Resolving conflicts (${strategy})...`, async () => {
    return await ctx.fxv.resolve(strategy, target);
  });

  if (!result.ok) {
    void vscode.window
      .showErrorMessage(`Resolve failed: ${result.message}`, 'Show Log')
      .then((act) => act === 'Show Log' && ctx.log?.show());
    return;
  }

  const conflicts = result.payload.conflicted_files;
  if (conflicts && conflicts.length > 0) {
    void vscode.window.showWarningMessage(
      `Resolved, but ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} remain.`,
    );
  } else {
    void vscode.window.showInformationMessage('Conflicts resolved successfully.');
  }

  await ctx.statusCache?.refresh({ skipRemoteUpdate: true });
}

function extractPaths(
  ctx: CommandContext,
  resource?: FlexVaultResourceState | vscode.SourceControlResourceState,
  selected?: (FlexVaultResourceState | vscode.SourceControlResourceState)[],
): string[] {
  if (selected && selected.length > 0) {
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

function extractSinglePath(
  ctx: CommandContext,
  item: FlexVaultResourceState | vscode.SourceControlResourceState,
): string | undefined {
  if ('descriptor' in item && item.descriptor?.path) {
    return item.descriptor.path;
  }
  if (item.resourceUri && ctx.rootUri) {
    const rel = path.relative(ctx.rootUri.fsPath, item.resourceUri.fsPath);
    return rel.replace(/\\/g, '/');
  }
  return undefined;
}
