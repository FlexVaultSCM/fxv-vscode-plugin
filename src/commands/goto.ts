import * as vscode from 'vscode';

import { assertSafeToMutate } from '../state/safetyGuards';
import { withMutationProgress } from '../ui/progress';
import type { CommandContext } from './types';

export async function gotoCommand(ctx: CommandContext, revisionSpec?: string): Promise<void> {
  let spec = revisionSpec?.trim();

  if (!spec || spec.length === 0) {
    const prompted = await vscode.window.showInputBox({
      prompt: 'Enter revision to switch to (e.g. main.10 or main.-.1)',
      placeHolder: 'main.10',
      validateInput: (val) => (val.trim().length === 0 ? 'Revision spec cannot be empty.' : null),
    });
    if (!prompted || prompted.trim().length === 0) {
      return;
    }
    spec = prompted.trim();
  }

  // Modal confirmation per PLAN.md 4.3
  const choice = await vscode.window.showWarningMessage(
    `Switch to revision ${spec}? Your current workspace state will be snapshotted first.`,
    { modal: true },
    'Switch Revision',
  );

  if (choice !== 'Switch Revision') {
    return;
  }

  const safe = await assertSafeToMutate({ rootUri: ctx.rootUri });
  if (!safe) {
    return;
  }

  const result = await withMutationProgress(`Going to revision ${spec}...`, async () => {
    return await ctx.fxv.goto(spec!);
  });

  if (!result.ok) {
    void vscode.window
      .showErrorMessage(`Goto failed: ${result.message}`, 'Show Log')
      .then((act) => act === 'Show Log' && ctx.log?.show());
    return;
  }

  const conflicts = result.payload.conflicted_files;
  if (conflicts && conflicts.length > 0) {
    void vscode.window.showWarningMessage(
      `Switched to revision ${result.payload.target_revision} with ${conflicts.length} unresolved conflict${conflicts.length === 1 ? '' : 's'}.`,
    );
  } else {
    void vscode.window.showInformationMessage(
      `Switched to revision ${result.payload.target_revision}.`,
    );
  }

  await ctx.statusCache?.refresh({ skipRemoteUpdate: true });
}
