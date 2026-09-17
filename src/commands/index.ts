import * as vscode from 'vscode';

import { loginCommand, logoutCommand } from './auth';
import { gotoCommand } from './goto';
import { publishCommand } from './publish';
import { resolveCommand } from './resolve';
import { revertCommand } from './revert';
import { syncCommand } from './sync';
import type { CommandContext } from './types';

export type { CommandContext } from './types';

export function registerCommands(ctxProvider: () => CommandContext): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  disposables.push(
    vscode.commands.registerCommand('flexvault.publish', async (...args: unknown[]) => {
      const desc = typeof args[0] === 'string' ? args[0] : undefined;
      await publishCommand(ctxProvider(), desc);
    }),

    vscode.commands.registerCommand('flexvault.sync', async (...args: unknown[]) => {
      const spec = typeof args[0] === 'string' ? args[0] : undefined;
      await syncCommand(ctxProvider(), spec);
    }),

    vscode.commands.registerCommand('flexvault.goto', async (...args: unknown[]) => {
      const spec = typeof args[0] === 'string' ? args[0] : undefined;
      await gotoCommand(ctxProvider(), spec);
    }),

    vscode.commands.registerCommand('flexvault.revert', async (...args: unknown[]) => {
      const resource = args[0] as Parameters<typeof revertCommand>[1];
      const selected = args[1] as Parameters<typeof revertCommand>[2];
      await revertCommand(ctxProvider(), resource, selected);
    }),

    vscode.commands.registerCommand('flexvault.resolveMine', async (...args: unknown[]) => {
      const resource = args[0] as Parameters<typeof resolveCommand>[2];
      const selected = args[1] as Parameters<typeof resolveCommand>[3];
      await resolveCommand(ctxProvider(), 'mine', resource, selected);
    }),

    vscode.commands.registerCommand('flexvault.resolveTheirs', async (...args: unknown[]) => {
      const resource = args[0] as Parameters<typeof resolveCommand>[2];
      const selected = args[1] as Parameters<typeof resolveCommand>[3];
      await resolveCommand(ctxProvider(), 'theirs', resource, selected);
    }),

    vscode.commands.registerCommand('flexvault.resolveUndo', async (...args: unknown[]) => {
      const resource = args[0] as Parameters<typeof resolveCommand>[2];
      const selected = args[1] as Parameters<typeof resolveCommand>[3];
      await resolveCommand(ctxProvider(), 'undo', resource, selected);
    }),

    vscode.commands.registerCommand('flexvault.login', async () => {
      await loginCommand(ctxProvider());
    }),

    vscode.commands.registerCommand('flexvault.logout', async () => {
      await logoutCommand(ctxProvider());
    }),

    vscode.commands.registerCommand('flexvault.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'flexvault');
    }),
  );

  return disposables;
}
