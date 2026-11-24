import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import sharp from 'sharp';
import { MAX_PHOTO_BYTES, PHOTO_THUMBNAIL_SIZE, photoThumbnailUrl } from '@garage/shared';
import { config } from '../config.js';
import { LocalPhotoStore } from '../photos.js';
import { authRoutes } from './auth.js';
import { photoRoutes } from './photos.js';

let server: Server;
let base: string;
let directory: string;
let store: LocalPhotoStore;
let cookie: string;
let saves: number;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'garage-photos-test-'));
  store = new LocalPhotoStore(directory);
  saves = 0;
  const app = express();
  app.use(cookieParser());
  app.use('/api', photoRoutes({
    save: async (name, body) => { saves++; await store.save(name, body); },
    read: (name) => store.read(name),
  }));
  app.use(express.json());
  app.use('/api/auth', authRoutes());
  app.use((_error: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: 'Storage unavailable' });
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passphrase: config.staffPassphrase }),
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie')!.split(';')[0]!;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
});

const upload = (body: Buffer, type = 'image/png', authenticated = true): Promise<Response> =>
  fetch(`${base}/api/photos`, {
    method: 'POST',
    headers: { 'content-type': type, ...(authenticated ? { cookie } : {}) },
    body: new Uint8Array(body),
  });

test('anonymous uploads are rejected before validation or storage', async () => {
  const response = await upload(Buffer.alloc(MAX_PHOTO_BYTES + 1), 'image/png', false);
  assert.equal(response.status, 401);
  assert.equal(saves, 0);
});

test('photos are resized, metadata-stripped, persisted and readable anonymously', async () => {
  const source = await sharp({
    create: { width: 2200, height: 1100, channels: 3, background: '#336699' },
  }).png().withMetadata().toBuffer();
  const response = await upload(source);
  assert.equal(response.status, 201);
  const { photoUrl } = await response.json() as { photoUrl: string };
  assert.match(photoUrl, /^\/api\/photos\/[0-9a-f-]+\.webp$/);
  const read = await fetch(`${base}${photoUrl}`);
  assert.equal(read.status, 200);
  assert.equal(read.headers.get('content-type'), 'image/webp');
  assert.equal(read.headers.get('x-content-type-options'), 'nosniff');
  const bytes = Buffer.from(await read.arrayBuffer());
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.width, 1920);
  assert.equal(metadata.height, 960);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  const name = photoUrl.split('/').at(-1)!;
  assert.deepEqual(await new LocalPhotoStore(directory).read(name), bytes);
});

test('unsupported, empty, oversized, corrupt and mislabeled files never reach storage', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
  for (const [body, type, status] of [
    [Buffer.from('<svg/>'), 'image/svg+xml', 415],
    [Buffer.alloc(0), 'image/png', 400],
    [Buffer.alloc(MAX_PHOTO_BYTES + 1), 'image/png', 413],
    [Buffer.from('not an image'), 'image/jpeg', 400],
    [png, 'image/jpeg', 400],
  ] as const) {
    const response = await upload(body, type);
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json() as { error: string }).error, 'string');
  }
  assert.equal(saves, 0);
});

test('photos above 5 MB are accepted and the transport limit is exactly 10 MB', async () => {
  const source = await sharp(Buffer.alloc(2048 * 1024 * 3, 123), {
    raw: { width: 2048, height: 1024, channels: 3 },
  }).png({ compressionLevel: 0 }).toBuffer();
  assert.ok(source.length > 5 * 1024 * 1024 && source.length < 10 * 1024 * 1024);
  assert.equal((await upload(source)).status, 201);
  const atLimit = await upload(Buffer.alloc(10 * 1024 * 1024));
  assert.equal(atLimit.status, 400);
  assert.match((await atLimit.json() as { error: string }).error, /could not be decoded/);
  assert.equal((await upload(Buffer.alloc(10 * 1024 * 1024 + 1))).status, 413);
  // One accepted upload stores the photo and its thumbnail.
  assert.equal(saves, 2);
});

test('uploads store a small square thumbnail served with the same immutable caching', async () => {
  const source = await sharp({
    create: { width: 2200, height: 1100, channels: 3, background: '#336699' },
  }).png().toBuffer();
  const { photoUrl } = await (await upload(source)).json() as { photoUrl: string };
  const thumbnailUrl = photoThumbnailUrl(photoUrl);
  assert.equal(thumbnailUrl, photoUrl.replace(/\.webp$/, '.thumb.webp'));
  const read = await fetch(`${base}${thumbnailUrl}`);
  assert.equal(read.status, 200);
  assert.equal(read.headers.get('content-type'), 'image/webp');
  assert.equal(read.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const bytes = Buffer.from(await read.arrayBuffer());
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.width, PHOTO_THUMBNAIL_SIZE);
  assert.equal(metadata.height, PHOTO_THUMBNAIL_SIZE);
  const full = Buffer.from(await (await fetch(`${base}${photoUrl}`)).arrayBuffer());
  assert.ok(bytes.length < full.length / 2);
  assert.equal(photoThumbnailUrl('https://example.com/photo.jpg'), 'https://example.com/photo.jpg');
});

test('photos uploaded before thumbnails existed get one generated and stored on first request', async () => {
  const name = '11111111-1111-4111-8111-111111111111.webp';
  await store.save(name, await sharp({
    create: { width: 800, height: 400, channels: 3, background: 'white' },
  }).webp().toBuffer());
  const thumbnailName = name.replace(/\.webp$/, '.thumb.webp');
  assert.equal(await store.read(thumbnailName), null);
  const read = await fetch(`${base}/api/photos/${thumbnailName}`);
  assert.equal(read.status, 200);
  assert.equal((await sharp(Buffer.from(await read.arrayBuffer())).metadata()).width, PHOTO_THUMBNAIL_SIZE);
  assert.ok(await store.read(thumbnailName));
  assert.equal((await fetch(`${base}/api/photos/22222222-2222-4222-8222-222222222222.thumb.webp`)).status, 404);
});

test('a failed thumbnail write does not fail an otherwise successful upload', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const save = store.save.bind(store);
  store.save = async (name, body) => {
    if (name.endsWith('.thumb.webp')) throw new Error('Thumbnail storage offline');
    await save(name, body);
  };
  const source = await sharp({ create: { width: 400, height: 400, channels: 3, background: 'white' } }).png().toBuffer();
  const response = await upload(source);
  assert.equal(response.status, 201);
  const { photoUrl } = await response.json() as { photoUrl: string };
  assert.equal((await fetch(`${base}${photoThumbnailUrl(photoUrl)}`)).status, 200);
});

test('missing and invalid names return 404; storage failures are not disguised as missing photos', async () => {
  assert.equal((await fetch(`${base}/api/photos/not-a-photo.webp`)).status, 404);
  assert.equal((await fetch(`${base}/api/photos/00000000-0000-4000-8000-000000000000.webp`)).status, 404);
  await assert.rejects(store.read('../private-file'), /Invalid stored photo name/);
  store.read = async () => { throw new Error('Access denied'); };
  assert.equal((await fetch(`${base}/api/photos/00000000-0000-4000-8000-000000000000.webp`)).status, 500);
  store.save = async () => { throw new Error('Storage offline'); };
  const source = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
  assert.equal((await upload(source)).status, 500);
});
