import * as path from 'path';
import * as vscode from 'vscode';

import { resolvePreviousRevisionSpecFromSpec } from '../cli/revision';
import type { ChangeElement, CommitElement } from '../providers/historyItems';
import type { HistoryFilter } from '../providers/historyTree';
import { toFxvUri } from '../providers/fxvUri';
import type { CommandContext } from './types';

/**
 * Per-entry history actions: show changes, go to revision, and copy revision.
 * "Show changes" reveals the commit's node rather than duplicating
 * loadChanges, since expanding it already drives the same fetch.
 */

export async function historyShowChangesCommand(
  ctx: CommandContext,
  element: CommitElement,
): Promise<void> {
  await ctx.historyTreeView?.reveal(element, { expand: true, focus: true, select: true });
}

export async function historyGotoRevisionCommand(
  _ctx: CommandContext,
  element: CommitElement,
): Promise<void> {
  await vscode.commands.executeCommand('flexvault.goto', element.spec);
}

export async function historyCopyRevisionCommand(
  _ctx: CommandContext,
  element: CommitElement,
): Promise<void> {
  await vscode.env.clipboard.writeText(element.spec);
  void vscode.window.showInformationMessage(`Copied ${element.spec} to the clipboard.`);
}

/**
 * Opens a diff between a changed file at the commit that changed it and its
 * previous revision in history, reusing the fxv: content provider.
 * When no previous revision is available (e.g. root commit), opens the
 * historical file directly.
 */
export async function historyOpenChangeCommand(
  _ctx: CommandContext,
  element: ChangeElement,
): Promise<void> {
  const fileName = path.basename(element.path);
  const currentUri = toFxvUri(element.path, element.commitSpec);

  const previousSpec =
    element.previousCommitSpec ?? resolvePreviousRevisionSpecFromSpec(element.commitSpec);

  if (!previousSpec) {
    if (element.action === 'deleted') {
      void vscode.window.showInformationMessage(
        `${fileName} was deleted in revision ${element.commitSpec}.`,
      );
      return;
    }
    await vscode.window.showTextDocument(currentUri);
    return;
  }

  const previousUri = toFxvUri(element.path, previousSpec);
  const title = `${fileName} (${previousSpec} ↔ ${element.commitSpec})`;
  await vscode.commands.executeCommand('vscode.diff', previousUri, currentUri, title);
}

export function historyFilterDescription(filter: HistoryFilter): string {
  switch (filter) {
    case 'draft':
      return 'Drafts';
    case 'published':
      return 'Published';
    default:
      return '';
  }
}

interface FilterPickItem extends vscode.QuickPickItem {
  readonly filter: HistoryFilter;
}

export async function historyFilterCommand(
  ctx: CommandContext,
  targetFilter?: unknown,
): Promise<void> {
  const currentFilter = ctx.historyProvider?.getFilter() ?? 'all';
  let filter: HistoryFilter | undefined;

  if (targetFilter === 'all' || targetFilter === 'draft' || targetFilter === 'published') {
    filter = targetFilter;
  } else {
    const items: FilterPickItem[] = [
      {
        label: `${currentFilter === 'all' ? '$(check) ' : ''}All Revisions`,
        description: 'Show both draft and published revisions',
        filter: 'all',
      },
      {
        label: `${currentFilter === 'draft' ? '$(check) ' : ''}Drafts Only`,
        description: 'Show only local draft revisions',
        filter: 'draft',
      },
      {
        label: `${currentFilter === 'published' ? '$(check) ' : ''}Published Only`,
        description: 'Show only published revisions',
        filter: 'published',
      },
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Filter history revisions',
    });

    if (!selected) {
      return;
    }
    filter = selected.filter;
  }

  ctx.historyProvider?.setFilter(filter);
  if (ctx.historyTreeView) {
    ctx.historyTreeView.description = historyFilterDescription(filter);
  }

  const config = vscode.workspace.getConfiguration('flexvault');
  if (typeof config.update === 'function') {
    void config.update('historyFilter', filter, vscode.ConfigurationTarget.Global);
  }
}
