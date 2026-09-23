import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assignLocationIdentities, childLocationKinds, locationHierarchyProblem,
  nextLocationLetter, prepareLocation, surfaceLocationId,
} from './location-hierarchy.js';
import { formatLocationPath, getLocationPath, locationCodeFromPath } from './location.js';
import { findCatalogProblems } from './integrity.js';
import type { Location } from './types.js';

const base: Location[] = [
  { id: 'room', name: 'Common', kind: 'room', parentId: null },
  { id: 'desk', name: 'Desk A', kind: 'desk', parentId: 'room', letter: 'A' },
  { id: 'station', name: 'Roland', kind: 'station', parentId: 'room', letter: 'B' },
  { id: 'drawer', name: 'Drawer 3', kind: 'drawer', parentId: 'desk', number: 3 },
  { id: 'bin', name: 'Bin 1', kind: 'bin', parentId: 'drawer', number: 1 },
  { id: 'shelf', name: 'Shelf 2', kind: 'shelf', parentId: 'desk', number: 2 },
];

test('levels restrict root, room, and container children without allowing nested rooms', () => {
  assert.deepEqual(childLocationKinds(base, null), ['room']);
  assert.deepEqual(childLocationKinds(base, 'room'), ['table', 'station', 'desk', 'workbench', 'cabinet']);
  assert.deepEqual(childLocationKinds(base, 'desk'), ['drawer', 'bin', 'shelf']);
  assert.deepEqual(childLocationKinds(base, 'drawer'), ['drawer', 'bin', 'shelf']);
  for (const [kind, parentId] of [['room', 'room'], ['bin', 'room'], ['table', 'desk'], ['station', 'drawer'], ['drawer', null]] as const) {
    assert.ok(locationHierarchyProblem({ id: 'new', kind, parentId }, base));
  }
  assert.equal(locationHierarchyProblem({ id: 'new', kind: 'cabinet', parentId: 'room' }, base), null);
  assert.equal(locationHierarchyProblem({ id: 'new', kind: 'shelf', parentId: 'drawer' }, base), null);
});

test('surface names default from type and next available letter but allow custom names', () => {
  const table = prepareLocation({ kind: 'table', parentId: 'room' }, base, 'new').location;
  assert.equal(table.name, 'Table B');
  assert.equal(table.letter, 'B');
  const named = prepareLocation({ name: 'Laser', kind: 'station', parentId: 'room' }, base, 'new').location;
  assert.equal(named.name, 'Laser');
  assert.equal(named.letter, undefined);
  assert.equal(formatLocationPath(getLocationPath([...base, named], 'new')), 'Common → Laser');
  const changedType = prepareLocation({ ...base[1]!, kind: 'cabinet' }, base, 'desk', base[1]).location;
  assert.equal(changedType.name, 'Cabinet A');
  assert.equal(changedType.letter, 'A');
});

test('storage numbers are allocated across all kinds and nested containers under the same surface', () => {
  const prepared = prepareLocation({ name: 'User-supplied name', kind: 'bin', parentId: 'drawer', number: 1 }, base, 'new').location;
  assert.equal(prepared.number, 4);
  assert.equal(prepared.name, 'Bin 4');
  assert.equal(surfaceLocationId([...base, prepared], prepared.id), 'desk');
  assert.equal(formatLocationPath(getLocationPath(base, 'drawer')), 'Common → Desk A → Drawer 3 (A3)');
  const other = prepareLocation({ kind: 'drawer', parentId: 'station' }, base, 'other').location;
  assert.equal(other.number, 1);
  assert.equal(other.name, 'Drawer 1');
});

test('storage pins are removed from identity projections and prepared writes without changing surface placement', () => {
  const pin = { roomId: 'room', mapId: 'common' as const, x: 0.2, y: 0.3 };
  const original = base.map((location) => ['desk', 'drawer', 'bin'].includes(location.id) ? { ...location, mapPosition: pin } : location);
  const identified = assignLocationIdentities(original);
  assert.deepEqual(identified.find((location) => location.id === 'desk')?.mapPosition, pin);
  assert.equal(identified.find((location) => location.id === 'drawer')?.mapPosition, undefined);
  assert.equal(identified.find((location) => location.id === 'bin')?.mapPosition, undefined);
  const prepared = prepareLocation({ kind: 'drawer', parentId: 'desk', mapPosition: pin }, identified, 'new');
  assert.equal(prepared.location.mapPosition, undefined);
  assert.equal(original.find((location) => location.id === 'drawer')?.mapPosition, pin);
});
test('same-surface edits retain numbers and ignore client attempts to rename or renumber storage', () => {
  const previous = base[3]!;
  const prepared = prepareLocation({ ...previous, name: 'Custom', number: 99, kind: 'shelf' }, base, previous.id, previous).location;
  assert.equal(prepared.name, 'Shelf 3');
  assert.equal(prepared.number, 3);
  const movedWithin = prepareLocation({ ...base[4]!, parentId: 'desk' }, base, 'bin', base[4]).location;
  assert.equal(movedWithin.number, 1);
});

