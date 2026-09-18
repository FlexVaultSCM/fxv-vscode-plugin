import * as vscode from 'vscode';

import { parseSpec } from '../cli/revision';

export const FXV_SCHEME = 'fxv';

/**
 * Builds an fxv: URI pointing to a repository-relative path at a specific revision spec.
 * Form: fxv:/path/to/file?revision=<spec>
 */
export function toFxvUri(repoRelativePath: string, revisionSpec: string): vscode.Uri {
  const normalized = repoRelativePath.replace(/\\/g, '/');
  const uriPath = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return vscode.Uri.from({
    scheme: FXV_SCHEME,
    path: uriPath,
    query: `revision=${encodeURIComponent(revisionSpec)}`,
  });
}

export interface ParsedFxvUri {
  readonly path: string;
  readonly revisionSpec: string;
}

/**
 * Parses an fxv: URI back into its repository-relative path and validated revision spec.
 * Returns undefined if the scheme does not match or the query lacks a valid revision spec.
 */
export function fromFxvUri(uri: vscode.Uri): ParsedFxvUri | undefined {
  if (uri.scheme !== FXV_SCHEME) {
    return undefined;
  }

  const relPath = uri.path.replace(/^\/+/, '');
  if (!relPath) {
    return undefined;
  }

  const params = new URLSearchParams(uri.query);
  const revisionSpec = params.get('revision');
  if (!revisionSpec) {
    return undefined;
  }

  // Validate revision spec format
  if (!parseSpec(revisionSpec)) {
    return undefined;
  }

  return { path: relPath, revisionSpec };
}
