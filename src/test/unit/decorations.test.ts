import { describe, expect, it } from 'vitest';

import { FlexVaultDecorationProvider, IGNORED_THEME_COLOR_ID } from '../../scm/decorations';
import { MockUri } from './vscodeMock';

describe('FlexVaultDecorationProvider ignore greying', () => {
  it('greys out files reported as ignored when there is no status decoration', () => {
    const provider = new FlexVaultDecorationProvider();
    provider.update(undefined, new MockUri('/root', '/root', 'file') as never);
    provider.setIgnoreChecker((rel) => rel === 'build/output.js');

    const decoration = provider.provideFileDecoration(
      new MockUri('/root/build/output.js', '/root/build/output.js', 'file') as never,
    );

    expect(decoration).toBeDefined();
    expect((decoration as { color?: { id: string } }).color?.id).toBe(IGNORED_THEME_COLOR_ID);
  });

  it('prefers a status-derived decoration over the ignored greying', () => {
    const provider = new FlexVaultDecorationProvider();
    const rootUri = new MockUri('/root', '/root', 'file') as never;
    provider.update(
      {
        files: [{ path: 'foo.txt', workspace_state: 'modified' }],
      } as never,
      rootUri,
    );
    provider.setIgnoreChecker(() => true);

    const decoration = provider.provideFileDecoration(
      new MockUri('/root/foo.txt', '/root/foo.txt', 'file') as never,
    );

    expect((decoration as { badge?: string }).badge).toBe('M');
  });

  it('returns undefined when the path is neither tracked nor ignored', () => {
    const provider = new FlexVaultDecorationProvider();
    provider.update(undefined, new MockUri('/root', '/root', 'file') as never);
    provider.setIgnoreChecker(() => false);

    const decoration = provider.provideFileDecoration(
      new MockUri('/root/foo.txt', '/root/foo.txt', 'file') as never,
    );

    expect(decoration).toBeUndefined();
  });
});
