import { catalogSchema, publicCatalog, type CatalogResponse } from '@garage/shared';

export const CATALOG_CACHE_KEY = 'garage-inventory:catalog:v3';
export const CATALOG_MAX_AGE_MS = 5 * 60_000;
export type CatalogStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface StoredCatalog {
  version: 3;
  fetchedAt: number;
  catalog: CatalogResponse;
}

export interface CatalogSnapshot {
  catalog: CatalogResponse;
  fetchedAt: number;
  source: 'cache' | 'network';
  stale: boolean;
}

export interface CacheIssue {
  operation: 'read' | 'write' | 'remove';
  error: unknown;
}

export class CatalogRefreshSupersededError extends Error {
  constructor() {
    super('Catalog refresh was superseded by invalidation or another tab');
    this.name = 'CatalogRefreshSupersededError';
  }
}

export class BrowserCatalogCache {
  readonly key: string;
  private readonly now: () => number;
  private readonly maxAgeMs: number;
  private entry: StoredCatalog | undefined;
  private hydrated = false;
  private generation = 0;
  private pending: Promise<StoredCatalog> | undefined;

  constructor(private readonly options: {
    fetchCatalog: () => Promise<unknown>;
    onCacheError: (issue: CacheIssue) => void;
    storage?: CatalogStorage;
    key?: string;
    maxAgeMs?: number;
    now?: () => number;
  }) {
    this.key = options.key ?? CATALOG_CACHE_KEY;
    this.now = options.now ?? Date.now;
    this.maxAgeMs = options.maxAgeMs ?? CATALOG_MAX_AGE_MS;
    if (!this.key.trim()) throw new Error('Catalog cache key must not be empty');
    if (!Number.isFinite(this.maxAgeMs) || this.maxAgeMs < 0) {
      throw new RangeError('Catalog cache max age must be a finite, nonnegative number');
    }
  }

  read(): CatalogSnapshot | null {
    if (!this.hydrated) {
      this.hydrated = true;
      this.hydrate();
    }
    return this.entry ? this.snapshot(this.entry, 'cache') : null;
  }

  async refresh(persist = true): Promise<CatalogSnapshot> {
    const generation = this.generation;
    const pending = this.pending ??= this.fetchSnapshot(generation, persist);
    try {
      const entry = await pending;
      if (generation !== this.generation) throw new CatalogRefreshSupersededError();
      return this.snapshot(entry, 'network');
    } finally {
      if (this.pending === pending) this.pending = undefined;
    }
  }

  invalidate(): void {
    this.dropMemory();
    this.hydrated = true;
    this.removeStoredEntry();
  }

  reloadFromStorage(): CatalogSnapshot | null {
    this.dropMemory();
    this.hydrated = false;
    return this.read();
  }

  private get storage(): CatalogStorage {
    return this.options.storage ?? window.localStorage;
  }

  private hydrate(): void {
    let raw: string | null;
    try {
      if (this.key === CATALOG_CACHE_KEY) this.storage.removeItem('garage-inventory:catalog:v2');
      raw = this.storage.getItem(this.key);
    } catch (error) {
      this.options.onCacheError({ operation: 'read', error });
      return;
    }
    if (raw === null) return;
    try {
      const stored: unknown = JSON.parse(raw);
      if (
        !stored || typeof stored !== 'object' ||
        !('version' in stored) || stored.version !== 3 ||
        !('fetchedAt' in stored) || typeof stored.fetchedAt !== 'number' ||
        !Number.isSafeInteger(stored.fetchedAt) || stored.fetchedAt < 0 ||
        stored.fetchedAt > this.now() || !('catalog' in stored)
      ) {
        throw new Error('Invalid or incompatible saved catalog');
      }
      this.entry = {
        version: 3,
        fetchedAt: stored.fetchedAt,
        catalog: publicCatalog(catalogSchema.parse(stored.catalog)),
      };
    } catch (error) {
      this.options.onCacheError({ operation: 'read', error });
      this.removeStoredEntry();
    }
  }

  private async fetchSnapshot(generation: number, persist: boolean): Promise<StoredCatalog> {
    const payload = await this.options.fetchCatalog();
    if (generation !== this.generation) throw new CatalogRefreshSupersededError();
    const catalog = catalogSchema.parse(payload);
    const entry: StoredCatalog = { version: 3, fetchedAt: this.now(), catalog };
    this.entry = entry;
    this.hydrated = true;
    if (persist) {
      try {
        this.storage.setItem(this.key, JSON.stringify({ ...entry, catalog: publicCatalog(catalog) }));
      } catch (error) {
        this.options.onCacheError({ operation: 'write', error });
      }
    }
    return entry;
  }

  private snapshot(entry: StoredCatalog, source: CatalogSnapshot['source']): CatalogSnapshot {
    const age = this.now() - entry.fetchedAt;
    return {
      catalog: structuredClone(entry.catalog),
      fetchedAt: entry.fetchedAt,
      source,
      stale: age < 0 || age >= this.maxAgeMs,
    };
  }

  private dropMemory(): void {
    this.generation++;
    this.entry = undefined;
    this.pending = undefined;
  }

  private removeStoredEntry(): void {
    try {
      this.storage.removeItem(this.key);
    } catch (error) {
      this.options.onCacheError({ operation: 'remove', error });
    }
  }
}
