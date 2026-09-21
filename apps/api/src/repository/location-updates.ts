import type { Location } from '@garage/shared';
import type { CatalogRepository } from './catalog-repository.js';

const OLD_NAMES: Record<string, readonly string[]> = {
  'loc-common-desk-1': ['Desk A'],
  'loc-common-table-9': ['Table B'],
  'loc-common-table-8': ['Table C'],
  'loc-common-table-7': ['Table D'],
  'loc-common-table-6-5': ['Corner table E'],
  'loc-common-table-6': ['Table F'],
  'loc-common-table-5': ['Table G'],
  'loc-common-table-10': ['Table H'],
  'loc-common-table-4': ['Table I'],
  'loc-common-workbench-2': ['Workbench J'],
  'loc-common-workbench-17': ['Workbench K'],
  'loc-common-table-14': ['Table L'],
  'loc-advanced-table-20': ['Table Z', 'Table T'],
  'loc-advanced-table-21': ['Table Y', 'Table S'],
  'loc-advanced-workbench-16': ['Workbench X', 'Workbench Z'],
  'loc-advanced-table-19': ['Table W', 'Table Y'],
  'loc-advanced-table-3': ['Table V', 'Table X'],
  'loc-advanced-table-18': ['Table U', 'Table W'],
  'loc-advanced-table-11': ['Table T', 'Table V'],
  'loc-table-u': ['Table U'],
};
const ADDITIONS = ['loc-table-u', 'loc-storage-closet', 'loc-basement-storage'];

/** Explicit, repeatable upgrade; never reseeds inventory or overwrites staff-positioned markers. */
export async function updateLocationCatalog(repository: CatalogRepository, seed: Location[], apply: boolean): Promise<string[]> {
  const locations = await repository.getLocations();
  const changes: string[] = [];
  const updates: Location[] = [];
  for (const location of locations) {
    const replacement = seed.find((candidate) => candidate.id === location.id);
    if (replacement && location.name !== replacement.name && OLD_NAMES[location.id]?.includes(location.name) &&
      location.parentId === replacement.parentId) {
      updates.push({ ...location, name: replacement.name });
      changes.push(`Rename ${location.name} to ${replacement.name} (${location.id}); preserve marker and parent.`);
    }
  }
  const next = locations.map((location) => updates.find((update) => update.id === location.id) ?? location);
  const additions: Location[] = [];
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
      additions.push(definition);
      changes.push(`Add ${definition.name}${definition.staffOnly ? ' (staff only)' : ''}.`);
    }
  }
  if (apply) {
    if (updates.length) await repository.saveLocations(updates);
    for (const { id, ...input } of additions) await repository.createLocation(input, id);
  }
  return changes;
}
