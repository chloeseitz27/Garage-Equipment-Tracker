import type { Location } from './types.js';

/**
 * Location paths are derived, never stored (technical-spec.md §3.1).
 *
 * The breadcrumb appears in search results, item detail, and every assistant
 * recommendation. Deriving it here — and only here — means those three can't
 * disagree with each other.
 */

export const PATH_SEPARATOR = ' \u2192 '; // " → "

export function indexLocations(locations: Location[]): Map<string, Location> {
  return new Map(locations.map((location) => [location.id, location]));
}

/**
 * Walks `parentId` to the root and returns the path root-first.
 * Returns an empty array if the id is unknown. A malformed tree with a cycle
 * stops rather than hanging.
 */
export function getLocationPath(
  locations: Location[] | Map<string, Location>,
  locationId: string,
): Location[] {
  const index = locations instanceof Map ? locations : indexLocations(locations);
  const path: Location[] = [];
  const seen = new Set<string>();

  let current = index.get(locationId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId === null ? undefined : index.get(current.parentId);
  }

  return path;
}

export function formatLocationPath(path: Location[]): string {
  return path.map((location) => location.name).join(PATH_SEPARATOR);
}

/** Direct children of a node; pass `null` for the roots. */
export function getChildLocations(locations: Location[], parentId: string | null): Location[] {
  return locations.filter((location) => location.parentId === parentId);
}

/** A node and every node beneath it — "show me everything in Cabinet B" (product-spec.md §5.2). */
export function getDescendantLocationIds(locations: Location[], locationId: string): string[] {
  const ids = [locationId];
  const queue = [locationId];

  while (queue.length > 0) {
    const parentId = queue.shift() as string;
    for (const child of locations) {
      if (child.parentId === parentId && !ids.includes(child.id)) {
        ids.push(child.id);
        queue.push(child.id);
      }
    }
  }

  return ids;
}

/**
 * Guards re-parenting a location under itself or one of its own descendants.
 *
 * A cycle makes the breadcrumb un-derivable for every item beneath it, and the
 * damage is silent until someone opens one of those items. Staff can reorganize
 * the tree freely, so this has to be checked on every move.
 */
export function wouldCreateCycle(
  locations: Location[],
  locationId: string,
  nextParentId: string | null,
): boolean {
  if (nextParentId === null) return false;
  if (nextParentId === locationId) return true;
  return getDescendantLocationIds(locations, locationId).includes(nextParentId);
}

export interface LocationMatch {
  id: string;
  kind: Location['kind'];
  /** Full breadcrumb, e.g. "Main Shop → Electronics Bench → Cabinet B". */
  label: string;
}

/**
 * Type-to-find over the location tree.
 *
 * Matches against the full breadcrumb rather than the node name, so "electronics"
 * reaches every bin under that bench. Every whitespace-separated token must
 * match the start of some word in the path, which means word order doesn't
 * matter — "b3 bin" finds the same node as "bin b3".
 *
 * Word-prefix rather than substring, deliberately: plain substring matching
 * makes "bin" match "Cabinet" (ca-BIN-et), which is a confusing result in a
 * space whose nodes are literally named Bin and Cabinet.
 *
 * An empty query returns the head of the list so the control has something to
 * show on focus.
 */
export function searchLocations(
  locations: Location[],
  query: string,
  limit = 12,
): LocationMatch[] {
  const index = indexLocations(locations);
  const options: LocationMatch[] = locations
    .map((location) => ({
      id: location.id,
      kind: location.kind,
      label: formatLocationPath(getLocationPath(index, location.id)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return options.slice(0, limit);

  return options
    .filter((option) => {
      const words = option.label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      return tokens.every((token) => words.some((word) => word.startsWith(token)));
    })
    .slice(0, limit);
}
