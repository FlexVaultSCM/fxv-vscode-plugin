import * as vscode from 'vscode';

import type { ResolveStrategy, ResolveTarget } from '../cli/commands';
import { assertSafeToMutate } from '../state/safetyGuards';
import { withMutationProgress } from '../ui/progress';
import { handleCommandFailure } from './errorHandler';
import { collectResourceItems, extractPaths } from './resources';
import type { CommandContext } from './types';

export async function resolveCommand(
  ctx: CommandContext,
  strategy: ResolveStrategy,
  resource?: unknown,
  ...selected: unknown[]
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

  const rawArgs = resource !== undefined ? [resource, ...selected] : selected;
  const items = collectResourceItems(rawArgs);
  const hasTargetArgs = items.length > 0;
  const paths = extractPaths(ctx, items);
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
      resolveCommand(ctx, strategy, resource, ...selected),
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
