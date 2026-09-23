import { locationSchema, resolveLocationMap, type Location } from '@garage/shared';

export interface MapSynchronization {
  updated: Location[];
  created: Location[];
}

/** Only drawn surfaces are synchronized; private rooms, children, and item assignments stay untouched. */
export function planMapSynchronization(current: Location[], seed: Location[]): MapSynchronization {
  const plan: MapSynchronization = { updated: [], created: [] };
  for (const desired of seed) {
    const position = desired.mapPosition;
    if (!position) continue;
    const mapped = resolveLocationMap(current, position.roomId);
    if (!mapped || mapped.room.mapId !== position.mapId) {
      throw new Error(`The current room/floor plan does not match ${desired.name}.`);
    }
    const existing = current.find((location) => location.id === desired.id);
    if (!existing) {
      plan.created.push(locationSchema.parse(desired));
      continue;
    }
    if (existing.parentId !== desired.parentId) {
      throw new Error(`${existing.id} has moved to a different parent; review before synchronizing its marker.`);
    }
    const lettered = desired.kind === 'table' || desired.kind === 'desk' || desired.kind === 'workbench';
    const next = locationSchema.parse({
      ...existing, name: lettered ? desired.name : existing.name, mapPosition: desired.mapPosition,
    });
    if (existing.name !== next.name || existing.mapPosition?.roomId !== position.roomId ||
      existing.mapPosition?.mapId !== position.mapId || existing.mapPosition?.x !== position.x || existing.mapPosition?.y !== position.y) {
      plan.updated.push(next);
    }
  }
  return plan;
}
