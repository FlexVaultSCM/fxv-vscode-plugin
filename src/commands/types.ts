import * as vscode from 'vscode';

import type { FxvCommands } from '../cli/commands';
import type { ContentCache } from '../providers/contentCache';
import type { FlexVaultScmProvider } from '../scm/provider';
import type { StatusCache } from '../state/statusCache';
import type { Log } from '../ui/log';

export interface CommandContext {
  readonly fxv: FxvCommands;
  readonly statusCache: StatusCache | undefined;
  readonly scmProvider: FlexVaultScmProvider | undefined;
  readonly contentCache?: ContentCache | undefined;
  readonly log: Log | undefined;
  readonly context: vscode.ExtensionContext;
  readonly rootUri: vscode.Uri | undefined;
}
