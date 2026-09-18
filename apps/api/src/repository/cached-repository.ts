import {
  catalogSchema,
  type CatalogResponse,
  type Category,
  type CreateItemInput,
  type Flag,
  type Item,
  type Location,
} from '@garage/shared';
import type { CatalogRepository } from './catalog-repository.js';

export const DEFAULT_CATALOG_CACHE_TTL_MS = 60 * 60_000;

interface CacheEntry {
  catalog: CatalogResponse;
  fetchedAt: number;
}

export class CachedCatalogRepository implements CatalogRepository {
  private entry: CacheEntry | undefined;
  private pending: Promise<CacheEntry | null> | undefined;
  private generation = 0;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly repository: CatalogRepository,
    options: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_CATALOG_CACHE_TTL_MS;
    if (!Number.isFinite(this.ttlMs) || this.ttlMs < 0) {
      throw new RangeError('Catalog cache TTL must be a finite, nonnegative number');
    }
    this.now = options.now ?? Date.now;
  }

  private async getCatalog(): Promise<CatalogResponse> {
    for (;;) {
      const age = this.entry ? this.now() - this.entry.fetchedAt : -1;
      if (this.entry && age >= 0 && age < this.ttlMs) return this.entry.catalog;

      const generation = this.generation;
      const pending = this.pending ??= this.fetchSnapshot(generation);
      try {
        const entry = await pending;
        if (entry && generation === this.generation) return entry.catalog;
      } finally {
        if (this.pending === pending) this.pending = undefined;
      }
    }
  }

  private async fetchSnapshot(generation: number): Promise<CacheEntry | null> {
    const [items, locations, categories] = await Promise.all([
      this.repository.getItems(),
      this.repository.getLocations(),
      this.repository.getCategories(),
    ]);
    if (generation !== this.generation) return null;
    const catalog = catalogSchema.parse({ items, locations, categories });
    const entry = { catalog, fetchedAt: this.now() };
    this.entry = entry;
    return entry;
  }

  async getItems(): Promise<Item[]> {
    return structuredClone((await this.getCatalog()).items);
  }

  async getItem(id: string): Promise<Item | null> {
    return structuredClone((await this.getCatalog()).items.find((item) => item.id === id) ?? null);
  }

  async getLocations(): Promise<Location[]> {
    return structuredClone((await this.getCatalog()).locations);
  }

  async getCategories(): Promise<Category[]> {
    return structuredClone((await this.getCatalog()).categories);
  }

  createItem(item: CreateItemInput): Promise<Item> {
    return this.write(() => this.repository.createItem(item));
  }

  createItems(items: CreateItemInput[]): Promise<Item[]> {
    return this.write(() => this.repository.createItems(items));
  }

  saveItem(item: Item): Promise<void> {
    return this.write(() => this.repository.saveItem(item));
  }

  saveItems(items: Item[]): Promise<void> {
    return this.write(() => this.repository.saveItems(items));
  }

  createLocation(location: Omit<Location, 'id'>): Promise<Location> {
    return this.write(() => this.repository.createLocation(location));
  }

  saveLocation(location: Location): Promise<void> {
    return this.write(() => this.repository.saveLocation(location));
  }

  deleteLocation(id: string): Promise<void> {
    return this.write(() => this.repository.deleteLocation(id));
  }

  createCategory(category: Omit<Category, 'id'>): Promise<Category> {
    return this.write(() => this.repository.createCategory(category));
  }

  saveCategory(category: Category): Promise<void> {
    return this.write(() => this.repository.saveCategory(category));
  }

  deleteCategory(id: string): Promise<void> {
    return this.write(() => this.repository.deleteCategory(id));
  }

  getFlags(): Promise<Flag[]> {
    return this.repository.getFlags();
  }

  addFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'resolved'>): Promise<Flag> {
    return this.repository.addFlag(flag);
  }

  setFlagResolved(id: string, resolved: boolean): Promise<Flag | null> {
    return this.repository.setFlagResolved(id, resolved);
  }

  invalidate(): void {
    this.generation++;
    this.entry = undefined;
    this.pending = undefined;
  }

  private async write<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } finally {
      // A failed write may have reached storage before its response was lost.
      this.invalidate();
    }
  }
}
