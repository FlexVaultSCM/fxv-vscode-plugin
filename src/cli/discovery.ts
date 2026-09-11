import * as fs from 'fs';

import * as vscode from 'vscode';

import type { Log } from '../ui/log';
import { type CliLocation, resolveCliPath } from './discoveryPaths';

export type { CliLocation, CliPathSource } from './discoveryPaths';

/**
 * Locates the `fxv` binary and caches the verdict. Discovery
 * costs a handful of `stat` calls, but it runs on every invocation otherwise,
 * and the result only changes when the setting does.
 */
export class CliDiscovery {
  private cached: CliLocation | undefined;

  constructor(private readonly log?: Log) {}

  locate(): CliLocation {
    if (this.cached) {
      return this.cached;
    }

    const location = resolveCliPath({
      platform: process.platform,
      env: process.env,
      configuredPath: vscode.workspace.getConfiguration('flexvault').get<string>('cliPath'),
      isExecutableFile,
    });

    if (location.configuredPathMissing) {
      this.log?.error(
        'flexvault.cliPath was ignored because it is not an absolute path to an executable file. The standard locations were searched instead.',
      );
    }
    this.log?.debug(`Resolved the fxv binary to ${location.path} (${location.source}).`);

    // A fallback verdict means nothing was found, and that is the one case
    // that changes without the setting changing: the user installs fxv while
    // the window stays open. Caching it would hold the failure for the session.
    if (location.source !== 'fallback') {
      this.cached = location;
    }
    return location;
  }

  /**
   * Drops the cached verdict. Call on a `flexvault.cliPath` change, and reset
   * the version guard at the same time: a different binary is a different
   * version.
   */
  invalidate(): void {
    this.cached = undefined;
  }
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!fs.statSync(candidate).isFile()) {
      return false;
    }
  } catch {
    return false;
  }

  if (process.platform === 'win32') {
    // The execute bit is meaningless on Windows, so existence as a file is enough.
    return true;
  }

  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
