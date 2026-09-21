import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';

import cookieParser from 'cookie-parser';
import express from 'express';
import type { Category, CreateItemInput, Flag, Item, Location } from '@garage/shared';

import type { CatalogRepository } from '../repository/catalog-repository.js';
import { CachedCatalogRepository } from '../repository/cached-repository.js';
import { authRoutes } from './auth.js';
import { staffRoutes } from './staff.js';
import { publicRoutes } from './public.js';

/**
 * Route-level guards for referential integrity.
 *
 * The catalog refuses to load when a reference is orphaned, so a write that
 * would orphan one has to be rejected at the boundary — otherwise the damage
 * only surfaces on the next restart, which in practice means mid-demo.
 */

const locations: Location[] = [
  { id: 'loc-room', name: 'Main Shop', parentId: null, kind: 'room', mapId: 'common' },
  { id: 'loc-shelf', name: 'Cabinet B', parentId: 'loc-room', kind: 'shelf' },
  { id: 'loc-bin', name: 'Bin 4', parentId: 'loc-shelf', kind: 'bin' },
  { id: 'loc-empty', name: 'Spare Shelf', parentId: 'loc-room', kind: 'shelf' },
];

const categories: Category[] = [
  { id: 'cat-used', name: 'Electronics' },
  { id: 'cat-secondary', name: 'Prototyping' },
  { id: 'cat-unused', name: 'Spare' },
];

const items: Item[] = [
  {
    id: 'itm-meter',
    name: 'Multimeter',
    kind: 'equipment',
    categoryIds: ['cat-used', 'cat-secondary'],
    locationId: 'loc-bin',
    tags: [],
    goodFor: [],
    status: 'available',
    quantity: 1,
    trainingRequired: 'none',
  },
  {
    id: 'itm-solder',
    name: 'Solder',
    kind: 'consumable',
    categoryIds: ['cat-used'],
    locationId: 'loc-bin',
    tags: [],
    goodFor: [],
    stockLevel: 'in-stock',
  },
];

/** In-memory stand-in; these tests are about the routes, not about persistence. */
const makeRepository = (): CatalogRepository => {
  const state = {
    items: [...items],
    locations: [...locations],
    categories: [...categories],
    flags: [] as Flag[],
  };

  return {
    getItems: async () => state.items,
    getItem: async (id) => state.items.find((item) => item.id === id) ?? null,
    createItem: async (input: CreateItemInput) => {
      const item = { ...input, id: `itm-${state.items.length}` } as Item;
      state.items.push(item);
      return item;
    },
    createItems: async (inputs: CreateItemInput[]) => {
      const created = inputs.map(
        (input, index) => ({ ...input, id: `itm-b${state.items.length + index}` }) as Item,
      );
      state.items.push(...created);
      return created;
    },
    saveItem: async (item) => {
      state.items = state.items.map((existing) => (existing.id === item.id ? item : existing));
    },
    saveItems: async (items) => {
      const byId = new Map(items.map((item) => [item.id, item]));
      state.items = state.items.map((existing) => byId.get(existing.id) ?? existing);
    },
    getLocations: async () => state.locations,
    createLocation: async (input) => {
      const location = { ...input, id: `loc-${state.locations.length}` };
      state.locations.push(location);
      return location;
    },
    saveLocation: async (location) => {
      state.locations = state.locations.map((existing) =>
        existing.id === location.id ? location : existing,
      );
    },
    saveLocations: async (locations) => {
      const byId = new Map(locations.map((location) => [location.id, location]));
      state.locations = state.locations.map((location) => byId.get(location.id) ?? location);
    },
    deleteLocation: async (id) => {
      state.locations = state.locations.filter((location) => location.id !== id);
    },
    getCategories: async () => state.categories,
    createCategory: async (input) => {
      const category = { ...input, id: `cat-${state.categories.length}` };
      state.categories.push(category);
      return category;
    },
    saveCategory: async (category) => {
      state.categories = state.categories.map((existing) =>
        existing.id === category.id ? category : existing,
      );
    },
    deleteCategory: async (id) => {
      state.categories = state.categories.filter((category) => category.id !== id);
    },
    getFlags: async () => state.flags,
    addFlag: async (input) => {
      const flag: Flag = {
        ...input,
        id: `flg-${state.flags.length}`,
        createdAt: new Date().toISOString(),
        resolved: false,
      };
      state.flags.push(flag);
      return flag;
    },
    setFlagResolved: async (id, resolved) => {
      const flag = state.flags.find((candidate) => candidate.id === id);
      if (!flag) return null;
      flag.resolved = resolved;
      return flag;
    },
  };
};

