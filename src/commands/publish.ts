import * as vscode from 'vscode';

import { assertSafeToMutate } from '../state/safetyGuards';
import { withMutationProgress } from '../ui/progress';
import { handleCommandFailure } from './errorHandler';
import type { CommandContext } from './types';

/**
 * Executes the full publish orchestration flow:
 * 1. Refuse while conflicts exist.
 * 2. Refuse while logged out, offering login.
 * 3. Prompt for description if SCM input box is empty.
 * 4. Run safety guards (active debug session, dirty workspace editors).
 * 5. Snapshot workspace. On failure, abort; nothing has changed.
 * 6. If sync_status is behind remote, confirm and sync. On failure or if sync
 *    produces conflicts, abort publish and report draft safety.
 * 7. Publish. On failure, report that snapshot succeeded locally and remains draft.
 * 8. On success, clear the SCM input box and refresh status.
 */
export async function publishCommand(
  ctx: CommandContext,
  explicitDescription?: unknown,
): Promise<void> {
  if (!ctx.rootUri) {
    void vscode.window.showErrorMessage('No FlexVault workspace is currently open.');
    return;
  }

  let status = ctx.statusCache?.status;
  if (!status && ctx.statusCache) {
    status = await ctx.statusCache.refresh({ skipRemoteUpdate: true });
  }

  // 1. Refuse while conflicts exist
  const hasConflicts = status?.files.some(
    (f) => f.conflict_state !== undefined && f.conflict_state !== null,
  );
  if (hasConflicts) {
    void vscode.window.showErrorMessage(
      'Cannot publish while there are unresolved conflicts. Resolve conflicts first.',
    );
    return;
  }

  // 2. Refuse while logged out
  const loggedIn = status?.current_user !== undefined && status?.current_user !== null;
  if (!loggedIn) {
    const action = await vscode.window.showErrorMessage(
      'No user is logged in to this workspace. Please log in before publishing.',
      'Log In',
    );
    if (action === 'Log In') {
      await vscode.commands.executeCommand('flexvault.login');
    }
    return;
  }

  // 3. Resolve description: prefer SCM input box, prompt if both empty
  const inputBox = ctx.scmProvider?.inputBox;
  const explicit = typeof explicitDescription === 'string' ? explicitDescription.trim() : '';
  let description = explicit || inputBox?.value.trim() || '';

  if (description.length === 0) {
    const prompted = await vscode.window.showInputBox({
      prompt: 'Enter a description for this publication',
      placeHolder: 'Description is required to publish',
      validateInput: (val) => (val.trim().length === 0 ? 'Description cannot be empty.' : null),
    });
    if (!prompted || prompted.trim().length === 0) {
      return;
    }
    description = prompted.trim();
  }

  // 4. Safety guards
  const safe = await assertSafeToMutate({ rootUri: ctx.rootUri });
  if (!safe) {
    return;
  }

  await withMutationProgress('Publishing...', async () => {
    // 5. Snapshot step
    const snapshotResult = await ctx.fxv.snapshot(description);
    if (!snapshotResult.ok) {
      handleCommandFailure('Snapshot', snapshotResult, ctx);
      return;
    }

    // 6. Check if behind remote and sync if needed
    if (status?.sync_status && !status.sync_status.up_to_date) {
      const choice = await vscode.window.showWarningMessage(
        'Your branch is behind the remote. Sync before publishing?',
        { modal: true },
        'Sync and Continue',
      );

      if (choice !== 'Sync and Continue') {
        void vscode.window.showInformationMessage(
          'Publish cancelled. Changes were snapshotted locally as an unpublished draft.',
        );
        await ctx.statusCache?.refresh({ skipRemoteUpdate: true });
        return;
      }

      const syncResult = await ctx.fxv.sync();
      if (!syncResult.ok) {
        if (syncResult.exitCode === 99 || syncResult.exitCode === 98) {
          handleCommandFailure('Sync', syncResult, ctx);
        } else {
          void vscode.window
            .showErrorMessage(
              `Sync failed: ${syncResult.message}. Your changes are safe as an unpublished draft.`,
              'Show Log',
            )
            .then((act) => act === 'Show Log' && ctx.log?.show());
        }
        await ctx.statusCache?.refresh({ skipRemoteUpdate: true });
        return;
      }

      // Check if sync produced conflicts
      if (syncResult.payload.conflicted_files && syncResult.payload.conflicted_files.length > 0) {
        const count = syncResult.payload.conflicted_files.length;
        void vscode.window.showErrorMessage(
          `Sync produced ${count} conflict${count === 1 ? '' : 's'}. Resolve conflicts before publishing.`,
        );
        await ctx.statusCache?.refresh({ skipRemoteUpdate: true });
        return;
      }
    }

    // 7. Publish step
    const publishResult = await ctx.fxv.publish(description);
    if (!publishResult.ok) {
      if (publishResult.exitCode === 99 || publishResult.exitCode === 98) {
        handleCommandFailure('Publish', publishResult, ctx);
      } else {
        void vscode.window
          .showErrorMessage(
            `Publish failed: ${publishResult.message}. The snapshot succeeded locally and your changes remain an unpublished draft.`,
            'Show Log',
          )
          .then((act) => act === 'Show Log' && ctx.log?.show());
      }
      await ctx.statusCache?.refresh({ skipRemoteUpdate: true });
      return;
    }

    // 8. Success: clear SCM input box and refresh status
    if (inputBox) {
      inputBox.value = '';
    }
    void vscode.window.showInformationMessage('Successfully published changes.');
    await ctx.statusCache?.refresh({ skipRemoteUpdate: false });
  });
}
