import * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';

import { fromFxvUri, FXV_SCHEME, toFxvUri } from '../../providers/fxvUri';

describe('fxv: URI scheme', () => {
  it('creates an fxv: URI with normalized repository-relative path and revision query', () => {
    const uri = toFxvUri('src/index.ts', 'main.12');
    expect(uri.scheme).toBe(FXV_SCHEME);
    expect(uri.path).toBe('/src/index.ts');
    expect(uri.query).toBe('revision=main.12');
  });

  it('normalizes Windows backslashes in paths', () => {
    const uri = toFxvUri('models\\assets\\mesh.obj', 'main.-.1');
    expect(uri.path).toBe('/models/assets/mesh.obj');
    expect(uri.query).toBe('revision=main.-.1');
  });

  it('parses valid fxv: URIs', () => {
    const uri = toFxvUri('path/to/file.txt', 'feature.5.10');
    const parsed = fromFxvUri(uri);
    expect(parsed).toEqual({
      path: 'path/to/file.txt',
      revisionSpec: 'feature.5.10',
    });
  });

  it('parses unparented draft revision specs with dash', () => {
    const uri = toFxvUri('a.txt', 'main.-.3');
    const parsed = fromFxvUri(uri);
    expect(parsed).toEqual({
      path: 'a.txt',
      revisionSpec: 'main.-.3',
    });
  });

  it('returns undefined for non-fxv schemes', () => {
    const fileUri = vscode.Uri.file('C:/temp/test.txt');
    expect(fromFxvUri(fileUri)).toBeUndefined();
  });

  it('returns undefined if revision query parameter is missing', () => {
    const uri = vscode.Uri.from({ scheme: FXV_SCHEME, path: '/a.txt' });
    expect(fromFxvUri(uri)).toBeUndefined();
  });

  it('returns undefined if revision query parameter is invalid spec', () => {
    const uri = vscode.Uri.from({
      scheme: FXV_SCHEME,
      path: '/a.txt',
      query: 'revision=invalid..spec',
    });
    expect(fromFxvUri(uri)).toBeUndefined();
  });
});
