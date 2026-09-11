import { describe, expect, it } from 'vitest';

import { findWorkspaceRoot, WORKSPACE_MARKER } from '../../cli/workspacePaths';

function markersAt(...roots: string[]): (candidate: string) => boolean {
  const markers = roots.map(
    (root) => `${root}${root.includes('\\') ? '\\' : '/'}${WORKSPACE_MARKER}`,
  );
  return (candidate) => markers.includes(candidate);
}

describe('findWorkspaceRoot', () => {
  it('finds the marker in the folder itself', () => {
    expect(
      findWorkspaceRoot({
        start: '/home/dev/game',
        platform: 'linux',
        isDirectory: markersAt('/home/dev/game'),
      }),
    ).toBe('/home/dev/game');
  });

  it('walks up to a parent, which is the subfolder-opened case', () => {
    expect(
      findWorkspaceRoot({
        start: '/home/dev/game/Assets/Art',
        platform: 'linux',
        isDirectory: markersAt('/home/dev/game'),
      }),
    ).toBe('/home/dev/game');
  });

  it('takes the nearest root when one workspace sits inside another', () => {
    expect(
      findWorkspaceRoot({
        start: '/home/dev/game/tools/kit/src',
        platform: 'linux',
        isDirectory: markersAt('/home/dev/game', '/home/dev/game/tools/kit'),
      }),
    ).toBe('/home/dev/game/tools/kit');
  });

  it('walks up a Windows path and stops at the drive root', () => {
    expect(
      findWorkspaceRoot({
        start: 'C:\\work\\game\\Assets',
        platform: 'win32',
        isDirectory: markersAt('C:\\work\\game'),
      }),
    ).toBe('C:\\work\\game');
    expect(
      findWorkspaceRoot({
        start: 'C:\\work\\game\\Assets',
        platform: 'win32',
        isDirectory: () => false,
      }),
    ).toBeUndefined();
  });

  it('gives up at the filesystem root rather than walking forever', () => {
    expect(
      findWorkspaceRoot({ start: '/home/dev', platform: 'linux', isDirectory: () => false }),
    ).toBeUndefined();
  });
});
