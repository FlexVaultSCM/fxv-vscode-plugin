import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import { FlexVaultScmProvider } from '../../scm/provider';
import type { StatusPayload } from '../../cli/types.generated';
import type { StatusCache } from '../../state/statusCache';

describe('FlexVaultScmProvider', () => {
  it('configures resource groups with hideWhenEmpty for conflicts and unpublished groups', () => {
    const rootUri = vscode.Uri.file('/test/workspace');
    const listeners: Array<(status: StatusPayload | undefined) => void> = [];
    const statusCache = {
      status: undefined,
      onDidChangeStatus: vi
        .fn()
        .mockImplementation((cb: (status: StatusPayload | undefined) => void) => {
          listeners.push(cb);
          return { dispose: vi.fn() };
        }),
    };

    const provider = new FlexVaultScmProvider(rootUri, statusCache as unknown as StatusCache);

    // Verify SCM was created with groups
    const scmMock = vi.mocked(vscode.scm.createSourceControl);
    const scmInstance = scmMock.mock.results.slice(-1)[0]?.value as {
      resourceGroups: Array<{ id: string; label: string; hideWhenEmpty?: boolean }>;
    };
    expect(scmInstance).toBeDefined();

    const groups: Array<{ id: string; label: string; hideWhenEmpty?: boolean }> =
      scmInstance.resourceGroups;
    const conflicts = groups.find((g) => g.id === 'conflicts');
    const unpublished = groups.find((g) => g.id === 'unpublished');
    const workspace = groups.find((g) => g.id === 'workspace');

    expect(conflicts?.hideWhenEmpty).toBe(true);
    expect(unpublished?.hideWhenEmpty).toBe(true);
    expect(workspace?.hideWhenEmpty).toBe(false);

    provider.dispose();
  });

  it('disables input box and clears groups when setError is called', () => {
    const rootUri = vscode.Uri.file('/test/workspace');
    const statusCache = {
      status: undefined,
      onDidChangeStatus: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    };

    const provider = new FlexVaultScmProvider(rootUri, statusCache as unknown as StatusCache);

    expect(provider.inputBox.enabled).toBe(true);

    provider.setError(true);
    expect(provider.inputBox.enabled).toBe(false);

    provider.setError(false);
    expect(provider.inputBox.enabled).toBe(true);

    provider.dispose();
  });

  it('updates statusBarCommands with branch switch and sync commands', () => {
    const rootUri = vscode.Uri.file('/test/workspace');
    let statusCallback: ((status: StatusPayload | undefined) => void) | undefined;
    const statusCache = {
      status: undefined,
      onDidChangeStatus: vi.fn().mockImplementation((cb) => {
        statusCallback = cb;
        return { dispose: vi.fn() };
      }),
    };

    const provider = new FlexVaultScmProvider(rootUri, statusCache as unknown as StatusCache);

    const scmMock = vi.mocked(vscode.scm.createSourceControl);
    const scmInstance = scmMock.mock.results.slice(-1)[0]?.value as {
      statusBarCommands?: vscode.Command[];
    };

    expect(scmInstance.statusBarCommands).toBeUndefined();

    // Fire status with current_branch and 2 revisions behind
    statusCallback?.({
      current_branch: 'feature-x',
      current_user: 'alice',
      head_commit: { state: 'parented_draft' } as StatusPayload['head_commit'],
      sync_status: {
        up_to_date: false,
        revisions_behind: 2,
        published_head_revision: 5,
        synced_revision: 3,
      },
      files: [],
      file_change_counts: { total: 0, unpublished: 0, workspace_need_snapshot: 0 },
    });

    expect(scmInstance.statusBarCommands).toBeDefined();
    expect(scmInstance.statusBarCommands).toHaveLength(2);
    expect(scmInstance.statusBarCommands?.[0]?.command).toBe('flexvault.branchSwitch');
    expect(scmInstance.statusBarCommands?.[0]?.title).toBe('$(git-branch) feature-x');
    expect(scmInstance.statusBarCommands?.[1]?.command).toBe('flexvault.sync');
    expect(scmInstance.statusBarCommands?.[1]?.title).toBe('$(sync) 2↓');

    // Calling setError(true) clears statusBarCommands
    provider.setError(true);
    expect(scmInstance.statusBarCommands).toEqual([]);

    provider.dispose();
  });
});
