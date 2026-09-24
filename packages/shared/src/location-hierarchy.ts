import { getLocationPath, getDescendantLocationIds, indexLocations } from './location.js';
import { STORAGE_KINDS, SURFACE_KINDS, isStationKind } from './schema.js';
import type { Location, LocationKind } from './types.js';

export type LocationLevel = 'room' | 'surface' | 'storage';
export const locationKindLabel = (kind: LocationKind): string => kind.charAt(0).toUpperCase() + kind.slice(1);
export const locationLevel = (locations: Location[], id: string): LocationLevel => {
  const depth = getLocationPath(locations, id).length;
  return depth <= 1 ? 'room' : depth === 2 ? 'surface' : 'storage';
};

export function childLocationKinds(locations: Location[], parentId: string | null): readonly LocationKind[] {
  if (parentId === null) return ['room'];
  return locationLevel(locations, parentId) === 'room' ? SURFACE_KINDS : STORAGE_KINDS;
}

const letterAt = (index: number): string => {
  let result = '';
  do {
    result = String.fromCharCode(65 + index % 26) + result;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return result;
};
export const nextLocationLetter = (locations: Location[]): string => {
  const used = new Set(locations.filter((location) => !isStationKind(location.kind)).map((location) => location.letter).filter(Boolean));
  for (let index = 0; ; index++) {
    const letter = letterAt(index);
    if (!used.has(letter)) return letter;
  }
};

export function surfaceLocationId(locations: Location[], id: string): string | undefined {
  return getLocationPath(locations, id)[1]?.id;
}

/** Preserve legacy IDs/parents while assigning codes and generated storage names. Persist before allocating new codes. */
export function assignLocationIdentities(locations: Location[]): Location[] {
  const result = locations.map((location) => ({ ...location }));
  const index = indexLocations(result);
  const surfaces = result.filter((location) => getLocationPath(index, location.id).length === 2)
    .sort((a, b) => a.id.localeCompare(b.id));
  const usedLetters = new Set<string>();
  for (const surface of surfaces) {
    if (surface.kind === 'zone') surface.kind = 'station';
    if (surface.kind === 'table' && /^Desk\b/i.test(surface.name)) surface.kind = 'desk';
    if (surface.kind === 'station') {
      delete surface.letter;
      continue;
    }
    if (!surface.letter) continue;
    if (usedLetters.has(surface.letter)) throw new Error(`Duplicate location letter: ${surface.letter}`);
    usedLetters.add(surface.letter);
  }
  // Preserve existing physical labels before assigning letters to other surfaces.
  for (const surface of surfaces) {
    if (surface.letter || surface.kind === 'station') continue;
    const letter = /^(?:Desk|Table|Corner table|Workbench|Cabinet) ([A-Z]+)$/i.exec(surface.name)?.[1]?.toUpperCase();
    if (letter && !usedLetters.has(letter)) { surface.letter = letter; usedLetters.add(letter); }
  }
  for (const surface of surfaces) {
    if (surface.letter || surface.kind === 'station') continue;
    surface.letter = nextLocationLetter(result);
  }
  for (const surface of surfaces) {
    const storage = result.filter((location) => location.id !== surface.id && getLocationPath(index, location.id)[1]?.id === surface.id)
      .sort((a, b) => a.id.localeCompare(b.id));
    const numbers = new Set<number>();
    for (const location of storage) {
      if (!location.number) continue;
      if (numbers.has(location.number)) throw new Error(`Duplicate storage number ${surface.letter ?? `${surface.name} / `}${location.number}`);
      numbers.add(location.number);
    }
    for (const location of storage) {
      if (location.number) continue;
      const namedNumber = Number(/^(?:Drawer|Bin|Shelf) (\d+)$/i.exec(location.name)?.[1]);
      if (Number.isSafeInteger(namedNumber) && namedNumber > 0 && !numbers.has(namedNumber)) {
        location.number = namedNumber;
        numbers.add(namedNumber);
      }
    }
    for (const location of storage) {
      if (location.number) continue;
      let number = 1;
      while (numbers.has(number)) number++;
      location.number = number;
      numbers.add(number);
    }
    for (const location of storage) {
      delete location.mapPosition;
      if (STORAGE_KINDS.some((kind) => kind === location.kind)) location.name = `${locationKindLabel(location.kind)} ${location.number}`;
    }
  }
  return result;
}

export function nextStorageNumber(locations: Location[], parentId: string, excludedIds: readonly string[] = []): number {
  const owner = surfaceLocationId(locations, parentId);
  const used = locations.filter((location) => !excludedIds.includes(location.id) &&
    surfaceLocationId(locations, location.id) === owner).map((location) => location.number ?? 0);
  const next = used.reduce((maximum, number) => Math.max(maximum, number), 0) + 1;
  if (!Number.isSafeInteger(next)) throw new Error('This surface has exhausted its storage number range.');
  return next;
}

export function locationHierarchyProblem(location: Pick<Location, 'id' | 'parentId' | 'kind'>, locations: Location[]): string | null {
  if (location.parentId !== null && !locations.some((parent) => parent.id === location.parentId)) return 'The parent location does not exist.';
  const allowed = childLocationKinds(locations, location.parentId);
  if (!allowed.includes(location.kind)) {
    return location.parentId === null ? 'Only rooms can be top-level locations.' :
      allowed === SURFACE_KINDS ? 'Rooms can contain tables, stations, desks, workbenches, or cabinets, not other rooms or storage containers.' :
        'Tables, stations, desks, workbenches, cabinets, and storage containers can contain drawers, bins, or shelves only.';
  }
  const next = [...locations.filter((entry) => entry.id !== location.id), { ...location, name: '' }];
  for (const child of next.filter((entry) => entry.parentId === location.id)) {
    if (!childLocationKinds(next, child.parentId).includes(child.kind)) {
      return `That change would give ${child.name} an invalid parent level. Move its children first.`;
    }
  }
  return null;
}

export interface PreparedLocation {
  location: Location;
  descendants: Location[];
}

/** The server owns letters, storage numbers, and generated storage names. */
export function prepareLocation(
  input: Omit<Location, 'id' | 'name'> & { name?: string },
  locations: Location[],
  id: string,
  previous?: Location,
): PreparedLocation {
  const level: LocationLevel = input.parentId === null ? 'room' : locationLevel(locations, input.parentId) === 'room' ? 'surface' : 'storage';
  const { letter: _ignoredLetter, number: _ignoredNumber, ...fields } = input;
  const record: Location = { ...fields, id, name: input.name?.trim() ?? '' };
  const descendants: Location[] = [];
  if (level === 'surface' && record.kind !== 'station') {
    record.letter = previous?.letter ?? nextLocationLetter(locations);
    if (!record.name) record.name = `${locationKindLabel(record.kind)} ${record.letter}`;
    else if (previous && record.kind !== previous.kind &&
      record.name === `${locationKindLabel(previous.kind)} ${record.letter}`) {
      record.name = `${locationKindLabel(record.kind)} ${record.letter}`;
    }
  } else if (level === 'storage' && input.parentId) {
    delete record.mapPosition;
    const sameSurface = previous && surfaceLocationId(locations, previous.id) === surfaceLocationId(locations, input.parentId);
    const moving = previous ? getDescendantLocationIds(locations, previous.id) : [id];
    let number = nextStorageNumber(locations, input.parentId, moving);
    record.number = sameSurface && previous.number ? previous.number : number++;
    record.name = `${locationKindLabel(record.kind)} ${record.number}`;
    if (previous && !sameSurface) {
      for (const child of locations.filter((child) => child.id !== id && moving.includes(child.id)).sort((a, b) => a.id.localeCompare(b.id))) {
        if (!Number.isSafeInteger(number)) throw new Error('The destination has exhausted its storage number range.');
        const { mapPosition: _oldPin, ...fields } = child;
        descendants.push({ ...fields, number, name: `${locationKindLabel(child.kind)} ${number++}` });
      }
    }
  }
  return { location: record, descendants };
}
