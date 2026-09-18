import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Item } from '@garage/shared';
import { retrieveCandidates } from './candidates.js';

const item = (id: string, categoryIds: string[], retiredAt?: string): Item => ({
  id,
  name: 'General tool',
  kind: 'consumable',
  categoryIds,
  locationId: 'loc-shop',
  tags: [],
  goodFor: [],
  stockLevel: 'in-stock',
  ...(retiredAt ? { retiredAt } : {}),
});

test('retrieval matches secondary category names once per item and excludes retired items', () => {
  const items = [
    item('itm-unrelated', ['cat-general']),
    item('itm-secondary', ['cat-general', 'cat-electronics']),
    item('itm-two-matches', ['cat-electronics', 'cat-circuits']),
    item('itm-retired', ['cat-general', 'cat-electronics'], '2026-09-18T12:00:00.000Z'),
  ];
  const categories = new Map([
    ['cat-general', 'Supplies'],
    ['cat-electronics', 'Electronics'],
    ['cat-circuits', 'Electronics circuits'],
  ]);
  const candidates = retrieveCandidates(items, categories, 'Electronics');
  assert.deepEqual(candidates.map((candidate) => candidate.id), ['itm-secondary', 'itm-two-matches']);
  assert.equal(new Set(candidates.map((candidate) => candidate.id)).size, candidates.length);
});
