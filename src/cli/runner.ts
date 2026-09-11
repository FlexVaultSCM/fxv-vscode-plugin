import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'child_process';

import {
  classifyExitCode,
  errorData as readErrorData,
  isErrorEnvelope,
  isErrorPayload,
  parseEnvelope,
  type Envelope,
  type ErrorData,
  type ExitClass,
} from './envelope';
import { MutationGate, type GateMode } from './gate';
import { describeLockHolder, parseLockHolder, type LockHolder } from './lockErrors';
import type { Logger } from './logger';
import { VersionGuard } from './versionGuard';

/**
 * Everything that spawns a process. The public surface is typed results, so no
 * caller outside `src/cli/` sees an argv array or an exit code. That boundary
 * keeps a later move to `fxv rpc` an internal change.
 */

/**
 * What a command does to the workspace, which decides the queue, the timeout
 * policy, and whether cancellation is honored.
 *
 * `locking-read` reads but takes the workspace lock, which a plain `status`
 * does. It queues like a mutation and is killable like a read, and it leaves
 * `flexvault.busy` alone: the input box has no business being disabled by a
 * status refresh.
 */
export type CommandClass = 'read' | 'locking-read' | 'write';

export interface CommandSpec {
  /** The subcommand and its arguments. Global flags are added here. */
  readonly argv: readonly string[];
  readonly commandClass: CommandClass;
  /**
   * False for `snapshot`, `publish`, and `cat`, which have no JSON success
   * path, so `--format json` is not appended for them.
   */
  readonly envelope: boolean;
}

export interface RunOptions {
  /** Reads cancel by killing the process. Writes decline and say so. */
  readonly cancellation?: CancellationSource | undefined;
}

export interface RunSuccess<TPayload> {
  readonly ok: true;
  readonly payload: TPayload;
  /** Human-readable stdout, which is all `snapshot` and `publish` return. */
  readonly text: string;
}

export type FailureKind =
  'error-envelope' | 'parse' | 'spawn' | 'timeout' | 'cancelled' | 'version' | 'died';

export interface RunFailure {
  readonly ok: false;
  readonly failure: FailureKind;
  readonly message: string;
  readonly exitCode: number | null;
  readonly exitClass: ExitClass;
  readonly errorData?: ErrorData;
  readonly lockHolder?: LockHolder;
  /**
   * The command may have been half-applied: a write that stopped being waited
   * for, or a process that died without reporting. The next `status` decides.
   */
  readonly possiblyInterrupted?: boolean;
  /** Raw stdout, for the log. */
  readonly raw: string;
}

export type RunResult<TPayload> = RunSuccess<TPayload> | RunFailure;

export interface RawSuccess {
  readonly ok: true;
  /** Never decoded to a string: `cat` streams bytes, and these are assets. */
  readonly data: Buffer;
}

export type RawResult = RawSuccess | RunFailure;

export interface RunnerDependencies {
  /** The `fxv` binary to spawn, resolved fresh so a settings change lands. */
  readonly binary: () => string;
  /** The workspace root, which is the `cwd` for every invocation. */
  readonly cwd: () => string | undefined;
  readonly readTimeoutSeconds: () => number;
  readonly writeTimeoutSeconds: () => number;
  readonly versionGuard?: VersionGuard;
  readonly log?: Logger;
  readonly env?: NodeJS.ProcessEnv;
  readonly spawn?: Spawn;
  /** Called when a mutating command starts and stops. Drives `flexvault.busy`. */
  readonly onBusyChanged?: (busy: boolean) => void;
  /** Called when a command may have left the workspace half-applied. */
  readonly onPossiblyInterrupted?: (reason: string) => void;
}

