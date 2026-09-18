import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isRetired, liveItems, retiredItems, type Item } from './index.js';

/**
 * Retirement is shared across kinds rather than being an equipment status, so
 * one predicate answers "is this in the recycle bin" for both. These pin that
 * consumables can retire too — the reason the model changed.
 */

const equipment = (id: string, retiredAt?: string): Item => ({
  id,
  name: id,
  kind: 'equipment',
  categoryIds: ['cat'],
  locationId: 'loc',
  tags: [],
  goodFor: [],
  status: 'available',
  quantity: 1,
  trainingRequired: 'none',
  ...(retiredAt ? { retiredAt } : {}),
});

const consumable = (id: string, retiredAt?: string): Item => ({
  id,
  name: id,
  kind: 'consumable',
  categoryIds: ['cat'],
  locationId: 'loc',
  tags: [],
  goodFor: [],
  stockLevel: 'in-stock',
  ...(retiredAt ? { retiredAt } : {}),
});

test('an item with no retiredAt is live', () => {
  assert.equal(isRetired(equipment('a')), false);
  assert.equal(isRetired(consumable('b')), false);
});

test('consumables can be retired, not just equipment', () => {
  assert.equal(isRetired(consumable('b', '2026-01-01T00:00:00.000Z')), true);
});

test('retirement is independent of operational status', () => {
  // A retired item keeps whatever status it had; the two are separate axes.
  const retired = equipment('a', '2026-01-01T00:00:00.000Z');
  assert.equal(isRetired(retired), true);
  assert.equal(retired.kind === 'equipment' && retired.status, 'available');
});

test('liveItems excludes the recycle bin, across both kinds', () => {
  const items = [
    equipment('live-eq'),
    equipment('gone-eq', '2026-01-01T00:00:00.000Z'),
    consumable('live-con'),
    consumable('gone-con', '2026-01-02T00:00:00.000Z'),
  ];

  assert.deepEqual(liveItems(items).map((item) => item.id), ['live-eq', 'live-con']);
});

test('retiredItems returns only the bin, newest first', () => {
  const items = [
    equipment('older', '2026-01-01T00:00:00.000Z'),
    equipment('live'),
    consumable('newer', '2026-06-01T00:00:00.000Z'),
  ];

  assert.deepEqual(retiredItems(items).map((item) => item.id), ['newer', 'older']);
});

test('live and retired partition the catalog with no overlap or loss', () => {
  const items = [
    equipment('a'),
    equipment('b', '2026-01-01T00:00:00.000Z'),
    consumable('c'),
    consumable('d', '2026-02-01T00:00:00.000Z'),
  ];

  assert.equal(liveItems(items).length + retiredItems(items).length, items.length);
});
