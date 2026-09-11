import { describe, expect, it } from 'vitest';

import { LINKS } from '../../links';

describe('LINKS', () => {
  it('exposes the website, docs, and Discord', () => {
    expect(Object.keys(LINKS).sort()).toEqual(['discord', 'docs', 'website']);
  });

  it('is all https', () => {
    for (const url of Object.values(LINKS)) {
      expect(() => new URL(url)).not.toThrow();
      expect(url.startsWith('https://')).toBe(true);
    }
  });
});
