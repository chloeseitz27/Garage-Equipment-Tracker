import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatLocationPath, getLocationPath, type Location } from './index.js';

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
