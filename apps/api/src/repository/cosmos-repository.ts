import { randomBytes } from 'node:crypto';

import {
  BulkOperationType,
  Container,
  CosmosClient,
  type CreateOperationInput,
  type JSONObject,
  type ReplaceOperationInput,
  type UpsertOperationInput,
} from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import {
  findCatalogProblems,
  MARKER_BATCH_LIMIT,
  itemSchema,
  type Category,
  type CreateItemInput,
  type Flag,
  type Item,
  type Location,
} from '@garage/shared';

import type { CatalogRepository } from './catalog-repository.js';

/**
 * Azure Cosmos DB implementation of the catalog repository — the successor the
 * technical spec left room for (§4, §11).
 *
 * Layout: a single container partitioned on `/type`. Four logical partitions
 * (`item`, `location`, `category`, `flag`) keep the whole catalog inside the
 * free tier's 1000 RU/s, where four separate containers would each demand a
 * 400 RU/s minimum and blow past it.
 *
 * Domain records are stored as-is. `Item` is a discriminated union whose two
 * arms carry different required fields, so storing documents rather than rows
 * avoids the nullable-column-plus-CHECK-constraint dance a relational store
 * would need.
 */

type DocType = 'item' | 'location' | 'category' | 'flag';

/** Cosmos system properties, plus the partition key we add on write. */
interface StoredDoc {
  id: string;
  type: DocType;
  [key: string]: unknown;
}

const SYSTEM_FIELDS = ['_rid', '_self', '_etag', '_attachments', '_ts', 'type'];

/** Strips Cosmos bookkeeping so callers only ever see domain shapes. */
const toDomain = <T>(doc: StoredDoc): T => {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!SYSTEM_FIELDS.includes(key)) clean[key] = value;
  }
  return clean as T;
};

const toDoc = (type: DocType, record: { id: string }): StoredDoc =>
  ({ ...record, type }) as StoredDoc;

export class CosmosCatalogRepository implements CatalogRepository {
  private container!: Container;

  constructor(
    private readonly options: {
      endpoint: string;
      database: string;
      container: string;
      key?: string;
    },
  ) {}

