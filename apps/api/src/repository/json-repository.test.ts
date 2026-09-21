import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import { JsonCatalogRepository } from './json-repository.js';
import { locationsFileSchema } from '@garage/shared';
import { updateLocationCatalog } from './location-updates.js';

const legacy = {
  id: 'itm-saw', name: 'Saw', kind: 'equipment', categoryId: 'cat-tools',
  locationId: 'loc-shop', tags: [], goodFor: [], status: 'available',
  quantity: 1, trainingRequired: 'none',
};
const multi = {
  id: 'itm-tape', name: 'Tape', kind: 'consumable', categoryIds: ['cat-tools', 'cat-wood'],
  locationId: 'loc-shop', tags: [], goodFor: [], stockLevel: 'low',
};

async function fixture(t: TestContext, items: unknown[]) {
  const dataDir = join(process.cwd(), `.json-repository-test-${randomUUID()}`);
  await mkdir(dataDir);
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const files = {
    'items.json': items,
    'locations.json': [{ id: 'loc-shop', name: 'Shop', kind: 'room', parentId: null }],
    'categories.json': [{ id: 'cat-tools', name: 'Tools' }, { id: 'cat-wood', name: 'Woodworking' }],
    'flags.json': [],
  };
  await Promise.all(Object.entries(files).map(([name, data]) =>
    writeFile(join(dataDir, name), JSON.stringify(data), 'utf8')));
  return { repository: new JsonCatalogRepository(dataDir), dataDir };
}

test('JSON reads migrate legacy items without rewriting and ordinary writes persist canonical arrays', async (t) => {
  const { repository, dataDir } = await fixture(t, [legacy, multi]);
  const path = join(dataDir, 'items.json');
  const original = await readFile(path, 'utf8');
  await repository.load();
  const items = await repository.getItems();
  assert.deepEqual(items.map((item) => item.categoryIds), [['cat-tools'], ['cat-tools', 'cat-wood']]);
  assert.deepEqual((await repository.getItem('itm-saw'))?.categoryIds, ['cat-tools']);
  assert.deepEqual((await repository.getItem('itm-tape'))?.categoryIds, ['cat-tools', 'cat-wood']);
  assert.ok(items.every((item) => !('categoryId' in item)));
  assert.equal(await readFile(path, 'utf8'), original);

  const tape = await repository.getItem('itm-tape');
  assert.ok(tape && tape.kind === 'consumable');
  await repository.saveItem({ ...tape, stockLevel: 'in-stock' });
  const persisted = JSON.parse(await readFile(path, 'utf8'));
  assert.ok(persisted.every((item: Record<string, unknown>) => !('categoryId' in item)));
  assert.deepEqual(persisted.map((item: { categoryIds: string[] }) => item.categoryIds), [
    ['cat-tools'], ['cat-tools', 'cat-wood'],
  ]);
  const reloaded = new JsonCatalogRepository(dataDir);
  await reloaded.load();
  assert.deepEqual(await reloaded.getItems(), await repository.getItems());
});

test('JSON item creation and bulk saves preserve all category assignments', async (t) => {
  const { repository, dataDir } = await fixture(t, []);
  await repository.load();
  const first = await repository.createItem({
    name: 'Tape', kind: 'consumable', stockLevel: 'low', categoryIds: ['cat-tools', 'cat-wood'],
    locationId: 'loc-shop', tags: [], goodFor: [],
  });
  const created = await repository.createItems([{
    name: 'Saw', kind: 'equipment', status: 'available', quantity: 1, trainingRequired: 'none',
    categoryIds: ['cat-tools', 'cat-wood'], locationId: 'loc-shop', tags: [], goodFor: [],
  }]);
  await repository.saveItems([first, ...created].map((item) => ({
    ...item, categoryIds: ['cat-wood', 'cat-tools'],
  })));
  const reloaded = new JsonCatalogRepository(dataDir);
  await reloaded.load();
  assert.deepEqual(await reloaded.getItems(), await repository.getItems());
});

