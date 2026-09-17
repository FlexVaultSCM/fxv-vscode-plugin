import * as vscode from 'vscode';

import { assertSafeToMutate } from '../state/safetyGuards';
import { withMutationProgress } from '../ui/progress';
import { handleCommandFailure } from './errorHandler';
import type { CommandContext } from './types';

export async function syncCommand(ctx: CommandContext, revisionSpec?: unknown): Promise<void> {
  if (!ctx.rootUri) {
    void vscode.window.showErrorMessage('No FlexVault workspace is currently open.');
    return;
  }

  const safe = await assertSafeToMutate({ rootUri: ctx.rootUri });
  if (!safe) {
    return;
  }

  const spec =
    typeof revisionSpec === 'string' && revisionSpec.trim().length > 0
      ? revisionSpec.trim()
      : undefined;

  const result = await withMutationProgress('Syncing with remote...', async () => {
    return await ctx.fxv.sync(spec);
  });

  if (!result.ok) {
    handleCommandFailure('Sync', result, ctx, () => syncCommand(ctx, revisionSpec));
    return;
  }

  const conflicts = result.payload.conflicted_files;
  if (conflicts && conflicts.length > 0) {
    void vscode.window.showWarningMessage(
      `Sync completed with ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}. Please resolve them in the Conflicts group.`,
    );
  } else if (result.payload.error_count > 0) {
    void vscode.window.showWarningMessage(
      `Synced to ${result.payload.target_revision}. ${result.payload.files_updated_count} updated, ${result.payload.error_count} failed to update.`,
    );
  } else {
    void vscode.window.showInformationMessage(
      `Synced to ${result.payload.target_revision}. ${result.payload.files_updated_count} file${result.payload.files_updated_count === 1 ? '' : 's'} updated.`,
    );
  }

  await ctx.statusCache?.refresh({ skipRemoteUpdate: true });
}
