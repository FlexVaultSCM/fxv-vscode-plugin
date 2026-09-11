import { describe, expect, it } from 'vitest';

import {
  classifyExitCode,
  errorData,
  finalKind,
  isErrorEnvelope,
  isErrorPayload,
  isProgressKind,
  parseEnvelope,
  topLevelObjects,
} from '../../cli/envelope';

function envelopeText(
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

describe('parseEnvelope', () => {
  it('parses the whole buffer, which is the expected path', () => {
    const parsed = parseEnvelope(envelopeText('status', { current_branch: 'main' }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.envelope.message.kind).toBe('status');
    expect(parsed.envelope.program.version).toBe('0.9.0');
  });

  it('takes the last complete object when the buffer holds several', () => {
    const progress = envelopeText('sync-progress', { files_updated_count: 1 });
    const final = envelopeText('sync', { files_updated_count: 4 });
    const parsed = parseEnvelope(`${progress}\n${final}\n`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.envelope.message.kind).toBe('sync');
  });

  it('skips a leading line that is not an envelope at all', () => {
    const parsed = parseEnvelope(`{"warning":"stale lock"}\n${envelopeText('status', {})}`);
    expect(parsed.ok).toBe(true);
  });

  it('reports an empty buffer separately, because that is success for snapshot', () => {
    const parsed = parseEnvelope('   \n');
    expect(parsed).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('reports unparsable output and keeps the raw buffer', () => {
    const parsed = parseEnvelope('Snapshot created: main.-.2');
    expect(parsed).toMatchObject({ ok: false, reason: 'invalid-json' });
    if (parsed.ok) {
      return;
    }
    expect(parsed.raw).toBe('Snapshot created: main.-.2');
  });

  it('separates valid JSON that is not an envelope', () => {
    expect(parseEnvelope('{"message":{"kind":"status"}}')).toMatchObject({
      ok: false,
      reason: 'not-an-envelope',
    });
  });
});

describe('topLevelObjects', () => {
  it('does not end an object on a brace inside a string', () => {
    const text = '{"description":"fix the } in the parser"}{"second":true}';
    expect(topLevelObjects(text)).toEqual([
      '{"description":"fix the } in the parser"}',
      '{"second":true}',
    ]);
  });

  it('respects escapes, so an escaped quote does not close the string', () => {
    const text = '{"description":"a \\" and a } brace"}';
    expect(topLevelObjects(text)).toEqual([text]);
  });

  it('ignores a stray closing brace between objects', () => {
    expect(topLevelObjects('}{"a":1}')).toEqual(['{"a":1}']);
  });
});

describe('classifyExitCode', () => {
  it('maps the taxonomy', () => {
    expect(classifyExitCode(0)).toBe('success');
    expect(classifyExitCode(1)).toBe('general');
    expect(classifyExitCode(2)).toBe('general');
    expect(classifyExitCode(98)).toBe('interrupted');
    expect(classifyExitCode(99)).toBe('locked');
    expect(classifyExitCode(127)).toBe('died');
  });

  it('treats a signal death as death without a report', () => {
    expect(classifyExitCode(null)).toBe('died');
  });
});

describe('progress kinds', () => {
  it('recognizes the suffix and strips it', () => {
    expect(isProgressKind('sync-progress')).toBe(true);
    expect(isProgressKind('sync')).toBe(false);
    expect(finalKind('sync-progress')).toBe('sync');
    expect(finalKind('sync')).toBe('sync');
  });
});

describe('error payloads', () => {
  const parsed = parseEnvelope(
    envelopeText(
      'error',
      {
        message: 'A previous `fxv goto` was interrupted.',
        exit_code: 98,
        error_data: {
          kind: 'interrupted-sync',
          version: '1.0',
          payload: { operation: 'goto', completed_entries: 2, remaining_entries: 4 },
        },
      },
      { version: '1.1' },
    ),
  );

  it('recognizes the error kind', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(isErrorEnvelope(parsed.envelope)).toBe(true);
  });

  it('accepts error_data, which the schema does not declare yet', () => {
    if (!parsed.ok) {
      throw new Error('the fixture should parse');
    }
    const payload = parsed.envelope.message.payload;
    expect(isErrorPayload(payload)).toBe(true);
    if (!isErrorPayload(payload)) {
      return;
    }
    expect(errorData(payload)).toMatchObject({ kind: 'interrupted-sync', version: '1.0' });
  });

  it('ignores an error_data that is not a sub-envelope', () => {
    expect(errorData({ message: 'x', exit_code: 1, error_data: 'nope' } as never)).toBeUndefined();
    expect(
      errorData({ message: 'x', exit_code: 1, error_data: { kind: 'x' } } as never),
    ).toBeUndefined();
  });

  it('rejects a payload missing the two fields every caller reads', () => {
    expect(isErrorPayload({ message: 'no code' })).toBe(false);
    expect(isErrorPayload(null)).toBe(false);
  });
});
