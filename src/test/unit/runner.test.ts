import { spawn as nodeSpawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  applyGlobalFlags,
  CliRunner,
  messageFromStderr,
  type CommandSpec,
  type RunnerDependencies,
} from '../../cli/runner';
import { VersionGuard } from '../../cli/versionGuard';

/**
 * The runner is exercised against a stand-in `fxv`: a Node script spawned the
 * same way the fxv binary is. Mocking `spawn` would test the mock, and the
 * timeout policy is the part most worth testing against a live process.
 */

let workDir: string;
let scriptCount = 0;

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fxv-runner-'));
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

function script(source: string): string {
  scriptCount += 1;
  const file = path.join(workDir, `fake-fxv-${scriptCount}.js`);
  fs.writeFileSync(file, source, 'utf8');
  return file;
}

function envelope(
  kind: string,
  payload: unknown,
  { version = '1.0', programVersion = '0.9.0' } = {},
): string {
  return JSON.stringify({
    program: {
      name: 'fxv',
      version: programVersion,
      executable: 'fxv',
      arguments: [kind],
      invoked_at: '2026-01-01T00:00:00Z',
    },
    message: { kind, version, payload },
  });
}

/** A fake that prints `text` on stdout and exits with `code`. */
function printing(text: string, code = 0): string {
  return script(`process.stdout.write(${JSON.stringify(text)});\nprocess.exit(${String(code)});\n`);
}

function runnerFor(file: string, overrides: Partial<RunnerDependencies> = {}): CliRunner {
  return new CliRunner({
    binary: () => 'fxv',
    cwd: () => undefined,
    readTimeoutSeconds: () => 0,
    writeTimeoutSeconds: () => 0,
    spawn: (_binary, args, options) => nodeSpawn(process.execPath, [file, ...args], options),
    ...overrides,
  });
}

const READ: CommandSpec = { argv: ['status'], commandClass: 'read', envelope: true };
const WRITE: CommandSpec = { argv: ['snapshot'], commandClass: 'write', envelope: false };

describe('applyGlobalFlags', () => {
  it('appends the two global flags and the JSON format', () => {
    expect(applyGlobalFlags(['status'], true)).toEqual([
      'status',
      '--format',
      'json',
      '--unattended',
      '--no-color',
    ]);
  });

  it('leaves --format off the commands that have no JSON success path', () => {
    expect(applyGlobalFlags(['snapshot', '-d', 'work'], false)).toEqual([
      'snapshot',
      '-d',
      'work',
      '--unattended',
      '--no-color',
    ]);
  });

  it('does not repeat a flag the caller already supplied', () => {
    expect(applyGlobalFlags(['status', '--format', 'human', '--no-color'], true)).toEqual([
      'status',
      '--format',
      'human',
      '--no-color',
      '--unattended',
    ]);
  });
});

