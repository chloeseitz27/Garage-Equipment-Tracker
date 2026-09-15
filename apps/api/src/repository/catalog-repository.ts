import type { Category, CreateItemInput, Flag, Item, Location } from '@garage/shared';

/**
 * Everything above this interface — routes, search, the assistant's grounding
 * layer — goes through it. Nothing else touches the files (technical-spec.md §4).
 *
 * The interface is the point: swapping JSON for SQLite should be a contained
 * change here, not a rewrite.
 */
export interface CatalogRepository {
  getItems(): Promise<Item[]>;
  getItem(id: string): Promise<Item | null>;
  createItem(item: CreateItemInput): Promise<Item>;
  saveItem(item: Item): Promise<void>;

  getLocations(): Promise<Location[]>;
  createLocation(location: Omit<Location, 'id'>): Promise<Location>;

  getCategories(): Promise<Category[]>;
  createCategory(category: Omit<Category, 'id'>): Promise<Category>;

  getFlags(): Promise<Flag[]>;
  addFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'resolved'>): Promise<Flag>;
  setFlagResolved(id: string, resolved: boolean): Promise<Flag | null>;
}
