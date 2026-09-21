import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASK_STAFF_LOCATION, isRetired, publicCatalog, type CatalogResponse } from '@garage/shared';
import {
  BrowserCatalogCache,
  CATALOG_CACHE_KEY,
  CATALOG_MAX_AGE_MS,
  CatalogRefreshSupersededError,
  type CacheIssue,
} from './catalog-cache.js';

const catalogFixture = (): CatalogResponse => ({
  access: 'public',
  items: [{
    id: 'ties', name: 'Cable ties', kind: 'consumable', stockLevel: 'low',
    categoryIds: ['supplies', 'electronics'], locationId: 'cabinet', tags: [], goodFor: [],
    retiredAt: '2026-09-18T00:00:00Z', safetyNotes: 'Staff-authored text.\nPreserve exactly.',
  }],
  locations: [
    { id: 'room', name: 'Shop', kind: 'room', parentId: null, mapId: 'common' },
    { id: 'cabinet', name: 'Cabinet', kind: 'cabinet', parentId: 'room',
      mapPosition: { roomId: 'room', mapId: 'common', x: 0.2, y: 0.8 } },
    { id: 'table', name: 'Table', kind: 'table', parentId: 'room' },
    { id: 'bench', name: 'Bench', kind: 'workbench', parentId: 'room' },
  ],
  categories: [{ id: 'supplies', name: 'Supplies' }, { id: 'electronics', name: 'Electronics' }],
});

