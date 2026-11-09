import { locationSchema, resolveLocationMap, type Location } from '@garage/shared';

export interface MapSynchronization {
  updated: Location[];
  created: Location[];
}

/** Synchronize catalog names for drawn surfaces; private rooms, children, and item assignments stay untouched. */
export function planMapSynchronization(current: Location[], seed: Location[]): MapSynchronization {
  const plan: MapSynchronization = { updated: [], created: [] };
  for (const desired of seed) {
    if (desired.parentId === null) continue;
    const desiredRoom = resolveLocationMap(seed, desired.id)?.room;
    if (!desiredRoom?.mapId) continue;
    const mapped = resolveLocationMap(current, desiredRoom.id);
    if (!mapped || mapped.room.mapId !== desiredRoom.mapId) {
      throw new Error(`The current room/floor plan does not match ${desired.name}.`);
    }
    const existing = current.find((location) => location.id === desired.id);
    if (!existing) {
      plan.created.push(locationSchema.parse(desired));
      continue;
    }
    if (existing.parentId !== desired.parentId) {
      throw new Error(`${existing.id} has moved to a different parent; review before synchronizing its map label.`);
    }
    const lettered = desired.kind === 'table' || desired.kind === 'desk' || desired.kind === 'workbench';
    const next = locationSchema.parse({
      ...existing, name: lettered ? desired.name : existing.name,
    });
    if (existing.name !== next.name) {
      plan.updated.push(next);
    }
  }
  return plan;
}