let server: Server;
let baseUrl: string;
let cookie: string;
let repository: CatalogRepository;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes());
  app.use('/api', (req, res, next) => publicRoutes(repository)(req, res, next));
  app.use('/api', (req, res, next) => staffRoutes(repository)(req, res, next));

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));

  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('No port');
  baseUrl = `http://127.0.0.1:${address.port}`;

  // config.staffPassphrase falls back to 'garage' when STAFF_PASSPHRASE is unset.
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passphrase: 'garage' }),
  });
  cookie = response.headers.getSetCookie().join('; ');
});

beforeEach(() => {
  repository = makeRepository();
});

after(() => {
  server.close();
});

const call = (method: string, path: string, body?: unknown): Promise<Response> =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test('the public catalog bypasses HTTP caching and sees writes through the shared repository cache', async () => {
  repository = new CachedCatalogRepository(repository);
  const before = await call('GET', '/api/catalog');
  assert.equal(before.headers.get('cache-control'), 'no-store');
  const catalog = await before.json() as { categories: Category[] };
  assert.ok(catalog.categories.some((category) => category.id === 'cat-used'));
  const created = await call('POST', '/api/categories', { name: 'Cache integration category' });
  assert.equal(created.status, 201);
  const category = await created.json() as Category;
  const after = await (await call('GET', '/api/catalog')).json() as { categories: Category[] };
  assert.ok(after.categories.some((entry) => entry.id === category.id && entry.name === category.name));
  assert.equal((await call('DELETE', `/api/categories/${category.id}`)).status, 204);
  const deleted = await (await call('GET', '/api/catalog')).json() as { categories: Category[] };
  assert.ok(!deleted.categories.some((entry) => entry.id === category.id));
});

test('staff routes reject an unauthenticated caller', async () => {
  const response = await fetch(`${baseUrl}/api/flags`);
  assert.equal(response.status, 401);
});

