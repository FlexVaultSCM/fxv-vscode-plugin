import * as vscode from 'vscode';

import type { StatusPayload } from '../cli/types.generated';

/**
 * Branch, revisions-behind, and login state. Clicking runs sync while
 * logged in, or login while logged out, covering both cases with one item.
 */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(
    createItem: () => vscode.StatusBarItem = () =>
      vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100),
  ) {
    this.item = createItem();
  }

  update(status: StatusPayload | undefined): void {
    if (!status) {
      this.item.hide();
      return;
    }

    const branch = status.current_branch;
    const loggedIn = status.current_user !== undefined && status.current_user !== null;
    const syncStatus = status.sync_status;
    const behind = syncStatus && !syncStatus.up_to_date ? syncStatus.revisions_behind : 0;

    let text = `$(source-control) ${branch}`;
    if (behind > 0) {
      text += ` ${behind}↓`;
    }
    if (!loggedIn) {
      text += ' $(sign-in)';
    }
    this.item.text = text;

    const tooltipLines = [`FlexVault: on branch ${branch}`];
    if (behind > 0) {
      tooltipLines.push(`${behind} revision${behind === 1 ? '' : 's'} behind the remote`);
    }
    tooltipLines.push(loggedIn ? 'Click to sync' : 'Logged out. Click to log in');
    this.item.tooltip = tooltipLines.join('\n');

    this.item.command = loggedIn ? 'flexvault.sync' : 'flexvault.login';
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
