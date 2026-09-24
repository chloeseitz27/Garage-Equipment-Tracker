import type { Category, CreateItemInput, Flag, Item, Location } from '@garage/shared';

/**
 * Everything above this interface — routes, search, the assistant's grounding
 * layer — goes through it. Storage access stays behind the interface.
 *
 * JSON supports local development; Cosmos and its cache use the same contract.
 */
export interface CatalogRepository {
  getItems(): Promise<Item[]>;
  getItem(id: string): Promise<Item | null>;
  createItem(item: CreateItemInput): Promise<Item>;
  /** Creates a batch in one write, so a partial shelf can't be left half-committed. */
  createItems(items: CreateItemInput[]): Promise<Item[]>;
  saveItem(item: Item): Promise<void>;
  /** Saves a batch in one write, so a bulk edit can't half-apply. */
  saveItems(items: Item[]): Promise<void>;

  getLocations(): Promise<Location[]>;
  createLocation(location: Omit<Location, 'id'>, migrationId?: string): Promise<Location>;
  saveLocation(location: Location): Promise<void>;
  /** Saves all locations atomically; a failed batch leaves every marker unchanged. */
  saveLocations(locations: Location[]): Promise<void>;
  deleteLocation(id: string): Promise<void>;

  getCategories(): Promise<Category[]>;
  createCategory(category: Omit<Category, 'id'>): Promise<Category>;
  saveCategory(category: Category): Promise<void>;
  deleteCategory(id: string): Promise<void>;

  getFlags(): Promise<Flag[]>;
  addFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'resolved'>): Promise<Flag>;
  setFlagResolved(id: string, resolved: boolean): Promise<Flag | null>;
}
