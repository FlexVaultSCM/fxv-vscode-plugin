import * as vscode from 'vscode';

import type { FxvCommands } from '../cli/commands';
import type { Logger } from '../cli/logger';
import { getChangeKindThemeColorId, getChangeKindTooltip } from '../scm/resources';
import {
  changeFileName,
  changesFromChangeInfoPayload,
  type ChangeElement,
  commitDescription,
  type CommitElement,
  commitLabel,
  commitStatusSuffix,
  commitsFromHistoryPayload,
  type CommitSyncInfo,
  commitSyncInfo,
  commitTooltip,
  type HistoryTreeElement,
} from './historyItems';

const CHANGE_KIND_ICON: Record<ChangeElement['action'], string> = {
  added: 'diff-added',
  modified: 'diff-modified',
  deleted: 'diff-removed',
  maybe_changed: 'diff-modified',
};

/**
 * TreeDataProvider for the History view. Root elements are
 * `history -n <historyLimit>` entries; expanding one loads its
 * `changeinfo <spec>` as child leaves, each wired to open a diff.
 */
export class HistoryTreeProvider implements vscode.TreeDataProvider<HistoryTreeElement> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<HistoryTreeElement | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Keyed by revision spec so getParent (required by TreeView.reveal) can
  // find a change leaf's owning commit without re-fetching it.
  private readonly commitsBySpec = new Map<string, CommitElement>();

  // Refetched alongside the commit list itself (loadCommits), rather than
  // read from the shared StatusCache, so the "Synced" marker is always
  // current as of the last tree refresh instead of racing a mutation's own
  // follow-up status refresh.
  private syncedRevision: number | undefined;

  constructor(
    private readonly fxv: FxvCommands,
    private readonly getHistoryLimit: () => number,
    private readonly log?: Logger,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: HistoryTreeElement): vscode.TreeItem {
    return element.kind === 'commit' ? this.commitTreeItem(element) : this.changeTreeItem(element);
  }

  getParent(element: HistoryTreeElement): HistoryTreeElement | undefined {
    return element.kind === 'commit' ? undefined : this.commitsBySpec.get(element.commitSpec);
  }

  async getChildren(element?: HistoryTreeElement): Promise<HistoryTreeElement[]> {
    if (!element) {
      return this.loadCommits();
    }
    return element.kind === 'commit' ? this.loadChanges(element) : [];
  }

  private async loadCommits(): Promise<CommitElement[]> {
    const [historyResult, statusResult] = await Promise.all([
      this.fxv.history({ count: this.getHistoryLimit() }),
      this.fxv.status({ skipRemoteUpdate: true }),
    ]);

    this.syncedRevision = statusResult.ok
      ? (statusResult.payload.sync_status?.synced_revision ?? undefined)
      : undefined;

    if (!historyResult.ok) {
      this.log?.error(`Failed to load FlexVault history: ${historyResult.message}`);
      return [];
    }
    const commits = commitsFromHistoryPayload(historyResult.payload);
    this.commitsBySpec.clear();
    for (const commit of commits) {
      this.commitsBySpec.set(commit.spec, commit);
    }
    return commits;
  }

  private async loadChanges(element: CommitElement): Promise<ChangeElement[]> {
    const result = await this.fxv.changeinfo(element.spec);
    if (!result.ok) {
      this.log?.error(`Failed to load changes for ${element.spec}: ${result.message}`);
      return [];
    }
    return changesFromChangeInfoPayload(element.spec, result.payload);
  }

  private commitTreeItem(element: CommitElement): vscode.TreeItem {
    const info = commitSyncInfo(element, this.syncedRevision);
    const item = new vscode.TreeItem(
      commitLabel(element.commit),
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.description = `${commitDescription(element)}${commitStatusSuffix(info)}`;
    item.tooltip = commitTooltip(element);
    item.contextValue = 'flexvaultHistoryCommit';
    item.iconPath = this.commitIcon(info);
    return item;
  }

  private commitIcon(info: CommitSyncInfo): vscode.ThemeIcon {
    if (info.isSynced) {
      // What the workspace currently has: the published revision it last synced to.
      return new vscode.ThemeIcon(
        'check',
        new vscode.ThemeColor('gitDecoration.addedResourceForeground'),
      );
    }
    if (info.isDraft) {
      // Snapshotted but not yet published, echoing the SCM view's own color for that state.
      return new vscode.ThemeIcon(
        'git-commit',
        new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
      );
    }
    return new vscode.ThemeIcon('git-commit');
  }

  private changeTreeItem(element: ChangeElement): vscode.TreeItem {
    const item = new vscode.TreeItem(changeFileName(element), vscode.TreeItemCollapsibleState.None);
    item.description = getChangeKindTooltip(element.action);
    item.tooltip = `${element.path} · ${getChangeKindTooltip(element.action)}`;
    item.contextValue = 'flexvaultHistoryChange';
    item.iconPath = new vscode.ThemeIcon(
      CHANGE_KIND_ICON[element.action],
      new vscode.ThemeColor(getChangeKindThemeColorId(element.action)),
    );
    item.command = {
      command: 'flexvault.historyOpenChange',
      title: 'Open Diff',
      arguments: [element],
    };
    return item;
  }
}
