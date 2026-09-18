import {
  getLocationPath,
  indexLocations,
  isRetired,
  type AssistantProvider,
  type Item,
  type RecommendResponse,
  type RecommendedItem,
} from '@garage/shared';

import type { CatalogRepository } from '../repository/catalog-repository.js';
import { retrieveCandidates } from './candidates.js';

/**
 * The assistant pipeline (technical-spec.md §6.1).
 *
 *   [1] candidate retrieval -> [2] model call -> [3] re-resolution -> [4] assembly
 *
 * The model may choose items. It may never author facts about them. Step [3] is
 * what makes that true by construction rather than by hoping the prompt held.
 */
export async function recommendForProject(
  repository: CatalogRepository,
  provider: AssistantProvider,
  projectDescription: string,
): Promise<RecommendResponse> {
  const [items, locations, categories] = await Promise.all([
    repository.getItems(),
    repository.getLocations(),
    repository.getCategories(),
  ]);

  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

  // [1] Deterministic, server-side, from the catalog.
  const candidates = retrieveCandidates(items, categoryNames, projectDescription);

  // [2] Candidates in, selected IDs + reasons out.
  const recommendation = await provider.recommend({ projectDescription, candidates });

  // [3] Re-resolution. Every returned ID is looked up in the catalog; anything
  // that doesn't resolve is dropped silently from the response and logged.
  const catalogById = new Map<string, Item>(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const dropped: string[] = [];
  const resolved: RecommendedItem[] = [];
  const locationIndex = indexLocations(locations);

  for (const entry of recommendation.garageItems) {
    const item = catalogById.get(entry.id);

    if (!item || isRetired(item)) {
      dropped.push(entry.id);
      continue;
    }
    if (seen.has(item.id)) continue;
    seen.add(item.id);

    // [4] Assembly. Name, location, training, and safety are read from the
    // record. The model's only contribution to this entry is `reason`.
    resolved.push({
      id: item.id,
      name: item.name,
      kind: item.kind,
      reason: entry.reason,
      locationPath: getLocationPath(locationIndex, item.locationId),
      ...(item.kind === 'equipment' ? { trainingRequired: item.trainingRequired } : {}),
      ...(item.safetyNotes ? { safetyNotes: item.safetyNotes } : {}),
    });
  }

  if (dropped.length > 0) {
    console.warn(
      `[assistant] Dropped ${dropped.length} unresolvable item id(s) from provider "${provider.name}": ${dropped.join(', ')}`,
    );
  }

  return {
    understoodAs: recommendation.understoodAs,
    garageItems: resolved,
    notInGarage: recommendation.notInGarage,
  };
}
