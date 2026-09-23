import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import type {
  BranchInfo,
  BranchListPayload,
  BranchNewOptions,
  BranchNewPayload,
  FxvCommands,
} from '../../cli/commands';
import type { StatusPayload, WorkspaceSyncPayload } from '../../cli/types.generated';
import { branchNewCommand, branchSwitchCommand } from '../../commands/branch';
import type { CommandContext } from '../../commands/types';
import type { StatusCache } from '../../state/statusCache';

function createHarness(
  overrides: {
    currentBranch?: string;
    branches?: BranchInfo[];
    branchListOk?: boolean;
    branchSwitchOk?: boolean;
    branchNewOk?: boolean;
    conflictedFiles?: string[];
  } = {},
) {
  const currentBranch = overrides.currentBranch ?? 'main';
  const branches = overrides.branches ?? [
    {
      branch: 'main',
      branch_unique_id: '0123456789abcdef',
      branch_type: 'global',
      published_head: 'main.10',
      draft_head: 'main.10.2',
      local_only: false,
      retired: false,
    },
    {
      branch: 'alice/feature',
      branch_unique_id: 'fedcba9876543210',
      branch_type: 'user',
      owner: 'alice',
      draft_head: 'alice/feature.-.1',
      local_only: true,
      retired: false,
    },
    {
      branch: 'legacy',
      branch_unique_id: 'aabbccddeeff0011',
      branch_type: 'global',
      published_head: 'legacy.5',
      local_only: false,
      retired: true,
    },
  ];

  const branchSwitchCalls: string[] = [];
  const branchNewCalls: BranchNewOptions[] = [];
  const refreshes: { skipRemoteUpdate?: boolean }[] = [];

  const fxv = {
    branchList: vi.fn().mockImplementation(() => {
      if (overrides.branchListOk === false) {
        return Promise.resolve({
          ok: false,
          exitCode: 1,
          message: 'failed to list branches',
        });
      }
      return Promise.resolve({
        ok: true,
        payload: { branches } as BranchListPayload,
        text: '',
      });
    }),

    branchSwitch: vi.fn().mockImplementation((branch: string) => {
      branchSwitchCalls.push(branch);
      if (overrides.branchSwitchOk === false) {
        return Promise.resolve({
          ok: false,
          exitCode: 1,
          message: 'failed to switch branch',
        });
      }
      return Promise.resolve({
        ok: true,
        payload: {
          target_revision: `${branch}.1`,
          files_updated_count: 5,
          error_count: 0,
          conflicted_files: overrides.conflictedFiles ?? [],
          files_updated: [],
        } as WorkspaceSyncPayload,
        text: '',
      });
    }),

    branchNew: vi.fn().mockImplementation((opts: BranchNewOptions) => {
      branchNewCalls.push(opts);
      if (overrides.branchNewOk === false) {
        return Promise.resolve({
          ok: false,
          exitCode: 1,
          message: 'failed to create branch',
        });
      }
      return Promise.resolve({
        ok: true,
        payload: {
          branch: opts.name,
          branch_type: opts.global ? 'global' : 'user',
          revision: `${opts.name}.-.1`,
          switched: true,
        } as BranchNewPayload,
        text: '',
      });
    }),
  } as unknown as FxvCommands;

  const statusCache = {
    status: {
      current_branch: currentBranch,
    } as StatusPayload,
    refresh: (opts: { skipRemoteUpdate?: boolean }) => {
      refreshes.push(opts);
      return Promise.resolve(undefined);
    },
  } as unknown as StatusCache;

  const ctx: CommandContext = {
    fxv,
    statusCache,
    scmProvider: undefined,
    log: undefined,
    context: {} as unknown as vscode.ExtensionContext,
    rootUri: vscode.Uri.file('/workspace'),
  };

  return { ctx, fxv, branchSwitchCalls, branchNewCalls, refreshes };
}

