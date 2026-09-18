import * as vscode from 'vscode';

import type { FxvCommands } from '../cli/commands';
import type { Logger } from '../cli/logger';
import { ContentCache } from './contentCache';
import { fromFxvUri, FXV_SCHEME } from './fxvUri';

export function isBinaryBuffer(buffer: Buffer, checkBytes = 8000): boolean {
  const len = Math.min(buffer.length, checkBytes);
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

export function getBinaryPlaceholder(filePath: string, revisionSpec: string): string {
  return `(Binary file not shown: ${filePath} at revision ${revisionSpec})`;
}

/**
 * TextDocumentContentProvider for the fxv: URI scheme.
 * Resolves fxv:/path?revision=<spec> by querying the ContentCache or running fxv cat -r <spec> <path>.
 * Detects binary files and renders a placeholder rather than corrupted mojibake.
 */
export class FxvContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly fxv: FxvCommands,
    private readonly cache: ContentCache,
    private readonly log?: Logger,
  ) {}

  async provideTextDocumentContent(
    uri: vscode.Uri,
    token: vscode.CancellationToken,
  ): Promise<string> {
    const parsed = fromFxvUri(uri);
    if (!parsed) {
      throw new Error(`Invalid FlexVault URI: ${uri.toString()}`);
    }

    // 1. Check cache first
    const cached = await this.cache.get(parsed.path, parsed.revisionSpec);
    if (cached !== undefined) {
      return cached;
    }

    // 2. Fetch raw file content using cat -r <spec> <path>
    const cancellation = {
      isCancellationRequested: token.isCancellationRequested,
      onCancellationRequested: (listener: () => void) => token.onCancellationRequested(listener),
    };

    const result = await this.fxv.cat(parsed.path, parsed.revisionSpec, {
      cancellation,
    });

    if (!result.ok) {
      const msg = `Failed to load ${parsed.path} at ${parsed.revisionSpec}: ${result.message}`;
      this.log?.error(msg);
      throw new Error(msg);
    }

    // 3. Detect binary content
    if (isBinaryBuffer(result.data)) {
      const placeholder = getBinaryPlaceholder(parsed.path, parsed.revisionSpec);
      return placeholder;
    }

    // 4. Decode text, cache, and return
    const text = result.data.toString('utf8');
    await this.cache.set(parsed.path, parsed.revisionSpec, text);
    return text;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

export { FXV_SCHEME };
