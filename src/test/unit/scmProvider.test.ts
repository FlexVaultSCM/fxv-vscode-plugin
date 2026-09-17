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
});
