import * as assert from 'node:assert';

import * as vscode from 'vscode';

const EXTENSION_ID = 'flexvault.flexvault-vscode';

suite('extension activation', () => {
  test('the extension is present', () => {
    assert.ok(vscode.extensions.getExtension(EXTENSION_ID));
  });

  test('it activates and registers its commands', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    await extension.activate();
    assert.strictEqual(extension.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'flexvault.showLog',
      'flexvault.refresh',
      'flexvault.publish',
      'flexvault.snapshot',
      'flexvault.sync',
      'flexvault.goto',
      'flexvault.branchSwitch',
      'flexvault.branchNew',
      'flexvault.revert',
      'flexvault.resolveMine',
      'flexvault.resolveTheirs',
      'flexvault.resolveUndo',
      'flexvault.login',
      'flexvault.logout',
      'flexvault.openSettings',
      'flexvault.openDocumentation',
      'flexvault.openWebsite',
      'flexvault.reportFeedback',
      'flexvault.historyShowChanges',
      'flexvault.historyGotoRevision',
      'flexvault.historyCopyRevision',
      'flexvault.historyOpenChange',
      'flexvault.historyRefresh',
    ]) {
      assert.ok(commands.includes(id), `missing command ${id}`);
    }
  });

  test('mutation commands handle execution without crashing on missing workspace or menu arguments', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    await extension.activate();

    // Invoking sync, publish, and snapshot with mock SCM arguments or undefined should not throw TypeErrors
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('flexvault.sync', { id: 'flexvault' });
    });

    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('flexvault.publish', { id: 'flexvault' });
    });

    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('flexvault.snapshot', { id: 'flexvault' });
    });
  });
});
