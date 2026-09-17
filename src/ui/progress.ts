import * as vscode from 'vscode';

export type WithProgressRunner = <T>(
  options: vscode.ProgressOptions,
  task: (
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ) => Thenable<T> | Promise<T>,
) => Thenable<T> | Promise<T>;

/**
 * Runs a mutating command under an indeterminate progress indicator in the SCM view.
 * Mutating commands cannot be killed mid-flight, so cancellation is disabled.
 */
export async function withMutationProgress<T>(
  title: string,
  task: (
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ) => Promise<T>,
  progressRunner: WithProgressRunner = vscode.window.withProgress,
): Promise<T> {
  return await progressRunner(
    {
      location: vscode.ProgressLocation.SourceControl,
      title,
      cancellable: false,
    },
    async (progress, token) => {
      return await task(progress, token);
    },
  );
}
