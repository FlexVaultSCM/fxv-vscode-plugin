import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import type { RunFailure } from '../../cli/runner';
import { handleCommandFailure, resetClientUpgradeNotice } from '../../commands/errorHandler';
import type { CommandContext } from '../../commands/types';

const UPGRADE_MESSAGE = 'fxv 0.13.3 is older than 0.14.0, the oldest version this broker serves';

function failure(exitCode: number, message: string): RunFailure {
  return { ok: false, failure: 'error-envelope', message, exitCode, exitClass: 'general', raw: '' };
}

const ctx = { log: undefined } as unknown as CommandContext;

describe('handleCommandFailure', () => {
  beforeEach(() => {
    vi.mocked(vscode.window.showErrorMessage).mockClear();
    resetClientUpgradeNotice();
  });

  it('tells the user to upgrade fxv on exit 94, once per session', () => {
    handleCommandFailure('Sync', failure(94, UPGRADE_MESSAGE), ctx);
    handleCommandFailure('Snapshot', failure(94, UPGRADE_MESSAGE), ctx);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `FlexVault: ${UPGRADE_MESSAGE}. Install a newer release of fxv.`,
      'Show Log',
    );
  });

  it('keeps the generic message for other failures', () => {
    handleCommandFailure('Sync', failure(1, 'boom'), ctx);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Sync failed: boom', 'Show Log');
  });
});
