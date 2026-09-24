import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JsonCatalogRepository } from './repository/json-repository.js';
import { serializeLocationWrite } from './location-write.js';

test('the location writer queue serializes concurrent allocations and releases after errors', async () => {
  const repository = new JsonCatalogRepository('unused');
  let number = 0;
  const allocate = () => serializeLocationWrite(repository, async () => {
    const previous = number;
    await new Promise((resolve) => setTimeout(resolve, 5));
    number = previous + 1;
    return number;
  });
  const allocated = await Promise.all([allocate(), allocate(), allocate()]);
  assert.deepEqual(allocated, [1, 2, 3]);
  await assert.rejects(serializeLocationWrite(repository, async () => { throw new Error('Write failed'); }), /Write failed/);
  assert.equal(await allocate(), 4);
});
