import * as vscode from 'vscode';

import { assertSafeToMutate } from '../state/safetyGuards';
import { withMutationProgress } from '../ui/progress';
import type { CommandContext } from './types';

export async function snapshotCommand(
  ctx: CommandContext,
  explicitDescription?: string,
): Promise<void> {
  const safe = await assertSafeToMutate({ rootUri: ctx.rootUri });
  if (!safe) {
    return;
  }

  const inputBox = ctx.scmProvider?.inputBox;
  const inputBoxText = inputBox?.value.trim();

  let description: string | undefined = explicitDescription?.trim();
  let usedInputBox = false;

  if (!description && inputBoxText && inputBoxText.length > 0) {
    description = inputBoxText;
    usedInputBox = true;
  }

  // An empty description is never passed: snapshot -d "" hard-errors.
  const descToPass = description && description.length > 0 ? description : undefined;

  const result = await withMutationProgress('Creating snapshot...', async () => {
    return await ctx.fxv.snapshot(descToPass);
  });

  if (!result.ok) {
    void vscode.window
      .showErrorMessage(`Snapshot failed: ${result.message}`, 'Show Log')
      .then((action) => {
        if (action === 'Show Log') {
          ctx.log?.show();
        }
      });
    return;
  }

  if (usedInputBox && inputBox) {
    inputBox.value = '';
  }

  await ctx.statusCache?.refresh({ skipRemoteUpdate: true });
}