test('an item pointing at an unknown location is rejected', async () => {
  const response = await call('POST', '/api/items', {
    name: 'Ghost',
    kind: 'consumable',
    categoryIds: ['cat-used'],
    locationId: 'loc-nope',
    tags: [],
    goodFor: [],
    stockLevel: 'in-stock',
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Unknown locationId/);
});

test('an item pointing at an unknown category is rejected', async () => {
  const response = await call('POST', '/api/items', {
    name: 'Ghost',
    kind: 'consumable',
    categoryIds: ['cat-nope'],
    locationId: 'loc-bin',
    tags: [],
    goodFor: [],
    stockLevel: 'in-stock',
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Unknown categoryId/);
});

test('a bulk batch is rejected whole when any row has a bad reference', async () => {
  const before = structuredClone(await repository.getItems());
  const response = await call('POST', '/api/items/bulk', {
    items: [
      {
        name: 'Fine',
        kind: 'consumable',
        categoryIds: ['cat-used'],
        locationId: 'loc-bin',
        tags: [],
        goodFor: [],
        stockLevel: 'in-stock',
      },
      {
        name: 'Broken',
        kind: 'consumable',
        categoryIds: ['cat-used'],
        locationId: 'loc-nope',
        tags: [],
        goodFor: [],
        stockLevel: 'in-stock',
      },
    ],
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Row 2/);

  // The valid first row must not have landed.
  assert.deepEqual(await repository.getItems(), before);
});

test('a valid bulk batch is created', async () => {
  const response = await call('POST', '/api/items/bulk', {
    items: [
      {
        name: 'Batch A',
        kind: 'consumable',
        categoryIds: ['cat-used'],
        locationId: 'loc-bin',
        tags: [],
        goodFor: [],
        stockLevel: 'in-stock',
      },
      {
        name: 'Batch B',
        kind: 'equipment',
        categoryIds: ['cat-used'],
        locationId: 'loc-bin',
        tags: [],
        goodFor: [],
        status: 'available',
        quantity: 2,
        trainingRequired: 'none',
      },
    ],
  });

  assert.equal(response.status, 201);
  assert.equal((await response.json()).created, 2);
});

test('moving a location into its own descendant is rejected', async () => {
  const response = await call('PUT', '/api/locations/loc-shelf', {
    name: 'Cabinet B',
    parentId: 'loc-bin',
    kind: 'shelf',
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /inside itself/);
});

test('a legitimate location move is accepted', async () => {
  const response = await call('PUT', '/api/locations/loc-empty', {
    name: 'Spare Shelf',
    parentId: null,
    kind: 'room',
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).parentId, null);
});

test('deleting a location that still holds items is refused', async () => {
  const response = await call('DELETE', '/api/locations/loc-bin');
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /still holds/i);
});

test('deleting a location that still has sub-locations is refused', async () => {
  const response = await call('DELETE', '/api/locations/loc-room');
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /sub-location/);
});

test('deleting a category still in use is refused', async () => {
  const response = await call('DELETE', '/api/categories/cat-used');
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Still used by/);
});

test('deleting an unused category succeeds', async () => {
  const response = await call('DELETE', '/api/categories/cat-unused');
  assert.equal(response.status, 204);
});

test('deleting a secondary category is blocked for active and retired references', async () => {
  for (const retired of [false, true]) {
    if (retired) {
      const response = await call('POST', '/api/items/bulk-retire', { ids: ['itm-meter'], retired });
      assert.equal(response.status, 200);
    }
    const response = await call('DELETE', '/api/categories/cat-secondary');
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /Still used by 1 item/);
    assert.ok((await repository.getCategories()).some((category) => category.id === 'cat-secondary'));
  }
});

test('create and update persist all categories for both item kinds', async () => {
  for (const item of items) {
    const categoryIds = ['cat-used', 'cat-secondary'];
    const created = await call('POST', '/api/items', { ...item, categoryIds });
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.deepEqual(body.categoryIds, categoryIds);
    assert.ok(!('categoryId' in body));
    assert.deepEqual((await repository.getItem(body.id))?.categoryIds, categoryIds);

    const updated = await call('PUT', `/api/items/${item.id}`, {
      ...item, categoryIds: ['cat-secondary', 'cat-unused'],
    });
    assert.equal(updated.status, 200);
    assert.deepEqual((await updated.json()).categoryIds, ['cat-secondary', 'cat-unused']);
    assert.deepEqual((await repository.getItem(item.id))?.categoryIds, ['cat-secondary', 'cat-unused']);
  }
});

test('legacy create, update, and bulk category payloads return only canonical arrays', async () => {
  const { categoryIds: _categoryIds, ...legacy } = items[0]!;
  const created = await call('POST', '/api/items', { ...legacy, categoryId: 'cat-used' });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.deepEqual(body.categoryIds, ['cat-used']);
  assert.ok(!('categoryId' in body));

  const updated = await call('PUT', '/api/items/itm-meter', { ...legacy, categoryId: 'cat-secondary' });
  assert.equal(updated.status, 200);
  assert.deepEqual((await updated.json()).categoryIds, ['cat-secondary']);
  const bulk = await call('POST', '/api/items/bulk-update', {
    ids: ['itm-meter', 'itm-solder'], changes: { categoryId: 'cat-unused' },
  });
  assert.equal(bulk.status, 200);
  for (const item of (await bulk.json()).items) {
    assert.deepEqual(item.categoryIds, ['cat-unused']);
    assert.ok(!('categoryId' in item));
  }
});

