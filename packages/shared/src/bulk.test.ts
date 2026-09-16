import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseBulkItems, type BulkDefaults } from './index.js';

const defaults: BulkDefaults = {
  kind: 'equipment',
  categoryId: 'cat-hand-tools',
  locationId: 'loc-tool-wall',
  status: 'available',
  stockLevel: 'in-stock',
  trainingRequired: 'none',
};

test('a bare name uses every default', () => {
  const result = parseBulkItems('Bench Vise', defaults);
  assert.equal(result.errorCount, 0);
  assert.deepEqual(result.items, [
    {
      name: 'Bench Vise',
      categoryId: 'cat-hand-tools',
      locationId: 'loc-tool-wall',
      tags: [],
      goodFor: [],
      kind: 'equipment',
      status: 'available',
      quantity: 1,
      trainingRequired: 'none',
    },
  ]);
});

test('per-row columns override the defaults', () => {
  const result = parseBulkItems('Painters Tape, consumable, low, , tape; masking', defaults);
  assert.equal(result.errorCount, 0);
  assert.deepEqual(result.items[0], {
    name: 'Painters Tape',
    categoryId: 'cat-hand-tools',
    locationId: 'loc-tool-wall',
    tags: ['tape', 'masking'],
    goodFor: [],
    kind: 'consumable',
    stockLevel: 'low',
  });
});

test('tab-separated rows work, so a spreadsheet paste lands intact', () => {
  const result = parseBulkItems('Drill Press\tequipment\tavailable\tsupervised', defaults);
  assert.equal(result.errorCount, 0);
  const item = result.items[0];
  assert.ok(item && item.kind === 'equipment');
  assert.equal(item.trainingRequired, 'supervised');
});

test('blank lines and comments are skipped rather than failing', () => {
  const result = parseBulkItems('# shelf audit\n\nHammer\n\n', defaults);
  assert.equal(result.errorCount, 0);
  assert.equal(result.items.length, 1);
});

test('an unknown enum value is reported against its line, not silently coerced', () => {
  const result = parseBulkItems('Hammer\nMystery Tool, equipment, sort-of-working', defaults);
  assert.equal(result.errorCount, 1);
  assert.equal(result.items.length, 1);

  const bad = result.rows.find((row) => row.error);
  assert.ok(bad);
  assert.equal(bad.lineNumber, 2);
  assert.match(bad.error ?? '', /Unknown status/);
});

test('an unknown kind is rejected', () => {
  const result = parseBulkItems('Thing, gadget', defaults);
  assert.equal(result.errorCount, 1);
  assert.match(result.rows[0]?.error ?? '', /Unknown kind/);
});

test('a row with no name is rejected', () => {
  const result = parseBulkItems(', equipment', defaults);
  assert.equal(result.errorCount, 1);
  assert.match(result.rows[0]?.error ?? '', /Missing name/);
});

test('line numbers refer to the pasted text, including skipped lines', () => {
  const result = parseBulkItems('# header\n\nGood Tool\n, equipment', defaults);
  const bad = result.rows.find((row) => row.error);
  assert.equal(bad?.lineNumber, 4);
});
