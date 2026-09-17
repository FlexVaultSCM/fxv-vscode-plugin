import * as vscode from 'vscode';

import { assertSafeToMutate } from '../state/safetyGuards';
import { withMutationProgress } from '../ui/progress';
import type { CommandContext } from './types';

export async function syncCommand(ctx: CommandContext, revisionSpec?: string): Promise<void> {
  const safe = await assertSafeToMutate({ rootUri: ctx.rootUri });
  if (!safe) {
    return;
  }

  const result = await withMutationProgress('Syncing with remote...', async () => {
    return await ctx.fxv.sync(revisionSpec);
  });

  if (!result.ok) {
    void vscode.window
      .showErrorMessage(`Sync failed: ${result.message}`, 'Show Log')
      .then((act) => act === 'Show Log' && ctx.log?.show());
    return;
  }

  const conflicts = result.payload.conflicted_files;
  if (conflicts && conflicts.length > 0) {
    void vscode.window.showWarningMessage(
      `Sync completed with ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}. Please resolve them in the Conflicts group.`,
    );
  } else {
    void vscode.window.showInformationMessage(
      `Synced to ${result.payload.target_revision}. ${result.payload.files_updated_count} file${result.payload.files_updated_count === 1 ? '' : 's'} updated.`,
    );
  }

  await ctx.statusCache?.refresh({ skipRemoteUpdate: true });
}
