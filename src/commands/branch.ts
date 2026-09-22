import * as vscode from 'vscode';

import { assertSafeToMutate } from '../state/safetyGuards';
import { withMutationProgress } from '../ui/progress';
import { handleCommandFailure } from './errorHandler';
import type { CommandContext } from './types';

export async function branchSwitchCommand(
  ctx: CommandContext,
  targetBranch?: unknown,
): Promise<void> {
  if (!ctx.rootUri) {
    void vscode.window.showErrorMessage('No FlexVault workspace is currently open.');
    return;
  }

  const safe = await assertSafeToMutate({ rootUri: ctx.rootUri });
  if (!safe) {
    return;
  }

  let branchName =
    typeof targetBranch === 'string' && targetBranch.trim().length > 0
      ? targetBranch.trim()
      : undefined;

  if (!branchName) {
    const listResult = await ctx.fxv.branchList({ all: true });
    if (!listResult.ok) {
      handleCommandFailure('Branch List', listResult, ctx, () =>
        branchSwitchCommand(ctx, targetBranch),
      );
      return;
    }

    const branches = listResult.payload.branches;
    const currentBranch = ctx.statusCache?.status?.current_branch;

    interface BranchPickItem extends vscode.QuickPickItem {
      readonly branchName?: string;
      readonly isCreateNew?: boolean;
    }

    const items: BranchPickItem[] = [
      {
        label: '$(plus) Create new branch...',
        description: '',
        detail: 'Create a new branch from current state',
        isCreateNew: true,
      },
    ];

    for (const b of branches) {
      const isCurrent = b.branch === currentBranch;
      const tags: string[] = [];
      if (isCurrent) {
        tags.push('current');
      }
      if (b.retired) {
        tags.push('retired');
      }
      if (b.local_only) {
        tags.push('local only');
      }
      if (b.owner && b.branch_type === 'user') {
        tags.push(`owner: ${b.owner}`);
      }

      const description = tags.length > 0 ? `(${tags.join(', ')})` : '';
      const head = b.draft_head ?? b.published_head;
      const detail = head ? `Head revision: ${head}` : 'No revisions published yet';

      items.push({
        label: isCurrent ? `$(check) ${b.branch}` : `$(git-branch) ${b.branch}`,
        description,
        detail,
        branchName: b.branch,
      });
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a branch to switch to',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) {
      return;
    }

    if (selected.isCreateNew) {
      await branchNewCommand(ctx);
      return;
    }

    if (!selected.branchName || selected.branchName === currentBranch) {
      if (currentBranch) {
        void vscode.window.showInformationMessage(`Already on branch '${currentBranch}'.`);
      }
      return;
    }

    branchName = selected.branchName;
  }

  const result = await withMutationProgress(`Switching to branch '${branchName}'...`, async () => {
    return await ctx.fxv.branchSwitch(branchName!);
  });

  if (!result.ok) {
    handleCommandFailure('Branch Switch', result, ctx, () =>
      branchSwitchCommand(ctx, targetBranch),
    );
    return;
  }

  const conflicts = result.payload.conflicted_files;
  if (conflicts && conflicts.length > 0) {
    void vscode.window.showWarningMessage(
      `Switched to branch '${branchName}'. Switch completed with ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}. Please resolve them in the Conflicts group.`,
    );
  } else {
    void vscode.window.showInformationMessage(
      `Switched to branch '${branchName}' (${result.payload.target_revision}).`,
    );
  }

  await ctx.statusCache?.refresh({ skipRemoteUpdate: false });
}

export async function branchNewCommand(
  ctx: CommandContext,
  suggestedName?: unknown,
): Promise<void> {
  if (!ctx.rootUri) {
    void vscode.window.showErrorMessage('No FlexVault workspace is currently open.');
    return;
  }

  const safe = await assertSafeToMutate({ rootUri: ctx.rootUri });
  if (!safe) {
    return;
  }

  let name =
    typeof suggestedName === 'string' && suggestedName.trim().length > 0
      ? suggestedName.trim()
      : undefined;

  if (!name) {
    const input = await vscode.window.showInputBox({
      prompt: 'Enter new branch name',
      placeHolder: 'feature-name',
      validateInput: (val) => {
        const trimmed = val.trim();
        if (trimmed.length === 0) {
          return 'Branch name cannot be empty.';
        }
        if (!/^[a-zA-Z0-9_\- ]+$/.test(trimmed)) {
          return 'Branch name can only contain letters, digits, underscores, dashes, and spaces.';
        }
        return null;
      },
    });

    if (!input || input.trim().length === 0) {
      return;
    }

    name = input.trim();
  }

  const result = await withMutationProgress(`Creating branch '${name}'...`, async () => {
    return await ctx.fxv.branchNew({ name });
  });

  if (!result.ok) {
    handleCommandFailure('Branch New', result, ctx, () => branchNewCommand(ctx, suggestedName));
    return;
  }

  void vscode.window.showInformationMessage(
    `Created branch '${result.payload.branch}' at ${result.payload.revision}. Workspace is now on '${result.payload.branch}'.`,
  );

  await ctx.statusCache?.refresh({ skipRemoteUpdate: false });
}
