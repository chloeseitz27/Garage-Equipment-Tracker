import { randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  categoriesFileSchema,
  findCatalogProblems,
  flagsFileSchema,
  itemsFileSchema,
  locationsFileSchema,
  type Category,
  type CreateItemInput,
  type Flag,
  type Item,
  type Location,
} from '@garage/shared';

import type { CatalogRepository } from './catalog-repository.js';

/**
 * JSON files on disk, held in memory and rewritten on change.
 *
 * Honest limitations, accepted for the demo (technical-spec.md §4.1): no
 * concurrency control, full-file rewrites, no transactions. Writes go through
 * write-temp-then-rename so a crash mid-write can't truncate a file (§4.3).
 */
export class JsonCatalogRepository implements CatalogRepository {
  private items: Item[] = [];
  private locations: Location[] = [];
  private categories: Category[] = [];
  private flags: Flag[] = [];

  constructor(private readonly dataDir: string) {}

  async load(): Promise<void> {
    this.items = itemsFileSchema.parse(await this.readJson('items.json'));
    this.locations = locationsFileSchema.parse(await this.readJson('locations.json'));
    this.categories = categoriesFileSchema.parse(await this.readJson('categories.json'));
    this.flags = flagsFileSchema.parse(await this.readJson('flags.json'));

    const problems = findCatalogProblems({
      items: this.items,
      locations: this.locations,
      categories: this.categories,
      flags: this.flags,
    });

    if (problems.length > 0) {
      throw new Error(
        `Catalog data in ${this.dataDir} is inconsistent:\n  - ${problems.join('\n  - ')}`,
      );
    }
  }

  async getItems(): Promise<Item[]> {
    return [...this.items];
  }

  async getItem(id: string): Promise<Item | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }

  async createItem(input: CreateItemInput): Promise<Item> {
    const item = { ...input, id: this.nextId('itm', input.name, this.items) } as Item;
    this.items.push(item);
    await this.persist('items.json', this.items);
    return item;
  }

  async saveItem(item: Item): Promise<void> {
    const index = this.items.findIndex((existing) => existing.id === item.id);
    if (index === -1) throw new Error(`Unknown item: ${item.id}`);
    this.items[index] = item;
    await this.persist('items.json', this.items);
  }

  async getLocations(): Promise<Location[]> {
    return [...this.locations];
  }

  async createLocation(input: Omit<Location, 'id'>): Promise<Location> {
    const location: Location = { ...input, id: this.nextId('loc', input.name, this.locations) };
    this.locations.push(location);
    await this.persist('locations.json', this.locations);
    return location;
  }

  async getCategories(): Promise<Category[]> {
    return [...this.categories];
  }

  async createCategory(input: Omit<Category, 'id'>): Promise<Category> {
    const category: Category = { ...input, id: this.nextId('cat', input.name, this.categories) };
    this.categories.push(category);
    await this.persist('categories.json', this.categories);
    return category;
  }

  async getFlags(): Promise<Flag[]> {
    return [...this.flags];
  }

  async addFlag(input: Omit<Flag, 'id' | 'createdAt' | 'resolved'>): Promise<Flag> {
    const flag: Flag = {
      ...input,
      id: `flg-${randomBytes(6).toString('hex')}`,
      createdAt: new Date().toISOString(),
      resolved: false,
    };
    this.flags.push(flag);
    await this.persist('flags.json', this.flags);
    return flag;
  }

  async setFlagResolved(id: string, resolved: boolean): Promise<Flag | null> {
    const flag = this.flags.find((candidate) => candidate.id === id);
    if (!flag) return null;
    flag.resolved = resolved;
    await this.persist('flags.json', this.flags);
    return flag;
  }

  private async readJson(fileName: string): Promise<unknown> {
    return JSON.parse(await readFile(join(this.dataDir, fileName), 'utf8'));
  }

  /** Write to a temp file in the same directory, then rename over the target (§4.3). */
  private async persist(fileName: string, data: unknown): Promise<void> {
    const target = join(this.dataDir, fileName);
    const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(temp, target);
  }

  /**
   * IDs are stable and never reused, including after retirement
   * (technical-spec.md §3.2) — a reused ID means an assistant recommendation
   * can resolve to the wrong physical object.
   */
  private nextId(prefix: string, name: string, existing: Array<{ id: string }>): string {
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'item';

    const taken = new Set(existing.map((record) => record.id));
    let candidate = `${prefix}-${slug}`;
    while (taken.has(candidate)) {
      candidate = `${prefix}-${slug}-${randomBytes(2).toString('hex')}`;
    }
    return candidate;
  }
}
