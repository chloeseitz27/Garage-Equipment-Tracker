import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BulkOperationType, type ReplaceOperationInput } from '@azure/cosmos';
import type { Location } from '@garage/shared';

import { CosmosCatalogRepository, nextId } from './cosmos-repository.js';

/**
 * Cosmos stores domain records as documents with an added `type` partition key
 * and a handful of system fields. If those leak back out, they reach the client
 * and the assistant's candidate payload — so the round trip is worth pinning.
 */

type StoredDoc = { id: string; [key: string]: unknown };

/** Exercise the real adapter while keeping all Cosmos I/O in memory. */
function makeRepository(initial: StoredDoc[]) {
  const documents = new Map(initial.map((doc) => [doc.id, structuredClone(doc)]));
  const store = async (doc: StoredDoc) => { documents.set(doc.id, structuredClone(doc)); };
  const repository = new CosmosCatalogRepository({
    endpoint: 'https://unused.invalid', database: 'test', container: 'test',
  });
  Object.assign(repository, {
    container: {
      items: {
        query: () => ({
          fetchAll: async () => ({ resources: structuredClone([...documents.values()]) }),
        }),
        create: store,
        upsert: store,
        batch: async (operations: { resourceBody: StoredDoc }[]) => {
          for (const operation of operations) await store(operation.resourceBody);
          return { result: operations.map(() => ({ statusCode: 200 })) };
        },
      },
      item: (id: string, partition: string) => {
        assert.equal(partition, 'item');
        return { read: async () => ({ resource: structuredClone(documents.get(id)) }) };
      },
    },
  });
  return { repository, documents };
}

test('real Cosmos list and point reads migrate legacy categories and strip system fields', async () => {
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

  const { repository, documents } = makeRepository([stored]);
  const item = await repository.getItem(stored.id);
  assert.ok(item);
  assert.deepEqual(await repository.getItems(), [item]);

  assert.deepEqual(Object.keys(item).sort(), [
    'categoryIds',
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
  assert.deepEqual(item.categoryIds, ['cat-wood']);
  assert.equal(documents.get(stored.id)?.categoryId, 'cat-wood', 'reads must not rewrite storage');
  await repository.saveItem(item);
  assert.ok(!('categoryId' in (documents.get(stored.id) ?? {})));
  assert.deepEqual(documents.get(stored.id)?.categoryIds, ['cat-wood']);
});

test('multi-category items survive Cosmos create, read, and bulk save for both kinds', async () => {
  const { repository, documents } = makeRepository([]);
  const consumable = await repository.createItem({
    name: 'Solder',
    kind: 'consumable',
    categoryIds: ['cat-electronics', 'cat-prototyping'],
    locationId: 'loc-bin',
    tags: [],
    goodFor: [],
    stockLevel: 'low',
  });
  const [equipment] = await repository.createItems([{
    name: 'Meter', kind: 'equipment', categoryIds: ['cat-electronics', 'cat-prototyping'],
    locationId: 'loc-bin', tags: [], goodFor: [], status: 'available', quantity: 1,
    trainingRequired: 'none',
  }]);
  assert.ok(equipment);
  const expected = [consumable, equipment];
  assert.deepEqual(await repository.getItems(), expected);
  for (const item of expected) assert.deepEqual(await repository.getItem(item.id), item);

  const updated = expected.map((item) => ({ ...item, categoryIds: ['cat-prototyping', 'cat-electronics'] }));
  await repository.saveItems(updated);
  assert.deepEqual(await repository.getItems(), updated);
  for (const item of updated) {
    assert.deepEqual(await repository.getItem(item.id), item);
    assert.deepEqual(documents.get(item.id), { ...item, type: 'item' });
  }
  assert.equal(consumable.kind, 'consumable');
  assert.ok(!('status' in consumable));
  assert.ok(!('quantity' in consumable));
});

test('Cosmos list and point reads validate category lists rather than casting raw documents', async () => {
  const base = {
    id: 'itm-solder',
    type: 'item',
    name: 'Solder',
    kind: 'consumable',
    locationId: 'loc-bin',
    tags: [],
    goodFor: [],
    stockLevel: 'low',
    _ts: 1,
  };
  for (const categoryIds of [undefined, [], [''], ['cat-electronics', 'cat-electronics']]) {
    const { repository } = makeRepository([{ ...base, categoryIds }]);
    await assert.rejects(repository.getItems(), /categoryIds/);
    await assert.rejects(repository.getItem(base.id), /categoryIds/);
  }
  const { repository } = makeRepository([{
    ...base, categoryIds: ['cat-electronics'], categoryId: 'cat-conflict',
  }]);
  await assert.rejects(repository.getItems(), /conflicts/);
  await assert.rejects(repository.getItem(base.id), /conflicts/);
});

test('Cosmos missing item reads still return null', async () => {
  const { repository } = makeRepository([]);
  assert.equal(await repository.getItem('missing'), null);
});

test('Cosmos saves marker batches in one location-partition replacement transaction', async () => {
  const locations: Location[] = [
    { id: 'a', name: 'A', parentId: 'room', kind: 'table', mapPosition: { roomId: 'room', mapId: 'common', x: 0.2, y: 0.3 } },
    { id: 'b', name: 'B', parentId: 'room', kind: 'bin' },
  ];
  const repository = new CosmosCatalogRepository({ endpoint: 'https://unused.invalid', database: 'test', container: 'test' });
  let calls = 0;
  let code = 200;
  let results: Array<{ statusCode: number }> | undefined = [{ statusCode: 200 }, { statusCode: 200 }];
  Object.assign(repository, { container: { items: {
    batch: async (operations: ReplaceOperationInput[], partition: string) => {
      calls++;
      assert.equal(partition, 'location');
      assert.deepEqual(operations, locations.map((location) => ({
        operationType: BulkOperationType.Replace, id: location.id, resourceBody: { ...location, type: 'location' },
      })));
      return { code, result: results };
    },
  } } });
  await repository.saveLocations(locations);
  assert.equal(calls, 1);
  code = 429;
  await assert.rejects(repository.saveLocations(locations), /status 429/);
  code = 200;
  results = [{ statusCode: 424 }, { statusCode: 404 }];
  await assert.rejects(repository.saveLocations(locations), /no locations were changed/);
  results = undefined;
  await assert.rejects(repository.saveLocations(locations), /Could not confirm/);
  const before = calls;
  await assert.rejects(repository.saveLocations(Array.from({ length: 101 }, () => locations[0]!)), /at most 100/);
  await repository.saveLocations([]);
  assert.equal(calls, before);
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
