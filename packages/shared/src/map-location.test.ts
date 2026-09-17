import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findCatalogProblems, locationMapProblem, locationSchema, resolveLocationMap, roomMapMarkers, type Location } from './index.js';

const locations: Location[] = [
  { id: 'common', name: 'Common Makerspace', kind: 'room', parentId: null, mapId: 'common' },
  { id: 'advanced', name: 'Advanced Makerspace', kind: 'room', parentId: null, mapId: 'advanced' },
  { id: 'table', name: 'Table A', kind: 'table', parentId: 'common', mapPosition: { roomId: 'common', mapId: 'common', x: 0.5, y: 0.5 } },
  { id: 'bin', name: 'Bin 1', kind: 'bin', parentId: 'table' },
];

test('a location resolves its room and direct marker', () => {
  const result = resolveLocationMap(locations, 'table');
  assert.equal(result?.room.id, 'common');
  assert.equal(result?.map.imageUrl, '/maps/common-makerspace.png');
  assert.equal(result?.marker?.location.id, 'table');
});

test('bins inherit the nearest mapped ancestor without inventing exact positions', () => {
  assert.equal(resolveLocationMap(locations, 'bin')?.marker?.location.id, 'table');
  assert.deepEqual(roomMapMarkers(locations, 'common').map((l) => l.id), ['table']);
});

test('a cross-room move invalidates old map coordinates on the moved subtree', () => {
  const moved = locations.map((l) => l.id === 'table' ? { ...l, parentId: 'advanced' } : l);
  const result = resolveLocationMap(moved, 'bin');
  assert.equal(result?.room.id, 'advanced');
  assert.equal(result?.marker, undefined);
  assert.deepEqual(roomMapMarkers(moved, 'common'), []);
  assert.deepEqual(roomMapMarkers(moved, 'advanced'), []);
});

test('changing a room floor plan does not reuse positions from the old drawing', () => {
  const changed = locations.map((l): Location => l.id === 'common' ? { ...l, mapId: 'advanced' } : l);
  assert.equal(resolveLocationMap(changed, 'table')?.marker, undefined);
});

test('unmapped rooms and invalid location IDs are explicit misses', () => {
  assert.equal(resolveLocationMap(locations, 'missing'), null);
  assert.equal(resolveLocationMap([{ id: 'plain', name: 'Room', kind: 'room', parentId: null }], 'plain'), null);
  assert.equal(resolveLocationMap(locations, 'advanced')?.marker, undefined);
});

test('location schemas validate normalized coordinates and supported floor plans', () => {
  const base = locations[2];
  assert.ok(base);
  for (const x of [-0.01, 1.01, NaN, Infinity]) {
    assert.equal(locationSchema.safeParse({ ...base, mapPosition: { ...base.mapPosition, x } }).success, false);
  }
  assert.equal(locationSchema.safeParse({ ...base, mapPosition: { ...base.mapPosition, y: -1 } }).success, false);
  assert.equal(locationSchema.safeParse({ ...locations[0], mapId: 'missing' }).success, false);
  assert.equal(locationSchema.safeParse(base).success, true);
});

test('new markers must belong to the current mapped room, including inherited location paths', () => {
  const table = locations[2];
  assert.ok(table);
  assert.equal(locationMapProblem(table, locations), null);
  assert.match(locationMapProblem({ ...table, mapPosition: { roomId: 'advanced', mapId: 'advanced', x: 0.5, y: 0.5 } }, locations) ?? '', /current room/);
  assert.match(locationMapProblem({ ...table, mapId: 'common' }, locations) ?? '', /top-level room/);
  assert.equal(locationMapProblem({ ...table, parentId: 'advanced' }, locations, table), null);
  assert.equal(findCatalogProblems({ items: [], categories: [], locations }).length, 0);
});
