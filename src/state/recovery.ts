import * as vscode from 'vscode';

import { interruptedSync } from '../cli/envelope';
import type { ErrorPayload, InterruptedSyncPayload } from '../cli/types.generated';

export interface RecoveryManagerOptions {
  readonly showWarningMessage?: (
    message: string,
    ...items: string[]
  ) => Thenable<string | undefined>;
  readonly showLog?: () => void;
  readonly executeCommand?: (command: string) => void;
}

function interruptedSyncPayload(error: ErrorPayload): InterruptedSyncPayload | undefined {
  if (!error.error_data) {
    return undefined;
  }
  return interruptedSync(error.error_data);
}

/**
 * Owns the interrupted-operation banner. Detection is free:
 * any `status` returning exit 98 carries the detail this renders. The banner
 * is sticky once shown, since a debounced background `status` keeps
 * re-detecting the same interruption on every file event until it is
 * resolved; `clear()` is what a subsequent successful `status` calls to
 * reset the latch.
 */
export class RecoveryManager {
  private bannerShown = false;
  private latest: InterruptedSyncPayload | undefined;

  constructor(private readonly options: RecoveryManagerOptions = {}) {}

  /** The detail behind the current banner, if any. Exposed for tests. */
  get current(): InterruptedSyncPayload | undefined {
    return this.latest;
  }

  /** Call whenever `status` reports exit 98. */
  handleInterrupted(error: ErrorPayload): void {
    this.latest = interruptedSyncPayload(error);
    if (this.bannerShown) {
      return;
    }
    this.bannerShown = true;
    void this.showBanner(error.message);
  }

  /** Reset the banner-shown latch, allowing the banner to surface on the next check. */
  resetBanner(): void {
    this.bannerShown = false;
  }

  /** Call whenever `status` succeeds: the workspace is no longer interrupted. */
  clear(): void {
    this.latest = undefined;
    this.bannerShown = false;
  }

  private async showBanner(fallbackMessage: string): Promise<void> {
    const showWarning = this.options.showWarningMessage ?? vscode.window.showWarningMessage;
    const payload = this.latest;

    if (!payload) {
      // error_data was missing or unrecognized; fall back to the raw message
      // rather than rendering a banner with nothing to say.
      const action = await showWarning(fallbackMessage, 'Show Log');
      if (action === 'Show Log') {
        this.bannerShown = false;
        this.options.showLog?.();
      }
      return;
    }

    if (payload.state === 'unreadable') {
      const action = await showWarning(
        `FlexVault: an interrupted operation's journal could not be read (${payload.reason}). ` +
          'Run `fxv resume --full` or `fxv doctor reset-sync` from a terminal to recover; neither Finish nor Undo can act on it here.',
        'Show Log',
      );
      if (action === 'Show Log') {
        this.bannerShown = false;
        this.options.showLog?.();
      }
      return;
    }

    const detail = `${payload.completed_entries} of ${payload.total_entries} file changes applied, ${payload.remaining_entries} remaining.`;
    const action = await showWarning(
      `FlexVault: ${payload.summary} ${detail}`,
      'Finish',
      'Undo',
      'Show Log',
    );

    if (action === 'Finish') {
      this.bannerShown = false;
      this.options.executeCommand?.('flexvault.resume');
    } else if (action === 'Undo') {
      this.bannerShown = false;
      this.options.executeCommand?.('flexvault.resumeRollback');
    } else if (action === 'Show Log') {
      this.bannerShown = false;
      this.options.showLog?.();
    }
  }
}
