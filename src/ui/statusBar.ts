import * as vscode from 'vscode';

/**
 * Status bar error indicator for FlexVault:
 * Displays $(error) FlexVault when status errors occur.
 * Healthy branch and sync states are handled natively by SourceControl.statusBarCommands.
 */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(
    createItem: () => vscode.StatusBarItem = () =>
      vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100),
  ) {
    this.item = createItem();
  }

  /**
   * Hides the error item once healthy status is available. Branch and sync
   * items are handled natively by scmProvider.statusBarCommands.
   */
  clearError(): void {
    this.item.hide();
  }

  showError(message: string): void {
    this.item.text = '$(error) FlexVault';
    this.item.tooltip = `FlexVault: status error\n${message}\n\nClick to show log`;
    this.item.command = 'flexvault.showLog';
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
