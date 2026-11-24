import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { BlobServiceClient } from '@azure/storage-blob';
import sharp from 'sharp';
import { AzurePhotoStore, normalizePhoto } from './photos.js';

test('Azure storage uses conditional private uploads and returns only actual missing blobs as null', async (t) => {
  const container = new BlobServiceClient('https://example.blob.core.windows.net').getContainerClient('photos');
  const blob = container.getBlockBlobClient(`${randomUUID()}.webp`);
  t.mock.method(container, 'getBlockBlobClient', () => blob);
  const upload = t.mock.method(blob, 'uploadData', async () => ({}));
  const bytes = Buffer.from('normalized image');
  t.mock.method(blob, 'downloadToBuffer', async () => bytes);
  const store = new AzurePhotoStore(container);
  const name = `${randomUUID()}.webp`;
  await store.save(name, bytes);
  assert.deepEqual(upload.mock.calls[0]?.arguments[1]?.conditions, { ifNoneMatch: '*' });
  assert.equal(upload.mock.calls[0]?.arguments[1]?.blobHTTPHeaders?.blobContentType, 'image/webp');
  assert.deepEqual(await store.read(name), bytes);
  t.mock.method(blob, 'downloadToBuffer', async () => { throw Object.assign(new Error('Missing'), { code: 'BlobNotFound' }); });
  assert.equal(await store.read(name), null);
  // downloadToBuffer probes with HEAD first; a missing blob then has status 404 but no error code.
  t.mock.method(blob, 'downloadToBuffer', async () => { throw Object.assign(new Error('Not found'), { statusCode: 404 }); });
  assert.equal(await store.read(name), null);
  t.mock.method(blob, 'downloadToBuffer', async () => { throw Object.assign(new Error('Denied'), { code: 'AuthorizationFailure' }); });
  await assert.rejects(store.read(name), /Denied/);
  t.mock.method(blob, 'uploadData', async () => { throw new Error('Offline'); });
  await assert.rejects(store.save(name, bytes), /Offline/);
});

test('oversized image dimensions and animated images are rejected', async () => {
  const large = await sharp({
    create: { width: 5000, height: 5000, channels: 3, background: 'white' },
  }).png().toBuffer();
  await assert.rejects(normalizePhoto(large, 'image/png'), /under 24 megapixels/);
  const frames = Buffer.alloc(2 * 2 * 3 * 2);
  frames.fill(255, 2 * 2 * 3);
  const animated = await sharp(frames, {
    raw: { width: 2, height: 4, channels: 3, pageHeight: 2 },
  }).webp().toBuffer();
  await assert.rejects(normalizePhoto(animated, 'image/webp'), /still/);
});
