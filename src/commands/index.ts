import * as vscode from 'vscode';

import { loginCommand, logoutCommand } from './auth';
import { clearCacheCommand, diffAgainstBaseCommand } from './diff';
import { gotoCommand } from './goto';
import {
  historyCopyRevisionCommand,
  historyGotoRevisionCommand,
  historyOpenChangeCommand,
  historyShowChangesCommand,
} from './history';
import { publishCommand } from './publish';
import { resolveCommand } from './resolve';
import { revertCommand } from './revert';
import { syncCommand } from './sync';
import type { CommandContext } from './types';

export type { CommandContext } from './types';

export function registerCommands(ctxProvider: () => CommandContext): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  disposables.push(
    vscode.commands.registerCommand('flexvault.diffAgainstBase', async (...args: unknown[]) => {
      await diffAgainstBaseCommand(ctxProvider(), args[0], args[1]);
    }),

    vscode.commands.registerCommand('flexvault.clearCache', async () => {
      await clearCacheCommand(ctxProvider());
    }),
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

    vscode.commands.registerCommand('flexvault.historyShowChanges', async (...args: unknown[]) => {
      await historyShowChangesCommand(
        ctxProvider(),
        args[0] as Parameters<typeof historyShowChangesCommand>[1],
      );
    }),

    vscode.commands.registerCommand('flexvault.historyGotoRevision', async (...args: unknown[]) => {
      await historyGotoRevisionCommand(
        ctxProvider(),
        args[0] as Parameters<typeof historyGotoRevisionCommand>[1],
      );
    }),

    vscode.commands.registerCommand('flexvault.historyCopyRevision', async (...args: unknown[]) => {
      await historyCopyRevisionCommand(
        ctxProvider(),
        args[0] as Parameters<typeof historyCopyRevisionCommand>[1],
      );
    }),

    vscode.commands.registerCommand('flexvault.historyOpenChange', async (...args: unknown[]) => {
      await historyOpenChangeCommand(
        ctxProvider(),
        args[0] as Parameters<typeof historyOpenChangeCommand>[1],
      );
    }),

    vscode.commands.registerCommand('flexvault.historyRefresh', () => {
      ctxProvider().historyProvider?.refresh();
    }),
  );

  return disposables;
}
