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
      'flexvault.openDocumentation',
      'flexvault.openWebsite',
      'flexvault.reportFeedback',
    ]) {
      assert.ok(commands.includes(id), `missing command ${id}`);
    }
  });
});
