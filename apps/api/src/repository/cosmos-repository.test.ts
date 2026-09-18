import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Consumable, Equipment } from '@garage/shared';

import { nextId } from './cosmos-repository.js';

/**
 * Cosmos stores domain records as documents with an added `type` partition key
 * and a handful of system fields. If those leak back out, they reach the client
 * and the assistant's candidate payload — so the round trip is worth pinning.
 */

const SYSTEM_FIELDS = ['_rid', '_self', '_etag', '_attachments', '_ts', 'type'];

const toDomain = <T>(doc: Record<string, unknown>): T => {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!SYSTEM_FIELDS.includes(key)) clean[key] = value;
  }
  return clean as T;
};

test('system fields and the partition key are stripped on read', () => {
  const stored = {
    id: 'itm-table-saw',
    type: 'item',
    name: 'Table Saw',
    kind: 'equipment',
    categoryId: 'cat-wood',
    locationId: 'loc-wood',
    tags: ['saw'],
    goodFor: [],
    status: 'available',
    quantity: 1,
    trainingRequired: 'certified',
    safetyNotes: 'Certification required.',
    _rid: 'abc==',
    _self: 'dbs/x/colls/y/docs/z',
    _etag: '"0000-0000"',
    _attachments: 'attachments/',
    _ts: 1_700_000_000,
  };

  const item = toDomain<Equipment>(stored);

  assert.deepEqual(Object.keys(item).sort(), [
    'categoryId',
    'goodFor',
    'id',
    'kind',
    'locationId',
    'name',
    'quantity',
    'safetyNotes',
    'status',
    'tags',
    'trainingRequired',
  ]);
  assert.equal(item.safetyNotes, 'Certification required.');
});

test('the discriminated union survives the round trip intact', () => {
  const consumable = toDomain<Consumable>({
    id: 'itm-solder',
    type: 'item',
    name: 'Solder',
    kind: 'consumable',
    categoryId: 'cat-electronics',
    locationId: 'loc-bin',
    tags: [],
    goodFor: [],
    stockLevel: 'low',
    _ts: 1,
  });

  assert.equal(consumable.kind, 'consumable');
  assert.equal(consumable.stockLevel, 'low');
  // Equipment-only fields must not appear on a consumable.
  assert.ok(!('status' in consumable));
  assert.ok(!('quantity' in consumable));
});

test('generated ids are slugged and stable', () => {
  assert.equal(nextId('itm', 'Bench Vise', new Set()), 'itm-bench-vise');
  assert.equal(nextId('loc', 'Cabinet B', new Set()), 'loc-cabinet-b');
});

test('a colliding id gets a suffix rather than overwriting', () => {
  const taken = new Set(['itm-bench-vise']);
  const generated = nextId('itm', 'Bench Vise', taken);

  assert.notEqual(generated, 'itm-bench-vise');
  assert.match(generated, /^itm-bench-vise-[0-9a-f]{4}$/);
});

test('a name with no usable characters still yields a valid id', () => {
  assert.equal(nextId('itm', '!!!', new Set()), 'itm-item');
});
