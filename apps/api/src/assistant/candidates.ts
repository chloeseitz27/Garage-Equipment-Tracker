import { liveItems, type Item } from '@garage/shared';

/**
 * Step [1] of the pipeline: deterministic, server-side candidate retrieval
 * (technical-spec.md §6.1).
 *
 * At demo scale the whole catalog would fit in one prompt, but the step stays
 * because it is the seam where real relevance ranking goes later.
 */

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'build', 'building', 'but', 'by', 'can', 'for',
  'from', 'have', 'how', 'i', 'in', 'is', 'it', 'make', 'making', 'me', 'my', 'need', 'of',
  'on', 'or', 'project', 'that', 'the', 'their', 'them', 'then', 'this', 'to', 'up', 'use',
  'using', 'want', 'was', 'we', 'what', 'with', 'would', 'you', 'your',
]);

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

/** Crude singular/plural folding so "boxes" matches "box". */
const stem = (token: string): string =>
  token.endsWith('ies') ? `${token.slice(0, -3)}y` : token.replace(/s$/, '');

const scoreItem = (item: Item, queryTokens: Set<string>, categoryName: string): number => {
  const field = (text: string, weight: number): number => {
    const tokens = new Set(tokenize(text).map(stem));
    let hits = 0;
    for (const token of queryTokens) if (tokens.has(token)) hits += 1;
    return hits * weight;
  };

  return (
    field(item.goodFor.join(' '), 5) +
    field(item.tags.join(' '), 4) +
    field(item.name, 3) +
    field(categoryName, 2) +
    field(item.description ?? '', 1)
  );
};

export interface RetrievalOptions {
  limit?: number;
}

export function retrieveCandidates(
  items: Item[],
  categoryNames: Map<string, string>,
  projectDescription: string,
  options: RetrievalOptions = {},
): Item[] {
  const limit = options.limit ?? 40;
  const queryTokens = new Set(tokenize(projectDescription).map(stem));

  // Retired items aren't unavailable, they're gone (technical-spec.md §6.2).
  const live = liveItems(items);

  const scored = live
    .map((item) => ({ item, score: scoreItem(item, queryTokens, categoryNames.get(item.categoryId) ?? '') }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  // A description that matches nothing still deserves a sensible candidate set:
  // let the model decide there's nothing relevant rather than starving it.
  if (scored.length === 0) return live.slice(0, limit);

  return scored.slice(0, limit).map((entry) => entry.item);
}