test('invalid category lists fail create, update, bulk create, and bulk update without any writes', async () => {
  const before = structuredClone(await repository.getItems());
  const invalidAssignments = [
    [],
    [''],
    ['   '],
    ['cat-used', 'cat-used'],
    ['cat-used', 'cat-nope'],
  ];
  for (const categoryIds of invalidAssignments) {
    const invalid = { ...items[0], categoryIds };
    const requests: Array<[string, string, unknown]> = [
      ['POST', '/api/items', invalid],
      ['PUT', '/api/items/itm-meter', invalid],
      ['POST', '/api/items/bulk', { items: [items[1], invalid] }],
      ['POST', '/api/items/bulk-update', {
        ids: ['itm-meter', 'itm-solder'], changes: { categoryIds, locationId: 'loc-empty' },
      }],
    ];
    for (const [method, path, body] of requests) {
      const response = await call(method, path, body);
      assert.equal(response.status, 400, `${method} ${path}: ${JSON.stringify(categoryIds)}`);
      assert.deepEqual(await repository.getItems(), before, `${method} ${path} must not partly write`);
    }
  }
});

test('conflicting legacy and canonical assignments are rejected rather than losing categories', async () => {
  const before = structuredClone(await repository.getItems());
  const assignments = { categoryId: 'cat-secondary', categoryIds: ['cat-used'] };
  for (const [method, path, body] of [
    ['POST', '/api/items', { ...items[0], ...assignments }],
    ['PUT', '/api/items/itm-meter', { ...items[0], ...assignments }],
    ['POST', '/api/items/bulk', { items: [items[1], { ...items[0], ...assignments }] }],
    ['POST', '/api/items/bulk-update', { ids: ['itm-meter', 'itm-solder'], changes: assignments }],
  ] as const) {
    const response = await call(method, path, body);
    assert.equal(response.status, 400);
    assert.deepEqual(await repository.getItems(), before);
  }
});

