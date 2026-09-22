import type {
  BranchInfo,
  BranchListOptions,
  BranchListPayload,
  BranchNewOptions,
  BranchNewPayload,
} from './branchTypes';
import type { CliRunner, RawResult, RunOptions, RunResult } from './runner';
import type {
  ChangeInfoPayload,
  DoctorPayload,
  HistoryPayload,
  LoginPayload,
  LogoutPayload,
  StatusPayload,
  WorkspaceSyncPayload,
} from './types.generated';

export type {
  BranchInfo,
  BranchListOptions,
  BranchListPayload,
  BranchNewOptions,
  BranchNewPayload,
};

/**
 * One typed function per subcommand, and the only surface the rest of the
 * extension is allowed to use. Callers pass values, never flags; the runner,
 * not the caller, decides between an envelope and raw bytes.
 */

export interface StatusOptions {
  /**
   * Skips the remote check, and with it the workspace lock. The only
   * contention-free way to read status.
   */
  readonly skipRemoteUpdate?: boolean;
  /** Skips the working-tree scan, so only snapshotted changes are reported. */
  readonly skipScan?: boolean;
}

export interface HistoryOptions {
  readonly count?: number;
  readonly branch?: string;
}

export type RevertTarget =
  { readonly paths: readonly string[] } | { readonly all: true; readonly force?: boolean };

export type ResolveStrategy = 'mine' | 'theirs' | 'undo';

export type ResolveTarget = { readonly paths: readonly string[] } | { readonly all: true };

export interface ResumeOptions {
  /** Finish the interrupted operation, or undo what it applied. */
  readonly mode?: 'continue' | 'rollback';
  /** Re-check every file rather than only the unfinished ones. */
  readonly full?: boolean;
}

export class FxvCommands {
  constructor(private readonly runner: CliRunner) {}

  status(options: StatusOptions = {}, run: RunOptions = {}): Promise<RunResult<StatusPayload>> {
    const argv = ['status'];
    if (options.skipRemoteUpdate) {
      argv.push('--skip-remote-update');
    }
    if (options.skipScan) {
      argv.push('--skip-scan');
    }
    // A plain status takes the workspace lock, so it queues behind mutations.
    // Only the --skip-remote-update form skips the remote check and the lock.
    return this.runner.runJson<StatusPayload>(
      {
        argv,
        commandClass: options.skipRemoteUpdate ? 'read' : 'locking-read',
        envelope: true,
      },
      run,
    );
  }

  /**
   * Success prints human text rather than a payload. An empty description is
   * never passed: `snapshot -d ""` hard-errors, and the SCM input box is empty
   * by default.
   */
  snapshot(description?: string, run: RunOptions = {}): Promise<RunResult<undefined>> {
    // The description rides on `-d`, which is a flag value rather than a
    // positional, so a description starting with a dash is already safe.
    return this.runner.runJson<undefined>(
      { argv: ['snapshot', ...describedBy(description)], commandClass: 'write', envelope: false },
      run,
    );
  }

  /**
   * Unlike `snapshot`, a description is required: `publish` without one is
   * rejected by the argument parser before the command runs.
   */
  publish(description: string, run: RunOptions = {}): Promise<RunResult<undefined>> {
    const described = describedBy(description);
    if (described.length === 0) {
      throw new Error('fxv publish needs a description.');
    }
    return this.runner.runJson<undefined>(
      { argv: ['publish', ...described], commandClass: 'write', envelope: false },
      run,
    );
  }

  sync(revisionSpec?: string, run: RunOptions = {}): Promise<RunResult<WorkspaceSyncPayload>> {
    return this.runner.runJson<WorkspaceSyncPayload>(
      {
        argv: ['sync'],
        ...(revisionSpec ? { positionals: [revisionSpec] } : {}),
        commandClass: 'write',
        envelope: true,
      },
      run,
    );
  }

  goto(revisionSpec: string, run: RunOptions = {}): Promise<RunResult<WorkspaceSyncPayload>> {
    return this.runner.runJson<WorkspaceSyncPayload>(
      { argv: ['goto'], positionals: [revisionSpec], commandClass: 'write', envelope: true },
      run,
    );
  }

  revert(target: RevertTarget, run: RunOptions = {}): Promise<RunResult<WorkspaceSyncPayload>> {
    const argv = ['revert'];
    let positionals: string[] = [];
    if ('all' in target) {
      argv.push('--all');
      if (target.force) {
        argv.push('--force');
      }
    } else {
      positionals = requirePaths(target.paths, 'revert');
    }
    return this.runner.runJson<WorkspaceSyncPayload>(
      { argv, positionals, commandClass: 'write', envelope: true },
      run,
    );
  }

