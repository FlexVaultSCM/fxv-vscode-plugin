import * as path from 'path';
import * as vscode from 'vscode';

import { toFxvUri } from '../providers/fxvUri';
import { isPathUnderRoot } from '../state/safetyGuards';
import type { StatusCache } from '../state/statusCache';
import { resolveQuickDiffBaseRevision } from './diffBase';

/**
 * QuickDiffProvider implementation for FlexVault (PLAN.md 5.2).
 * Lights up editor gutter indicators by pointing to the published or local snapshot base revision in the fxv: scheme.
 */
export class FlexVaultQuickDiffProvider implements vscode.QuickDiffProvider {
  constructor(
    private readonly rootUri: vscode.Uri,
    private readonly statusCache: StatusCache,
  ) {}

  provideOriginalResource(
    uri: vscode.Uri,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.Uri> {
    if (uri.scheme !== 'file') {
      return undefined;
    }

    if (!isPathUnderRoot(uri.fsPath, this.rootUri.fsPath)) {
      return undefined;
    }

    const relPath = path.relative(this.rootUri.fsPath, uri.fsPath).replace(/\\/g, '/');
    if (!relPath || relPath.startsWith('..') || path.isAbsolute(relPath)) {
      return undefined;
    }

    const baseSpec = resolveQuickDiffBaseRevision(this.statusCache.status);
    if (!baseSpec) {
      return undefined;
    }

    return toFxvUri(relPath, baseSpec);
  }
}
