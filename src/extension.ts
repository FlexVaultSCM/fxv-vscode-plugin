import * as path from 'path';
import * as vscode from 'vscode';

import { FxvCommands } from './cli/commands';
import { CliDiscovery } from './cli/discovery';
import { describeLockHolder, parseLockHolder } from './cli/lockErrors';
import { CliRunner } from './cli/runner';
import { VersionGuard } from './cli/versionGuard';
import { WorkspaceRoots } from './cli/workspace';
import { registerCommands } from './commands';
import { LINKS, type LinkName } from './links';
import { ContentCache } from './providers/contentCache';
import { FxvContentProvider, FXV_SCHEME } from './providers/contentProvider';
import type { HistoryTreeElement } from './providers/historyItems';
import { HistoryTreeProvider } from './providers/historyTree';
import { FlexVaultDecorationProvider } from './scm/decorations';
import { FlexVaultScmProvider } from './scm/provider';
import { ContextKeys } from './state/contextKeys';
import { RecoveryManager } from './state/recovery';
import { StatusCache } from './state/statusCache';
import { Log } from './ui/log';
import { StatusBar } from './ui/statusBar';

const EXTENSION_ID = 'flexvault.flexvault-vscode';

let log: Log | undefined;

export function activate(context: vscode.ExtensionContext): void {
  log = new Log();
  context.subscriptions.push(log);

  const version = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON?.version ?? 'unknown';
  log.info(`FlexVault ${version} activated on VS Code ${vscode.version}.`);

  const discovery = new CliDiscovery(log);
  reportCliLocation(discovery);

  const roots = new WorkspaceRoots(log);
  const versionGuard = new VersionGuard();
  const contextKeys = new ContextKeys((key, value) =>
    vscode.commands.executeCommand('setContext', key, value),
  );
  void contextKeys.setCliNotFound(discovery.locate().source === 'fallback');

  const statusBar = new StatusBar();
  context.subscriptions.push(statusBar);

  const recoveryManager = new RecoveryManager({
    showLog: () => log?.show(),
    executeCommand: (command) => void vscode.commands.executeCommand(command),
  });

  const cacheDir = path.join(context.globalStorageUri.fsPath, 'cat-cache');
  const contentCache = new ContentCache({
    cacheDir,
    maxDiskSizeMB: numberSetting('contentCacheSizeMB', 512),
    log,
  });
  void contentCache.initialize();

  let scmProvider: FlexVaultScmProvider | undefined;
  let statusCache: StatusCache | undefined;
  let decorationProvider: FlexVaultDecorationProvider | undefined;
  let rootSubscriptions: vscode.Disposable[] = [];

  const runner = new CliRunner({
    binary: () => discovery.locate().path,
    cwd: () => roots.primary()?.path,
    readTimeoutSeconds: () => numberSetting('readTimeoutSeconds', 60),
    writeTimeoutSeconds: () => numberSetting('writeTimeoutSeconds', 0),
    versionGuard,
    log,
    onBusyChanged: (busy) => {
      void contextKeys.setBusy(busy);
      scmProvider?.setBusy(busy);
      // History only moves on a write command, so refresh once the mutation
      // queue drains rather than on every debounced status read.
      if (!busy) {
        historyProvider.refresh();
      }
    },
    onPossiblyInterrupted: (reason) => {
      log?.error(`The workspace may be mid-operation: ${reason}. Run fxv status to check.`);
      void contextKeys.setInterrupted(true);
    },
    onVersionVerdict: (blocked) => {
      void contextKeys.setCliIncompatible(blocked);
    },
  });
  const fxv = new FxvCommands(runner);

  const historyProvider = new HistoryTreeProvider(
    fxv,
    () => numberSetting('historyLimit', 50, 1),
    log,
  );
  const historyTreeView = vscode.window.createTreeView<HistoryTreeElement>('flexvaultHistory', {
    treeDataProvider: historyProvider,
  });
  context.subscriptions.push(historyProvider, historyTreeView);

  const teardownRoot = () => {
    for (const d of rootSubscriptions) {
      d.dispose();
    }
    rootSubscriptions = [];
    scmProvider = undefined;
    statusCache = undefined;
    decorationProvider = undefined;
    statusBar.update(undefined);
    recoveryManager.clear();
    void contextKeys.setStatusError(false);
  };

  const setupRoot = () => {
    teardownRoot();
    const primary = roots.primary();
    reportWorkspaceRoot(roots);
    // History is keyed to the active root's fxv workspace, same as scmProvider
    // and statusCache below; without this it keeps showing the previous
    // root's commits until some unrelated event happens to trigger a refresh.
    historyProvider.refresh();

    if (!primary) {
      void contextKeys.setEnabled(false);
      return;
    }

    void contextKeys.setEnabled(true);
    void contextKeys.setCliIncompatible(versionGuard.blocked);
    const rootUri = vscode.Uri.file(primary.path);

    decorationProvider = new FlexVaultDecorationProvider();
    rootSubscriptions.push(vscode.window.registerFileDecorationProvider(decorationProvider));

    statusCache = new StatusCache(fxv, rootUri, {
      getDebounceMs: () => numberSetting('refreshDebounceMs', 300),
      isWatchEnabled: () => booleanSetting('watchEnabled', true),
      getWatchExclude: () => stringArraySetting('watchExclude', []),
      log,
      onInterrupted: (error) => {
        void contextKeys.setInterrupted(true);
        recoveryManager.handleInterrupted(error);
      },
      onLockContention: (msg) => {
        const holder = parseLockHolder(msg);
        const description = describeLockHolder(holder);
        void vscode.window
          .showWarningMessage(`Workspace is locked by ${description}.`, 'Retry', 'Show Log')
          .then((action) => {
            if (action === 'Retry') {
              void statusCache?.refresh({ skipRemoteUpdate: false });
            } else if (action === 'Show Log') {
              log?.show();
            }
          });
      },
      onStatusError: (msg) => {
        void contextKeys.setStatusError(true);
        statusBar.showError(msg);
        scmProvider?.setError(true);
        void vscode.window.showErrorMessage(`FlexVault: ${msg}`, 'Show Log').then((action) => {
          if (action === 'Show Log') {
            log?.show();
          }
        });
      },
    });
    rootSubscriptions.push(statusCache);

    rootSubscriptions.push(
      statusCache.onDidChangeStatus((status) => {
        decorationProvider?.update(status, rootUri);
        void contextKeys.updateFromStatus(status);
        if (status) {
          scmProvider?.setError(false);
          statusBar.update(status);
        }
        recoveryManager.clear();
      }),
    );

    scmProvider = new FlexVaultScmProvider(rootUri, statusCache, log);
    rootSubscriptions.push(scmProvider);

    // Document and file hooks triggering debounced lock-free status refresh
    rootSubscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.scheme === 'file') {
          const rel = path.relative(primary.path, doc.uri.fsPath);
          if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
            statusCache?.scheduleRefresh({ debounce: true, skipRemoteUpdate: true });
          }
        }
      }),
      vscode.workspace.onDidCreateFiles(() => {
        statusCache?.scheduleRefresh({ debounce: true, skipRemoteUpdate: true });
      }),
      vscode.workspace.onDidDeleteFiles(() => {
        statusCache?.scheduleRefresh({ debounce: true, skipRemoteUpdate: true });
      }),
      vscode.workspace.onDidRenameFiles(() => {
        statusCache?.scheduleRefresh({ debounce: true, skipRemoteUpdate: true });
      }),
    );

    // Initial status check
    void statusCache.refresh({ skipRemoteUpdate: true }).then((status) => {
      if (status) {
        const { current_branch: branch, file_change_counts: counts, head_commit: head } = status;
        log?.info(
          `On branch ${branch} (${head.state}), ${counts.total} changed ${counts.total === 1 ? 'file' : 'files'}.`,
        );
      }
    });
  };

  setupRoot();

  context.subscriptions.push(
    { dispose: teardownRoot },
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      roots.invalidate();
      setupRoot();
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('flexvault.logLevel')) {
        log?.refreshLevel();
      }
      if (event.affectsConfiguration('flexvault.cliPath')) {
        discovery.invalidate();
        versionGuard.reset();
        void contextKeys.setCliIncompatible(versionGuard.blocked);
        void contextKeys.setCliNotFound(discovery.locate().source === 'fallback');
      }
      if (event.affectsConfiguration('flexvault.contentCacheSizeMB')) {
        contentCache.updateCap(numberSetting('contentCacheSizeMB', 512));
      }
      if (
        event.affectsConfiguration('flexvault.watchEnabled') ||
        event.affectsConfiguration('flexvault.watchExclude') ||
        event.affectsConfiguration('files.watcherExclude')
      ) {
        statusCache?.updateConfiguration();
      }
      if (event.affectsConfiguration('flexvault.historyLimit')) {
        historyProvider.refresh();
      }
    }),
  );

  const contentProvider = new FxvContentProvider(fxv, contentCache, log);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(FXV_SCHEME, contentProvider),
    contentProvider,
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flexvault.showLog', () => {
      log?.show();
    }),
    vscode.commands.registerCommand('flexvault.refresh', async () => {
      recoveryManager.resetBanner();
      if (statusCache) {
        await statusCache.refresh({ skipRemoteUpdate: false });
      }
    }),
    vscode.commands.registerCommand('flexvault.openDocumentation', () => openLink('docs')),
    vscode.commands.registerCommand('flexvault.openWebsite', () => openLink('website')),
    vscode.commands.registerCommand('flexvault.reportFeedback', () => openLink('discord')),
    ...registerCommands(() => ({
      fxv,
      statusCache,
      scmProvider,
      contentCache,
      historyTreeView,
      historyProvider,
      log,
      context,
      rootUri: roots.primary() ? vscode.Uri.file(roots.primary()!.path) : undefined,
    })),
  );
}

