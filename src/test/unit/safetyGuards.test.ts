import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import { assertSafeToMutate } from '../../state/safetyGuards';

describe('assertSafeToMutate', () => {
  it('blocks when active debug session is running', async () => {
    let warningMessage = '';
    const safe = await assertSafeToMutate({
      getActiveDebugSession: () => true,
      showWarningMessage: (msg) => {
        warningMessage = msg;
        return Promise.resolve(undefined);
      },
    });

    expect(safe).toBe(false);
    expect(warningMessage).toContain('debug session');
  });

  it('proceeds when no debug session and no dirty documents', async () => {
    const safe = await assertSafeToMutate({
      getActiveDebugSession: () => false,
      rootUri: vscode.Uri.file('/repo'),
      getDirtyDocuments: () => [],
    });

    expect(safe).toBe(true);
  });

  it('prompts user when dirty documents exist under root and allows continue if saved', async () => {
    let promptShown = false;
    let saveAllCalled = false;

    const dirtyDoc = {
      isDirty: true,
      uri: vscode.Uri.file('/repo/src/file.txt'),
    } as unknown as vscode.TextDocument;

    const safe = await assertSafeToMutate({
      getActiveDebugSession: () => false,
      rootUri: vscode.Uri.file('/repo'),
      getDirtyDocuments: () => [dirtyDoc],
      showWarningMessage: (_msg, _options, ...items) => {
        promptShown = true;
        expect(items).toContain('Save All and Continue');
        return Promise.resolve('Save All and Continue');
      },
      saveAll: () => {
        saveAllCalled = true;
        return Promise.resolve(true);
      },
    });

    expect(promptShown).toBe(true);
    expect(saveAllCalled).toBe(true);
    expect(safe).toBe(true);
  });

  it('blocks when user cancels the save prompt for dirty documents', async () => {
    const dirtyDoc = {
      isDirty: true,
      uri: vscode.Uri.file('/repo/src/file.txt'),
    } as unknown as vscode.TextDocument;

    const safe = await assertSafeToMutate({
      getActiveDebugSession: () => false,
      rootUri: vscode.Uri.file('/repo'),
      getDirtyDocuments: () => [dirtyDoc],
      showWarningMessage: () => Promise.resolve(undefined),
    });

    expect(safe).toBe(false);
  });

  it('ignores dirty documents outside the workspace root', async () => {
    const outsideDoc = {
      isDirty: true,
      uri: vscode.Uri.file('/other/directory/file.txt'),
    } as unknown as vscode.TextDocument;

    const safe = await assertSafeToMutate({
      getActiveDebugSession: () => false,
      rootUri: vscode.Uri.file('/repo'),
      getDirtyDocuments: () => [outsideDoc],
    });

    expect(safe).toBe(true);
  });
});
