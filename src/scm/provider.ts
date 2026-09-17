import * as vscode from 'vscode';

import type { StatusPayload } from '../cli/types.generated';
import type { Logger } from '../cli/logger';
import type { StatusCache } from '../state/statusCache';
import { mapStatusToResourceDescriptors, type ResourceDescriptor } from './resources';

export interface FlexVaultResourceState extends vscode.SourceControlResourceState {
  readonly descriptor: ResourceDescriptor;
}

export function createSourceControlResourceState(
  descriptor: ResourceDescriptor,
  rootUri: vscode.Uri,
): FlexVaultResourceState {
  const normalized = descriptor.path.replace(/\\/g, '/');
  const uri = vscode.Uri.joinPath(rootUri, ...normalized.split('/'));

  const decorations: vscode.SourceControlResourceDecorations = {
    strikeThrough: descriptor.strikeThrough,
    tooltip: descriptor.tooltip,
  };

  return {
    resourceUri: uri,
    decorations,
    contextValue: `flexvault.resource.${descriptor.group}`,
    descriptor,
    ...(descriptor.isDeleted
      ? {}
      : {
          command: {
            command: 'vscode.open',
            title: 'Open',
            arguments: [uri],
          },
        }),
  };
}

/**
 * FlexVault Source Control provider.
 * Registers with VS Code's SCM API and binds status snapshots to resource groups.
 */
export class FlexVaultScmProvider implements vscode.Disposable {
  private readonly scm: vscode.SourceControl;
  private readonly conflictsGroup: vscode.SourceControlResourceGroup;
  private readonly unpublishedGroup: vscode.SourceControlResourceGroup;
  private readonly workspaceGroup: vscode.SourceControlResourceGroup;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly rootUri: vscode.Uri,
    private readonly statusCache: StatusCache,
    private readonly log?: Logger,
  ) {
    this.scm = vscode.scm.createSourceControl('flexvault', 'FlexVault', rootUri);
    this.scm.inputBox.placeholder = 'Message (Ctrl+Enter to publish)';
    this.scm.inputBox.enabled = true;
    this.scm.acceptInputCommand = {
      command: 'flexvault.publish',
      title: 'Publish',
    };

    // Conflicts group is listed first, blocks publish, hideWhenEmpty is true
    this.conflictsGroup = this.scm.createResourceGroup('conflicts', 'Conflicts');
    this.conflictsGroup.hideWhenEmpty = true;

    this.unpublishedGroup = this.scm.createResourceGroup('unpublished', 'Unpublished');
    this.unpublishedGroup.hideWhenEmpty = false;

    this.workspaceGroup = this.scm.createResourceGroup('workspace', 'Pending Snapshot');
    this.workspaceGroup.hideWhenEmpty = false;

    this.disposables.push(
      this.scm,
      this.conflictsGroup,
      this.unpublishedGroup,
      this.workspaceGroup,
      this.statusCache.onDidChangeStatus((status) => this.onStatusChanged(status)),
    );

    // Initial populate if status is already available
    if (this.statusCache.status) {
      this.onStatusChanged(this.statusCache.status);
    }
  }

  setBusy(busy: boolean): void {
    this.scm.inputBox.enabled = !busy;
  }

  private onStatusChanged(status: StatusPayload | undefined): void {
    if (!status) {
      this.conflictsGroup.resourceStates = [];
      this.unpublishedGroup.resourceStates = [];
      this.workspaceGroup.resourceStates = [];
      this.scm.count = 0;
      return;
    }

    const desc = mapStatusToResourceDescriptors(status);
    this.conflictsGroup.resourceStates = desc.conflicts.map((d) =>
      createSourceControlResourceState(d, this.rootUri),
    );
    this.unpublishedGroup.resourceStates = desc.unpublished.map((d) =>
      createSourceControlResourceState(d, this.rootUri),
    );
    this.workspaceGroup.resourceStates = desc.workspace.map((d) =>
      createSourceControlResourceState(d, this.rootUri),
    );
    this.scm.count = status.file_change_counts.total;

    this.log?.debug(
      `SCM updated: ${desc.conflicts.length} conflicts, ${desc.unpublished.length} unpublished, ${desc.workspace.length} pending snapshot.`,
    );
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}
