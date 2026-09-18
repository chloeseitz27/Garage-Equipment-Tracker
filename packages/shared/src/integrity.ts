import { getLocationPath, indexLocations } from './location.js';
import type { Category, Flag, Item, Location } from './types.js';

/**
 * Referential integrity for the catalog. Schema validation proves each record
 * is well-formed; this proves the records agree with each other.
 *
 * Broken seed data breaks the demo silently (technical-spec.md §10), so this
 * runs in `npm run validate:seed` and again when the API loads its data.
 */
export interface CatalogData {
  items: Item[];
  locations: Location[];
  categories: Category[];
  flags?: Flag[];
}

export function findCatalogProblems(data: CatalogData): string[] {
  const problems: string[] = [];
  const { items, locations, categories, flags = [] } = data;

  const duplicates = (ids: string[], label: string): void => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) problems.push(`Duplicate ${label} id: ${id}`);
      seen.add(id);
    }
  };

  duplicates(items.map((i) => i.id), 'item');
  duplicates(locations.map((l) => l.id), 'location');
  duplicates(categories.map((c) => c.id), 'category');
  duplicates(flags.map((f) => f.id), 'flag');

  const locationIndex = indexLocations(locations);
  const categoryIds = new Set(categories.map((c) => c.id));
  const itemIds = new Set(items.map((i) => i.id));

  for (const location of locations) {
    if (location.mapId && (location.kind !== 'room' || location.parentId !== null)) {
      problems.push(`Location ${location.id} has a floor plan but is not a top-level room.`);
    }
    if (location.parentId !== null && !locationIndex.has(location.parentId)) {
      problems.push(`Location ${location.id} has unknown parentId: ${location.parentId}`);
      continue;
    }
    // A cycle makes the breadcrumb un-derivable; getLocationPath stops early,
    // so a path that doesn't reach a root is the tell.
    const path = getLocationPath(locationIndex, location.id);
    const root = path[0];
    if (!root || root.parentId !== null) {
      problems.push(`Location ${location.id} does not resolve to a root (cycle in the tree?)`);
    }
  }

  for (const item of items) {
    if (!categoryIds.has(item.categoryId)) {
      problems.push(`Item ${item.id} has unknown categoryId: ${item.categoryId}`);
    }
    if (!locationIndex.has(item.locationId)) {
      problems.push(`Item ${item.id} has unknown locationId: ${item.locationId}`);
    }
  }

  for (const flag of flags) {
    if (!itemIds.has(flag.itemId)) {
      problems.push(`Flag ${flag.id} references unknown itemId: ${flag.itemId}`);
    }
  }

  return problems;
}