function setup() {
  const values = new Map<string, string>();
  const issues: CacheIssue[] = [];
  const options = {
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
    fetchCatalog: async () => catalogFixture(),
    onCacheError: (issue: CacheIssue) => { issues.push(issue); },
    now: () => 1_000,
  };
  return { values, issues, options, cache: new BrowserCatalogCache(options) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('cold and warm loads preserve retirement, all location kinds, floor plans, and safety text', async () => {
  const { cache, options } = setup();
  assert.equal(cache.read(), null);
  const fresh = await cache.refresh();
  assert.equal(fresh.source, 'network');
  const restarted = new BrowserCatalogCache(options);
  assert.deepEqual(restarted.read()?.catalog, catalogFixture());
  assert.equal(restarted.read()?.source, 'cache');
  assert.equal(restarted.read()?.fetchedAt, 1_000);
  assert.equal(isRetired(restarted.read()!.catalog.items[0]!), true);
});

test('staff catalogs remain in memory only; saved and hydrated snapshots contain public locations', async () => {
  const { options, values } = setup();
  const privateCatalog = catalogFixture();
  privateCatalog.access = 'staff';
  privateCatalog.locations[1] = { ...privateCatalog.locations[1]!, name: 'Storage Closet', staffOnly: true };
  values.set('garage-inventory:catalog:v2', JSON.stringify({ version: 2, fetchedAt: 1_000, catalog: privateCatalog }));
  const cache = new BrowserCatalogCache({ ...options, fetchCatalog: async () => privateCatalog });
  assert.equal(cache.read(), null);
  assert.equal(values.has('garage-inventory:catalog:v2'), false);
  const fresh = await cache.refresh();
  assert.equal(fresh.catalog.access, 'staff');
  assert.ok(fresh.catalog.locations.some((location) => location.name === 'Storage Closet'));
  assert.doesNotMatch(values.get(cache.key)!, /Storage Closet/);
  assert.equal(JSON.parse(values.get(cache.key)!).catalog.items[0].locationId, ASK_STAFF_LOCATION.id);
  assert.deepEqual(new BrowserCatalogCache(options).read()?.catalog, publicCatalog(privateCatalog));
});
test('legacy cached and network categories normalize without losing the saved catalog', async () => {
  const { options, values, issues } = setup();
  const original = catalogFixture();
  const legacy = {
    ...original,
    items: original.items.map(({ categoryIds, ...item }) => ({ ...item, categoryId: categoryIds[0] })),
  };
  const expected = {
    ...original, items: original.items.map((item) => ({ ...item, categoryIds: ['supplies'] })),
  };
  values.set(CATALOG_CACHE_KEY, JSON.stringify({ version: 3, fetchedAt: 1_000, catalog: legacy }));
  const cache = new BrowserCatalogCache({ ...options, fetchCatalog: async () => legacy });
  assert.deepEqual(cache.read()?.catalog, expected);
  assert.deepEqual((await cache.refresh()).catalog, expected);
  assert.deepEqual(JSON.parse(values.get(CATALOG_CACHE_KEY)!).catalog, expected);
  assert.deepEqual(issues, []);
});

test('concurrent requests coalesce, and returned values cannot mutate the saved snapshot', async () => {
  const { options } = setup();
  const response = deferred<CatalogResponse>();
  let calls = 0;
  const cache = new BrowserCatalogCache({
    ...options, fetchCatalog: () => { calls++; return response.promise; },
  });
  const first = cache.refresh();
  const second = cache.refresh();
  response.resolve(catalogFixture());
  const [a, b] = await Promise.all([first, second]);
  a.catalog.items[0]!.name = 'Wrong name';
  b.catalog.locations[1]!.mapPosition!.x = 0;
  assert.deepEqual(cache.read()?.catalog, catalogFixture());
  assert.equal(calls, 1);
});

test('age is recomputed at the exact five-minute boundary and after clock rollback', async () => {
  const { options } = setup();
  let now = 1_000;
  const cache = new BrowserCatalogCache({ ...options, now: () => now });
  await cache.refresh();
  now += CATALOG_MAX_AGE_MS - 1;
  assert.equal(cache.read()?.stale, false);
  now++;
  assert.equal(cache.read()?.stale, true);
  now = 999;
  assert.equal(cache.read()?.stale, true);
});

test('warm refresh failures preserve the last good data and timestamp, and cold failures reject', async () => {
  const { options, cache, values } = setup();
  await cache.refresh();
  const persisted = values.get(cache.key);
  const offline = new BrowserCatalogCache({
    ...options, fetchCatalog: async () => { throw new Error('Offline'); },
  });
  assert.ok(offline.read());
  await assert.rejects(offline.refresh(), /Offline/);
  assert.equal(offline.read()?.fetchedAt, 1_000);
  assert.equal(values.get(cache.key), persisted);
  offline.invalidate();
  await assert.rejects(offline.refresh(), /Offline/);
  assert.equal(offline.read(), null);
});

test('invalid network data never replaces a good persisted catalog', async () => {
  const { options, cache, values } = setup();
  await cache.refresh();
  const persisted = values.get(cache.key);
  const invalid = new BrowserCatalogCache({
    ...options, fetchCatalog: async () => ({ ...catalogFixture(), categories: [] }),
  });
  await assert.rejects(invalid.refresh(), /unknown categoryId/);
  assert.equal(values.get(cache.key), persisted);
});

test('corrupt, old-version, future-dated, or dangling persisted data is reported and removed', () => {
  for (const raw of [
    '{broken',
    JSON.stringify({ version: 1, fetchedAt: 1_000, catalog: catalogFixture() }),
    JSON.stringify({ version: 3, fetchedAt: 1_001, catalog: catalogFixture() }),
    JSON.stringify({ version: 3, fetchedAt: -1, catalog: catalogFixture() }),
    JSON.stringify({ version: 3, fetchedAt: 1_000, catalog: { ...catalogFixture(), locations: [] } }),
  ]) {
    const { options, values, issues } = setup();
    values.set(CATALOG_CACHE_KEY, raw);
    values.set('unrelated', 'keep');
    assert.equal(new BrowserCatalogCache(options).read(), null);
    assert.equal(values.has(CATALOG_CACHE_KEY), false);
    assert.equal(values.get('unrelated'), 'keep');
    assert.equal(issues[0]?.operation, 'read');
  }
});

test('storage access and quota failures are reported while network data remains usable in memory', async () => {
  const { options, issues } = setup();
  const fail = () => { throw new Error('Storage disabled'); };
  const cache = new BrowserCatalogCache({
    ...options, storage: { getItem: fail, setItem: fail, removeItem: fail },
  });
  assert.equal(cache.read(), null);
  assert.deepEqual((await cache.refresh()).catalog, catalogFixture());
  assert.deepEqual(cache.read()?.catalog, catalogFixture());
  cache.invalidate();
  assert.equal(cache.read(), null);
  assert.deepEqual(issues.map((issue) => issue.operation), ['read', 'write', 'remove']);
});

test('invalidation cannot let a pre-write response restore older data', async () => {
  const { options } = setup();
  const old = deferred<CatalogResponse>();
  let calls = 0;
  const updated = catalogFixture();
  updated.items[0]!.name = 'Updated';
  const cache = new BrowserCatalogCache({
    ...options, fetchCatalog: () => ++calls === 1 ? old.promise : Promise.resolve(updated),
  });
  const waiting = cache.refresh();
  const rejected = assert.rejects(waiting, CatalogRefreshSupersededError);
  cache.invalidate();
  assert.deepEqual((await cache.refresh()).catalog, updated);
  old.resolve(catalogFixture());
  await rejected;
  assert.deepEqual(cache.read()?.catalog, updated);
});

test('another tab replaces memory without old requests overwriting its saved catalog', async () => {
  const { options, cache, values } = setup();
  await cache.refresh();
  const old = deferred<CatalogResponse>();
  const tab = new BrowserCatalogCache({ ...options, fetchCatalog: () => old.promise });
  const pending = tab.refresh();
  const rejected = assert.rejects(pending, CatalogRefreshSupersededError);
  const updated = catalogFixture();
  updated.items[0]!.name = 'Another tab';
  await new BrowserCatalogCache({ ...options, fetchCatalog: async () => updated }).refresh();
  assert.deepEqual(tab.reloadFromStorage()?.catalog, updated);
  old.resolve(catalogFixture());
  await rejected;
  assert.deepEqual(new BrowserCatalogCache(options).read()?.catalog, updated);
  values.delete(cache.key);
  assert.equal(tab.reloadFromStorage(), null);
});

test('only catalog fields are persisted, with keys isolating different catalogs', async () => {
  const { options, values } = setup();
  const cache = new BrowserCatalogCache({
    ...options, key: 'other-catalog',
    fetchCatalog: async () => ({ ...catalogFixture(), session: 'private', projectDescription: 'private' }),
  });
  await cache.refresh();
  assert.deepEqual(JSON.parse(values.get(cache.key)!), {
    version: 3, fetchedAt: 1_000, catalog: catalogFixture(),
  });
  assert.equal(new BrowserCatalogCache(options).read(), null);
  new BrowserCatalogCache(options).invalidate();
  assert.ok(values.has(cache.key));
});
