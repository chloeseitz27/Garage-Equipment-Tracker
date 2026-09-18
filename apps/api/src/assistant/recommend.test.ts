import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  AssistantProvider,
  AssistantRecommendation,
  Category,
  Flag,
  Item,
  Location,
} from '@garage/shared';

import type { CatalogRepository } from '../repository/catalog-repository.js';
import { recommendForProject } from './recommend.js';

/**
 * Grounding is the single most important behaviour in the project
 * (technical-spec.md §10): a model response containing a hallucinated ID must
 * not survive into the assembled response.
 */

const SAFETY_TEXT =
  'Certification required. Always use the blade guard and riving knife. Use a push stick within 6 inches of the blade.';

const locations: Location[] = [
  { id: 'loc-shop', name: 'Main Shop', parentId: null, kind: 'room' },
  { id: 'loc-wood', name: 'Wood Shop', parentId: 'loc-shop', kind: 'zone' },
];

const categories: Category[] = [{ id: 'cat-wood', name: 'Woodworking' }];

const items: Item[] = [
  {
    id: 'itm-table-saw',
    name: 'Table Saw',
    kind: 'equipment',
    categoryId: 'cat-wood',
    locationId: 'loc-wood',
    tags: ['saw'],
    goodFor: ['planter box'],
    status: 'available',
    quantity: 1,
    trainingRequired: 'certified',
    safetyNotes: SAFETY_TEXT,
  },
  {
    id: 'itm-retired-lathe',
    name: 'Old Lathe',
    kind: 'equipment',
    categoryId: 'cat-wood',
    locationId: 'loc-wood',
    tags: ['lathe'],
    goodFor: ['planter box'],
    status: 'available',
    quantity: 1,
    trainingRequired: 'certified',
    retiredAt: '2026-03-14T16:00:00.000Z',
  },
];

const repository = {
  getItems: async () => items,
  getItem: async (id: string) => items.find((item) => item.id === id) ?? null,
  getLocations: async () => locations,
  getCategories: async () => categories,
  getFlags: async () => [] as Flag[],
} as unknown as CatalogRepository;

const providerReturning = (recommendation: AssistantRecommendation): AssistantProvider => ({
  name: 'test',
  recommend: async () => recommendation,
});

test('hallucinated item ids never reach the response', async () => {
  const response = await recommendForProject(
    repository,
    providerReturning({
      understoodAs: 'A planter box',
      garageItems: [
        { id: 'itm-table-saw', reason: 'Rips the sides to width.' },
        { id: 'itm-reflow-oven', reason: 'Invented by the model.' },
        { id: '', reason: 'Empty id.' },
      ],
      notInGarage: [],
    }),
    'a planter box',
  );

  assert.deepEqual(
    response.garageItems.map((entry) => entry.id),
    ['itm-table-saw'],
  );
});

test('retired items are excluded from recommendations', async () => {
  const response = await recommendForProject(
    repository,
    providerReturning({
      understoodAs: 'A planter box',
      garageItems: [{ id: 'itm-retired-lathe', reason: 'Should not appear.' }],
      notInGarage: [],
    }),
    'a planter box',
  );

  assert.equal(response.garageItems.length, 0);
});

test('safety text is passed through from the catalog byte for byte', async () => {
  const response = await recommendForProject(
    repository,
    providerReturning({
      understoodAs: 'A planter box',
      garageItems: [{ id: 'itm-table-saw', reason: 'Rips the sides to width.' }],
      // A model attempting to author safety guidance has no path into the
      // response: the assembled entry reads safetyNotes from the record.
      notInGarage: [{ name: 'Outdoor wood stain', reason: 'Protects the finished box.' }],
    }),
    'a planter box',
  );

  const entry = response.garageItems[0];
  assert.ok(entry);
  assert.equal(entry.safetyNotes, SAFETY_TEXT);
  assert.equal(entry.trainingRequired, 'certified');
});

test('name and location are read from the record, not the model', async () => {
  const response = await recommendForProject(
    repository,
    providerReturning({
      understoodAs: 'A planter box',
      garageItems: [{ id: 'itm-table-saw', reason: 'Rips the sides to width.' }],
      notInGarage: [],
    }),
    'a planter box',
  );

  const entry = response.garageItems[0];
  assert.ok(entry);
  assert.equal(entry.name, 'Table Saw');
  assert.deepEqual(
    entry.locationPath.map((node) => node.name),
    ['Main Shop', 'Wood Shop'],
  );
});

test('duplicate ids from the model collapse to one entry', async () => {
  const response = await recommendForProject(
    repository,
    providerReturning({
      understoodAs: 'A planter box',
      garageItems: [
        { id: 'itm-table-saw', reason: 'First.' },
        { id: 'itm-table-saw', reason: 'Second.' },
      ],
      notInGarage: [],
    }),
    'a planter box',
  );

  assert.equal(response.garageItems.length, 1);
});