describe('branch commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [];
    (vscode.debug as unknown as { activeDebugSession: unknown }).activeDebugSession = undefined;
  });

  describe('branchSwitchCommand', () => {
    it('aborts when no workspace is open', async () => {
      const { ctx, branchSwitchCalls } = createHarness();
      const ctxWithoutRoot = { ...ctx, rootUri: undefined };

      await branchSwitchCommand(ctxWithoutRoot);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'No FlexVault workspace is currently open.',
      );
      expect(branchSwitchCalls).toHaveLength(0);
    });

    it('switches directly when a valid branch name is provided as an argument', async () => {
      const { ctx, branchSwitchCalls, refreshes } = createHarness();

      await branchSwitchCommand(ctx, 'alice/feature');

      expect(branchSwitchCalls).toEqual(['alice/feature']);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        "Switched to branch 'alice/feature' (alice/feature.1).",
      );
      expect(refreshes).toEqual([{ skipRemoteUpdate: false }]);
    });

    it('prompts with a quickpick showing available branches and current marker', async () => {
      const { ctx, branchSwitchCalls } = createHarness();

      vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({
        label: '$(git-branch) alice/feature',
        branchName: 'alice/feature',
      } as never);

      await branchSwitchCommand(ctx);

      expect(ctx.fxv.branchList).toHaveBeenCalledWith({ all: true });
      expect(vscode.window.showQuickPick).toHaveBeenCalled();
      const calls = vi.mocked(vscode.window.showQuickPick).mock.calls;
      const items = (calls[0]?.[0] ?? []) as {
        label: string;
        description: string;
        isCreateNew?: boolean;
        branchName?: string;
      }[];

      // First item is create new branch
      expect(items[0]?.isCreateNew).toBe(true);
      // Current branch has check mark
      const currentItem = items.find((i) => i.branchName === 'main');
      expect(currentItem?.label).toContain('$(check)');
      expect(currentItem?.description).toContain('current');

      expect(branchSwitchCalls).toEqual(['alice/feature']);
    });

    it('informs the user and does nothing when selecting the current branch', async () => {
      const { ctx, branchSwitchCalls } = createHarness();

      vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({
        label: '$(check) main',
        branchName: 'main',
      } as never);

      await branchSwitchCommand(ctx);

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        "Already on branch 'main'.",
      );
      expect(branchSwitchCalls).toHaveLength(0);
    });

    it('delegates to branchNewCommand when user selects Create new branch...', async () => {
      const { ctx, branchNewCalls } = createHarness();

      vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({
        label: '$(plus) Create new branch...',
        isCreateNew: true,
      } as never);

      vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('my-new-feat');

      await branchSwitchCommand(ctx);

      expect(branchNewCalls).toEqual([{ name: 'my-new-feat' }]);
    });

    it('aborts cleanly when quickpick is dismissed', async () => {
      const { ctx, branchSwitchCalls } = createHarness();

      vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined);

      await branchSwitchCommand(ctx);

      expect(branchSwitchCalls).toHaveLength(0);
    });

    it('displays a warning when switch results in merge conflicts', async () => {
      const { ctx } = createHarness({ conflictedFiles: ['art/hero.png'] });

      await branchSwitchCommand(ctx, 'alice/feature');

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        "Switched to branch 'alice/feature'. Switch completed with 1 conflict. Please resolve them in the Conflicts group.",
      );
    });
  });

  describe('branchNewCommand', () => {
    it('creates a new branch from argument and refreshes status', async () => {
      const { ctx, branchNewCalls, refreshes } = createHarness();

      await branchNewCommand(ctx, 'feature-world');

      expect(branchNewCalls).toEqual([{ name: 'feature-world' }]);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        "Created branch 'feature-world' at feature-world.-.1. Workspace is now on 'feature-world'.",
      );
      expect(refreshes).toEqual([{ skipRemoteUpdate: false }]);
    });

    it('prompts for a branch name with input validation when no argument is given', async () => {
      const { ctx, branchNewCalls } = createHarness();

      vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('cool-branch');

      await branchNewCommand(ctx);

      expect(vscode.window.showInputBox).toHaveBeenCalled();
      const options = vi.mocked(vscode.window.showInputBox).mock.calls[0]?.[0];
      expect(options?.validateInput?.('')).toBe('Branch name cannot be empty.');
      expect(options?.validateInput?.('invalid/name!')).toContain('can only contain');
      expect(options?.validateInput?.('valid-name_123')).toBeNull();

      expect(branchNewCalls).toEqual([{ name: 'cool-branch' }]);
    });

    it('aborts cleanly when input box is cancelled', async () => {
      const { ctx, branchNewCalls } = createHarness();

      vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(undefined);

      await branchNewCommand(ctx);

      expect(branchNewCalls).toHaveLength(0);
    });
  });
});
