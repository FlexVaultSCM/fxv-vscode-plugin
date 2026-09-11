import { describe, expect, it } from 'vitest';

import {
  binaryName,
  pathScanLocations,
  resolveCliPath,
  standardLocations,
  type DiscoveryEnvironment,
} from '../../cli/discoveryPaths';

const WINDOWS_ENV = {
  LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
  ProgramFiles: 'C:\\Program Files',
  PATH: 'C:\\Windows\\system32;C:\\tools\\fxv',
  PATHEXT: '.COM;.EXE;.BAT;.CMD',
};

const POSIX_ENV = {
  HOME: '/home/dev',
  PATH: '/usr/bin:/home/dev/bin',
};

function environment(
  overrides: Partial<DiscoveryEnvironment> & Pick<DiscoveryEnvironment, 'platform' | 'env'>,
): DiscoveryEnvironment {
  return { isExecutableFile: () => false, ...overrides };
}

function only(...executable: string[]): (candidate: string) => boolean {
  return (candidate) => executable.includes(candidate);
}

describe('binaryName', () => {
  it('adds the extension on Windows only', () => {
    expect(binaryName('win32')).toBe('fxv.exe');
    expect(binaryName('darwin')).toBe('fxv');
    expect(binaryName('linux')).toBe('fxv');
  });
});

describe('standardLocations', () => {
  it('prefers the per-user install over Program Files on Windows', () => {
    expect(standardLocations('win32', WINDOWS_ENV)).toEqual([
      'C:\\Users\\dev\\AppData\\Local\\fxv\\bin\\fxv.exe',
      'C:\\Program Files\\FlexVault\\bin\\fxv.exe',
    ]);
  });

  it('skips a location whose environment variable is unset', () => {
    expect(standardLocations('win32', { ProgramFiles: 'C:\\Program Files' })).toEqual([
      'C:\\Program Files\\FlexVault\\bin\\fxv.exe',
    ]);
    expect(standardLocations('linux', {})).toEqual(['/usr/local/bin/fxv', '/opt/homebrew/bin/fxv']);
  });

  it('covers the install script target, Homebrew, and cargo on macOS and Linux', () => {
    const expected = [
      '/home/dev/.local/bin/fxv',
      '/usr/local/bin/fxv',
      '/opt/homebrew/bin/fxv',
      '/home/dev/.cargo/bin/fxv',
    ];
    expect(standardLocations('darwin', POSIX_ENV)).toEqual(expected);
    expect(standardLocations('linux', POSIX_ENV)).toEqual(expected);
  });
});

describe('pathScanLocations', () => {
  it('crosses every PATH entry with PATHEXT on Windows', () => {
    expect(pathScanLocations('win32', { PATH: 'C:\\tools', PATHEXT: '.EXE;.CMD' })).toEqual([
      'C:\\tools\\fxv.exe',
      'C:\\tools\\fxv.cmd',
    ]);
  });

  it('assumes the default PATHEXT when it is unset', () => {
    expect(pathScanLocations('win32', { PATH: 'C:\\tools' })).toEqual([
      'C:\\tools\\fxv.com',
      'C:\\tools\\fxv.exe',
      'C:\\tools\\fxv.bat',
      'C:\\tools\\fxv.cmd',
    ]);
  });

  it('splits on the platform delimiter and strips quoted entries', () => {
    expect(pathScanLocations('linux', { PATH: '/usr/bin::"/home/dev/bin" ' })).toEqual([
      '/usr/bin/fxv',
      '/home/dev/bin/fxv',
    ]);
  });

  it('reads Path as well, which is how Windows spells it', () => {
    expect(pathScanLocations('win32', { Path: 'C:\\tools', PATHEXT: '.EXE' })).toEqual([
      'C:\\tools\\fxv.exe',
    ]);
  });
});

describe('resolveCliPath', () => {
  it('takes the configured path when it points at an executable', () => {
    const location = resolveCliPath(
      environment({
        platform: 'win32',
        env: WINDOWS_ENV,
        configuredPath: 'D:\\build\\fxv.exe',
        isExecutableFile: only('D:\\build\\fxv.exe', 'C:\\tools\\fxv\\fxv.exe'),
      }),
    );
    expect(location).toEqual({
      path: 'D:\\build\\fxv.exe',
      source: 'setting',
      configuredPathMissing: false,
    });
  });

  it('ignores a configured path that does not exist, and says so', () => {
    const location = resolveCliPath(
      environment({
        platform: 'win32',
        env: WINDOWS_ENV,
        configuredPath: '  D:\\gone\\fxv.exe  ',
        isExecutableFile: only('C:\\Program Files\\FlexVault\\bin\\fxv.exe'),
      }),
    );
    expect(location).toEqual({
      path: 'C:\\Program Files\\FlexVault\\bin\\fxv.exe',
      source: 'standard',
      configuredPathMissing: true,
    });
  });

  it('rejects a relative setting rather than resolving it against the host cwd', () => {
    const location = resolveCliPath(
      environment({
        platform: 'linux',
        env: POSIX_ENV,
        configuredPath: './fxv',
        isExecutableFile: only('./fxv', '/usr/local/bin/fxv'),
      }),
    );
    expect(location).toEqual({
      path: '/usr/local/bin/fxv',
      source: 'standard',
      configuredPathMissing: true,
    });
  });

  it('treats an empty setting as unset', () => {
    const location = resolveCliPath(
      environment({
        platform: 'linux',
        env: POSIX_ENV,
        configuredPath: '   ',
        isExecutableFile: only('/usr/local/bin/fxv'),
      }),
    );
    expect(location.configuredPathMissing).toBe(false);
    expect(location.source).toBe('standard');
  });

  it('prefers a standard location over one on PATH', () => {
    const location = resolveCliPath(
      environment({
        platform: 'darwin',
        env: POSIX_ENV,
        isExecutableFile: only('/opt/homebrew/bin/fxv', '/home/dev/bin/fxv'),
      }),
    );
    expect(location.path).toBe('/opt/homebrew/bin/fxv');
    expect(location.source).toBe('standard');
  });

  it('scans PATH when no standard location holds the binary', () => {
    const location = resolveCliPath(
      environment({
        platform: 'win32',
        env: WINDOWS_ENV,
        isExecutableFile: only('C:\\tools\\fxv\\fxv.cmd'),
      }),
    );
    expect(location).toEqual({
      path: 'C:\\tools\\fxv\\fxv.cmd',
      source: 'path',
      configuredPathMissing: false,
    });
  });

  it('falls back to the bare name so the OS gets the last word', () => {
    expect(resolveCliPath(environment({ platform: 'win32', env: {} }))).toEqual({
      path: 'fxv.exe',
      source: 'fallback',
      configuredPathMissing: false,
    });
    expect(resolveCliPath(environment({ platform: 'linux', env: {} }))).toEqual({
      path: 'fxv',
      source: 'fallback',
      configuredPathMissing: false,
    });
  });
});
