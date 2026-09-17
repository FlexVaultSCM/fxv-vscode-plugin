import * as path from 'path';
import * as vscode from 'vscode';

import type { RevertTarget } from '../cli/commands';
import type { FlexVaultResourceState } from '../scm/provider';
import { assertSafeToMutate } from '../state/safetyGuards';
import { withMutationProgress } from '../ui/progress';
import type { CommandContext } from './types';

export async function revertCommand(
  ctx: CommandContext,
  resource?: FlexVaultResourceState | vscode.SourceControlResourceState,
  selected?: (FlexVaultResourceState | vscode.SourceControlResourceState)[],
): Promise<void> {
  const paths = extractPaths(ctx, resource, selected);
  let target: RevertTarget;

  if (paths.length > 0) {
    const count = paths.length;
    const fileWord = count === 1 ? 'file' : 'files';
    const choice = await vscode.window.showWarningMessage(
      `Revert changes in ${count} ${fileWord}? Your current state will be snapshotted first.`,
      { modal: true },
      'Revert',
    );
    if (choice !== 'Revert') {
      return;
    }
    target = { paths };
  } else {
    const choice = await vscode.window.showWarningMessage(
      'Revert all changes in the workspace? Your current state will be snapshotted first.',
      { modal: true },
      'Revert All Changes',
    );
    if (choice !== 'Revert All Changes') {
      return;
    }
    target = { all: true };
  }

  const safe = await assertSafeToMutate({ rootUri: ctx.rootUri });
  if (!safe) {
    return;
  }

  const result = await withMutationProgress('Reverting changes...', async () => {
    return await ctx.fxv.revert(target);
  });

  if (!result.ok) {
    void vscode.window
      .showErrorMessage(`Revert failed: ${result.message}`, 'Show Log')
      .then((act) => act === 'Show Log' && ctx.log?.show());
    return;
  }

  void vscode.window.showInformationMessage(
    `Reverted ${result.payload.files_updated_count} file${result.payload.files_updated_count === 1 ? '' : 's'}.`,
  );

  await ctx.statusCache?.refresh({ skipRemoteUpdate: true });
}

function extractPaths(
  ctx: CommandContext,
  resource?: FlexVaultResourceState | vscode.SourceControlResourceState,
  selected?: (FlexVaultResourceState | vscode.SourceControlResourceState)[],
): string[] {
  if (selected && selected.length > 0) {
    return selected
      .map((item) => extractSinglePath(ctx, item))
      .filter((p): p is string => p !== undefined);
  }
  if (resource) {
    const p = extractSinglePath(ctx, resource);
    return p ? [p] : [];
  }
  return [];
}

function extractSinglePath(
  ctx: CommandContext,
  item: FlexVaultResourceState | vscode.SourceControlResourceState,
): string | undefined {
  if ('descriptor' in item && item.descriptor?.path) {
    return item.descriptor.path;
  }
  if (item.resourceUri && ctx.rootUri) {
    const rel = path.relative(ctx.rootUri.fsPath, item.resourceUri.fsPath);
    return rel.replace(/\\/g, '/');
  }
  return undefined;
}
