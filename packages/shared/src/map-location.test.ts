import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { findCatalogProblems, locationMapProblem, locationSchema, locationsFileSchema, resolveLocationMap, ROOM_MAPS, roomMapMarkers, searchLocations, type Location } from './index.js';

const locations: Location[] = [
  { id: 'common', name: 'Common Makerspace', kind: 'room', parentId: null, mapId: 'common' },
  { id: 'advanced', name: 'Advanced Makerspace', kind: 'room', parentId: null, mapId: 'advanced' },
  { id: 'table', name: 'Table A', kind: 'table', parentId: 'common', mapPosition: { roomId: 'common', mapId: 'common', x: 0.5, y: 0.5 } },
  { id: 'bin', name: 'Bin 1', kind: 'bin', parentId: 'table' },
];

test('a location resolves its room and direct marker', () => {
  const result = resolveLocationMap(locations, 'table');
  assert.equal(result?.room.id, 'common');
  assert.equal(result?.map.imageUrl, '/maps/common-makerspace.svg');
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

test('redrawn maps preserve source coordinate systems and include all seeded map locations', async () => {
  const seed = locationsFileSchema.parse(JSON.parse(await readFile(new URL('../../../data/seed/locations.json', import.meta.url), 'utf8')));
  for (const [mapId, asset] of Object.entries(ROOM_MAPS)) {
    const svg = await readFile(new URL(`../../../apps/web/public${asset.imageUrl}`, import.meta.url), 'utf8');
    assert.ok(svg.includes(`viewBox="0 0 ${asset.width} ${asset.height}"`));
    assert.ok(svg.includes(`<title id="title">${asset.name}</title>`));
    assert.ok(!svg.includes('<script'));
    const markers = seed.filter((location) => location.mapPosition?.mapId === mapId);
    assert.equal((svg.match(/data-location-id=/g) ?? []).length, markers.length);
    for (const marker of markers) assert.ok(svg.includes(`data-location-id="${marker.id}"`), marker.name);
  }
});

test('the Toolbox keeps its ID but belongs to Advanced Makerspace at the old coat-rack area', async () => {
  const seed = locationsFileSchema.parse(JSON.parse(await readFile(new URL('../../../data/seed/locations.json', import.meta.url), 'utf8')));
  const toolbox = seed.find((location) => location.id === 'loc-common-toolbench');
  assert.ok(toolbox);
  assert.equal(toolbox.name, 'Toolbox');
  assert.equal(toolbox.parentId, 'loc-advanced-makerspace');
  assert.deepEqual(toolbox.mapPosition, { roomId: 'loc-advanced-makerspace', mapId: 'advanced', x: 0.172, y: 0.132 });
  assert.equal(resolveLocationMap(seed, toolbox.id)?.room.name, 'Advanced Makerspace');
  assert.equal(roomMapMarkers(seed, 'loc-common-makerspace').some((location) => location.id === toolbox.id), false);
});

test('storage letters follow the agreed perimeter order and are unique across both rooms', async () => {
  const seed = locationsFileSchema.parse(JSON.parse(await readFile(new URL('../../../data/seed/locations.json', import.meta.url), 'utf8')));
  const sequences = [
    {
      room: 'common',
      letters: 'ABCDEFGHIJKLM',
      ids: ['desk-1', 'table-9', 'table-8', 'table-7', 'table-6-5', 'table-6', 'table-5',
        'table-10', 'table-4', 'workbench-2', 'workbench-17', 'table-14', 'table-13'],
    },
    {
      room: 'advanced',
      letters: 'ZYXWVUT',
      ids: ['table-20', 'table-21', 'workbench-16', 'table-19', 'table-3', 'table-18', 'table-11'],
    },
  ];
  const allLetters: string[] = [];
  for (const { room, letters, ids } of sequences) {
    const svg = await readFile(new URL(`../../../apps/web/public/maps/${room}-makerspace.svg`, import.meta.url), 'utf8');
    const surfaces = seed.filter((l) => l.parentId === `loc-${room}-makerspace` && ['table', 'workbench'].includes(l.kind));
    assert.equal(surfaces.length, ids.length);
    for (const [index, oldId] of ids.entries()) {
      const id = `loc-${room}-${oldId}`;
      const location = surfaces.find((l) => l.id === id);
      const letter = letters[index];
      assert.ok(location && letter);
      assert.match(location.name, new RegExp(` ${letter}$`));
      assert.equal(/\d/.test(location.name), false, 'Numbers are reserved for drawers');
      assert.ok(svg.includes(`data-location-id="${id}" data-storage-letter="${letter}"`));
      assert.ok(searchLocations(seed, location.name, seed.length).some((match) => match.id === id));
      allLetters.push(letter);
    }
  }
  assert.equal(allLetters.length, 20);
  assert.equal(new Set(allLetters).size, 20);
});

test('six central work tables stay on the drawing but cannot be selected as storage', async () => {
  const seed = locationsFileSchema.parse(JSON.parse(await readFile(new URL('../../../data/seed/locations.json', import.meta.url), 'utf8')));
  const svg = await readFile(new URL('../../../apps/web/public/maps/common-makerspace.svg', import.meta.url), 'utf8');
  assert.equal((svg.match(/<rect class="island"/g) ?? []).length, 6);
  assert.ok(svg.includes('NO STORAGE'));
  for (const letter of 'abcdef') {
    const id = `loc-common-table-${letter}`;
    assert.equal(seed.some((location) => location.id === id), false);
    assert.equal(svg.includes(`data-location-id="${id}"`), false);
    assert.equal(resolveLocationMap(seed, id), null);
  }
  assert.equal(roomMapMarkers(seed, 'loc-common-makerspace').length, 15);
  assert.equal(roomMapMarkers(seed, 'loc-advanced-makerspace').length, 11);
  assert.deepEqual(searchLocations(seed, 'work table'), []);
});
