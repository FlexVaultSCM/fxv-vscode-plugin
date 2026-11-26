import * as vscode from 'vscode';

import { EXIT_CODES } from '../cli/envelope';
import { describeLockHolder, parseLockHolder } from '../cli/lockErrors';
import type { RunFailure } from '../cli/runner';
import type { Log } from '../ui/log';
import type { CommandContext } from './types';

let clientUpgradeNotified = false;

/**
 * Exit 94: a broker refused this fxv as too old. Every later call fails the
 * same way until fxv is upgraded, so this is shown once per session.
 */
export function notifyClientUpgradeRequired(message: string, log: Log | undefined): void {
  if (clientUpgradeNotified) {
    return;
  }
  clientUpgradeNotified = true;
  void vscode.window
    .showErrorMessage(
      `FlexVault: ${message.trim().replace(/\.$/, '')}. Install a newer release of fxv.`,
      'Show Log',
    )
    .then((action) => {
      if (action === 'Show Log') {
        log?.show();
      }
    });
}

/** Test hook: lets each test observe the once-per-session notification. */
export function resetClientUpgradeNotice(): void {
  clientUpgradeNotified = false;
}

/**
 * Handles command failures uniformly according to the exit code taxonomy:
 * - Exit 99: Workspace is locked by another process. Surface with a Retry option.
 * - Exit 98: A previous sync was interrupted. Prompt to run fxv resume or status.
 * - Exit 94: fxv is too old for the broker. Tell the user to upgrade, once.
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

  if (result.exitCode === EXIT_CODES.clientUpgradeRequired) {
    notifyClientUpgradeRequired(result.message, ctx.log);
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
