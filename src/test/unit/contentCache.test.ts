import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ContentCache } from '../../providers/contentCache';

describe('ContentCache', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fxv-cache-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('initializes cache and stores version file', async () => {
    const cache = new ContentCache({ cacheDir: tmpDir });
    await cache.initialize();

    const versionRaw = await fs.readFile(path.join(tmpDir, 'version.json'), 'utf8');
    const versionData = JSON.parse(versionRaw) as { version: number };
    expect(versionData.version).toBe(1);
  });

  it('sets and retrieves content from cache', async () => {
    const cache = new ContentCache({ cacheDir: tmpDir });
    await cache.initialize();

    await cache.set('src/test.txt', 'main.1', 'hello flexvault');
    const content = await cache.get('src/test.txt', 'main.1');

    expect(content).toBe('hello flexvault');
  });

  it('reads from disk if memory cache does not have entry', async () => {
    const cache1 = new ContentCache({ cacheDir: tmpDir });
    await cache1.initialize();
    await cache1.set('src/test.txt', 'main.2', 'persistent content');

    // Fresh cache instance pointing to same directory
    const cache2 = new ContentCache({ cacheDir: tmpDir });
    await cache2.initialize();
    const content = await cache2.get('src/test.txt', 'main.2');

    expect(content).toBe('persistent content');
  });

  it('purges disk if version marker does not match', async () => {
    await fs.writeFile(path.join(tmpDir, 'version.json'), JSON.stringify({ version: 999 }), 'utf8');
    await fs.writeFile(path.join(tmpDir, 'dummy.dat'), 'old data', 'utf8');

    const cache = new ContentCache({ cacheDir: tmpDir });
    await cache.initialize();

    // Outdated version purged
    const versionRaw = await fs.readFile(path.join(tmpDir, 'version.json'), 'utf8');
    expect(JSON.parse(versionRaw)).toEqual({ version: 1 });

    const exists = await fs
      .access(path.join(tmpDir, 'dummy.dat'))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it('clears all cached entries on clear()', async () => {
    const cache = new ContentCache({ cacheDir: tmpDir });
    await cache.initialize();

    await cache.set('a.txt', 'main.1', 'content A');
    await cache.set('b.txt', 'main.1', 'content B');
    expect(cache.entryCount).toBe(2);

    await cache.clear();
    expect(cache.entryCount).toBe(0);
    expect(await cache.get('a.txt', 'main.1')).toBeUndefined();
    expect(await cache.get('b.txt', 'main.1')).toBeUndefined();
  });

  it('evicts oldest entries when disk cap is reached', async () => {
    // 1 MB cap, but we'll use small entries and small byte threshold
    const cache = new ContentCache({ cacheDir: tmpDir, maxDiskSizeMB: 1 });
    await cache.initialize();

    // Artificially configure a tiny maxDiskSizeBytes to test eviction
    (cache as unknown as { maxDiskSizeBytes: number }).maxDiskSizeBytes = 50;

    await cache.set('file1.txt', 'main.1', '12345678901234567890'); // 20 bytes
    // Small pause to guarantee distinct timestamps
    await new Promise((r) => setTimeout(r, 10));
    await cache.set('file2.txt', 'main.1', '12345678901234567890'); // 20 bytes
    await new Promise((r) => setTimeout(r, 10));
    await cache.set('file3.txt', 'main.1', '12345678901234567890'); // 20 bytes -> total 60 > 50 -> file1 evicted

    expect(await cache.get('file1.txt', 'main.1')).toBeUndefined();
    expect(await cache.get('file2.txt', 'main.1')).toBe('12345678901234567890');
    expect(await cache.get('file3.txt', 'main.1')).toBe('12345678901234567890');
  });

  it('trims an oversized on-disk cache when reinitialized under a lowered cap', async () => {
    const cache1 = new ContentCache({ cacheDir: tmpDir, maxDiskSizeMB: 1 });
    await cache1.initialize();
    await cache1.set('file1.txt', 'main.1', '12345678901234567890'); // 20 bytes
    await new Promise((r) => setTimeout(r, 10));
    await cache1.set('file2.txt', 'main.1', '12345678901234567890'); // 20 bytes
    expect(cache1.entryCount).toBe(2);

    // Simulate the user lowering flexvault.contentCacheSizeMB and reloading the window:
    // a fresh instance is constructed with a cap the existing on-disk cache already exceeds.
    const cache2 = new ContentCache({ cacheDir: tmpDir });
    (cache2 as unknown as { maxDiskSizeBytes: number }).maxDiskSizeBytes = 25;
    await cache2.initialize();

    expect(cache2.entryCount).toBe(1);
    expect(cache2.totalBytes).toBeLessThanOrEqual(25);
    expect(await cache2.get('file1.txt', 'main.1')).toBeUndefined();
    expect(await cache2.get('file2.txt', 'main.1')).toBe('12345678901234567890');
  });

  it('does not double-decrement tracked size when evictions race', async () => {
    const cache = new ContentCache({ cacheDir: tmpDir, maxDiskSizeMB: 1 });
    await cache.initialize();
    (cache as unknown as { maxDiskSizeBytes: number }).maxDiskSizeBytes = 50;

    await cache.set('file1.txt', 'main.1', '12345678901234567890'); // 20 bytes
    await new Promise((r) => setTimeout(r, 10));
    await cache.set('file2.txt', 'main.1', '12345678901234567890'); // 20 bytes

    // A new write and a concurrent config-driven cap refresh (e.g. flexvault.contentCacheSizeMB
    // changing) both trigger eviction of the same over-cap state; they must serialize rather
    // than each independently decrementing totalDiskSizeBytes for the same evicted entry.
    const setPromise = cache.set('file3.txt', 'main.1', '12345678901234567890'); // 20 bytes
    const evictPromise = (
      cache as unknown as { evictIfNecessary: (n?: number) => Promise<void> }
    ).evictIfNecessary();
    await Promise.all([setPromise, evictPromise]);

    const diskIndex = (cache as unknown as { diskIndex: Map<string, { size: number }> }).diskIndex;
    const sum = [...diskIndex.values()].reduce((acc, e) => acc + e.size, 0);
    expect(cache.totalBytes).toBe(sum);
  });
});
