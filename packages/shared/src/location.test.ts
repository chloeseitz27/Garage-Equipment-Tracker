import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatLocationPath,
  getLocationPath,
  searchLocations,
  wouldCreateCycle,
  type Location,
} from './index.js';

const locations: Location[] = [
  { id: 'room', name: 'Main Shop', parentId: null, kind: 'room' },
  { id: 'zone', name: 'Electronics Bench', parentId: 'room', kind: 'zone' },
  { id: 'shelf', name: 'Cabinet B', parentId: 'zone', kind: 'shelf' },
  { id: 'bin', name: 'Bin 4', parentId: 'shelf', kind: 'bin' },
  { id: 'lonely-room', name: 'Media Room', parentId: null, kind: 'room' },
];

test('derives a full path from a leaf bin', () => {
  assert.equal(
    formatLocationPath(getLocationPath(locations, 'bin')),
    'Main Shop \u2192 Electronics Bench \u2192 Cabinet B \u2192 Bin 4',
  );
});

test('derives a path for an item attached at any depth', () => {
  assert.equal(formatLocationPath(getLocationPath(locations, 'zone')), 'Main Shop \u2192 Electronics Bench');
});

test('a root node is a valid one-element path', () => {
  assert.equal(formatLocationPath(getLocationPath(locations, 'lonely-room')), 'Media Room');
});

test('an unknown location yields an empty path rather than throwing', () => {
  assert.deepEqual(getLocationPath(locations, 'nope'), []);
});

test('a cycle terminates instead of hanging', () => {
  const cyclic: Location[] = [
    { id: 'a', name: 'A', parentId: 'b', kind: 'zone' },
    { id: 'b', name: 'B', parentId: 'a', kind: 'zone' },
  ];
  assert.equal(getLocationPath(cyclic, 'a').length, 2);
});

test('moving a location under itself is a cycle', () => {
  assert.equal(wouldCreateCycle(locations, 'zone', 'zone'), true);
});

test('moving a location under its own descendant is a cycle', () => {
  assert.equal(wouldCreateCycle(locations, 'zone', 'bin'), true);
});

test('moving a location to a root or an unrelated branch is allowed', () => {
  assert.equal(wouldCreateCycle(locations, 'shelf', null), false);
  assert.equal(wouldCreateCycle(locations, 'shelf', 'lonely-room'), false);
});

test('moving a parent under a sibling subtree is allowed', () => {
  assert.equal(wouldCreateCycle(locations, 'bin', 'room'), false);
});

/* --- Type-to-find --- */

test('an empty query returns options rather than nothing', () => {
  assert.equal(searchLocations(locations, '').length, locations.length);
});

test('matching runs over the full breadcrumb, not just the node name', () => {
  // "Electronics Bench" is an ancestor of the bin, not part of its own name.
  const matches = searchLocations(locations, 'electronics');
  assert.deepEqual(
    matches.map((match) => match.id),
    ['zone', 'shelf', 'bin'],
  );
});

test('every token must match, so extra words narrow the result', () => {
  assert.deepEqual(
    searchLocations(locations, 'cabinet bin').map((match) => match.id),
    ['bin'],
  );
});

test('matching is word-prefix, so "bin" does not match "Cabinet"', () => {
  // Plain substring matching finds "bin" inside "ca-BIN-et", which is a
  // confusing result in a space with nodes named both Bin and Cabinet.
  assert.deepEqual(
    searchLocations(locations, 'bin').map((match) => match.id),
    ['bin'],
  );
});

test('a prefix of a word matches that word', () => {
  assert.deepEqual(
    searchLocations(locations, 'elec').map((match) => match.id),
    ['zone', 'shelf', 'bin'],
  );
});

test('token order does not matter', () => {
  const forward = searchLocations(locations, 'bin 4').map((match) => match.id);
  const reversed = searchLocations(locations, '4 bin').map((match) => match.id);

  assert.deepEqual(forward, reversed);
  assert.deepEqual(forward, ['bin']);
});

test('matching is case insensitive', () => {
  assert.deepEqual(
    searchLocations(locations, 'CABINET B').map((match) => match.id),
    searchLocations(locations, 'cabinet b').map((match) => match.id),
  );
});

test('a query matching nothing returns an empty list', () => {
  assert.deepEqual(searchLocations(locations, 'zzzz'), []);
});

test('results are capped by the limit', () => {
  assert.equal(searchLocations(locations, '', 2).length, 2);
});
