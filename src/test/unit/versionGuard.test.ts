import { describe, expect, it } from 'vitest';

import { parseSemVer, VersionGuard } from '../../cli/versionGuard';

function guard(platform = 'linux'): VersionGuard {
  return new VersionGuard({ platform });
}

describe('parseSemVer', () => {
  it('tolerates prerelease and build suffixes', () => {
    expect(parseSemVer('0.9.1')).toMatchObject({ major: 0, minor: 9, patch: 1 });
    expect(parseSemVer('0.9.0-rc.2')).toMatchObject({ patch: 0, prerelease: 'rc.2' });
    expect(parseSemVer('0.9.0+build.7')).toMatchObject({ build: 'build.7' });
    expect(parseSemVer('0.9')).toBeUndefined();
    expect(parseSemVer('nightly')).toBeUndefined();
  });
});

describe('the program version gate', () => {
  it('accepts the floor and everything below the ceiling', () => {
    expect(guard().checkProgram('0.9.0').ok).toBe(true);
    expect(guard().checkProgram('0.9.12').ok).toBe(true);
  });

  it('blocks below the floor and points at the CLI', () => {
    const verdict = guard().checkProgram('0.8.9');
    expect(verdict).toMatchObject({ ok: false, problem: 'below-floor', remedy: 'upgrade-cli' });
  });

  it('blocks at the ceiling and points at the extension', () => {
    const verdict = guard().checkProgram('0.10.0');
    expect(verdict).toMatchObject({
      ok: false,
      problem: 'above-ceiling',
      remedy: 'upgrade-extension',
    });
  });

  it('offers fxv upgrade only where a release binary exists', () => {
    const onWindows = guard('win32').checkProgram('0.8.0');
    const onLinux = guard('linux').checkProgram('0.8.0');
    expect(onWindows).toMatchObject({ ok: false, upgradeCommandAvailable: true });
    expect(onLinux).toMatchObject({ ok: false, upgradeCommandAvailable: false });
  });

  it('never offers the upgrade command above the ceiling, where it cannot help', () => {
    expect(guard('win32').checkProgram('1.0.0')).toMatchObject({ upgradeCommandAvailable: false });
  });

  it('reads a prerelease as its release version, at both ends of the range', () => {
    expect(guard().checkProgram('0.9.0-rc1').ok).toBe(true);
    expect(guard().checkProgram('0.10.0-rc1')).toMatchObject({
      ok: false,
      problem: 'above-ceiling',
    });
  });

  it('blocks a version it cannot compare', () => {
    expect(guard().checkProgram('dev')).toMatchObject({ ok: false, problem: 'unparsable' });
  });

  it('remembers the verdict until it is reset', () => {
    const versionGuard = guard();
    expect(versionGuard.blocked).toBe(false);
    versionGuard.checkProgram('0.8.0');
    expect(versionGuard.blocked).toBe(true);
    versionGuard.reset();
    expect(versionGuard.blocked).toBe(false);
    expect(versionGuard.lastProgramVerdict).toBeUndefined();
  });

  it('takes an injected range, so a fixture need not sit in the supported one', () => {
    const injected = new VersionGuard({
      range: { floor: { major: 0, minor: 4, patch: 0 }, ceiling: { major: 0, minor: 5, patch: 0 } },
      platform: 'linux',
    });
    expect(injected.checkProgram('0.4.0').ok).toBe(true);
    expect(injected.checkProgram('0.9.0').ok).toBe(false);
  });
});
