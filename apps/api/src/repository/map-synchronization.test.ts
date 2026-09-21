import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Location } from '@garage/shared';
import { planMapSynchronization } from './map-synchronization.js';

const room: Location = { id: 'room', name: 'Common Makerspace', kind: 'room', parentId: null, mapId: 'common' };
const table: Location = {
  id: 'stable-table', name: 'Table A', kind: 'table', parentId: room.id,
  mapPosition: { roomId: room.id, mapId: 'common', x: 0.7, y: 0.1 },
};
const station: Location = { ...table, id: 'station', name: 'Laser', kind: 'zone' };
const added: Location = { ...table, id: 'stable-new-table', name: 'Table B' };

test('map synchronization changes names and positions by stable id, leaving other data untouched', () => {
  const original: Location[] = [
    room,
    { ...table, name: 'Previous table name', staffOnly: true, mapPosition: { ...table.mapPosition!, x: 0.2 } },
    { ...station, name: 'Custom station label', mapPosition: { ...station.mapPosition!, y: 0.5 } },
    { id: 'child', name: 'Drawer 1', parentId: table.id, kind: 'bin' },
    { id: 'storage', name: 'Storage Closet', parentId: null, kind: 'room', staffOnly: true },
  ];
  const before = structuredClone(original);
  const plan = planMapSynchronization(original, [room, table, station, added]);
  assert.deepEqual(plan.updated.map((location) => location.id), [table.id, station.id]);
  assert.equal(plan.updated[0]?.name, 'Table A');
  assert.equal(plan.updated[0]?.staffOnly, true);
  assert.equal(plan.updated[0]?.parentId, room.id);
  assert.deepEqual(plan.updated[0]?.mapPosition, table.mapPosition);
  assert.equal(plan.updated[1]?.name, 'Custom station label');
  assert.deepEqual(plan.created, [added]);
  assert.deepEqual(original, before);
  const next = [...original.map((location) => plan.updated.find((updated) => updated.id === location.id) ?? location), ...plan.created];
  assert.deepEqual(planMapSynchronization(next, [room, table, station, added]), { updated: [], created: [] });
  assert.equal(next.find((location) => location.id === 'child')?.parentId, table.id);
});

test('map synchronization rejects changed rooms or parents instead of moving records implicitly', () => {
  assert.throws(() => planMapSynchronization([{ ...room, mapId: 'advanced' }], [table]), /room\/floor plan/);
  assert.throws(() => planMapSynchronization([room, { ...table, parentId: 'other-parent' }], [table]), /different parent/);
  assert.throws(() => planMapSynchronization([], [table]), /room\/floor plan/);
});

test('equivalent coordinate objects do not require a write just because property order differs', () => {
  const current = { ...table, mapPosition: { x: 0.7, y: 0.1, mapId: 'common' as const, roomId: room.id } };
  assert.deepEqual(planMapSynchronization([room, current], [room, table]), { updated: [], created: [] });
});