export type Spawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface CancellationSource {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

function gateMode(commandClass: CommandClass): GateMode {
  return commandClass === 'read' ? 'read' : 'write';
}

function isMutation(commandClass: CommandClass): boolean {
  return commandClass === 'write';
}

/** How long a killed read is given to exit before it is killed outright. */
const SIGKILL_GRACE_MS = 5_000;

export class CliRunner {
  private readonly gate = new MutationGate();
  private readonly spawn: Spawn;
  private readonly guard: VersionGuard;

  constructor(private readonly deps: RunnerDependencies) {
    this.spawn = deps.spawn ?? nodeSpawn;
    this.guard = deps.versionGuard ?? new VersionGuard();
  }

  /** True while a mutating command is in flight. */
  get busy(): boolean {
    return this.gate.busy;
  }

  /** Runs a command that answers with an envelope. */
  async runJson<TPayload>(
    spec: CommandSpec,
    options: RunOptions = {},
  ): Promise<RunResult<TPayload>> {
    const run = await this.run(spec, options);
    if (!run.ok) {
      return run;
    }
    const text = run.stdout.toString('utf8');
    const parsed = parseEnvelope<TPayload>(text);

    if (!parsed.ok) {
      // The commands with no JSON success path print human text, so an
      // unparsable buffer at exit 0 is exactly what success looks like there.
      if (!spec.envelope && run.exitClass === 'success') {
        return { ok: true, payload: undefined as TPayload, text: text.trim() };
      }
      return this.parseFailure(spec, parsed.reason, text, run.stderr, run.exitCode, run.exitClass);
    }

    const versionFailure = this.checkVersions(parsed.envelope, text);
    if (versionFailure) {
      return versionFailure;
    }

    if (isErrorEnvelope(parsed.envelope)) {
      return this.errorFailure(parsed.envelope, text, run.exitCode);
    }

    if (run.exitClass !== 'success') {
      // A non-error envelope with a failing exit code is a CLI bug, and taking
      // the payload as a success would be worse than saying so.
      return {
        ok: false,
        failure: 'parse',
        message: `The fxv CLI exited with code ${String(run.exitCode)} but did not report an error. See the FlexVault log.`,
        exitCode: run.exitCode,
        exitClass: run.exitClass,
        possiblyInterrupted: run.exitClass === 'died',
        raw: text,
      };
    }

    return {
      ok: true,
      payload: parsed.envelope.message.payload,
      text: text.trim(),
    };
  }

  /**
   * Runs `cat`, the only command whose output is not an envelope. The bytes are
   * returned undecoded.
   */
  async runRaw(spec: CommandSpec, options: RunOptions = {}): Promise<RawResult> {
    const run = await this.run(spec, options);
    if (!run.ok) {
      return run;
    }

    if (run.exitClass === 'success') {
      return { ok: true, data: run.stdout };
    }

    // On failure the bytes are an error envelope on stdout, not content.
    const text = run.stdout.toString('utf8');
    const parsed = parseEnvelope(text);
    if (parsed.ok && isErrorEnvelope(parsed.envelope)) {
      return this.errorFailure(parsed.envelope, text, run.exitCode);
    }
    return this.parseFailure(
      spec,
      'not-an-envelope',
      text,
      run.stderr,
      run.exitCode,
      run.exitClass,
    );
  }

  private async run(spec: CommandSpec, options: RunOptions): Promise<Execution> {
    const mode = gateMode(spec.commandClass);
    await this.gate.acquire(mode);
    if (isMutation(spec.commandClass)) {
      this.deps.onBusyChanged?.(true);
    }
    try {
      return await this.execute(spec, options);
    } finally {
      this.gate.release(mode);
      if (isMutation(spec.commandClass)) {
        this.deps.onBusyChanged?.(false);
      }
    }
  }

  private execute(spec: CommandSpec, options: RunOptions): Promise<Execution> {
    const binary = this.deps.binary();
    const argv = applyGlobalFlags(spec.argv, spec.envelope);
    const cwd = this.deps.cwd();
    const timeoutSeconds = isMutation(spec.commandClass)
      ? this.deps.writeTimeoutSeconds()
      : this.deps.readTimeoutSeconds();

    this.deps.log?.debug(`Running ${binary} ${argv.join(' ')}${cwd ? ` in ${cwd}` : ''}.`);

    return new Promise<Execution>((resolve) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      let killTimer: NodeJS.Timeout | undefined;
      let cancelled = false;

      const child = this.spawn(binary, argv, {
        cwd: cwd ?? undefined,
        env: this.deps.env ?? process.env,
        windowsHide: true,
        // An argv array, never a shell string: paths contain spaces, and a
        // shell would also reinterpret every character in a commit message.
        shell: false,
      });

      const finish = (execution: Execution): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        if (killTimer) {
          clearTimeout(killTimer);
        }
        subscription?.dispose();
        resolve(execution);
      };

      child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));

      child.on('error', (error: Error) => {
        finish({
          ok: false,
          failure: 'spawn',
          message: `The fxv CLI could not be started: ${error.message}. Check flexvault.cliPath.`,
          exitCode: null,
          exitClass: 'died',
          raw: '',
        });
      });

      child.on('close', (code, signal) => {
        const exitCode = code ?? null;
        const exitClass = classifyExitCode(exitCode);
        const stderrText = Buffer.concat(stderr).toString('utf8').trim();
        if (stderrText.length > 0) {
          this.deps.log?.debug(`fxv stderr: ${stderrText}`);
        }
        if (cancelled) {
          finish({
            ok: false,
            failure: 'cancelled',
            message: 'The fxv command was cancelled.',
            exitCode,
            exitClass,
            raw: Buffer.concat(stdout).toString('utf8'),
          });
          return;
        }
        if (exitClass === 'died') {
          this.deps.onPossiblyInterrupted?.(
            `fxv ${argv[0] ?? ''} exited with ${String(exitCode)}${signal ? ` on ${signal}` : ''}`,
          );
        }
        finish({
          ok: true,
          stdout: Buffer.concat(stdout),
          stderr: stderrText,
          exitCode,
          exitClass,
        });
      });

      const subscription = options.cancellation?.onCancellationRequested(() => {
        if (isMutation(spec.commandClass)) {
          // Killing a writer mid-flight is what manufactures the interrupted
          // state `fxv resume` exists to repair, so cancellation is declined.
          this.deps.log?.info(
            `fxv ${argv[0] ?? ''} cannot be cancelled: it is changing the workspace and will run to completion.`,
          );
          return;
        }
        cancelled = true;
        this.terminate(child);
      });

      if (timeoutSeconds > 0) {
        timer = setTimeout(() => {
          if (!isMutation(spec.commandClass)) {
            this.deps.log?.error(
              `fxv ${argv[0] ?? ''} exceeded flexvault.readTimeoutSeconds (${timeoutSeconds}s) and was stopped.`,
            );
            killTimer = this.terminate(child);
            finish({
              ok: false,
              failure: 'timeout',
              message: `The fxv CLI did not answer within ${timeoutSeconds} seconds.`,
              exitCode: null,
              exitClass: 'died',
              raw: Buffer.concat(stdout).toString('utf8'),
            });
            return;
          }

          // A writer is never killed. The runner stops waiting, and the
          // workspace is flagged so recovery runs on the next refresh.
          this.deps.log?.error(
            `fxv ${argv[0] ?? ''} exceeded flexvault.writeTimeoutSeconds (${timeoutSeconds}s). It is still running and was left alone.`,
          );
          child.unref();
          this.deps.onPossiblyInterrupted?.(`fxv ${argv[0] ?? ''} outran its write timeout`);
          finish({
            ok: false,
            failure: 'timeout',
            message: `The fxv CLI has been running for more than ${timeoutSeconds} seconds. It was left running, because stopping it partway would leave the workspace inconsistent.`,
            exitCode: null,
            exitClass: 'general',
            possiblyInterrupted: true,
            raw: '',
          });
        }, timeoutSeconds * 1000);
      }

      if (options.cancellation?.isCancellationRequested && !isMutation(spec.commandClass)) {
        cancelled = true;
        this.terminate(child);
      }
    });
  }

  private terminate(child: ChildProcess): NodeJS.Timeout {
    child.kill();
    return setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }, SIGKILL_GRACE_MS);
  }

  private checkVersions(envelope: Envelope<unknown>, raw: string): RunFailure | undefined {
    const program = this.guard.checkProgram(envelope.program.version);
    if (!program.ok) {
      return {
        ok: false,
        failure: 'version',
        message: program.message,
        exitCode: null,
        exitClass: 'general',
        raw,
      };
    }
    const message = this.guard.checkMessage(envelope.message.kind, envelope.message.version);
    if (!message.ok) {
      return {
        ok: false,
        failure: 'version',
        message: message.message,
        exitCode: null,
        exitClass: 'general',
        raw,
      };
    }
    return undefined;
  }

  private errorFailure(envelope: Envelope, raw: string, exitCode: number | null): RunFailure {
    const payload = envelope.message.payload;
    if (!isErrorPayload(payload)) {
      return {
        ok: false,
        failure: 'parse',
        message: 'The fxv CLI reported an error it did not describe. See the FlexVault log.',
        exitCode,
        exitClass: classifyExitCode(exitCode),
        raw,
      };
    }

    // The payload holds the exit code the CLI meant to return, which is the
    // one to classify: an error envelope can arrive on stdout from a command
    // whose process exit code has not been observed yet.
    const effectiveCode = payload.exit_code;
    const exitClass = classifyExitCode(effectiveCode);
    const data = readErrorData(payload);
    const lockHolder = exitClass === 'locked' ? parseLockHolder(payload.message) : undefined;

    if (lockHolder) {
      this.deps.log?.info(
        `The workspace is locked by ${describeLockHolder(lockHolder)}: ${payload.message}`,
      );
    }

    return {
      ok: false,
      failure: 'error-envelope',
      message: payload.message,
      exitCode: effectiveCode,
      exitClass,
      ...(data ? { errorData: data } : {}),
      ...(lockHolder ? { lockHolder } : {}),
      ...(exitClass === 'interrupted' || exitClass === 'died' ? { possiblyInterrupted: true } : {}),
      raw,
    };
  }

  private parseFailure(
    spec: CommandSpec,
    reason: string,
    raw: string,
    stderr: string,
    exitCode: number | null,
    exitClass: ExitClass,
  ): RunFailure {
    this.deps.log?.error(
      `Could not read the output of fxv ${spec.argv[0] ?? ''} (${reason}). Raw output: ${raw.trim() || '(empty)'}`,
    );
    const died = exitClass === 'died';
    const reported = messageFromStderr(stderr);
    return {
      ok: false,
      failure: died ? 'died' : 'parse',
      message:
        reported ??
        (died
          ? 'The fxv CLI stopped without reporting anything. The workspace may be mid-operation.'
          : 'The fxv CLI returned output this extension could not read. See the FlexVault log.'),
      exitCode,
      exitClass,
      ...(died ? { possiblyInterrupted: true } : {}),
      raw,
    };
  }
}

