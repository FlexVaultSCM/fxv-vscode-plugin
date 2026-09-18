import * as vscode from 'vscode';

import { assertSafeToMutate } from '../state/safetyGuards';
import { withMutationProgress } from '../ui/progress';
import { handleCommandFailure } from './errorHandler';
import type { CommandContext } from './types';

/**
 * Snapshots the workspace on its own, independent of the publish flow. Prefers
 * an explicit description if passed, falls back to the SCM input box, and omits
 * `-d` when it is empty rather than passing an empty string, which the CLI rejects.
 */
export async function snapshotCommand(
  ctx: CommandContext,
  explicitDescription?: unknown,
): Promise<void> {
  if (!ctx.rootUri) {
    void vscode.window.showErrorMessage('No FlexVault workspace is currently open.');
    return;
  }

  const safe = await assertSafeToMutate({ rootUri: ctx.rootUri });
  if (!safe) {
    return;
  }

  const inputBox = ctx.scmProvider?.inputBox;
  const explicit = typeof explicitDescription === 'string' ? explicitDescription.trim() : '';
  const description = explicit || inputBox?.value.trim() || '';

  const result = await withMutationProgress('Snapshotting...', async () =>
    ctx.fxv.snapshot(description.length > 0 ? description : undefined),
  );

  if (!result.ok) {
    handleCommandFailure('Snapshot', result, ctx, () => snapshotCommand(ctx, explicitDescription));
    return;
  }

  if (!explicit && inputBox) {
    inputBox.value = '';
  }

  void vscode.window.showInformationMessage('Snapshot created.');
  await ctx.statusCache?.refresh({ skipRemoteUpdate: true });
}
