import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bulkUpdateItemsSchema,
  bulkUpdateMarkersSchema,
  MARKER_BATCH_LIMIT,
  consumableSchema,
  createItemSchema,
  equipmentSchema,
  itemSchema,
  itemsFileSchema,
} from './schema.js';
import { findCatalogProblems } from './integrity.js';

const base = { name: 'Test item', locationId: 'loc-shop' };
const variants = [
  { ...base, kind: 'equipment', status: 'available', quantity: 1, trainingRequired: 'none' },
  { ...base, kind: 'consumable', stockLevel: 'in-stock' },
];

test('marker batches require distinct locations, valid normalized points, and at most 100 changes', () => {
  const marker = { id: 'bin', roomId: 'room', mapId: 'common', position: { x: 0, y: 1 } };
  assert.equal(MARKER_BATCH_LIMIT, 100);
  assert.deepEqual(bulkUpdateMarkersSchema.parse({ markers: [marker] }).markers, [marker]);
  assert.equal(bulkUpdateMarkersSchema.safeParse({ markers: [{ ...marker, position: null }] }).success, true);
  const full = Array.from({ length: 100 }, (_, index) => ({ ...marker, id: `bin-${index}` }));
  assert.equal(bulkUpdateMarkersSchema.safeParse({ markers: full }).success, true);
  for (const markers of [
    [], [marker, marker], [...full, marker],
    [{ ...marker, position: undefined }], [{ ...marker, roomId: '' }],
    [{ ...marker, position: { x: -0.1, y: 0.5 } }],
    [{ ...marker, position: { x: 0.5, y: 1.1 } }],
    [{ ...marker, position: { x: Infinity, y: NaN } }],
  ]) assert.equal(bulkUpdateMarkersSchema.safeParse({ markers }).success, false);
});

test('item and create schemas migrate legacy categories for both kinds', () => {
  for (const variant of variants) {
    const legacy = { ...variant, categoryId: 'cat-tools' };
    const created = createItemSchema.parse(legacy);
    const stored = itemSchema.parse({ ...legacy, id: 'itm-test' });
    assert.deepEqual(created.categoryIds, ['cat-tools']);
    assert.deepEqual(stored.categoryIds, ['cat-tools']);
    assert.ok(!('categoryId' in created));
    assert.ok(!('categoryId' in stored));
  }
});

test('canonical category lists round-trip and kind schemas remain objects', () => {
  const categoryIds = ['cat-tools', 'cat-wood'];
  for (const [index, variant] of variants.entries()) {
    const input = { ...variant, categoryIds };
    const created = createItemSchema.parse(input);
    assert.deepEqual(created.categoryIds, categoryIds);
    assert.deepEqual(itemSchema.parse({ ...created, id: 'itm-test' }).categoryIds, categoryIds);
    const schema = index === 0 ? equipmentSchema : consumableSchema;
    assert.deepEqual(schema.omit({ id: true }).parse(input).categoryIds, categoryIds);
  }
});

test('canonical category lists must be nonempty, unique, and contain nonblank ids', () => {
  for (const categoryIds of [undefined, null, 'cat-tools', [], [''], ['  '], [12], ['cat-tools', 'cat-tools']]) {
    for (const variant of variants) {
      assert.equal(createItemSchema.safeParse({ ...variant, categoryIds }).success, false);
      assert.equal(itemSchema.safeParse({ ...variant, id: 'itm-test', categoryIds }).success, false);
    }
    if (categoryIds !== undefined) {
      assert.equal(bulkUpdateItemsSchema.safeParse({
        ids: ['itm-test'], changes: { categoryIds },
      }).success, false);
    }
  }
});

test('canonical assignments win only when a simultaneous legacy id agrees', () => {
  const categoryIds = ['cat-tools', 'cat-wood'];
  for (const variant of variants) {
    const input = { ...variant, categoryIds, categoryId: 'cat-wood' };
    const parsed = createItemSchema.parse(input);
    assert.deepEqual(parsed.categoryIds, categoryIds);
    assert.ok(!('categoryId' in parsed));
    assert.equal(createItemSchema.safeParse({ ...input, categoryId: 'cat-other' }).success, false);
    assert.equal(itemSchema.safeParse({ ...input, id: 'itm-test', categoryId: 'cat-other' }).success, false);
    for (const invalid of [undefined, null, []]) {
      assert.equal(createItemSchema.safeParse({ ...input, categoryIds: invalid }).success, false);
    }
  }
});

test('bulk changes migrate legacy assignments and preserve optional replacements', () => {
  const parse = (changes: unknown) => bulkUpdateItemsSchema.parse({ ids: ['itm-test'], changes }).changes;
  assert.deepEqual(parse({ categoryId: 'cat-tools' }), { categoryIds: ['cat-tools'] });
  assert.deepEqual(parse({ categoryIds: ['cat-tools', 'cat-wood'] }), {
    categoryIds: ['cat-tools', 'cat-wood'],
  });
  assert.deepEqual(parse({ categoryId: 'cat-tools', categoryIds: ['cat-tools', 'cat-wood'] }), {
    categoryIds: ['cat-tools', 'cat-wood'],
  });
  assert.deepEqual(parse({ locationId: 'loc-new' }), { locationId: 'loc-new' });
  assert.throws(() => parse({ categoryId: 'cat-other', categoryIds: ['cat-tools'] }));
  assert.throws(() => parse({ categoryId: '' }));
  assert.throws(() => parse({}));
});

test('file parsing accepts mixed legacy/canonical data and integrity checks every retired category', () => {
  const items = itemsFileSchema.parse([
    { ...variants[0], id: 'itm-legacy', categoryId: 'cat-tools' },
    {
      ...variants[1],
      id: 'itm-retired',
      categoryIds: ['cat-tools', 'cat-missing', 'cat-also-missing'],
      retiredAt: '2026-09-18T12:00:00.000Z',
    },
  ]);
  assert.deepEqual(items[0]?.categoryIds, ['cat-tools']);
  const problems = findCatalogProblems({
    items,
    categories: [{ id: 'cat-tools', name: 'Tools' }],
    locations: [{ id: 'loc-shop', name: 'Shop', parentId: null, kind: 'room' }],
  });
  assert.deepEqual(problems, [
    'Item itm-retired has unknown categoryId: cat-missing',
    'Item itm-retired has unknown categoryId: cat-also-missing',
  ]);
});