test('JSON loading rejects unknown secondary references on retired items', async (t) => {
  const { repository } = await fixture(t, [{
    ...multi, categoryIds: ['cat-tools', 'cat-missing'], retiredAt: '2026-09-18T12:00:00.000Z',
  }]);
  await assert.rejects(repository.load(), /itm-tape has unknown categoryId: cat-missing/);
});

test('JSON location batches persist every marker and reload with stable ids', async (t) => {
  const { repository, dataDir } = await fixture(t, []);
  await repository.load();
  const first = await repository.createLocation({ name: 'A', kind: 'table', parentId: 'loc-shop' });
  const second = await repository.createLocation({ name: 'B', kind: 'table', parentId: 'loc-shop' });
  const updated = [first, second].map((location, index) => ({
    ...location, mapPosition: { roomId: 'loc-shop', mapId: 'common' as const, x: 0.2 + index * 0.1, y: 0.5 },
  }));
  await repository.saveLocations(updated);
  const reloaded = new JsonCatalogRepository(dataDir);
  await reloaded.load();
  assert.deepEqual((await reloaded.getLocations()).filter((location) => location.id !== 'loc-shop'), updated);
  await repository.saveLocations([first, second]);
  assert.ok((await repository.getLocations()).every((location) => !location.mapPosition));
});

test('JSON batch validation and disk failures leave all in-memory and persisted locations unchanged', async (t) => {
  const { repository, dataDir } = await fixture(t, []);
  await repository.load();
  const original = await repository.getLocations();
  const location = original[0]!;
  await assert.rejects(repository.saveLocations([
    { ...location, name: 'Changed' }, { ...location, id: 'missing' },
  ]), /Unknown location/);
  assert.deepEqual(await repository.getLocations(), original);
  const offline = `${dataDir}-offline`;
  await rename(dataDir, offline);
  try {
    await assert.rejects(repository.saveLocations([{ ...location, name: 'Changed' }]), /ENOENT/);
    assert.deepEqual(await repository.getLocations(), original);
    assert.deepEqual(JSON.parse(await readFile(join(offline, 'locations.json'), 'utf8')), original);
  } finally {
    await rename(offline, dataDir);
  }
});

test('location upgrades add staff storage and Table U once without resetting inventory or custom markers', async (t) => {
  const seed = locationsFileSchema.parse(JSON.parse(await readFile(
    new URL('../../../../data/seed/locations.json', import.meta.url), 'utf8',
  )));
  const { repository, dataDir } = await fixture(t, []);
  const original = seed.filter((location) => !['loc-table-u', 'loc-storage-closet', 'loc-basement-storage'].includes(location.id))
    .map((location) => location.id === 'loc-advanced-table-20'
      ? { ...location, name: 'Table Z', mapPosition: { roomId: 'loc-advanced-makerspace', mapId: 'advanced' as const, x: 0.1, y: 0.2 } }
      : location);
  original.push({ id: 'custom-closet', name: 'Storage Closet', kind: 'room', parentId: null });
  await writeFile(join(dataDir, 'locations.json'), JSON.stringify(original));
  await repository.load();
  const preview = await updateLocationCatalog(repository, seed, false);
  assert.equal(preview.length, 4);
  assert.deepEqual(await repository.getLocations(), original);
  await updateLocationCatalog(repository, seed, true);
  const updated = await repository.getLocations();
  const table = updated.find((location) => location.id === 'loc-advanced-table-20')!;
  assert.equal(table.name, 'Table T');
  assert.deepEqual(table.mapPosition, { roomId: 'loc-advanced-makerspace', mapId: 'advanced', x: 0.1, y: 0.2 });
  assert.equal(updated.find((location) => location.id === 'custom-closet')?.staffOnly, true);
  assert.equal(updated.filter((location) => location.name === 'Storage Closet').length, 1);
  assert.equal(updated.find((location) => location.id === 'loc-basement-storage')?.staffOnly, true);
  assert.ok(updated.some((location) => location.id === 'loc-table-u'));
  assert.deepEqual(await updateLocationCatalog(repository, seed, true), []);
  assert.deepEqual(await repository.getItems(), []);
});
