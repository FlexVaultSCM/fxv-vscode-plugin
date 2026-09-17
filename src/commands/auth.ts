import * as vscode from 'vscode';

import { withMutationProgress } from '../ui/progress';
import type { CommandContext } from './types';

const LAST_USERNAME_KEY = 'flexvault.lastUsername';

export async function loginCommand(ctx: CommandContext): Promise<void> {
  const lastUsername = ctx.context.workspaceState.get<string>(LAST_USERNAME_KEY) ?? '';

  const username = await vscode.window.showInputBox({
    prompt: 'Enter username for FlexVault commits',
    placeHolder: 'username',
    value: lastUsername,
    validateInput: (val) => (val.trim().length === 0 ? 'Username cannot be empty.' : null),
  });

  if (!username || username.trim().length === 0) {
    return;
  }

  const trimmed = username.trim();

  const result = await withMutationProgress(`Logging in as ${trimmed}...`, async () => {
    return await ctx.fxv.login(trimmed);
  });

  if (!result.ok) {
    void vscode.window
      .showErrorMessage(`Login failed: ${result.message}`, 'Show Log')
      .then((act) => act === 'Show Log' && ctx.log?.show());
    return;
  }

  await ctx.context.workspaceState.update(LAST_USERNAME_KEY, trimmed);
  void vscode.window.showInformationMessage(`Logged in as ${result.payload.username}.`);

  await ctx.statusCache?.refresh({ skipRemoteUpdate: false });
}

export async function logoutCommand(ctx: CommandContext): Promise<void> {
  const result = await withMutationProgress('Logging out...', async () => {
    return await ctx.fxv.logout();
  });

  if (!result.ok) {
    void vscode.window
      .showErrorMessage(`Logout failed: ${result.message}`, 'Show Log')
      .then((act) => act === 'Show Log' && ctx.log?.show());
    return;
  }

  const prevUser =
    result.payload.username ?? (result.payload.was_logged_in ? 'previous user' : undefined);
  const msg = prevUser ? `Logged out (previously logged in as ${prevUser}).` : 'Logged out.';
  void vscode.window.showInformationMessage(msg);

  await ctx.statusCache?.refresh({ skipRemoteUpdate: false });
}
