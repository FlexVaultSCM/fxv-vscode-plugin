import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { FxvCommands } from '../cli/commands';
import type { ErrorPayload, StatusPayload } from '../cli/types.generated';
import type { Logger } from '../cli/logger';
import { IgnoreFilter } from './ignoreFilter';
import { StatusCoordinator, type RefreshOptions } from './statusCoordinator';

export type { RefreshOptions };

export interface StatusCacheOptions {
  readonly getDebounceMs: () => number;
  readonly isWatchEnabled: () => boolean;
  readonly getWatchExclude: () => string[];
  readonly log?: Logger | undefined;
  readonly onInterrupted?: ((error: ErrorPayload) => void) | undefined;
}

/**
 * Coordinates status caching, debounce, coalescing, and filesystem watching.
 */
export class StatusCache implements vscode.Disposable {
  private readonly _onDidChangeStatus = new vscode.EventEmitter<StatusPayload | undefined>();
  readonly onDidChangeStatus = this._onDidChangeStatus.event;

  private currentStatus: StatusPayload | undefined;
  private readonly coordinator: StatusCoordinator;
  private watcher: vscode.FileSystemWatcher | null = null;
  private ignoreFilter: IgnoreFilter;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly fxv: FxvCommands,
    private readonly rootUri: vscode.Uri,
    private readonly options: StatusCacheOptions,
  ) {
    this.coordinator = new StatusCoordinator(
      (skipRemoteUpdate) => this.executeStatus(skipRemoteUpdate),
      this.options.getDebounceMs,
    );

    this.ignoreFilter = new IgnoreFilter();
    this.reloadIgnoreFilter();
    this.setupWatcher();
  }

  get status(): StatusPayload | undefined {
    return this.currentStatus;
  }

  /**
   * Schedules a refresh. If debounce is true, collapses multiple calls into a
   * single invocation after the debounce period. Debounced refreshes always use
   * skipRemoteUpdate: true to avoid taking a workspace lock.
   */
  scheduleRefresh(opts?: { skipRemoteUpdate?: boolean; debounce?: boolean }): void {
    this.coordinator.scheduleRefresh(opts);
  }

  /**
   * Executes a status command or coalesces with an in-flight execution.
   */
  async refresh(opts?: { skipRemoteUpdate?: boolean }): Promise<StatusPayload | undefined> {
    return this.coordinator.refresh(opts);
  }

  private async executeStatus(skipRemoteUpdate: boolean): Promise<StatusPayload | undefined> {
    this.options.log?.debug(`Executing status (skipRemoteUpdate: ${skipRemoteUpdate})...`);

    const result = await this.fxv.status({ skipRemoteUpdate });
    if (!result.ok) {
      if (result.exitCode === 98) {
        this.options.log?.error(`Status detected an interrupted operation: ${result.message}`);
        const errorPayload: ErrorPayload = {
          message: result.message,
          exit_code: 98,
          ...(result.errorData ? { error_data: result.errorData } : {}),
        };
        this.options.onInterrupted?.(errorPayload);
      } else {
        this.options.log?.error(`Status refresh failed: ${result.message}`);
      }
      return undefined;
    }

    this.currentStatus = result.payload;
    this._onDidChangeStatus.fire(this.currentStatus);
    return this.currentStatus;
  }

  private reloadIgnoreFilter(): void {
    const fxvignorePath = path.join(this.rootUri.fsPath, '.fxvignore');
    let content: string | undefined;
    try {
      if (fs.existsSync(fxvignorePath)) {
        content = fs.readFileSync(fxvignorePath, 'utf8');
      }
    } catch {
      // Ignore read errors
    }

    const watcherExcludes = vscode.workspace
      .getConfiguration('files', this.rootUri)
      .get<Record<string, boolean>>('watcherExclude', {});
    const fileExcludeKeys = Object.keys(watcherExcludes).filter((k) => watcherExcludes[k]);
    const extraExcludes = [...this.options.getWatchExclude(), ...fileExcludeKeys];

    this.ignoreFilter.updateRules(content, extraExcludes);
  }

  private setupWatcher(): void {
    if (!this.options.isWatchEnabled()) {
      return;
    }

    const pattern = new vscode.RelativePattern(this.rootUri, '**/*');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const onFileEvent = (uri: vscode.Uri) => {
      const rel = path.relative(this.rootUri.fsPath, uri.fsPath);
      if (rel === '.fxvignore') {
        this.reloadIgnoreFilter();
        this.scheduleRefresh({ debounce: true, skipRemoteUpdate: true });
        return;
      }
      if (!this.ignoreFilter.isIgnored(rel)) {
        this.scheduleRefresh({ debounce: true, skipRemoteUpdate: true });
      }
    };

    this.disposables.push(
      this.watcher.onDidCreate(onFileEvent),
      this.watcher.onDidChange(onFileEvent),
      this.watcher.onDidDelete(onFileEvent),
      this.watcher,
    );
  }

  dispose(): void {
    this.coordinator.dispose();
    this.watcher?.dispose();
    this.watcher = null;
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
    this._onDidChangeStatus.dispose();
  }
}
