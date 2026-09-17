import { describe, expect, it } from 'vitest';

import { IgnoreFilter } from '../../state/ignoreFilter';

describe('IgnoreFilter', () => {
  it('unconditionally ignores .fxv_workspace and subpaths', () => {
    const filter = new IgnoreFilter();

    expect(filter.isIgnored('.fxv_workspace')).toBe(true);
    expect(filter.isIgnored('.fxv_workspace/config.db')).toBe(true);
    expect(filter.isIgnored('.fxv_workspace\\sync.lock')).toBe(true);
    expect(filter.isIgnored('.fxv_workspace/nested/file.txt')).toBe(true);
  });

  it('unconditionally ignores .git and subpaths', () => {
    const filter = new IgnoreFilter();

    expect(filter.isIgnored('.git')).toBe(true);
    expect(filter.isIgnored('.git/HEAD')).toBe(true);
    expect(filter.isIgnored('.git\\objects\\12')).toBe(true);
  });

  it('parses and honors .fxvignore comments and patterns', () => {
    const content = `
# This is a comment
*.log
temp/
/build
docs/*.md
`;
    const filter = new IgnoreFilter(content);

    // *.log
    expect(filter.isIgnored('error.log')).toBe(true);
    expect(filter.isIgnored('nested/sub/debug.log')).toBe(true);
    expect(filter.isIgnored('log.txt')).toBe(false);

    // temp/ directory
    expect(filter.isIgnored('temp/foo.txt')).toBe(true);
    expect(filter.isIgnored('sub/temp/bar.txt')).toBe(true);
    expect(filter.isIgnored('tempfile.txt')).toBe(false);

    // /build from root
    expect(filter.isIgnored('build/out.js')).toBe(true);
    expect(filter.isIgnored('sub/build/out.js')).toBe(false);

    // docs/*.md
    expect(filter.isIgnored('docs/readme.md')).toBe(true);
    expect(filter.isIgnored('docs/sub/readme.md')).toBe(false);
  });

  it('honors extra excludes from configuration', () => {
    const filter = new IgnoreFilter('', ['**/node_modules/**', 'dist/']);

    expect(filter.isIgnored('node_modules/package/index.js')).toBe(true);
    expect(filter.isIgnored('sub/node_modules/pkg.js')).toBe(true);
    expect(filter.isIgnored('dist/bundle.js')).toBe(true);
    expect(filter.isIgnored('src/index.ts')).toBe(false);
  });

  it('allows normal workspace files to pass', () => {
    const filter = new IgnoreFilter('*.log\nnode_modules/');

    expect(filter.isIgnored('src/extension.ts')).toBe(false);
    expect(filter.isIgnored('package.json')).toBe(false);
    expect(filter.isIgnored('assets/models/character.fbx')).toBe(false);
  });
});
