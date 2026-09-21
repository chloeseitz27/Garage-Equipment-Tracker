import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CatalogResponse, CreateItemInput, Item } from '@garage/shared';
import { CachedCatalogRepository, DEFAULT_CATALOG_CACHE_TTL_MS } from './cached-repository.js';
import type { CatalogRepository } from './catalog-repository.js';

const catalogFixture = (): CatalogResponse => ({
  items: [{
    id: 'camera', name: 'Inspection camera', kind: 'equipment',
    locationId: 'bench', categoryIds: ['tools', 'electronics'], tags: ['scope'], goodFor: ['inspection'],
    quantity: 1, status: 'available', trainingRequired: 'orientation',
    safetyNotes: 'Ask staff before use.\nKeep the case dry.',
    retiredAt: '2026-09-17T00:00:00Z',
  }],
  locations: [
    { id: 'room', name: 'Shop', kind: 'room', parentId: null, mapId: 'common' },
    { id: 'bench', name: 'Bench', kind: 'workbench', parentId: 'room',
      mapPosition: { roomId: 'room', mapId: 'common', x: 0.4, y: 0.6 } },
  ],
  categories: [{ id: 'tools', name: 'Tools' }, { id: 'electronics', name: 'Electronics' }],
});

function setup() {
  const state = { catalog: catalogFixture(), reads: 0, writes: [] as string[] };
  const flag = { id: 'flag', itemId: 'camera', type: 'not-here' as const,
    createdAt: '2026-09-18T00:00:00Z', resolved: false };
  const write = async <T>(method: string, result: T): Promise<T> => {
    state.writes.push(method);
    return result;
  };
  const repository: CatalogRepository = {
    getItems: async () => { state.reads++; return state.catalog.items; },
    getItem: async (id) => state.catalog.items.find((item) => item.id === id) ?? null,
    getLocations: async () => state.catalog.locations,
    getCategories: async () => state.catalog.categories,
    createItem: (input) => write('createItem', { ...input, id: 'new' }),
    createItems: (inputs) => write('createItems', inputs.map((input, index) => ({ ...input, id: `new-${index}` }))),
    saveItem: () => write('saveItem', undefined),
    saveItems: () => write('saveItems', undefined),
    createLocation: (input) => write('createLocation', { ...input, id: 'new-location' }),
    saveLocation: () => write('saveLocation', undefined),
    saveLocations: () => write('saveLocations', undefined),
    deleteLocation: () => write('deleteLocation', undefined),
    createCategory: (input) => write('createCategory', { ...input, id: 'new-category' }),
    saveCategory: () => write('saveCategory', undefined),
    deleteCategory: () => write('deleteCategory', undefined),
    getFlags: async () => [flag],
    addFlag: async () => flag,
    setFlagResolved: async (_id, resolved) => ({ ...flag, resolved }),
  };
  return { repository, state };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('all reads share one query per collection and preserve retirement, maps, and safety text', async () => {
  const { repository, state } = setup();
  let locationReads = 0;
  let categoryReads = 0;
  repository.getLocations = async () => { locationReads++; return state.catalog.locations; };
  repository.getCategories = async () => { categoryReads++; return state.catalog.categories; };
  repository.getItem = async () => { throw new Error('Point reads should use the cache'); };
  const cache = new CachedCatalogRepository(repository);
  const [items, locations, categories, item] = await Promise.all([
    cache.getItems(), cache.getLocations(), cache.getCategories(), cache.getItem('camera'),
  ]);
  assert.deepEqual({ items, locations, categories }, catalogFixture());
  assert.deepEqual(item, catalogFixture().items[0]);
  assert.equal(await cache.getItem('missing'), null);
  assert.deepEqual([state.reads, locationReads, categoryReads], [1, 1, 1]);
  items[0]!.tags.push('caller mutation');
  locations[1]!.mapPosition!.x = 0;
  categories[0]!.name = 'Wrong';
  state.catalog.items[0]!.name = 'Underlying mutation';
  assert.deepEqual(await cache.getItems(), catalogFixture().items);
  assert.deepEqual(await cache.getLocations(), catalogFixture().locations);
  assert.deepEqual(await cache.getCategories(), catalogFixture().categories);
});

test('the default TTL is exactly one hour, and direct database changes appear after expiry', async () => {
  assert.equal(DEFAULT_CATALOG_CACHE_TTL_MS, 3_600_000);
  const { repository, state } = setup();
  let now = 1_000;
  const cache = new CachedCatalogRepository(repository, { now: () => now });
  await cache.getItems();
  state.catalog.items[0]!.name = 'External update';
  now += 3_600_000 - 1;
  assert.equal((await cache.getItem('camera'))?.name, 'Inspection camera');
  now++;
  assert.equal((await cache.getItem('camera'))?.name, 'External update');
  assert.equal(state.reads, 2);
});

const input: CreateItemInput = {
  name: 'New item', kind: 'consumable', locationId: 'bench',
  categoryIds: ['tools', 'electronics'], tags: [], goodFor: [], stockLevel: 'low',
};
const mutations: Array<{ name: string; run: (cache: CatalogRepository) => Promise<unknown> }> = [
  { name: 'createItem', run: (cache) => cache.createItem(input) },
  { name: 'createItems', run: (cache) => cache.createItems([input]) },
  { name: 'saveItem', run: (cache) => cache.saveItem(catalogFixture().items[0]!) },
  { name: 'saveItems', run: (cache) => cache.saveItems(catalogFixture().items) },
  { name: 'createLocation', run: (cache) => cache.createLocation({ name: 'Table', parentId: 'room', kind: 'table' }) },
  { name: 'saveLocation', run: (cache) => cache.saveLocation(catalogFixture().locations[1]!) },
  { name: 'saveLocations', run: (cache) => cache.saveLocations(catalogFixture().locations) },
  { name: 'deleteLocation', run: (cache) => cache.deleteLocation('unused') },
  { name: 'createCategory', run: (cache) => cache.createCategory({ name: 'New' }) },
  { name: 'saveCategory', run: (cache) => cache.saveCategory({ id: 'tools', name: 'Updated' }) },
  { name: 'deleteCategory', run: (cache) => cache.deleteCategory('unused') },
];

for (const mutation of mutations) {
  test(`${mutation.name} delegates and immediately invalidates every cached collection`, async () => {
    const { repository, state } = setup();
    const cache = new CachedCatalogRepository(repository);
    await cache.getItems();
    state.catalog.items[0]!.name = 'Changed';
    state.catalog.locations[1]!.name = 'Changed';
    state.catalog.categories[0]!.name = 'Changed';
    const result = await mutation.run(cache);
    assert.deepEqual(state.writes, [mutation.name]);
    if (mutation.name === 'createItem') assert.deepEqual(result, { ...input, id: 'new' });
    if (mutation.name === 'createItems') assert.deepEqual(result, [{ ...input, id: 'new-0' }]);
    assert.equal((await cache.getItem('camera'))?.name, 'Changed');
    assert.equal((await cache.getLocations())[1]?.name, 'Changed');
    assert.equal((await cache.getCategories())[0]?.name, 'Changed');
    assert.equal(state.reads, 2);
  });
}

test('a rejected write invalidates potentially committed data and propagates the error', async () => {
  const { repository, state } = setup();
  const error = new Error('Write response lost');
  repository.saveItems = async () => {
    state.catalog.items[0]!.name = 'Partial write';
    throw error;
  };
  const cache = new CachedCatalogRepository(repository);
  await cache.getItems();
  await assert.rejects(cache.saveItems([]), (cause) => cause === error);
  assert.equal((await cache.getItem('camera'))?.name, 'Partial write');
});

test('a write fences an older in-flight query while concurrent new readers share a replacement', async () => {
  const { repository, state } = setup();
  const old = deferred<Item[]>();
  repository.getItems = async () => {
    state.reads++;
    return state.reads === 1 ? old.promise : state.catalog.items;
  };
  const cache = new CachedCatalogRepository(repository);
  const waiting = cache.getItems();
  await cache.saveItems([]);
  state.catalog.items[0]!.name = 'New value';
  const replacement = cache.getItems();
  old.resolve(catalogFixture().items);
  const results = await Promise.all([waiting, replacement]);
  assert.ok(results.every((items) => items[0]?.name === 'New value'));
  assert.equal(state.reads, 2);
});

test('explicit invalidation and clock rollback force fresh snapshots; TTL zero disables reuse', async () => {
  const { repository, state } = setup();
  let now = 1_000;
  const cache = new CachedCatalogRepository(repository, { now: () => now });
  await cache.getItems();
  cache.invalidate();
  await cache.getItems();
  now--;
  await cache.getItems();
  assert.equal(state.reads, 3);
  const uncached = new CachedCatalogRepository(repository, { ttlMs: 0 });
  await uncached.getItems();
  await uncached.getItems();
  assert.equal(state.reads, 5);
});

test('query failures and invalid payloads never silently serve an expired entry', async () => {
  const { repository, state } = setup();
  const cache = new CachedCatalogRepository(repository, { ttlMs: 0 });
  await cache.getItems();
  repository.getItems = async () => { throw new Error('Cosmos unavailable'); };
  await assert.rejects(cache.getItems(), /Cosmos unavailable/);
  repository.getItems = async () => state.catalog.items;
  state.catalog.items[0]!.locationId = 'missing';
  await assert.rejects(cache.getItems(), /unknown locationId/);
  state.catalog = catalogFixture();
  assert.deepEqual(await cache.getItems(), state.catalog.items);
});

test('flag reads and writes bypass caching and preserve their return values and errors', async () => {
  const { repository, state } = setup();
  const cache = new CachedCatalogRepository(repository);
  await cache.getItems();
  const flag = await cache.addFlag({ itemId: 'camera', type: 'not-here' });
  assert.deepEqual(await cache.getFlags(), [flag]);
  assert.deepEqual(await cache.setFlagResolved(flag.id, true), { ...flag, resolved: true });
  repository.getFlags = async () => [];
  assert.deepEqual(await cache.getFlags(), []);
  repository.addFlag = async () => { throw new Error('Flag write failed'); };
  await assert.rejects(cache.addFlag({ itemId: 'camera', type: 'not-here' }), /Flag write failed/);
  await cache.getItems();
  assert.equal(state.reads, 1);
});

test('invalid TTL configuration fails explicitly', () => {
  for (const ttlMs of [-1, Infinity, NaN]) {
    assert.throws(() => new CachedCatalogRepository(setup().repository, { ttlMs }), RangeError);
  }
});
