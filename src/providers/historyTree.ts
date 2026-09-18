import * as vscode from 'vscode';

import type { FxvCommands } from '../cli/commands';
import type { Logger } from '../cli/logger';
import { specFromCommitInfo, specFromRevision } from '../cli/revision';
import type { RunResult } from '../cli/runner';
import type { StatusPayload } from '../cli/types.generated';
import { getLocalSnapshot } from '../scm/diffBase';
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
export class HistoryTreeProvider
  implements vscode.TreeDataProvider<HistoryTreeElement>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<HistoryTreeElement | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  // Keyed by revision spec so getParent (required by TreeView.reveal) can
  // find a change leaf's owning commit without re-fetching it.
  private readonly commitsBySpec = new Map<string, CommitElement>();

  // Refetched alongside the commit list itself (loadCommits), rather than
  // read from the shared StatusCache, so the "Synced" marker is always
  // current as of the last tree refresh instead of racing a mutation's own
  // follow-up status refresh.
  //
  // Read off head_commit's local_snapshot, not sync_status.synced_revision:
  // that field only moves on an actual `fxv sync` (remote pull bookkeeping),
  // so it goes stale the moment goto/revert/resolve moves the workspace to a
  // different draft. local_snapshot is wherever the workspace actually is
  // right now, draft or published, and every mutation that changes the head
  // updates it — so a draft the user just switched to is marked too, not
  // only its published parent.
  private currentSpec: string | undefined;

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

    this.currentSpec = this.resolveCurrentSpec(statusResult);

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

  private resolveCurrentSpec(statusResult: RunResult<StatusPayload>): string | undefined {
    if (!statusResult.ok) {
      return undefined;
    }
    const localSnapshot = getLocalSnapshot(statusResult.payload.head_commit);
    if (!localSnapshot) {
      return undefined;
    }
    const commit = localSnapshot.commit;
    // A workspace sitting exactly on a published revision, with no draft
    // changes, still reports as a draft at draft_revision 0 (the CLI's alias
    // for its published parent, e.g. main.11.0 for main.11). Collapse that
    // back to the published spec so it matches the published history entry
    // instead of comparing two spellings of the same commit as unequal.
    if (commit.type === 'draft' && commit.draft_revision === 0 && commit.revision !== undefined) {
      return specFromRevision(commit.branch, commit.revision);
    }
    return specFromCommitInfo(commit);
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
    const info = commitSyncInfo(element, this.currentSpec);
    const item = new vscode.TreeItem(
      commitLabel(element.commit),
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    // A stable id (not object identity, since loadCommits rebuilds elements
    // on every refresh) is what lets VS Code keep this node's expansion and
    // selection state across a refresh instead of collapsing it.
    item.id = element.spec;
    item.description = `${commitDescription(element)}${commitStatusSuffix(info)}`;
    item.tooltip = commitTooltip(element);
    item.contextValue = 'flexvaultHistoryCommit';
    item.iconPath = this.commitIcon(info);
    return item;
  }

  private commitIcon(info: CommitSyncInfo): vscode.ThemeIcon {
    // The draft/published color is independent of whether this is the
    // current entry, so a current draft still reads as unpublished rather
    // than borrowing the published "Synced" color.
    const color = info.isDraft
      ? new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
      : info.isSynced
        ? new vscode.ThemeColor('gitDecoration.addedResourceForeground')
        : undefined;
    return new vscode.ThemeIcon(info.isSynced ? 'check' : 'git-commit', color);
  }

  private changeTreeItem(element: ChangeElement): vscode.TreeItem {
    const item = new vscode.TreeItem(changeFileName(element), vscode.TreeItemCollapsibleState.None);
    item.id = `${element.commitSpec}::${element.path}`;
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