describe('runJson', () => {
  it('returns the payload of a successful envelope', async () => {
    const runner = runnerFor(printing(envelope('status', { current_branch: 'main' })));
    const result = await runner.runJson<{ current_branch: string }>(READ);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.payload.current_branch).toBe('main');
  });

  it('passes the global flags through to the process', async () => {
    const file = script(
      'process.stdout.write(JSON.stringify(process.argv.slice(2)));\nprocess.exit(0);\n',
    );
    const runner = runnerFor(file);
    const result = await runner.runRaw({
      argv: ['cat', 'a.txt'],
      commandClass: 'read',
      envelope: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(JSON.parse(result.data.toString('utf8'))).toEqual([
      'cat',
      'a.txt',
      '--unattended',
      '--no-color',
    ]);
  });

  it('reads an error envelope as failure and identifies the lock holder', async () => {
    const message =
      "Workspace is locked by another process (PID: 9300, Command: 'fxv.exe workspace hold-lock 10').";
    const runner = runnerFor(
      printing(envelope('error', { message, exit_code: 99 }, { version: '1.1' }), 99),
    );
    const result = await runner.runJson(READ);
    expect(result).toMatchObject({
      ok: false,
      failure: 'error-envelope',
      exitClass: 'locked',
      exitCode: 99,
    });
    if (result.ok) {
      return;
    }
    expect(result.lockHolder).toMatchObject({ pid: 9300, application: 'fxv' });
  });

  it('passes error_data through, which is what the recovery banner reads', async () => {
    const payload = {
      message: 'A previous `fxv goto` was interrupted.',
      exit_code: 98,
      error_data: {
        kind: 'interrupted-sync',
        version: '1.0',
        payload: { operation: 'goto', completed_entries: 2, remaining_entries: 4 },
      },
    };
    const runner = runnerFor(printing(envelope('error', payload, { version: '1.1' }), 98));
    const result = await runner.runJson(READ);
    expect(result).toMatchObject({
      ok: false,
      exitClass: 'interrupted',
      possiblyInterrupted: true,
    });
    if (result.ok) {
      return;
    }
    expect(result.errorData?.kind).toBe('interrupted-sync');
  });

  it('blocks a CLI outside the supported range before reading the payload', async () => {
    const runner = runnerFor(
      printing(envelope('status', { current_branch: 'main' }, { programVersion: '0.4.0' })),
    );
    const result = await runner.runJson(READ);
    expect(result).toMatchObject({ ok: false, failure: 'version' });
  });

  it('accepts an out-of-range fixture when the guard is injected', async () => {
    const runner = runnerFor(
      printing(envelope('status', { current_branch: 'main' }, { programVersion: '0.4.0' })),
      {
        versionGuard: new VersionGuard({
          range: {
            floor: { major: 0, minor: 4, patch: 0 },
            ceiling: { major: 0, minor: 5, patch: 0 },
          },
        }),
      },
    );
    expect((await runner.runJson(READ)).ok).toBe(true);
  });

  it('treats unparsable output at exit 0 as success for snapshot and publish', async () => {
    const runner = runnerFor(printing('Snapshot created: main.-.2\n'));
    const result = await runner.runJson(WRITE);
    expect(result).toMatchObject({ ok: true, text: 'Snapshot created: main.-.2' });
  });

  it('still reads the error envelope those commands print on failure', async () => {
    const runner = runnerFor(
      printing(
        envelope('error', { message: 'Nothing to snapshot.', exit_code: 1 }, { version: '1.1' }),
        1,
      ),
    );
    const result = await runner.runJson(WRITE);
    expect(result).toMatchObject({
      ok: false,
      failure: 'error-envelope',
      message: 'Nothing to snapshot.',
      exitClass: 'general',
    });
  });

  it('treats a process that died without reporting as possibly mid-operation', async () => {
    const reasons: string[] = [];
    const runner = runnerFor(printing('', 127), {
      onPossiblyInterrupted: (reason) => reasons.push(reason),
    });
    const result = await runner.runJson(READ);
    expect(result).toMatchObject({ ok: false, failure: 'died', possiblyInterrupted: true });
    expect(reasons).toHaveLength(1);
  });

  it('reports a binary it could not start', async () => {
    const runner = new CliRunner({
      binary: () => path.join(workDir, 'not-a-binary'),
      cwd: () => undefined,
      readTimeoutSeconds: () => 0,
      writeTimeoutSeconds: () => 0,
    });
    const result = await runner.runJson(READ);
    expect(result).toMatchObject({ ok: false, failure: 'spawn' });
  });
});

describe('messageFromStderr', () => {
  it('takes the failure and drops the hint the CLI appends', () => {
    const stderr = [
      'Error: Workspace error: No user is logged in to this workspace; run `fxv login <username>` before publishing',
      '=== Run `fxv doctor` to check your environment and workspace.',
      '',
    ].join('\n');
    expect(messageFromStderr(stderr)).toBe(
      'Workspace error: No user is logged in to this workspace; run `fxv login <username>` before publishing',
    );
  });

  it('has nothing to report when stderr is empty', () => {
    expect(messageFromStderr('   \n')).toBeUndefined();
  });
});

describe('runRaw', () => {
  it('returns bytes without decoding them', async () => {
    const file = script(
      'process.stdout.write(Buffer.from([0x00, 0xff, 0xfe, 0x41]));\nprocess.exit(0);\n',
    );
    const runner = runnerFor(file);
    const result = await runner.runRaw({
      argv: ['cat', 'texture.bin'],
      commandClass: 'read',
      envelope: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect([...result.data]).toEqual([0x00, 0xff, 0xfe, 0x41]);
  });

  it('reports what stderr said when a failure prints no envelope', async () => {
    // What a failing `cat` does at 0.9.0: nothing on stdout, the message on
    // stderr, and no envelope anywhere.
    const file = script(
      ['process.stderr.write("Error: cannot read \'gone.txt\'");', 'process.exit(1);', ''].join(
        '\n',
      ),
    );
    const runner = runnerFor(file);
    const result = await runner.runRaw({
      argv: ['cat', 'gone.txt'],
      commandClass: 'read',
      envelope: false,
    });
    expect(result).toMatchObject({ ok: false, message: "cannot read 'gone.txt'" });
  });

  it('reads the error envelope a failed cat prints on stdout', async () => {
    const runner = runnerFor(
      printing(
        envelope('error', { message: 'No such file.', exit_code: 1 }, { version: '1.1' }),
        1,
      ),
    );
    const result = await runner.runRaw({
      argv: ['cat', 'gone.txt'],
      commandClass: 'read',
      envelope: false,
    });
    expect(result).toMatchObject({ ok: false, message: 'No such file.' });
  });
});

describe('timeouts', () => {
  it('stops a read that outruns its timeout, and kills the process', async () => {
    const marker = path.join(workDir, 'read-marker.txt');
    const file = script(
      `setTimeout(() => { require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); }, 3000);\n`,
    );
    const runner = runnerFor(file, { readTimeoutSeconds: () => 1 });

    const result = await runner.runJson(READ);
    expect(result).toMatchObject({ ok: false, failure: 'timeout' });

    await wait(2500);
    expect(fs.existsSync(marker)).toBe(false);
  }, 15_000);

  it('stops waiting on a write but leaves the process running', async () => {
    const marker = path.join(workDir, 'write-marker.txt');
    const file = script(
      `setTimeout(() => { require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); }, 2000);\n`,
    );
    const interrupted: string[] = [];
    const runner = runnerFor(file, {
      writeTimeoutSeconds: () => 1,
      onPossiblyInterrupted: (reason) => interrupted.push(reason),
    });

    const result = await runner.runJson({
      argv: ['sync'],
      commandClass: 'write',
      envelope: true,
    });
    expect(result).toMatchObject({ ok: false, failure: 'timeout', possiblyInterrupted: true });
    expect(interrupted).toHaveLength(1);

    // The child was never killed, so the work it was doing still lands.
    await wait(2500);
    expect(fs.existsSync(marker)).toBe(true);
  }, 15_000);
});

describe('the mutation queue', () => {
  it('reports busy only while a mutation is in flight', async () => {
    const busy: boolean[] = [];
    const runner = runnerFor(printing(envelope('sync', { files_updated_count: 0 })), {
      onBusyChanged: (value) => busy.push(value),
    });

    await runner.runJson({ argv: ['sync'], commandClass: 'write', envelope: true });
    expect(busy).toEqual([true, false]);

    busy.length = 0;
    await runner.runJson({
      argv: ['status', '--skip-remote-update'],
      commandClass: 'read',
      envelope: true,
    });
    expect(busy).toEqual([]);
    expect(runner.busy).toBe(false);
  });
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
