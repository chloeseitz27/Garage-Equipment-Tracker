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
  // A moved location must never reuse coordinates from a different room or floor plan.
  const mapped = [...path].reverse().find((node) =>
    node.mapPosition?.roomId === room.id && node.mapPosition.mapId === room.mapId,
  );
  if (mapped?.mapPosition) result.marker = { location: mapped, position: mapped.mapPosition };
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
  // Existing pins may become stale after a move. The resolver ignores them until remapped.
  if (previous && JSON.stringify(location.mapPosition) === JSON.stringify(previous.mapPosition)) return null;
  const path = location.parentId ? getLocationPath(locations, location.parentId) : [];
  const room = path[0];
  if (!room || !room.mapId || room.parentId !== null ||
      location.mapPosition.roomId !== room.id || location.mapPosition.mapId !== room.mapId) {
    return 'Place the marker on the floor plan for this location\'s current room.';
  }
  return null;
}

/** A location's own marker is required when its containing room has a floor plan. */
export function locationPlacementProblem(
  location: Pick<Location, 'parentId' | 'mapPosition'>,
  locations: Location[],
): string | null {
  const room = location.parentId ? getLocationPath(locations, location.parentId)[0] : undefined;
  if (!room || room.parentId !== null || room.kind !== 'room' || !room.mapId) return null;
  if (!location.mapPosition || location.mapPosition.roomId !== room.id || location.mapPosition.mapId !== room.mapId) {
    return `Place this location on the ${room.name} map before saving.`;
  }
  return null;
}
