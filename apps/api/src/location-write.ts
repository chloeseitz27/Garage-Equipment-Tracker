import { assignLocationIdentities, MARKER_BATCH_LIMIT, type Location } from '@garage/shared';
import type { CatalogRepository } from './repository/catalog-repository.js';

const queues = new WeakMap<CatalogRepository, Promise<void>>();

/** One catalog API process owns writes; keep number allocation and hierarchy changes in the same critical section. */
export async function serializeLocationWrite<T>(repository: CatalogRepository, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(repository) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => { release = resolve; });
  queues.set(repository, turn);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (queues.get(repository) === turn) queues.delete(repository);
  }
}

export async function identifiedLocations(repository: CatalogRepository): Promise<Location[]> {
  const current = await repository.getLocations();
  const locations = assignLocationIdentities(current);
  const changed = locations.filter((location, index) =>
    location.letter !== current[index]?.letter || location.number !== current[index]?.number ||
    location.name !== current[index]?.name || location.kind !== current[index]?.kind ||
    location.mapPosition !== current[index]?.mapPosition);
  // Persist legacy assignments before new allocations so deletion or renaming cannot shift existing codes.
  for (let index = 0; index < changed.length; index += MARKER_BATCH_LIMIT) {
    await repository.saveLocations(changed.slice(index, index + MARKER_BATCH_LIMIT));
  }
  return locations;
}
