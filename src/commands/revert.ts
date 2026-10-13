import * as vscode from 'vscode';

import type { RevertTarget } from '../cli/commands';
import { assertSafeToMutate } from '../state/safetyGuards';
import { withMutationProgress } from '../ui/progress';
import { handleCommandFailure } from './errorHandler';
import { collectResourceItems, extractPaths } from './resources';
import type { CommandContext } from './types';

export async function revertCommand(
  ctx: CommandContext,
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
  let target: RevertTarget;

  if (paths.length > 0) {
    const count = paths.length;
    const fileWord = count === 1 ? 'file' : 'files';
    const choice = await vscode.window.showWarningMessage(
      `Revert changes in ${count} ${fileWord}? Your current state will be snapshotted first.`,
      { modal: true },
      'Revert',
    );
    if (choice !== 'Revert') {
      return;
    }
    target = { paths };
  } else if (!hasTargetArgs) {
    const choice = await vscode.window.showWarningMessage(
      'Revert all changes in the workspace? Your current state will be snapshotted first.',
      { modal: true },
      'Revert All Changes',
    );
    if (choice !== 'Revert All Changes') {
      return;
    }
    target = { all: true };
  } else {
    void vscode.window.showErrorMessage('Unable to determine files to revert.');
    return;
  }

  const result = await withMutationProgress('Reverting changes...', async () => {
    return await ctx.fxv.revert(target);
  });

  if (!result.ok) {
    handleCommandFailure('Revert', result, ctx, () => revertCommand(ctx, resource, ...selected));
    return;
  }

  const conflicts = result.payload.conflicted_files;
  if (conflicts && conflicts.length > 0) {
    void vscode.window.showWarningMessage(
      `Reverted with ${conflicts.length} unresolved conflict${conflicts.length === 1 ? '' : 's'}.`,
    );
  } else if (result.payload.error_count > 0) {
    void vscode.window.showWarningMessage(
      `Reverted ${result.payload.files_updated_count} file${result.payload.files_updated_count === 1 ? '' : 's'}, but ${result.payload.error_count} failed to update.`,
    );
  } else {
    void vscode.window.showInformationMessage(
      `Reverted ${result.payload.files_updated_count} file${result.payload.files_updated_count === 1 ? '' : 's'}.`,
    );
  }

  await ctx.statusCache?.refresh({ skipRemoteUpdate: true });
}
