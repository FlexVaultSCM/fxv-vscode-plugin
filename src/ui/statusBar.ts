import * as vscode from 'vscode';

import type { StatusPayload } from '../cli/types.generated';

/**
 * Status bar controls for FlexVault:
 * - Branch item showing repository name and branch, clicking opens branch switch.
 * - Sync item showing synchronization and login state, clicking triggers sync or login.
 */
export class StatusBar implements vscode.Disposable {
  private readonly branchItem: vscode.StatusBarItem;
  private readonly syncItem: vscode.StatusBarItem | undefined;

  constructor(
    createBranchItem?: () => vscode.StatusBarItem,
    createSyncItem?: () => vscode.StatusBarItem,
  ) {
    this.branchItem = createBranchItem
      ? createBranchItem()
      : vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.syncItem = createSyncItem
      ? createSyncItem()
      : createBranchItem
        ? undefined
        : vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  }

  update(status: StatusPayload | undefined, repoName?: string): void {
    if (!status) {
      this.branchItem.hide();
      this.syncItem?.hide();
      return;
    }

    const branch = status.current_branch;
    const loggedIn = status.current_user !== undefined && status.current_user !== null;
    const syncStatus = status.sync_status;
    const behind = syncStatus && !syncStatus.up_to_date ? syncStatus.revisions_behind : 0;

    const label = repoName
      ? `$(repo) ${repoName} $(git-branch) ${branch}`
      : `$(git-branch) ${branch}`;
    this.branchItem.text = label;

    const tooltipLines = [
      repoName ? `FlexVault: ${repoName} on branch ${branch}` : `FlexVault: on branch ${branch}`,
    ];
    tooltipLines.push('Click to switch branch');
    this.branchItem.tooltip = tooltipLines.join('\n');
    this.branchItem.command = 'flexvault.branchSwitch';
    this.branchItem.show();

    if (this.syncItem) {
      if (!loggedIn) {
        this.syncItem.text = '$(sign-in)';
        this.syncItem.tooltip = 'Logged out of FlexVault\nClick to log in';
        this.syncItem.command = 'flexvault.login';
      } else if (behind > 0) {
        this.syncItem.text = `$(sync) ${behind}↓`;
        this.syncItem.tooltip = `${behind} revision${behind === 1 ? '' : 's'} behind the remote\nClick to sync`;
        this.syncItem.command = 'flexvault.sync';
      } else {
        this.syncItem.text = '$(sync)';
        this.syncItem.tooltip = 'FlexVault: up to date\nClick to sync';
        this.syncItem.command = 'flexvault.sync';
      }
      this.syncItem.show();
    }
  }

  showError(message: string): void {
    this.branchItem.text = '$(error) FlexVault';
    this.branchItem.tooltip = `FlexVault: status error\n${message}\n\nClick to show log`;
    this.branchItem.command = 'flexvault.showLog';
    this.branchItem.show();
    this.syncItem?.hide();
  }

  dispose(): void {
    this.branchItem.dispose();
    this.syncItem?.dispose();
  }
}
