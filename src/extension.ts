import * as vscode from 'vscode';

import { FxvCommands } from './cli/commands';
import { CliDiscovery } from './cli/discovery';
import { CliRunner } from './cli/runner';
import { VersionGuard } from './cli/versionGuard';
import { WorkspaceRoots } from './cli/workspace';
import { LINKS, type LinkName } from './links';
import { FlexVaultDecorationProvider } from './scm/decorations';
import { FlexVaultScmProvider } from './scm/provider';
import { ContextKeys } from './state/contextKeys';
import { StatusCache } from './state/statusCache';
import { Log } from './ui/log';

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
    },
    onPossiblyInterrupted: (reason) => {
      log?.error(`The workspace may be mid-operation: ${reason}. Run fxv status to check.`);
      void contextKeys.setInterrupted(true);
    },
  });
  const fxv = new FxvCommands(runner);

  const teardownRoot = () => {
    for (const d of rootSubscriptions) {
      d.dispose();
    }
    rootSubscriptions = [];
    scmProvider?.dispose();
    scmProvider = undefined;
    statusCache?.dispose();
    statusCache = undefined;
    decorationProvider?.dispose();
    decorationProvider = undefined;
  };

  const setupRoot = () => {
    teardownRoot();
    const primary = roots.primary();
    reportWorkspaceRoot(roots);

    if (!primary) {
      void contextKeys.setEnabled(false);
      return;
    }

    void contextKeys.setEnabled(true);
    const rootUri = vscode.Uri.file(primary.path);

    decorationProvider = new FlexVaultDecorationProvider();
    rootSubscriptions.push(vscode.window.registerFileDecorationProvider(decorationProvider));

    statusCache = new StatusCache(fxv, rootUri, {
      getDebounceMs: () => numberSetting('refreshDebounceMs', 300),
      isWatchEnabled: () => booleanSetting('watchEnabled', true),
      getWatchExclude: () => stringArraySetting('watchExclude', []),
      log,
      onInterrupted: () => {
        void contextKeys.setInterrupted(true);
      },
    });

    rootSubscriptions.push(
      statusCache.onDidChangeStatus((status) => {
        decorationProvider?.update(status, rootUri);
      }),
    );

    scmProvider = new FlexVaultScmProvider(rootUri, statusCache, contextKeys, log);
    rootSubscriptions.push(scmProvider);

    // Document and file hooks triggering debounced lock-free status refresh
    rootSubscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.fsPath.toLowerCase().startsWith(primary.path.toLowerCase())) {
          statusCache?.scheduleRefresh({ debounce: true, skipRemoteUpdate: true });
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
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flexvault.showLog', () => {
      log?.show();
    }),
    vscode.commands.registerCommand('flexvault.refresh', async () => {
      if (statusCache) {
        await statusCache.refresh({ skipRemoteUpdate: false });
      }
    }),
    vscode.commands.registerCommand('flexvault.publish', async () => {
      // Phase 4 will implement the full publish flow.
      vscode.window.showInformationMessage('FlexVault publish will be available in Phase 4.');
    }),
    vscode.commands.registerCommand('flexvault.openDocumentation', () => openLink('docs')),
    vscode.commands.registerCommand('flexvault.openWebsite', () => openLink('website')),
    vscode.commands.registerCommand('flexvault.reportFeedback', () => openLink('discord')),
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

function numberSetting(name: string, fallback: number): number {
  const value = vscode.workspace.getConfiguration('flexvault').get<number>(name);
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
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
