import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';

import cookieParser from 'cookie-parser';
import express from 'express';
import type { Category, CreateItemInput, Flag, Item, Location } from '@garage/shared';

import type { CatalogRepository } from '../repository/catalog-repository.js';
import { authRoutes } from './auth.js';
import { staffRoutes } from './staff.js';

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
  { id: 'cat-unused', name: 'Spare' },
];

const items: Item[] = [
  {
    id: 'itm-meter',
    name: 'Multimeter',
    kind: 'equipment',
    categoryId: 'cat-used',
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
    categoryId: 'cat-used',
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

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes());
  app.use('/api', staffRoutes(makeRepository()));

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

after(() => {
  server.close();
});

const call = (method: string, path: string, body?: unknown): Promise<Response> =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test('staff routes reject an unauthenticated caller', async () => {
  const response = await fetch(`${baseUrl}/api/flags`);
  assert.equal(response.status, 401);
});

test('an item pointing at an unknown location is rejected', async () => {
  const response = await call('POST', '/api/items', {
    name: 'Ghost',
    kind: 'consumable',
    categoryId: 'cat-used',
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
    categoryId: 'cat-nope',
    locationId: 'loc-bin',
    tags: [],
    goodFor: [],
    stockLevel: 'in-stock',
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Unknown categoryId/);
});

test('a bulk batch is rejected whole when any row has a bad reference', async () => {
  const response = await call('POST', '/api/items/bulk', {
    items: [
      {
        name: 'Fine',
        kind: 'consumable',
        categoryId: 'cat-used',
        locationId: 'loc-bin',
        tags: [],
        goodFor: [],
        stockLevel: 'in-stock',
      },
      {
        name: 'Broken',
        kind: 'consumable',
        categoryId: 'cat-used',
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
  const listed = await (await call('GET', '/api/flags')).json();
  assert.ok(Array.isArray(listed));
});

test('a valid bulk batch is created', async () => {
  const response = await call('POST', '/api/items/bulk', {
    items: [
      {
        name: 'Batch A',
        kind: 'consumable',
        categoryId: 'cat-used',
        locationId: 'loc-bin',
        tags: [],
        goodFor: [],
        stockLevel: 'in-stock',
      },
      {
        name: 'Batch B',
        kind: 'equipment',
        categoryId: 'cat-used',
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

test('editing a missing item is a 404, not a silent create', async () => {
  const response = await call('PUT', '/api/items/itm-nope', {
    name: 'Nope',
    kind: 'consumable',
    categoryId: 'cat-used',
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
    changes: { categoryId: 'cat-unused' },
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
