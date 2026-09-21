import type { Location } from '@garage/shared';
import type { CatalogRepository } from './catalog-repository.js';

const OLD_ADVANCED_NAMES: Record<string, string> = {
  'loc-advanced-table-20': 'Table Z',
  'loc-advanced-table-21': 'Table Y',
  'loc-advanced-workbench-16': 'Workbench X',
  'loc-advanced-table-19': 'Table W',
  'loc-advanced-table-3': 'Table V',
  'loc-advanced-table-18': 'Table U',
  'loc-advanced-table-11': 'Table T',
};
const ADDITIONS = ['loc-table-u', 'loc-storage-closet', 'loc-basement-storage'];

/** Explicit, repeatable upgrade; never reseeds inventory or overwrites staff-positioned markers. */
export async function updateLocationCatalog(repository: CatalogRepository, seed: Location[], apply: boolean): Promise<string[]> {
  const locations = await repository.getLocations();
  const changes: string[] = [];
  const updates: Location[] = [];
  for (const location of locations) {
    const replacement = seed.find((candidate) => candidate.id === location.id);
    if (replacement && OLD_ADVANCED_NAMES[location.id] === location.name && location.parentId === replacement.parentId) {
      updates.push({ ...location, name: replacement.name });
      changes.push(`Rename ${location.name} to ${replacement.name} (${location.id}); preserve marker and parent.`);
    }
  }
  const next = locations.map((location) => updates.find((update) => update.id === location.id) ?? location);
  const additions: Array<Omit<Location, 'id'>> = [];
  for (const id of ADDITIONS) {
    const definition = seed.find((location) => location.id === id);
    if (!definition) throw new Error(`Missing location upgrade definition: ${id}`);
    const existing = next.find((location) => location.id === id ||
      (location.parentId === definition.parentId && location.name.toLowerCase() === definition.name.toLowerCase()));
    if (existing) {
      if (definition.staffOnly && !existing.staffOnly) {
        updates.push({ ...existing, staffOnly: true });
        changes.push(`Restrict ${existing.name} to staff; preserve its id, parent, and marker.`);
      }
    } else {
      if (definition.parentId && !next.some((location) => location.id === definition.parentId)) {
        throw new Error(`Cannot add ${definition.name}: its parent ${definition.parentId} is missing.`);
      }
      const { id: _id, ...input } = definition;
      additions.push(input);
      changes.push(`Add ${definition.name}${definition.staffOnly ? ' (staff only)' : ''}.`);
    }
  }
  if (apply) {
    if (updates.length) await repository.saveLocations(updates);
    for (const input of additions) await repository.createLocation(input);
  }
  return changes;
}
