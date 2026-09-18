import * as vscode from 'vscode';

import { parseSpec } from '../cli/revision';
import { assertSafeToMutate } from '../state/safetyGuards';
import { withMutationProgress } from '../ui/progress';
import { handleCommandFailure } from './errorHandler';
import type { CommandContext } from './types';

export async function gotoCommand(ctx: CommandContext, revisionSpec?: unknown): Promise<void> {
  if (!ctx.rootUri) {
    void vscode.window.showErrorMessage('No FlexVault workspace is currently open.');
    return;
  }

  let spec = typeof revisionSpec === 'string' ? revisionSpec.trim() : undefined;

  if (!spec || spec.length === 0) {
    const prompted = await vscode.window.showInputBox({
      prompt: 'Enter revision to switch to (e.g. main.10 or main.-.1)',
      placeHolder: 'main.10',
      validateInput: (val) => {
        const trimmed = val.trim();
        if (trimmed.length === 0) {
          return 'Revision spec cannot be empty.';
        }
        if (!parseSpec(trimmed)) {
          return 'Invalid revision spec (expected format: branch.revision or branch.revision.draft).';
        }
        return null;
      },
    });
    if (!prompted || prompted.trim().length === 0) {
      return;
    }
    spec = prompted.trim();
  }

  // Safety guards checked before modal confirmation
  const safe = await assertSafeToMutate({ rootUri: ctx.rootUri });
  if (!safe) {
    return;
  }

  // Modal confirmation since goto rewrites the workspace
  const choice = await vscode.window.showWarningMessage(
    `Switch to revision ${spec}? Your current workspace state will be snapshotted first.`,
    { modal: true },
    'Switch Revision',
  );

  if (choice !== 'Switch Revision') {
    return;
  }

  const result = await withMutationProgress(`Going to revision ${spec}...`, async () => {
    return await ctx.fxv.goto(spec!);
  });

  if (!result.ok) {
    handleCommandFailure('Goto', result, ctx, () => gotoCommand(ctx, revisionSpec));
    return;
  }

  const conflicts = result.payload.conflicted_files;
  if (conflicts && conflicts.length > 0) {
    void vscode.window.showWarningMessage(
      `Switched to revision ${result.payload.target_revision} with ${conflicts.length} unresolved conflict${conflicts.length === 1 ? '' : 's'}.`,
    );
  } else if (result.payload.error_count > 0) {
    void vscode.window.showWarningMessage(
      `Switched to revision ${result.payload.target_revision}. ${result.payload.files_updated_count} updated, ${result.payload.error_count} failed to update.`,
    );
  } else {
    void vscode.window.showInformationMessage(
      `Switched to revision ${result.payload.target_revision}.`,
    );
  }

  await ctx.statusCache?.refresh({ skipRemoteUpdate: true });
}