/**
 * Ground rule 5, applied centrally. `--no-pager` and `--no-progress` are
 * deliberately absent: they are unwired at 0.9.0 and print a warning to stderr
 * on every call. `--unattended` also suppresses the update check and the
 * detached refresh process it would otherwise spawn.
 */
export function applyGlobalFlags(argv: readonly string[], envelope: boolean): string[] {
  const applied = [...argv];
  if (envelope && !applied.includes('--format')) {
    applied.push('--format', 'json');
  }
  if (!applied.includes('--unattended')) {
    applied.push('--unattended');
  }
  if (!applied.includes('--no-color')) {
    applied.push('--no-color');
  }
  return applied;
}

/**
 * The message a failure reports when no envelope arrived.
 *
 * Ground rule 4 holds wherever an envelope exists: the message comes from the
 * payload and stderr is ignored. It does not hold at 0.9.0 for a failing `cat`,
 * a failing `publish`, or an argument the CLI rejects before it runs. There
 * stdout is empty, no envelope is printed, and stderr is the only account of
 * what went wrong. The alternative is telling the user nothing.
 */
export function messageFromStderr(stderr: string): string | undefined {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    // The doctor hint and the shell's own noise are not the failure.
    .filter((line) => line.length > 0 && !line.startsWith('==='))
    .filter((line) => !line.startsWith('Shell cwd was reset'));
  const first = lines[0];
  if (!first) {
    return undefined;
  }
  return first.replace(/^Error:\s*/i, '');
}

type Execution =
  | {
      readonly ok: true;
      readonly stdout: Buffer;
      /** Trimmed, and only ever read when no envelope arrived on stdout. */
      readonly stderr: string;
      readonly exitCode: number | null;
      readonly exitClass: ExitClass;
    }
  | RunFailure;
