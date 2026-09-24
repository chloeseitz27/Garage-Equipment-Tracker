import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASK_STAFF_LOCATION, publicCatalog, isStaffOnlyLocation } from './location-access.js';
import { catalogSchema } from './catalog.js';
import { getLocationPath } from './location.js';
import { resolveLocationMap } from './map-location.js';
import type { CatalogResponse } from './types.js';

const catalog: CatalogResponse = {
  access: 'staff',
  categories: [{ id: 'tools', name: 'Tools' }],
  locations: [
    { id: 'shop', name: 'Shop', parentId: null, kind: 'room', mapId: 'common' },
    { id: 'bench', name: 'Bench', parentId: 'shop', kind: 'table' },
    { id: 'closet', name: 'Storage Closet', parentId: null, kind: 'room', staffOnly: true },
    { id: 'basement', name: 'Basement Storage', parentId: null, kind: 'room', staffOnly: true },
    { id: 'bin', name: 'Private Bin', parentId: 'closet', kind: 'bin', staffOnly: false },
    { id: 'cabinet', name: 'Private Cabinet', parentId: 'shop', kind: 'cabinet', staffOnly: true,
      mapPosition: { roomId: 'shop', mapId: 'common', x: 0.8, y: 0.4 } },
  ],
  items: ['closet', 'basement', 'bin', 'bench', 'cabinet'].map((locationId) => ({
    id: `item-${locationId}`, name: 'Tool', kind: 'equipment', categoryIds: ['tools'], locationId,
    status: 'available', quantity: 1, trainingRequired: 'none', tags: [], goodFor: [],
  })),
};

test('staff-only locations and descendants become one Ask Staff destination without hiding items', () => {
  const original = structuredClone(catalog);
  const visible = publicCatalog(catalogSchema.parse(catalog));
  assert.equal(visible.access, 'public');
  assert.equal(visible.items.length, catalog.items.length);
  assert.deepEqual(visible.locations.map((location) => location.id), ['shop', 'bench', ASK_STAFF_LOCATION.id]);
  for (const item of visible.items) {
    if (item.id === 'item-bench') assert.equal(item.locationId, 'bench');
    else {
      assert.deepEqual(getLocationPath(visible.locations, item.locationId), [ASK_STAFF_LOCATION]);
      assert.equal(resolveLocationMap(visible.locations, item.locationId), null);
    }
  }
  assert.doesNotMatch(JSON.stringify(visible.locations), /Storage Closet|Basement Storage|Private|mapPosition|staffOnly/);
  assert.deepEqual(catalog, original);
  assert.deepEqual(catalogSchema.parse(visible), visible);
  assert.deepEqual(publicCatalog(visible), visible);
});

test('restriction is inherited even if a child explicitly sets staffOnly false', () => {
  assert.equal(isStaffOnlyLocation(catalog.locations, 'bin'), true);
  assert.equal(isStaffOnlyLocation(catalog.locations, 'cabinet'), true);
  assert.equal(isStaffOnlyLocation(catalog.locations, 'bench'), false);
  assert.equal(isStaffOnlyLocation(catalog.locations, 'shop'), false);
  assert.equal(isStaffOnlyLocation(catalog.locations, 'missing'), false);
});
