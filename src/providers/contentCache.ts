import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import type { Logger } from '../cli/logger';

export const CURRENT_CACHE_VERSION = 1;
export const DEFAULT_CACHE_SIZE_MB = 512;
export const MAX_STREAM_THRESHOLD_BYTES = 32 * 1024 * 1024; // 32MB: skip caching for giant files
export const MAX_MEMORY_CACHE_ENTRIES = 50;
export const MAX_MEMORY_CACHE_BYTES = 16 * 1024 * 1024; // 16MB

export interface CacheEntryMetadata {
  readonly key: string;
  readonly path: string;
  readonly revisionSpec: string;
  size: number;
  lastAccessed: number;
}

interface IndexFile {
  readonly version: number;
  readonly entries: Record<string, CacheEntryMetadata>;
}

export interface ContentCacheOptions {
  readonly cacheDir: string;
  readonly maxDiskSizeMB?: number | undefined;
  readonly log?: Logger | undefined;
}

export class ContentCache {
  private readonly cacheDir: string;
  private maxDiskSizeBytes: number;
  private readonly log: Logger | undefined;

  private readonly memoryCache = new Map<string, string>();
  private memoryCacheSizeBytes = 0;

  private diskIndex = new Map<string, CacheEntryMetadata>();
  private totalDiskSizeBytes = 0;
  private initialized = false;

  constructor(options: ContentCacheOptions) {
    this.cacheDir = options.cacheDir;
    this.maxDiskSizeBytes = (options.maxDiskSizeMB ?? DEFAULT_CACHE_SIZE_MB) * 1024 * 1024;
    this.log = options.log;
  }

  updateCap(maxDiskSizeMB: number): void {
    const mb = Math.max(1, maxDiskSizeMB);
    this.maxDiskSizeBytes = mb * 1024 * 1024;
    void this.evictIfNecessary();
  }

  private entryKey(relPath: string, revisionSpec: string): string {
    const normalized = relPath.replace(/\\/g, '/');
    return crypto.createHash('sha256').update(`${normalized}\0${revisionSpec}`).digest('hex');
  }

  private entryFilePath(key: string): string {
    return path.join(this.cacheDir, `${key}.dat`);
  }

  private indexPath(): string {
    return path.join(this.cacheDir, 'index.json');
  }

  private versionFilePath(): string {
    return path.join(this.cacheDir, 'version.json');
  }

  /**
   * Initializes the cache directory, verifying the version marker.
   * If the version marker does not match, all cache contents are purged.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await fs.mkdir(this.cacheDir, { recursive: true });

      let purge = false;
      try {
        const rawVersion = await fs.readFile(this.versionFilePath(), 'utf8');
        const parsed = JSON.parse(rawVersion) as { version?: number };
        if (parsed.version !== CURRENT_CACHE_VERSION) {
          purge = true;
        }
      } catch {
        purge = true;
      }

      if (purge) {
        this.log?.info('Purging outdated or unversioned FlexVault content cache.');
        await this.purgeDisk();
        await fs.writeFile(
          this.versionFilePath(),
          JSON.stringify({ version: CURRENT_CACHE_VERSION }),
          'utf8',
        );
      } else {
        await this.loadIndex();
      }

      this.initialized = true;
    } catch (err) {
      this.log?.error(
        `Failed to initialize content cache directory: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async loadIndex(): Promise<void> {
    try {
      const raw = await fs.readFile(this.indexPath(), 'utf8');
      const data = JSON.parse(raw) as IndexFile;
      if (data.version === CURRENT_CACHE_VERSION && data.entries) {
        this.diskIndex.clear();
        this.totalDiskSizeBytes = 0;
        for (const [key, entry] of Object.entries(data.entries)) {
          this.diskIndex.set(key, entry);
          this.totalDiskSizeBytes += entry.size;
        }
      }
    } catch {
      // Index missing or corrupted: will rebuild or start fresh
      this.diskIndex.clear();
      this.totalDiskSizeBytes = 0;
    }
  }

  private async saveIndex(): Promise<void> {
    try {
      const entries: Record<string, CacheEntryMetadata> = {};
      for (const [k, v] of this.diskIndex.entries()) {
        entries[k] = v;
      }
      const data: IndexFile = {
        version: CURRENT_CACHE_VERSION,
        entries,
      };
      await fs.writeFile(this.indexPath(), JSON.stringify(data), 'utf8');
    } catch (err) {
      this.log?.debug(
        `Failed to persist cache index: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async purgeDisk(): Promise<void> {
    this.memoryCache.clear();
    this.memoryCacheSizeBytes = 0;
    this.diskIndex.clear();
    this.totalDiskSizeBytes = 0;

    try {
      const entries = await fs.readdir(this.cacheDir);
      for (const entry of entries) {
        try {
          await fs.unlink(path.join(this.cacheDir, entry));
        } catch {
          // Ignore individual unlink failures
        }
      }
    } catch {
      // Directory may not exist yet
    }
  }

  /**
   * Retrieves cached content for a path at a specific revision.
   */
  async get(relPath: string, revisionSpec: string): Promise<string | undefined> {
    const key = this.entryKey(relPath, revisionSpec);

    // 1. Check in-memory cache
    if (this.memoryCache.has(key)) {
      const content = this.memoryCache.get(key)!;
      // Refresh memory LRU
      this.memoryCache.delete(key);
      this.memoryCache.set(key, content);

      // Update access time in disk index
      const meta = this.diskIndex.get(key);
      if (meta) {
        meta.lastAccessed = Date.now();
      }
      return content;
    }

    // 2. Check on-disk cache
    const meta = this.diskIndex.get(key);
    if (!meta) {
      return undefined;
    }

    try {
      const filePath = this.entryFilePath(key);
      const text = await fs.readFile(filePath, 'utf8');

      // Update disk LRU
      meta.lastAccessed = Date.now();
      this.putInMemory(key, text);

      return text;
    } catch {
      // File missing on disk, remove from index
      this.diskIndex.delete(key);
      this.totalDiskSizeBytes -= meta.size;
      return undefined;
    }
  }

