import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Location } from '@garage/shared';
import { planMapSynchronization } from './map-synchronization.js';

const room: Location = { id: 'room', name: 'Common Makerspace', kind: 'room', parentId: null, mapId: 'common' };
const table: Location = {
  id: 'stable-table', name: 'Table A', kind: 'table', parentId: room.id,
};
const station: Location = { ...table, id: 'station', name: 'Laser', kind: 'zone' };
const added: Location = { ...table, id: 'stable-new-table', name: 'Table B' };

test('map synchronization changes drawn surface names by stable id, leaving other data untouched', () => {
  const original: Location[] = [
    room,
    { ...table, name: 'Previous table name', staffOnly: true },
    { ...station, name: 'Custom station label' },
    { id: 'child', name: 'Drawer 1', parentId: table.id, kind: 'bin' },
    { id: 'storage', name: 'Storage Closet', parentId: null, kind: 'room', staffOnly: true },
  ];
  const before = structuredClone(original);
  const plan = planMapSynchronization(original, [room, table, station, added]);
  assert.deepEqual(plan.updated.map((location) => location.id), [table.id]);
  assert.equal(plan.updated[0]?.name, 'Table A');
  assert.equal(plan.updated[0]?.staffOnly, true);
  assert.equal(plan.updated[0]?.parentId, room.id);
  assert.deepEqual(plan.created, [added]);
  assert.deepEqual(original, before);
  const next = [...original.map((location) => plan.updated.find((updated) => updated.id === location.id) ?? location), ...plan.created];
  assert.deepEqual(planMapSynchronization(next, [room, table, station, added]), { updated: [], created: [] });
  assert.equal(next.find((location) => location.id === 'child')?.parentId, table.id);
});

test('map synchronization rejects changed rooms or parents instead of moving records implicitly', () => {
  assert.throws(() => planMapSynchronization([{ ...room, mapId: 'advanced' }], [room, table]), /room\/floor plan/);
  assert.throws(() => planMapSynchronization([room, { ...table, parentId: 'other-parent' }], [room, table]), /different parent/);
  assert.throws(() => planMapSynchronization([], [room, table]), /room\/floor plan/);
});