  resolve(
    strategy: ResolveStrategy,
    target: ResolveTarget,
    run: RunOptions = {},
  ): Promise<RunResult<WorkspaceSyncPayload>> {
    const argv = ['resolve', `--${strategy}`];
    let positionals: string[] = [];
    if ('all' in target) {
      argv.push('--all');
    } else {
      positionals = requirePaths(target.paths, 'resolve');
    }
    return this.runner.runJson<WorkspaceSyncPayload>(
      { argv, positionals, commandClass: 'write', envelope: true },
      run,
    );
  }

  history(options: HistoryOptions = {}, run: RunOptions = {}): Promise<RunResult<HistoryPayload>> {
    const argv = ['history'];
    if (options.count !== undefined) {
      argv.push('-n', String(options.count));
    }
    if (options.branch) {
      argv.push('-b', options.branch);
    }
    return this.runner.runJson<HistoryPayload>({ argv, commandClass: 'read', envelope: true }, run);
  }

  /** Defaults to changed files only, which is what the history view renders. */
  changeinfo(revisionSpec: string, run: RunOptions = {}): Promise<RunResult<ChangeInfoPayload>> {
    return this.runner.runJson<ChangeInfoPayload>(
      { argv: ['changeinfo'], positionals: [revisionSpec], commandClass: 'read', envelope: true },
      run,
    );
  }

  /** The only command that answers with bytes rather than an envelope. */
  cat(path: string, revisionSpec?: string, run: RunOptions = {}): Promise<RawResult> {
    const argv = revisionSpec ? ['cat', '-r', revisionSpec] : ['cat'];
    return this.runner.runRaw(
      { argv, positionals: [path], commandClass: 'read', envelope: false },
      run,
    );
  }

  resume(
    options: ResumeOptions = {},
    run: RunOptions = {},
  ): Promise<RunResult<WorkspaceSyncPayload>> {
    const argv = ['resume'];
    if (options.mode) {
      argv.push(`--${options.mode}`);
    }
    if (options.full) {
      argv.push('--full');
    }
    return this.runner.runJson<WorkspaceSyncPayload>(
      { argv, commandClass: 'write', envelope: true },
      run,
    );
  }

  /** `--fix` changes the workspace, so it queues as a mutation. */
  doctor(fix = false, run: RunOptions = {}): Promise<RunResult<DoctorPayload>> {
    const argv = fix ? ['doctor', '--fix'] : ['doctor'];
    return this.runner.runJson<DoctorPayload>(
      { argv, commandClass: fix ? 'write' : 'read', envelope: true },
      run,
    );
  }

  login(username: string, run: RunOptions = {}): Promise<RunResult<LoginPayload>> {
    return this.runner.runJson<LoginPayload>(
      { argv: ['login'], positionals: [username], commandClass: 'write', envelope: true },
      run,
    );
  }

  logout(run: RunOptions = {}): Promise<RunResult<LogoutPayload>> {
    return this.runner.runJson<LogoutPayload>(
      { argv: ['logout'], commandClass: 'write', envelope: true },
      run,
    );
  }

  branchList(
    options: BranchListOptions = {},
    run: RunOptions = {},
  ): Promise<RunResult<BranchListPayload>> {
    const argv = ['branch', 'list'];
    if (options.all) {
      argv.push('--all');
    }
    if (options.mine) {
      argv.push('--mine');
    }
    if (options.global) {
      argv.push('--global');
    }
    if (options.includeRetired) {
      argv.push('--include-retired');
    }
    return this.runner.runJson<BranchListPayload>(
      { argv, commandClass: 'read', envelope: true },
      run,
    );
  }

  branchSwitch(branch: string, run: RunOptions = {}): Promise<RunResult<WorkspaceSyncPayload>> {
    return this.runner.runJson<WorkspaceSyncPayload>(
      { argv: ['branch', 'switch'], positionals: [branch], commandClass: 'write', envelope: true },
      run,
    );
  }

  branchNew(options: BranchNewOptions, run: RunOptions = {}): Promise<RunResult<BranchNewPayload>> {
    const argv = ['branch', 'new'];
    if (options.global) {
      argv.push('--global');
    }
    if (options.empty) {
      argv.push('--empty');
    }
    if (options.from) {
      argv.push('--from', options.from);
    }
    if (options.noSwitch) {
      argv.push('--no-switch');
    }
    return this.runner.runJson<BranchNewPayload>(
      { argv, positionals: [options.name], commandClass: 'write', envelope: true },
      run,
    );
  }
}

function describedBy(description: string | undefined): string[] {
  const trimmed = description?.trim() ?? '';
  return trimmed.length > 0 ? ['-d', trimmed] : [];
}

function requirePaths(paths: readonly string[], command: string): string[] {
  if (paths.length === 0) {
    throw new Error(`fxv ${command} needs at least one path, or --all.`);
  }
  return [...paths];
}
