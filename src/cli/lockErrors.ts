/**
 * Lock contention, which is exit 99.
 *
 * Mutating commands take a workspace lock and exit rather than waiting, and so
 * does a plain `status`: only the `--skip-remote-update` form skips both the
 * remote check and the lock. The runner's queue only serializes this
 * extension's own calls, so the holder is just as likely to be Unity, a `fxv`
 * in the integrated terminal, or a stale lock left by a crash.
 */

export interface LockHolder {
  readonly pid?: number;
  /** The holder's full command line, as the CLI reported it. */
  readonly command?: string;
  /** The holder's executable name, so a notification can say who holds it. */
  readonly application?: string;
  readonly timestamp?: string;
}

const PID = /PID:\s*(\d+)/i;
const COMMAND = /Command:\s*'([^']*)'/i;
const TIMESTAMP = /Timestamp:\s*([^,)]+)/i;

/**
 * Pulls the holder out of the error message. The exit code says the workspace
 * is locked; this is only ever used to identify who holds it, so every field is
 * optional and a message in an unexpected format yields an empty holder rather
 * than an error.
 */
export function parseLockHolder(message: string): LockHolder {
  const pid = PID.exec(message);
  const command = COMMAND.exec(message)?.[1]?.trim();
  const timestamp = TIMESTAMP.exec(message)?.[1]?.trim();

  return {
    ...(pid ? { pid: Number(pid[1]) } : {}),
    ...(command ? { command } : {}),
    ...(command ? withApplication(command) : {}),
    ...(timestamp ? { timestamp } : {}),
  };
}

/** A phrase for a notification, which always identifies something. */
export function describeLockHolder(holder: LockHolder): string {
  if (holder.application && holder.pid !== undefined) {
    return `${holder.application} (PID ${holder.pid})`;
  }
  if (holder.application) {
    return holder.application;
  }
  if (holder.pid !== undefined) {
    return `another process (PID ${holder.pid})`;
  }
  return 'another application';
}

function withApplication(command: string): { application?: string } {
  const executable = firstToken(command);
  if (!executable) {
    return {};
  }
  const base = executable.split(/[\\/]/).pop() ?? executable;
  const withoutExtension = base.replace(/\.(exe|com|bat|cmd)$/i, '');
  return withoutExtension.length > 0 ? { application: withoutExtension } : {};
}

/**
 * The executable is the first token, and it is quoted when its path has spaces,
 * which on Windows it usually does.
 */
function firstToken(command: string): string | undefined {
  const trimmed = command.trim();
  if (trimmed.startsWith('"')) {
    const closing = trimmed.indexOf('"', 1);
    return closing > 1 ? trimmed.slice(1, closing) : undefined;
  }
  const [token] = trimmed.split(/\s+/);
  return token && token.length > 0 ? token : undefined;
}