  /**
   * Connects and verifies the stored catalog is internally consistent, matching
   * the JSON repository's behaviour — a catalog with dangling references should
   * fail loudly at startup rather than at the first unlucky request.
   */
  async load(): Promise<void> {
    const { endpoint, database, container, key } = this.options;

    // With no key configured, authenticate via managed identity. Nothing to
    // leak, nothing to rotate (technical-spec.md §9.1).
    const client = key
      ? new CosmosClient({ endpoint, key })
      : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });

    this.container = client.database(database).container(container);

    const [items, locations, categories, flags] = await Promise.all([
      this.getItems(),
      this.getLocations(),
      this.getCategories(),
      this.getFlags(),
    ]);

    const problems = findCatalogProblems({ items, locations, categories, flags });
    if (problems.length > 0) {
      throw new Error(
        `Catalog in Cosmos (${database}/${container}) is inconsistent:\n  - ${problems.join('\n  - ')}`,
      );
    }
  }

  private async readPartition<T>(type: DocType): Promise<T[]> {
    const { resources } = await this.container.items
      .query<StoredDoc>({
        query: 'SELECT * FROM c WHERE c.type = @type',
        parameters: [{ name: '@type', value: type }],
      })
      // Scoped to one logical partition, so this never fans out.
      .fetchAll();

    return resources.map((doc) => toDomain<T>(doc));
  }

  private async create<T extends { id: string }>(type: DocType, record: T): Promise<T> {
    await this.container.items.create(toDoc(type, record));
    return record;
  }

  private async upsert<T extends { id: string }>(type: DocType, record: T): Promise<void> {
    await this.container.items.upsert(toDoc(type, record));
  }

  private async remove(type: DocType, id: string): Promise<void> {
    await this.container.item(id, type).delete();
  }

  async getItems(): Promise<Item[]> {
    return (await this.readPartition<unknown>('item')).map((item) => itemSchema.parse(item));
  }

  async getItem(id: string): Promise<Item | null> {
    try {
      const { resource } = await this.container.item(id, 'item').read<StoredDoc>();
      return resource ? itemSchema.parse(toDomain<unknown>(resource)) : null;
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }

  async createItem(input: CreateItemInput): Promise<Item> {
    const existing = await this.existingIds('item');
    return this.create('item', { ...input, id: nextId('itm', input.name, existing) } as Item);
  }

  async createItems(inputs: CreateItemInput[]): Promise<Item[]> {
    const existing = await this.existingIds('item');

    const created = inputs.map((input) => {
      const item = { ...input, id: nextId('itm', input.name, existing) } as Item;
      // Reserve the id so two identically named rows in one batch can't collide.
      existing.add(item.id);
      return item;
    });

    const operations: CreateOperationInput[] = created.map((item) => ({
      operationType: BulkOperationType.Create,
      resourceBody: toDoc('item', item) as unknown as JSONObject,
    }));

    // Every item shares the `item` partition key, so this is a genuine
    // transaction — the all-or-nothing guarantee the bulk route promises holds
    // at the storage layer, not just in the route's validation pass.
    const response = await this.container.items.batch(operations, 'item');

    const failed = response.result?.find((entry) => entry.statusCode >= 400);
    if (failed) {
      throw new Error(`Bulk create failed (status ${failed.statusCode}); no items were written.`);
    }

    return created;
  }

  async saveItem(item: Item): Promise<void> {
    await this.upsert('item', item);
  }

  async saveItems(items: Item[]): Promise<void> {
    if (items.length === 0) return;

    const operations: UpsertOperationInput[] = items.map((item) => ({
      operationType: BulkOperationType.Upsert,
      resourceBody: toDoc('item', item) as unknown as JSONObject,
    }));

    // All items share the `item` partition key, so this is a real transaction:
    // a bulk move or retire lands completely or not at all.
    const response = await this.container.items.batch(operations, 'item');

    const failed = response.result?.find((entry) => entry.statusCode >= 400);
    if (failed) {
      throw new Error(`Bulk update failed (status ${failed.statusCode}); no items were changed.`);
    }
  }

  async getLocations(): Promise<Location[]> {
    return this.readPartition<Location>('location');
  }

  async createLocation(input: Omit<Location, 'id'>, migrationId?: string): Promise<Location> {
    if (migrationId) return this.create('location', { ...input, id: migrationId });
    const existing = await this.existingIds('location');
    return this.create('location', { ...input, id: nextId('loc', input.name, existing) });
  }

  async saveLocation(location: Location): Promise<void> {
    await this.upsert('location', location);
  }

  async saveLocations(locations: Location[]): Promise<void> {
    if (locations.length === 0) return;
    if (locations.length > MARKER_BATCH_LIMIT) throw new Error(`Save at most ${MARKER_BATCH_LIMIT} markers at once.`);
    const operations: ReplaceOperationInput[] = locations.map((location) => ({
      operationType: BulkOperationType.Replace,
      id: location.id,
      resourceBody: { ...location, type: 'location' },
    }));
    const response = await this.container.items.batch(operations, 'location');
    const failed = response.result?.find((entry) => entry.statusCode >= 400);
    if ((response.code !== undefined && response.code >= 400) || failed) {
      throw new Error(`Marker batch failed (status ${failed?.statusCode ?? response.code}); no locations were changed.`);
    }
    if (!response.result || response.result.length !== locations.length) {
      throw new Error('Could not confirm the marker batch result. Refresh the catalog before retrying.');
    }
  }

  async deleteLocation(id: string): Promise<void> {
    await this.remove('location', id);
  }

  async getCategories(): Promise<Category[]> {
    return this.readPartition<Category>('category');
  }

  async createCategory(input: Omit<Category, 'id'>): Promise<Category> {
    const existing = await this.existingIds('category');
    return this.create('category', { ...input, id: nextId('cat', input.name, existing) });
  }

  async saveCategory(category: Category): Promise<void> {
    await this.upsert('category', category);
  }

  async deleteCategory(id: string): Promise<void> {
    await this.remove('category', id);
  }

  async getFlags(): Promise<Flag[]> {
    return this.readPartition<Flag>('flag');
  }

  async addFlag(input: Omit<Flag, 'id' | 'createdAt' | 'resolved'>): Promise<Flag> {
    return this.create('flag', {
      ...input,
      id: `flg-${randomBytes(6).toString('hex')}`,
      createdAt: new Date().toISOString(),
      resolved: false,
    });
  }

  async setFlagResolved(id: string, resolved: boolean): Promise<Flag | null> {
    try {
      const { resource } = await this.container.item(id, 'flag').read<StoredDoc>();
      if (!resource) return null;

      const flag = { ...toDomain<Flag>(resource), resolved };
      await this.upsert('flag', flag);
      return flag;
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }

  /** Reads just the ids in a partition — enough to keep generated ids unique. */
  private async existingIds(type: DocType): Promise<Set<string>> {
    const { resources } = await this.container.items
      .query<{ id: string }>({
        query: 'SELECT c.id FROM c WHERE c.type = @type',
        parameters: [{ name: '@type', value: type }],
      })
      .fetchAll();

    return new Set(resources.map((row) => row.id));
  }
}

/**
 * IDs are stable and never reused, including after retirement
 * (technical-spec.md §3.2) — the assistant grounds recommendations on them.
 */
export function nextId(prefix: string, name: string, taken: Set<string>): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'item';

  let candidate = `${prefix}-${slug}`;
  while (taken.has(candidate)) {
    candidate = `${prefix}-${slug}-${randomBytes(2).toString('hex')}`;
  }
  return candidate;
}
