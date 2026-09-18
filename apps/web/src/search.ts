import Fuse from 'fuse.js';
import {
  formatLocationPath,
  getLocationPath,
  indexLocations,
  liveItems,
  type CatalogResponse,
  type Item,
  type Location,
} from '@garage/shared';

/**
 * Search runs client-side over the whole catalog (technical-spec.md §7).
 *
 * At Garage scale the catalog is a small payload, and loading it once buys
 * keystroke-latency results with no network round trip — which is how the
 * sub-200ms target is met without a search service.
 */

export interface SearchRecord {
  item: Item;
  categoryName: string;
  locationPath: Location[];
  locationText: string;
}

export function buildRecords(catalog: CatalogResponse): SearchRecord[] {
  const locationIndex = indexLocations(catalog.locations);
  const categoryNames = new Map(catalog.categories.map((category) => [category.id, category.name]));

  return liveItems(catalog.items)
    // Retired items live only in the staff recycle bin.
    .map((item) => {
      const locationPath = getLocationPath(locationIndex, item.locationId);
      return {
        item,
        categoryName: categoryNames.get(item.categoryId) ?? '',
        locationPath,
        locationText: formatLocationPath(locationPath),
      };
    });
}

export function createSearchIndex(records: SearchRecord[]): Fuse<SearchRecord> {
  return new Fuse(records, {
    // Fuzzy matching covers the misspelling and plural tolerance required by
    // product-spec.md §6.1.
    threshold: 0.4,
    ignoreLocation: true,
    keys: [
      { name: 'item.name', weight: 5 },
      { name: 'item.tags', weight: 4 },
      { name: 'item.goodFor', weight: 2 },
      { name: 'categoryName', weight: 2 },
      { name: 'item.description', weight: 1 },
      { name: 'locationText', weight: 1 },
    ],
  });
}
