import { describe, expect, it } from 'vitest';

import { describeLockHolder, parseLockHolder } from '../../cli/lockErrors';

const MESSAGE =
  "Workspace is locked by another process (PID: 9300, Command: 'C:\\Users\\dev\\AppData\\Local\\fxv\\bin\\fxv.exe workspace hold-lock 10', Timestamp: 2026-09-11 19:46:46).";

describe('parseLockHolder', () => {
  it('pulls the holder out of the message', () => {
    expect(parseLockHolder(MESSAGE)).toEqual({
      pid: 9300,
      command: 'C:\\Users\\dev\\AppData\\Local\\fxv\\bin\\fxv.exe workspace hold-lock 10',
      application: 'fxv',
      timestamp: '2026-09-11 19:46:46',
    });
  });

  it('identifies a quoted executable path with spaces', () => {
    const message =
      'Workspace is locked by another process (PID: 12, Command: \'"C:\\Program Files\\Unity\\Editor\\Unity.exe" -projectPath .\').';
    expect(parseLockHolder(message)).toMatchObject({ application: 'Unity', pid: 12 });
  });

  it('handles a POSIX command with no extension', () => {
    expect(parseLockHolder("locked (PID: 44, Command: '/usr/local/bin/fxv sync')")).toMatchObject({
      application: 'fxv',
    });
  });

  it('returns an empty holder rather than failing on an unexpected message', () => {
    expect(parseLockHolder('Workspace is locked.')).toEqual({});
  });
});

describe('describeLockHolder', () => {
  it('reports the application and the process when both are known', () => {
    expect(describeLockHolder(parseLockHolder(MESSAGE))).toBe('fxv (PID 9300)');
  });

  it('falls back through what it does know', () => {
    expect(describeLockHolder({ application: 'Unity' })).toBe('Unity');
    expect(describeLockHolder({ pid: 7 })).toBe('another process (PID 7)');
    expect(describeLockHolder({})).toBe('another application');
  });
});
