import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FxvCommands } from '../../cli/commands';
import { ContentCache } from '../../providers/contentCache';
import {
  FxvContentProvider,
  getBinaryPlaceholder,
  isBinaryBuffer,
} from '../../providers/contentProvider';
import { toFxvUri } from '../../providers/fxvUri';

describe('FxvContentProvider and binary detection', () => {
  let tmpDir: string;
  let cache: ContentCache;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fxv-prov-test-'));
    cache = new ContentCache({ cacheDir: tmpDir });
    await cache.initialize();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('detects binary buffers with NUL bytes in the first few KB', () => {
    const textBuffer = Buffer.from('hello world\nline 2\n');
    expect(isBinaryBuffer(textBuffer)).toBe(false);

    const binaryBuffer = Buffer.from([0x68, 0x65, 0x00, 0x6c, 0x6f]); // 'he\0lo'
    expect(isBinaryBuffer(binaryBuffer)).toBe(true);

    const nulAtEnd = Buffer.alloc(100);
    nulAtEnd[99] = 0;
    expect(isBinaryBuffer(nulAtEnd)).toBe(true);
  });

  it('returns cached text content if available without calling cat', async () => {
    await cache.set('src/test.txt', 'main.1', 'cached text content');

    const fxvMock = {
      cat: vi.fn(),
    } as unknown as FxvCommands;

    const provider = new FxvContentProvider(fxvMock, cache);
    const uri = toFxvUri('src/test.txt', 'main.1');
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideTextDocumentContent(uri, token);

    expect(result).toBe('cached text content');
    expect(fxvMock.cat).not.toHaveBeenCalled();
  });

  it('calls fxv.cat on cache miss and caches decoded text', async () => {
    const fxvMock = {
      cat: vi.fn().mockResolvedValue({
        ok: true,
        data: Buffer.from('content from cat', 'utf8'),
      }),
    } as unknown as FxvCommands;

    const provider = new FxvContentProvider(fxvMock, cache);
    const uri = toFxvUri('src/test.txt', 'main.5');
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideTextDocumentContent(uri, token);

    expect(result).toBe('content from cat');
    expect(fxvMock.cat).toHaveBeenCalledWith(
      'src/test.txt',
      'main.5',
      expect.objectContaining({ cancellation: expect.anything() }),
    );

    // Verify it was stored in cache
    expect(await cache.get('src/test.txt', 'main.5')).toBe('content from cat');
  });

  it('returns binary placeholder if fxv.cat returns binary buffer', async () => {
    const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const fxvMock = {
      cat: vi.fn().mockResolvedValue({
        ok: true,
        data: binaryData,
      }),
    } as unknown as FxvCommands;

    const provider = new FxvContentProvider(fxvMock, cache);
    const uri = toFxvUri('texture.png', 'main.1');
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideTextDocumentContent(uri, token);

    expect(result).toBe(getBinaryPlaceholder('texture.png', 'main.1'));
  });

  it('throws descriptive error when cat fails', async () => {
    const fxvMock = {
      cat: vi.fn().mockResolvedValue({
        ok: false,
        message: 'File not found in revision',
        exitCode: 1,
      }),
    } as unknown as FxvCommands;

    const provider = new FxvContentProvider(fxvMock, cache);
    const uri = toFxvUri('missing.txt', 'main.1');
    const token = new vscode.CancellationTokenSource().token;

    await expect(provider.provideTextDocumentContent(uri, token)).rejects.toThrow(
      'Failed to load missing.txt at main.1: File not found in revision',
    );
  });
});