test('moving a storage subtree to another surface reallocates its numbers as a unit', () => {
  const occupied: Location = { id: 'occupied', name: 'Bin 1', parentId: 'station', kind: 'bin', number: 1 };
  const prepared = prepareLocation({ ...base[3]!, parentId: 'station' }, [...base, occupied], 'drawer', base[3]);
  assert.equal(prepared.location.number, 2);
  assert.equal(prepared.location.name, 'Drawer 2');
  assert.deepEqual(prepared.descendants.map((child) => [child.id, child.number, child.name]), [['bin', 3, 'Bin 3']]);
});

test('legacy identity assignment preserves table letters, honors generated names, and is idempotent', () => {
  const legacy: Location[] = [
    { id: 'room', name: 'Room', kind: 'room', parentId: null },
    { id: 'roland', name: 'Roland', kind: 'zone', parentId: 'room' },
    { id: 'desk', name: 'Desk A', kind: 'table', parentId: 'room' },
    { id: 'drawer', name: 'Drawer 3', kind: 'drawer', parentId: 'desk' },
    { id: 'bin', name: 'My bin', kind: 'bin', parentId: 'desk' },
  ];
  const result = assignLocationIdentities(legacy);
  assert.equal(result.find((location) => location.id === 'desk')?.letter, 'A');
  assert.equal(result.find((location) => location.id === 'roland')?.letter, undefined);
  assert.equal(result.find((location) => location.id === 'drawer')?.number, 3);
  assert.equal(result.find((location) => location.id === 'bin')?.name, 'Bin 1');
  assert.deepEqual(assignLocationIdentities(result), result);
  assert.equal(legacy[4]?.name, 'My bin');
  assert.equal(nextLocationLetter(Array.from({ length: 26 }, (_, i) => ({ ...base[1]!, id: String(i), letter: String.fromCharCode(65 + i) }))), 'AA');
});

test('stations release legacy letters without changing names, child numbers, or other surface letters', () => {
  const child: Location = { id: 'station-drawer', name: 'Drawer 3', kind: 'drawer', parentId: 'station', number: 3 };
  const nextDesk: Location = { id: 'desk-b', name: 'Desk B', kind: 'desk', parentId: 'room', letter: 'B' };
  const original = [...base, child, nextDesk];
  assert.deepEqual(findCatalogProblems({ items: [], categories: [], locations: original }), []);
  const identified = assignLocationIdentities(original);
  assert.equal(identified.find((location) => location.id === 'station')?.name, 'Roland');
  assert.equal(identified.find((location) => location.id === 'station')?.letter, undefined);
  assert.equal(identified.find((location) => location.id === 'station-drawer')?.number, 3);
  assert.equal(identified.find((location) => location.id === 'desk-b')?.letter, 'B');
  assert.equal(locationCodeFromPath(getLocationPath(original, 'station-drawer')), undefined, 'Old cached station letters are not displayed');
  assert.equal(formatLocationPath(getLocationPath(identified, 'station-drawer')), 'Common → Roland → Drawer 3');
  assert.equal(prepareLocation({ kind: 'bin', parentId: 'station' }, identified, 'new-bin').location.number, 4);
  assert.equal(base[2]?.letter, 'B', 'Normalization does not mutate input records');
  const converted = prepareLocation({ ...base[1]!, kind: 'station', name: 'Soldering station' }, base, 'desk', base[1]).location;
  assert.equal(converted.letter, undefined);
  assert.equal(converted.name, 'Soldering station');
});

test('explicit duplicate letters or numbers are rejected, not silently reassigned', () => {
  assert.throws(() => assignLocationIdentities([...base, { ...base[1]!, id: 'duplicate' }]), /Duplicate location letter/);
  assert.throws(() => assignLocationIdentities([...base, { ...base[3]!, id: 'duplicate' }]), /Duplicate storage number/);
});
