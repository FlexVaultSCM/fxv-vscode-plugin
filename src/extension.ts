import * as vscode from 'vscode';

import { FxvCommands } from './cli/commands';
import { CliDiscovery } from './cli/discovery';
import { CliRunner } from './cli/runner';
import { VersionGuard } from './cli/versionGuard';
import { WorkspaceRoots } from './cli/workspace';
import { LINKS, type LinkName } from './links';
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
  const runner = new CliRunner({
    binary: () => discovery.locate().path,
    cwd: () => roots.primary()?.path,
    readTimeoutSeconds: () => numberSetting('readTimeoutSeconds', 60),
    writeTimeoutSeconds: () => numberSetting('writeTimeoutSeconds', 0),
    versionGuard,
    log,
    onPossiblyInterrupted: (reason) => {
      // Recovery itself arrives with the status cache; until then the log is
      // the only place this can be said.
      log?.error(`The workspace may be mid-operation: ${reason}. Run fxv status to check.`);
    },
  });
  const fxv = new FxvCommands(runner);

  reportWorkspaceRoot(roots);
  void probeWorkspace(fxv, roots);

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      roots.invalidate();
      reportWorkspaceRoot(roots);
      void probeWorkspace(fxv, roots);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('flexvault.logLevel')) {
        log?.refreshLevel();
      }
      if (event.affectsConfiguration('flexvault.cliPath')) {
        // A different binary is a different version, so the guard's verdict
        // goes with it. The rediscovery itself is left to the next caller:
        // this event fires for every intermediate value the settings editor
        // writes, and a full PATH scan per keystroke is not worth an eager
        // log line.
        discovery.invalidate();
        versionGuard.reset();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flexvault.showLog', () => {
      log?.show();
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

/**
 * One `status` at activation, in the form that takes no workspace lock. It
 * confirms the binary runs, puts both version gates through their paces, and
 * records the branch in the log. The status cache that replaces it arrives with
 * the source control provider.
 */
async function probeWorkspace(fxv: FxvCommands, roots: WorkspaceRoots): Promise<void> {
  if (!roots.primary()) {
    return;
  }
  const result = await fxv.status({ skipRemoteUpdate: true });
  if (!result.ok) {
    log?.error(`fxv status failed: ${result.message}`);
    return;
  }
  const { current_branch: branch, file_change_counts: counts, head_commit: head } = result.payload;
  log?.info(
    `On branch ${branch} (${head.state}), ${counts.total} changed ${counts.total === 1 ? 'file' : 'files'}.`,
  );
}

function numberSetting(name: string, fallback: number): number {
  const value = vscode.workspace.getConfiguration('flexvault').get<number>(name);
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function openLink(name: LinkName): Thenable<boolean> {
  const url = LINKS[name];
  log?.debug(`Opening ${url}.`);
  return vscode.env.openExternal(vscode.Uri.parse(url));
}

export function deactivate(): void {
  // In-flight writes are deliberately left running: a window reload must not be
  // a way to manufacture an interrupted sync.
  log?.info('FlexVault deactivated.');
  log = undefined;
}
