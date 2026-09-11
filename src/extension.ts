import * as vscode from 'vscode';

import { CliDiscovery } from './cli/discovery';
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
  log.info(`Using the fxv binary at ${discovery.locate().path}.`);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('flexvault.logLevel')) {
        log?.refreshLevel();
      }
      if (event.affectsConfiguration('flexvault.cliPath')) {
        // A different binary is a different version, so the version guard's
        // verdict is reset here too once it exists.
        discovery.invalidate();
        log?.info(`Using the fxv binary at ${discovery.locate().path}.`);
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

function openLink(name: LinkName): Thenable<boolean> {
  const url = LINKS[name];
  log?.debug(`Opening ${url}.`);
  return vscode.env.openExternal(vscode.Uri.parse(url));
}

export function deactivate(): void {
  log?.info('FlexVault deactivated.');
  log = undefined;
}
