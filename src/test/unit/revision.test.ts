import { describe, expect, it } from 'vitest';

import { parseSpec, specFromCommitInfo, specFromRevision } from '../../cli/revision';

describe('specFromCommitInfo', () => {
  it('writes a published revision as branch.revision', () => {
    expect(specFromCommitInfo({ branch: 'main', type: 'published', revision: 11 })).toBe('main.11');
  });

  it('writes a parented draft as branch.parent.draft', () => {
    expect(
      specFromCommitInfo({ branch: 'main', type: 'draft', revision: 11, draft_revision: 123 }),
    ).toBe('main.11.123');
  });

  it('writes a missing published revision as -, never as an omission', () => {
    // An unparented draft has no `revision` key at all. A template that reads
    // it straight yields main.undefined.1.
    expect(specFromCommitInfo({ branch: 'main', type: 'draft', draft_revision: 1 })).toBe(
      'main.-.1',
    );
  });

  it('takes the branch from the payload rather than assuming main', () => {
    expect(specFromCommitInfo({ branch: 'art', type: 'draft', draft_revision: 4 })).toBe('art.-.4');
    expect(specFromCommitInfo({ branch: 'art', type: 'published', revision: 2 })).toBe('art.2');
  });

  it('refuses a draft with no draft revision rather than naming another commit', () => {
    // Falling through would build main.11: the published parent, not the draft.
    expect(() => specFromCommitInfo({ branch: 'main', type: 'draft', revision: 11 })).toThrow(
      /draft revision/,
    );
  });

  it('refuses to invent a revision number for a published commit', () => {
    expect(() => specFromRevision('main', undefined)).toThrow(/published revision/);
    expect(() => specFromRevision('', 1)).toThrow(/branch/);
  });
});

describe('parseSpec', () => {
  it('round-trips every form', () => {
    for (const spec of ['main.11', 'main.11.123', 'main.-.1', 'art.-.4', 'art.7.2']) {
      const parsed = parseSpec(spec);
      expect(parsed, spec).toBeDefined();
      if (!parsed) {
        continue;
      }
      expect(specFromRevision(parsed.branch, parsed.revision, parsed.draftRevision), spec).toBe(
        spec,
      );
    }
  });

  it('reads the parts back out', () => {
    expect(parseSpec('main.-.1')).toEqual({ branch: 'main', draftRevision: 1 });
    expect(parseSpec('art.7.2')).toEqual({ branch: 'art', revision: 7, draftRevision: 2 });
    expect(parseSpec('art.7')).toEqual({ branch: 'art', revision: 7 });
  });

  it('rejects what is not a spec', () => {
    expect(parseSpec('main')).toBeUndefined();
    expect(parseSpec('main.head')).toBeUndefined();
    expect(parseSpec('')).toBeUndefined();
  });
});
