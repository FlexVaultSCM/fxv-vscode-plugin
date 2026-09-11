import { describe, expect, it } from 'vitest';

import { FxvCommands } from '../../cli/commands';
import type { CliRunner, CommandSpec } from '../../cli/runner';

/** Captures what each command function asks the runner to run. */
function recording(): { fxv: FxvCommands; specs: CommandSpec[] } {
  const specs: CommandSpec[] = [];
  const runner = {
    runJson: (spec: CommandSpec) => {
      specs.push(spec);
      return Promise.resolve({ ok: true, payload: undefined, text: '' });
    },
    runRaw: (spec: CommandSpec) => {
      specs.push(spec);
      return Promise.resolve({ ok: true, data: Buffer.alloc(0) });
    },
  } as unknown as CliRunner;
  return { fxv: new FxvCommands(runner), specs };
}

async function argvOf(call: (fxv: FxvCommands) => Promise<unknown>): Promise<CommandSpec> {
  const { fxv, specs } = recording();
  await call(fxv);
  return specs[0] as CommandSpec;
}

describe('FxvCommands', () => {
  it('takes the workspace lock for a plain status and not for the skipping form', async () => {
    expect(await argvOf((fxv) => fxv.status())).toMatchObject({
      argv: ['status'],
      commandClass: 'locking-read',
    });
    expect(
      await argvOf((fxv) => fxv.status({ skipRemoteUpdate: true, skipScan: true })),
    ).toMatchObject({
      argv: ['status', '--skip-remote-update', '--skip-scan'],
      commandClass: 'read',
      envelope: true,
    });
  });

  it('never passes an empty description, which hard-errors', async () => {
    expect((await argvOf((fxv) => fxv.snapshot(''))).argv).toEqual(['snapshot']);
    expect((await argvOf((fxv) => fxv.snapshot('   '))).argv).toEqual(['snapshot']);
    expect((await argvOf((fxv) => fxv.snapshot(' shipped the boss '))).argv).toEqual([
      'snapshot',
      '-d',
      'shipped the boss',
    ]);
    expect((await argvOf((fxv) => fxv.publish('shipped'))).argv).toEqual([
      'publish',
      '-d',
      'shipped',
    ]);
  });

  it('refuses a publish with no description, which the CLI rejects outright', () => {
    const { fxv } = recording();
    expect(() => fxv.publish('  ')).toThrow(/needs a description/);
  });

  it('marks snapshot and publish as having no JSON success path', async () => {
    expect(await argvOf((fxv) => fxv.snapshot('x'))).toMatchObject({
      envelope: false,
      commandClass: 'write',
    });
    expect(await argvOf((fxv) => fxv.publish('x'))).toMatchObject({ envelope: false });
  });

  it('builds the workspace-sync family', async () => {
    expect((await argvOf((fxv) => fxv.sync())).argv).toEqual(['sync']);
    expect(await argvOf((fxv) => fxv.sync('main.11'))).toMatchObject({
      argv: ['sync'],
      positionals: ['main.11'],
    });
    expect(await argvOf((fxv) => fxv.goto('main.-.1'))).toMatchObject({
      argv: ['goto'],
      positionals: ['main.-.1'],
    });
    expect((await argvOf((fxv) => fxv.resume({ mode: 'rollback', full: true }))).argv).toEqual([
      'resume',
      '--rollback',
      '--full',
    ]);
  });

  it('takes paths or --all for revert and resolve, never both', async () => {
    // Paths are positional, so a file named `-weird.txt` is still a file name.
    expect(await argvOf((fxv) => fxv.revert({ paths: ['a.txt', '-weird.png'] }))).toMatchObject({
      argv: ['revert'],
      positionals: ['a.txt', '-weird.png'],
    });
    expect((await argvOf((fxv) => fxv.revert({ all: true, force: true }))).argv).toEqual([
      'revert',
      '--all',
      '--force',
    ]);
    expect(await argvOf((fxv) => fxv.resolve('theirs', { paths: ['a.txt'] }))).toMatchObject({
      argv: ['resolve', '--theirs'],
      positionals: ['a.txt'],
    });
    expect((await argvOf((fxv) => fxv.resolve('undo', { all: true }))).argv).toEqual([
      'resolve',
      '--undo',
      '--all',
    ]);
  });

  it('refuses an empty path list rather than reverting everything', () => {
    const { fxv } = recording();
    expect(() => fxv.revert({ paths: [] })).toThrow(/at least one path/);
    expect(() => fxv.resolve('mine', { paths: [] })).toThrow(/at least one path/);
  });

  it('builds the read commands', async () => {
    expect((await argvOf((fxv) => fxv.history({ count: 20, branch: 'art' }))).argv).toEqual([
      'history',
      '-n',
      '20',
      '-b',
      'art',
    ]);
    expect(await argvOf((fxv) => fxv.changeinfo('main.11'))).toMatchObject({
      argv: ['changeinfo'],
      positionals: ['main.11'],
    });
    expect(await argvOf((fxv) => fxv.doctor())).toMatchObject({ commandClass: 'read' });
    expect(await argvOf((fxv) => fxv.doctor(true))).toMatchObject({
      argv: ['doctor', '--fix'],
      commandClass: 'write',
    });
  });

  it('sends cat down the raw path, with and without a revision', async () => {
    expect(await argvOf((fxv) => fxv.cat('art/hero.png'))).toEqual({
      argv: ['cat'],
      positionals: ['art/hero.png'],
      commandClass: 'read',
      envelope: false,
    });
    expect(await argvOf((fxv) => fxv.cat('art/hero.png', 'main.-.1'))).toMatchObject({
      argv: ['cat', '-r', 'main.-.1'],
      positionals: ['art/hero.png'],
    });
  });

  it('treats the auth commands as mutations', async () => {
    expect(await argvOf((fxv) => fxv.login('dev'))).toMatchObject({
      argv: ['login'],
      positionals: ['dev'],
      commandClass: 'write',
    });
    expect(await argvOf((fxv) => fxv.logout())).toMatchObject({
      argv: ['logout'],
      commandClass: 'write',
    });
  });
});
