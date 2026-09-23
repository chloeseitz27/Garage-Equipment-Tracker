import { getLocationPath, indexLocations } from './location.js';
import { ROOM_MAPS } from './room-maps.js';
import type { Location } from './types.js';

export type MapPosition = NonNullable<Location['mapPosition']>;
export interface MappedLocation {
  room: Location;
  map: (typeof ROOM_MAPS)[keyof typeof ROOM_MAPS];
  marker?: { location: Location; position: MapPosition };
}

export function resolveLocationMap(locations: Location[], locationId: string): MappedLocation | null {
  const path = getLocationPath(indexLocations(locations), locationId);
  const room = path[0];
  if (!room || room.parentId !== null || room.kind !== 'room' || !room.mapId) return null;
  const result: MappedLocation = { room, map: ROOM_MAPS[room.mapId] };
  // Storage inherits its enclosing surface, never a legacy storage-level pin.
  const surface = path[1];
  if (surface?.mapPosition?.roomId === room.id && surface.mapPosition.mapId === room.mapId) {
    result.marker = { location: surface, position: surface.mapPosition };
  }
  return result;
}

export function roomMapMarkers(locations: Location[], roomId: string): Location[] {
  return locations.filter((location) => {
    if (!location.mapPosition) return false;
    const resolved = resolveLocationMap(locations, location.id);
    return resolved?.room.id === roomId && resolved.marker?.location.id === location.id;
  });
}

export function locationMapProblem(
  location: Pick<Location, 'kind' | 'parentId' | 'mapId' | 'mapPosition'>,
  locations: Location[],
  previous?: Location,
): string | null {
  if (location.mapId && (location.kind !== 'room' || location.parentId !== null)) {
    return 'A floor plan can only be assigned to a top-level room.';
  }
  if (!location.mapPosition) return null;
  const path = location.parentId ? getLocationPath(locations, location.parentId) : [];
  if (path.length > 1) return 'Storage locations inherit their enclosing surface and cannot have separate map pins.';
  // Existing pins may become stale after a move. The resolver ignores them until remapped.
  if (previous && JSON.stringify(location.mapPosition) === JSON.stringify(previous.mapPosition)) return null;
  const room = path[0];
  if (!room || !room.mapId || room.parentId !== null ||
      location.mapPosition.roomId !== room.id || location.mapPosition.mapId !== room.mapId) {
    return 'Place the marker on the floor plan for this location\'s current room.';
  }
  return null;
}

/** Only room-level surfaces require their own placement. Storage inherits that surface. */
export function locationPlacementProblem(
  location: Pick<Location, 'parentId' | 'mapPosition'> & { id?: string },
  locations: Location[],
  svgLocationIds: ReadonlySet<string> = new Set(),
): string | null {
  const path = location.parentId ? getLocationPath(locations, location.parentId) : [];
  if (path.length !== 1) return null;
  const room = path[0];
  if (!room || room.parentId !== null || room.kind !== 'room' || !room.mapId) return null;
  if (location.id && svgLocationIds.has(location.id)) return null;
  if (!location.mapPosition || location.mapPosition.roomId !== room.id || location.mapPosition.mapId !== room.mapId) {
    return `Place this location on the ${room.name} map before saving.`;
  }

  return null;
}

export interface MapTarget {
  location: Location;
  kind: 'shape' | 'point';
  position?: MapPosition;
}

export function resolveMapTarget(locations: Location[], locationId: string, svgLocationIds: ReadonlySet<string>): MapTarget | null {
  const path = getLocationPath(locations, locationId);
  const room = path[0];
  if (!room?.mapId || room.kind !== 'room' || room.parentId !== null) return null;
  const surface = path[1];
  if (!surface) return null;
  if (svgLocationIds.has(surface.id)) return { location: surface, kind: 'shape' };
  const position = surface.mapPosition;
  if (position?.roomId === room.id && position.mapId === room.mapId) return { location: surface, kind: 'point', position };
  return null;
}
