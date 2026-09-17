import * as vscode from 'vscode';

import { describeLockHolder, parseLockHolder } from '../cli/lockErrors';
import type { RunFailure } from '../cli/runner';
import type { CommandContext } from './types';

/**
 * Handles command failures uniformly according to the exit code taxonomy (PLAN.md 2.4):
 * - Exit 99: Workspace is locked by another process. Surface with a Retry option.
 * - Exit 98: A previous sync was interrupted. Prompt to run fxv resume or status.
 * - Other: Show error notification with "Show Log".
 */
export function handleCommandFailure(
  operationName: string,
  result: RunFailure,
  ctx: CommandContext,
  retry?: () => Promise<void>,
): void {
  if (result.exitCode === 99) {
    const holder = parseLockHolder(result.message);
    const description = describeLockHolder(holder);
    const items = retry ? ['Retry', 'Show Log'] : ['Show Log'];

    void vscode.window
      .showWarningMessage(`Workspace is locked by ${description}.`, ...items)
      .then((action) => {
        if (action === 'Retry' && retry) {
          void retry();
        } else if (action === 'Show Log') {
          ctx.log?.show();
        }
      });
    return;
  }

  if (result.exitCode === 98) {
    void vscode.window
      .showErrorMessage(
        'A previous FlexVault operation was interrupted. Run fxv status or resume to recover.',
        'Show Log',
      )
      .then((action) => {
        if (action === 'Show Log') {
          ctx.log?.show();
        }
      });
    return;
  }

  void vscode.window
    .showErrorMessage(`${operationName} failed: ${result.message}`, 'Show Log')
    .then((action) => {
      if (action === 'Show Log') {
        ctx.log?.show();
      }
    });
}