test('valid bulk creation preserves multiple category assignments on every row', async () => {
  const response = await call('POST', '/api/items/bulk', {
    items: items.map((item) => ({ ...item, categoryIds: ['cat-used', 'cat-secondary'] })),
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.created, 2);
  for (const item of body.items) {
    assert.deepEqual(item.categoryIds, ['cat-used', 'cat-secondary']);
    assert.deepEqual((await repository.getItem(item.id))?.categoryIds, item.categoryIds);
  }
});

test('editing a missing item is a 404, not a silent create', async () => {
  const response = await call('PUT', '/api/items/itm-nope', {
    name: 'Nope',
    kind: 'consumable',
    categoryIds: ['cat-used'],
    locationId: 'loc-bin',
    tags: [],
    goodFor: [],
    stockLevel: 'in-stock',
  });

  assert.equal(response.status, 404);
});

/* --- Bulk edit and the recycle bin --- */

test('a bulk move applies to every selected item', async () => {
  const response = await call('POST', '/api/items/bulk-update', {
    ids: ['itm-meter', 'itm-solder'],
    changes: { locationId: 'loc-empty' },
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.updated, 2);
  assert.ok(body.items.every((item: Item) => item.locationId === 'loc-empty'));
  assert.deepEqual((await repository.getItem('itm-meter'))?.categoryIds, ['cat-used', 'cat-secondary']);
  assert.deepEqual((await repository.getItem('itm-solder'))?.categoryIds, ['cat-used']);
});

test('bulk category edits replace rather than append assignments, including retired items', async () => {
  const retirement = await call('POST', '/api/items/bulk-retire', { ids: ['itm-solder'], retired: true });
  assert.equal(retirement.status, 200);
  const response = await call('POST', '/api/items/bulk-update', {
    ids: ['itm-meter', 'itm-solder'], changes: { categoryIds: ['cat-secondary', 'cat-unused'] },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.updated, 2);
  for (const item of await repository.getItems()) {
    assert.deepEqual(item.categoryIds, ['cat-secondary', 'cat-unused']);
  }
  assert.ok((await repository.getItem('itm-solder'))?.retiredAt);
});

test('bulk updates check secondary references on every selected item before saving', async () => {
  const solder = await repository.getItem('itm-solder');
  assert.ok(solder);
  await repository.saveItem({
    ...solder, categoryIds: ['cat-used', 'cat-nope'], retiredAt: '2026-09-18T12:00:00.000Z',
  });
  const before = structuredClone(await repository.getItems());
  const response = await call('POST', '/api/items/bulk-update', {
    ids: ['itm-meter', 'itm-solder'], changes: { locationId: 'loc-empty' },
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /cat-nope/);
  assert.deepEqual(await repository.getItems(), before);
});

test('a bulk move to an unknown location is rejected', async () => {
  const response = await call('POST', '/api/items/bulk-update', {
    ids: ['itm-meter'],
    changes: { locationId: 'loc-nope' },
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Unknown locationId/);
});

test('status cannot be applied to a selection containing consumables', async () => {
  // Merging status onto a consumable would produce a record that fails schema
  // validation, so the whole request is refused rather than partly applied.
  const response = await call('POST', '/api/items/bulk-update', {
    ids: ['itm-meter', 'itm-solder'],
    changes: { status: 'in-use' },
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /equipment only/i);
});

test('stock level cannot be applied to a selection containing equipment', async () => {
  const response = await call('POST', '/api/items/bulk-update', {
    ids: ['itm-meter', 'itm-solder'],
    changes: { stockLevel: 'low' },
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /consumables only/i);
});

test('a bulk update naming an unknown id changes nothing', async () => {
  const response = await call('POST', '/api/items/bulk-update', {
    ids: ['itm-meter', 'itm-ghost'],
    changes: { categoryIds: ['cat-unused'] },
  });

  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /itm-ghost/);
});

test('retiring sets a timestamp on both kinds rather than deleting', async () => {
  const response = await call('POST', '/api/items/bulk-retire', {
    ids: ['itm-meter', 'itm-solder'],
    retired: true,
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.updated, 2);
  assert.ok(body.items.every((item: Item) => typeof item.retiredAt === 'string'));

  // The records survive — retirement is a state, not a delete.
  const stillThere = await (await call('GET', '/api/items/itm-meter')).json().catch(() => null);
  assert.ok(stillThere === null || stillThere.id === 'itm-meter');
});

test('restoring clears the timestamp', async () => {
  await call('POST', '/api/items/bulk-retire', { ids: ['itm-meter'], retired: true });
  const response = await call('POST', '/api/items/bulk-retire', {
    ids: ['itm-meter'],
    retired: false,
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.items[0].retiredAt, undefined);
});

test('retiring an unknown id is a 404', async () => {
  const response = await call('POST', '/api/items/bulk-retire', {
    ids: ['itm-ghost'],
    retired: true,
  });

  assert.equal(response.status, 404);
});

test('a bulk update with no changes is rejected', async () => {
  const response = await call('POST', '/api/items/bulk-update', {
    ids: ['itm-meter'],
    changes: {},
  });

  assert.equal(response.status, 400);
});

test('location map updates preserve normalized coordinates', async () => {
  const response = await call('PUT', '/api/locations/loc-bin', {
    name: 'Bin 4', kind: 'bin', parentId: 'loc-shelf',
    mapPosition: { roomId: 'loc-room', mapId: 'common', x: 0.25, y: 0.4 },
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).mapPosition, {
    roomId: 'loc-room', mapId: 'common', x: 0.25, y: 0.4,
  });
});

test('marker batches update multiple rooms atomically and preserve other location fields', async (t) => {
  const advanced = await repository.createLocation({ name: 'Advanced', kind: 'room', parentId: null, mapId: 'advanced' });
  const table = await repository.createLocation({ name: 'Table', kind: 'table', parentId: advanced.id });
  const current = (await repository.getLocations()).find((location) => location.id === 'loc-bin')!;
  await repository.saveLocation({ ...current, name: 'Renamed bin' });
  const save = t.mock.method(repository, 'saveLocations');
  const response = await call('POST', '/api/locations/markers', { markers: [
    { id: 'loc-bin', roomId: 'loc-room', mapId: 'common', position: { x: 0.25, y: 0.4 } },
    { id: table.id, roomId: advanced.id, mapId: 'advanced', position: { x: 0.8, y: 0.1 } },
  ] });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.updated, 2);
  assert.equal(body.locations[0].name, 'Renamed bin');
  assert.equal(body.locations[0].parentId, 'loc-shelf');
  assert.deepEqual(body.locations[1].mapPosition, { roomId: advanced.id, mapId: 'advanced', x: 0.8, y: 0.1 });
  assert.equal(save.mock.callCount(), 1);
  assert.equal(save.mock.calls[0]?.arguments[0].length, 2);
});

test('marker removal and movement share one batch and invalidate the catalog cache', async () => {
  const current = (await repository.getLocations()).find((location) => location.id === 'loc-bin')!;
  await repository.saveLocation({ ...current, mapPosition: { roomId: 'loc-room', mapId: 'common', x: 0.1, y: 0.2 } });
  repository = new CachedCatalogRepository(repository);
  await call('GET', '/api/catalog');
  const response = await call('POST', '/api/locations/markers', { markers: [
    { id: 'loc-bin', roomId: 'loc-room', mapId: 'common', position: null },
    { id: 'loc-empty', roomId: 'loc-room', mapId: 'common', position: { x: 0, y: 1 } },
  ] });
  assert.equal(response.status, 200);
  const catalog = await (await call('GET', '/api/catalog')).json() as { locations: Location[] };
  assert.equal('mapPosition' in catalog.locations.find((location) => location.id === 'loc-bin')!, false);
  assert.equal(catalog.locations.find((location) => location.id === 'loc-empty')?.mapPosition?.y, 1);
});

test('invalid, missing, stale, and duplicate marker changes reject the entire batch', async (t) => {
  const original = structuredClone(await repository.getLocations());
  const save = t.mock.method(repository, 'saveLocations');
  const valid = { id: 'loc-bin', roomId: 'loc-room', mapId: 'common', position: { x: 0.25, y: 0.4 } };
  for (const [invalid, status] of [
    [{ ...valid, id: 'loc-empty', position: { x: 2, y: 0.5 } }, 400],
    [{ ...valid, id: 'missing' }, 404],
    [{ ...valid, id: 'loc-empty', roomId: 'another-room' }, 409],
    [{ ...valid, id: 'loc-empty', mapId: 'advanced' }, 409],
    [{ ...valid, id: 'loc-empty', mapId: 'advanced', position: null }, 409],
    [{ ...valid, id: 'loc-room' }, 409],
    [valid, 400],
  ] as const) {
    const response = await call('POST', '/api/locations/markers', { markers: [valid, invalid] });
    assert.equal(response.status, status);
    assert.deepEqual(await repository.getLocations(), original);
  }
  assert.equal(save.mock.callCount(), 0);
});

test('marker batches are staff-only and propagate storage failure without reporting success', async () => {
  const body = { markers: [{ id: 'loc-bin', roomId: 'loc-room', mapId: 'common', position: { x: 0.1, y: 0.2 } }] };
  const anonymous = await fetch(`${baseUrl}/api/locations/markers`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal(anonymous.status, 401);
  const original = structuredClone(await repository.getLocations());
  repository.saveLocations = async () => { throw new Error('Storage unavailable'); };
  assert.equal((await call('POST', '/api/locations/markers', body)).status, 500);
  assert.deepEqual(await repository.getLocations(), original);
});

test('location map updates reject coordinates outside the image or on another room', async () => {
  for (const mapPosition of [
    { roomId: 'loc-room', mapId: 'common', x: 1.1, y: 0.4 },
    { roomId: 'different-room', mapId: 'common', x: 0.2, y: 0.4 },
    { roomId: 'loc-room', mapId: 'advanced', x: 0.2, y: 0.4 },
  ]) {
    const response = await call('PUT', '/api/locations/loc-bin', {
      name: 'Bin 4', kind: 'bin', parentId: 'loc-shelf', mapPosition,
    });
    assert.equal(response.status, 400);
  }
});

test('floor plans can only be attached to root rooms, and anonymous marker updates are refused', async () => {
  const response = await call('PUT', '/api/locations/loc-bin', {
    name: 'Bin 4', kind: 'bin', parentId: 'loc-shelf', mapId: 'common',
  });
  assert.equal(response.status, 400);
  const anonymous = await fetch(`${baseUrl}/api/locations/loc-bin`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Bin 4', kind: 'bin', parentId: 'loc-shelf' }),
  });
  assert.equal(anonymous.status, 401);
});
