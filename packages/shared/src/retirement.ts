import type { Item } from './types.js';

/**
 * Retirement (product-spec.md §6.5, technical-spec.md §3.2).
 *
 * A retired item is never destroyed. It leaves search and assistant results and
 * appears only in the staff recycle bin, from which it can be restored. Its id
 * is never reused, because the assistant grounds recommendations on ids and a
 * reused id would resolve to the wrong physical object.
 *
 * This is one predicate, deliberately: equipment and consumables retire the
 * same way, so nothing has to branch on kind to ask the question.
 */
export function isRetired(item: Pick<Item, 'retiredAt'>): boolean {
  return item.retiredAt !== undefined;
}

/** Items visible in search, browse, and assistant candidates. */
export function liveItems<T extends Pick<Item, 'retiredAt'>>(items: T[]): T[] {
  return items.filter((item) => !isRetired(item));
}

/** Items in the recycle bin, newest first. */
export function retiredItems<T extends Pick<Item, 'retiredAt'>>(items: T[]): T[] {
  return items
    .filter(isRetired)
    .sort((a, b) => (b.retiredAt ?? '').localeCompare(a.retiredAt ?? ''));
}