  /**
   * Stores content in the cache (memory + disk).
   */
  async set(relPath: string, revisionSpec: string, content: string): Promise<void> {
    const key = this.entryKey(relPath, revisionSpec);
    const byteLength = Buffer.byteLength(content, 'utf8');

    // Skip caching for giant files over threshold
    if (byteLength > MAX_STREAM_THRESHOLD_BYTES) {
      this.log?.debug(`Skipping cache for ${relPath} (${byteLength} bytes > threshold).`);
      return;
    }

    this.putInMemory(key, content);

    // Evict disk entries if necessary to fit the new entry
    await this.evictIfNecessary(byteLength);

    try {
      const filePath = this.entryFilePath(key);
      await fs.writeFile(filePath, content, 'utf8');

      const existing = this.diskIndex.get(key);
      if (existing) {
        this.totalDiskSizeBytes -= existing.size;
      }

      const meta: CacheEntryMetadata = {
        key,
        path: relPath.replace(/\\/g, '/'),
        revisionSpec,
        size: byteLength,
        lastAccessed: Date.now(),
      };

      this.diskIndex.set(key, meta);
      this.totalDiskSizeBytes += byteLength;

      await this.saveIndex();
    } catch (err) {
      this.log?.error(
        `Failed to write cache entry for ${relPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private putInMemory(key: string, content: string): void {
    const byteLength = Buffer.byteLength(content, 'utf8');
    if (byteLength > MAX_MEMORY_CACHE_BYTES) {
      return;
    }

    // Evict old entries from memory cache
    while (
      this.memoryCache.size >= MAX_MEMORY_CACHE_ENTRIES ||
      this.memoryCacheSizeBytes + byteLength > MAX_MEMORY_CACHE_BYTES
    ) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      const oldestContent = this.memoryCache.get(oldestKey)!;
      this.memoryCacheSizeBytes -= Buffer.byteLength(oldestContent, 'utf8');
      this.memoryCache.delete(oldestKey);
    }

    this.memoryCache.set(key, content);
    this.memoryCacheSizeBytes += byteLength;
  }

  private async evictIfNecessary(additionalBytes = 0): Promise<void> {
    if (this.totalDiskSizeBytes + additionalBytes <= this.maxDiskSizeBytes) {
      return;
    }

    // Sort entries by lastAccessed ascending (oldest first)
    const sorted = [...this.diskIndex.values()].sort((a, b) => a.lastAccessed - b.lastAccessed);

    for (const entry of sorted) {
      if (this.totalDiskSizeBytes + additionalBytes <= this.maxDiskSizeBytes) {
        break;
      }

      try {
        await fs.unlink(this.entryFilePath(entry.key));
      } catch {
        // File may already be gone
      }

      this.memoryCache.delete(entry.key);
      this.diskIndex.delete(entry.key);
      this.totalDiskSizeBytes -= entry.size;
    }

    await this.saveIndex();
  }

  /**
   * Purges all cached content on demand.
   */
  async clear(): Promise<void> {
    await this.purgeDisk();
    try {
      await fs.writeFile(
        this.versionFilePath(),
        JSON.stringify({ version: CURRENT_CACHE_VERSION }),
        'utf8',
      );
    } catch {
      // Ignore write failure
    }
  }

  get entryCount(): number {
    return this.diskIndex.size;
  }

  get totalBytes(): number {
    return this.totalDiskSizeBytes;
  }
}
