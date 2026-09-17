import * as vscode from 'vscode';

import type { StatusPayload } from '../cli/types.generated';
import type { Logger } from '../cli/logger';
import type { ContextKeys } from '../state/contextKeys';
import type { StatusCache } from '../state/statusCache';
import { mapStatusToResourceDescriptors, type ResourceDescriptor } from './resources';

export interface FlexVaultResourceState extends vscode.SourceControlResourceState {
  readonly descriptor: ResourceDescriptor;
}

export function createSourceControlResourceState(
  descriptor: ResourceDescriptor,
  rootUri: vscode.Uri,
): FlexVaultResourceState {
  const uri = vscode.Uri.joinPath(rootUri, ...descriptor.path.split('/'));

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
  private readonly changesGroup: vscode.SourceControlResourceGroup;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly rootUri: vscode.Uri,
    private readonly statusCache: StatusCache,
    private readonly contextKeys: ContextKeys,
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

    this.changesGroup = this.scm.createResourceGroup('changes', 'Changes');
    this.changesGroup.hideWhenEmpty = false;

    this.disposables.push(
      this.scm,
      this.conflictsGroup,
      this.changesGroup,
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
      this.changesGroup.resourceStates = [];
      this.scm.count = 0;
      void this.contextKeys.updateFromStatus(undefined);
      return;
    }

    const desc = mapStatusToResourceDescriptors(status);
    this.conflictsGroup.resourceStates = desc.conflicts.map((d) =>
      createSourceControlResourceState(d, this.rootUri),
    );
    this.changesGroup.resourceStates = desc.changes.map((d) =>
      createSourceControlResourceState(d, this.rootUri),
    );
    this.scm.count = status.file_change_counts.total;

    void this.contextKeys.updateFromStatus(status);
    this.log?.debug(
      `SCM updated: ${desc.conflicts.length} conflicts, ${desc.changes.length} changes.`,
    );
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}
