import { getLocationPath, indexLocations } from './location.js';
import { ROOM_MAPS } from './room-maps.js';
import type { Location } from './types.js';

export interface MappedLocation {
  room: Location;
  map: (typeof ROOM_MAPS)[keyof typeof ROOM_MAPS];
}

export function resolveLocationMap(locations: Location[], locationId: string): MappedLocation | null {
  const path = getLocationPath(indexLocations(locations), locationId);
  const room = path[0];
  if (!room || room.parentId !== null || room.kind !== 'room' || !room.mapId) return null;
  return { room, map: ROOM_MAPS[room.mapId] };
}

export function locationMapProblem(
  location: Pick<Location, 'kind' | 'parentId' | 'mapId'>,
): string | null {
  if (location.mapId && (location.kind !== 'room' || location.parentId !== null)) {
    return 'A floor plan can only be assigned to a top-level room.';
  }
  return null;
}

export interface MapTarget {
  location: Location;
}

export function resolveMapTarget(locations: Location[], locationId: string, svgLocationIds: ReadonlySet<string>): MapTarget | null {
  const path = getLocationPath(locations, locationId);
  const room = path[0];
  if (!room?.mapId || room.kind !== 'room' || room.parentId !== null) return null;
  const surface = path[1];
  if (!surface) return null;
  return svgLocationIds.has(surface.id) ? { location: surface } : null;
}
