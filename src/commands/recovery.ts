import * as vscode from 'vscode';

import { assertSafeToMutate } from '../state/safetyGuards';
import { withMutationProgress } from '../ui/progress';
import { handleCommandFailure } from './errorHandler';
import type { CommandContext } from './types';

/**
 * Finishes (`continue`) or undoes (`rollback`) an interrupted sync/goto/
 * revert/resolve. Invoked from the recovery banner's Finish/Undo actions;
 * `resume` returns the same workspace-sync payload as `goto`/`sync`, so the
 * outcome messaging mirrors those commands.
 */
export async function resumeCommand(
  ctx: CommandContext,
  mode: 'continue' | 'rollback',
): Promise<void> {
  if (!ctx.rootUri) {
    void vscode.window.showErrorMessage('No FlexVault workspace is currently open.');
    return;
  }

  const safe = await assertSafeToMutate({ rootUri: ctx.rootUri });
  if (!safe) {
    return;
  }

  const label = mode === 'continue' ? 'Finish' : 'Undo';
  const result = await withMutationProgress(
    mode === 'continue' ? 'Finishing interrupted operation...' : 'Undoing interrupted operation...',
    async () => ctx.fxv.resume({ mode }),
  );

  if (!result.ok) {
    handleCommandFailure(label, result, ctx, () => resumeCommand(ctx, mode));
    return;
  }

  void vscode.window.showInformationMessage(
    mode === 'continue'
      ? `Finished. Now at ${result.payload.target_revision}.`
      : `Undone. Now at ${result.payload.target_revision}.`,
  );

  await ctx.statusCache?.refresh({ skipRemoteUpdate: true });
}