function reportCliLocation(discovery: CliDiscovery): void {
  const location = discovery.locate();
  if (location.source === 'fallback') {
    log?.error(
      `No fxv binary was found in the standard locations or on PATH, so \`${location.path}\` will be spawned as a bare command. Set flexvault.cliPath if fxv is installed elsewhere.`,
    );
    return;
  }
  log?.info(`Using the fxv binary at ${location.path}.`);
}

function reportWorkspaceRoot(roots: WorkspaceRoots): void {
  const root = roots.primary();
  if (!root) {
    log?.info('No FlexVault workspace was found in the open folders.');
    return;
  }
  log?.info(`Using the FlexVault workspace at ${root.path}.`);
}

function numberSetting(name: string, fallback: number, min = 0): number {
  const value = vscode.workspace.getConfiguration('flexvault').get<number>(name);
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? value : fallback;
}

function booleanSetting(name: string, fallback: boolean): boolean {
  const value = vscode.workspace.getConfiguration('flexvault').get<boolean>(name);
  return typeof value === 'boolean' ? value : fallback;
}

function stringArraySetting(name: string, fallback: string[]): string[] {
  const value = vscode.workspace.getConfiguration('flexvault').get<string[]>(name);
  return Array.isArray(value) ? value : fallback;
}

function openLink(name: LinkName): Thenable<boolean> {
  const url = LINKS[name];
  log?.debug(`Opening ${url}.`);
  return vscode.env.openExternal(vscode.Uri.parse(url));
}

export function deactivate(): void {
  log?.info('FlexVault deactivated.');
  log = undefined;
}
