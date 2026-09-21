import { getLocationPath, indexLocations } from './location.js';
import type { CatalogResponse, Location } from './types.js';

export const ASK_STAFF_LOCATION: Location = {
  id: 'public-ask-staff', name: 'Ask Staff', kind: 'room', parentId: null,
};

export function isStaffOnlyLocation(locations: Location[], id: string): boolean {
  return getLocationPath(locations, id).some((location) => location.staffOnly);
}

/** Restricted names, hierarchy, IDs, and map coordinates never belong in a visitor catalog. */
export function publicCatalog(catalog: CatalogResponse): CatalogResponse {
  const index = indexLocations(catalog.locations);
  const restricted = new Set(catalog.locations.filter((location) =>
    getLocationPath(index, location.id).some((ancestor) => ancestor.staffOnly),
  ).map((location) => location.id));
  const locations = catalog.locations.filter((location) => !restricted.has(location.id));
  if (restricted.size && !locations.some((location) => location.id === ASK_STAFF_LOCATION.id)) {
    locations.push({ ...ASK_STAFF_LOCATION });
  }
  return {
    ...catalog,
    access: 'public',
    locations,
    items: catalog.items.map((item) => restricted.has(item.locationId)
      ? { ...item, locationId: ASK_STAFF_LOCATION.id } : item),
  };
}
