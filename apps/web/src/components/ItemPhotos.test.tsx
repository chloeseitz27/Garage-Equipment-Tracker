import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { MAX_PHOTO_BYTES, type Item } from '@garage/shared';
import { buildRecords } from '../search.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  Node: { configurable: true, value: dom.window.Node },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
});
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
const { ItemEditor } = await import('./ItemEditor.js');
const { ItemDetail } = await import('./ItemDetail.js');
const { SearchResults } = await import('./SearchResults.js');

const item: Item = {
  id: 'camera', name: 'Camera', kind: 'equipment', status: 'available',
  categoryIds: ['tools'], locationId: 'room', quantity: 1, trainingRequired: 'none',
  tags: [], goodFor: [], photoUrl: 'https://example.com/old-photo.jpg',
};
const catalog = {
  items: [item],
  locations: [{ id: 'room', name: 'Shop', kind: 'room' as const, parentId: null }],
  categories: [{ id: 'tools', name: 'Tools' }],
};
let root: Root;
let host: HTMLDivElement;
let router: ReturnType<typeof createMemoryRouter>;
let requests: Array<{ url: unknown; options?: RequestInit }>;
let respond: (url: unknown, options?: RequestInit) => Promise<Response>;
let saved: number;
let cancelled: number;
let revoked: string[];
const originalFetch = globalThis.fetch;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  requests = [];
  saved = 0;
  cancelled = 0;
  revoked = [];
  URL.createObjectURL = () => 'blob:photo-preview';
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  respond = async (url, options) => url === '/api/photos'
    ? Response.json({ photoUrl: '/api/photos/saved.webp' }, { status: 201 })
    : Response.json(JSON.parse(String(options?.body)));
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return respond(url, options);
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  router?.dispose();
  host.remove();
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});
after(() => dom.window.close());

const renderEditor = async (editing: Item | null = item): Promise<void> => {
  router = createMemoryRouter([{
    path: '*',
    element: createElement(ItemEditor, {
      item: editing, locations: catalog.locations, categories: catalog.categories,
      onSaved: () => { saved++; }, onCancel: () => { cancelled++; },
    }),
  }]);
  await act(() => root.render(createElement(RouterProvider, { router })));
};
const choose = async (file = new dom.window.File(['image'], 'camera.png', { type: 'image/png' })): Promise<File> => {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]');
  assert.ok(input);
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(() => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
  return file;
};
const click = async (label: string): Promise<void> => {
  const button = [...host.querySelectorAll('button')].find((node) => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === label);
  assert.ok(button, `Missing ${label}`);
  await act(() => button.click());
};

test('a selected file previews locally; canceling does not upload and marks the draft as unsaved', async () => {
  await renderEditor();
  await choose();
  assert.equal(host.querySelector('img')?.getAttribute('src'), 'blob:photo-preview');
  const event = new dom.window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  await click('Cancel');
  assert.equal(cancelled, 1);
  assert.equal(requests.length, 0);
});

test('new-item image tile lives in the sidebar and opens the hidden chooser without submitting', async () => {
  await renderEditor(null);
  const tile = host.querySelector<HTMLButtonElement>('.image-upload');
  const input = host.querySelector<HTMLInputElement>('input[type="file"]');
  assert.ok(tile && input);
  assert.ok(host.querySelector('.editor-location .editor-image')?.contains(tile));
  assert.equal(host.querySelector('.editor-image h4')?.textContent, 'Image');
  assert.equal(tile.getAttribute('aria-label'), 'Upload image');
  assert.ok(tile.querySelector('.action-icon-add'));
  assert.equal(input.hidden, true);
  assert.doesNotMatch(host.textContent ?? '', /Photo URL|24 megapixels/);
  assert.match(host.querySelector('.editor-image .hint')?.textContent ?? '', /10 MB/);
  assert.equal(host.querySelector('.image-clear'), null);
  let opened = 0;
  input.addEventListener('click', (event) => { event.preventDefault(); opened++; });
  await act(() => tile.click());
  assert.equal(opened, 1);
  assert.equal(requests.length, 0);
  await choose();
  assert.equal(tile.getAttribute('aria-label'), 'Replace image');
  assert.equal(tile.querySelector('img')?.getAttribute('src'), 'blob:photo-preview');
  const clear = host.querySelector('.image-upload-area .image-clear');
  assert.ok(clear);
  assert.ok(clear.querySelector('.action-icon-cancel'));
  assert.equal(clear.textContent?.trim(), '');
  await click('Clear image');
  assert.equal(opened, 1);
  assert.equal(host.querySelector('.image-clear'), null);
  assert.equal(tile.getAttribute('aria-label'), 'Upload image');
});

test('upload failure retains the draft; item-write failure reuses the uploaded photo on retry', async () => {
  await renderEditor();
  const file = await choose();
  respond = async () => Response.json({ error: 'Photo storage offline' }, { status: 503 });
  await click('Save changes');
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.options?.body, file);
  assert.deepEqual(requests[0]?.options?.headers, { 'content-type': 'image/png' });
  assert.match(host.textContent ?? '', /Photo storage offline/);
  assert.equal(host.querySelector('img')?.getAttribute('src'), 'blob:photo-preview');
  assert.equal(saved, 0);

  respond = async (url) => url === '/api/photos'
    ? Response.json({ photoUrl: '/api/photos/saved.webp' }, { status: 201 })
    : Response.json({ error: 'Catalog offline' }, { status: 503 });
  await click('Save changes');
  assert.match(host.textContent ?? '', /Catalog offline/);
  assert.equal(host.querySelector('img')?.getAttribute('src'), '/api/photos/saved.webp');
  assert.deepEqual(revoked, ['blob:photo-preview']);

  respond = async (_url, options) => Response.json(JSON.parse(String(options?.body)));
  await click('Save changes');
  assert.equal(requests.filter((request) => request.url === '/api/photos').length, 2);
  const payload = JSON.parse(String(requests.at(-1)?.options?.body)) as Item;
  assert.equal(payload.id, item.id);
  assert.equal(payload.photoUrl, '/api/photos/saved.webp');
  assert.equal(saved, 1);
});

test('removing a photo clears the saved assignment without uploading', async () => {
  await renderEditor();
  await click('Clear image');
  assert.equal(host.querySelector('img'), null);
  await click('Save changes');
  assert.equal(requests.length, 1);
  assert.equal(JSON.parse(String(requests[0]?.options?.body)).photoUrl, undefined);
});

test('clearing a selected image during creation saves the item without uploading it', async () => {
  await renderEditor(null);
  const name = host.querySelector<HTMLInputElement>('.editor input');
  assert.ok(name);
  await act(() => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(name, 'Camera without photo');
    name.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await choose();
  assert.ok(host.querySelector('.image-upload-area .image-clear'));
  await click('Clear image');
  assert.equal(host.querySelector('.image-upload img'), null);
  assert.ok(host.querySelector('.image-upload .action-icon-add'));
  assert.equal(host.querySelector<HTMLInputElement>('input[type="file"]')?.value, '');
  assert.deepEqual(revoked, ['blob:photo-preview']);
  await click('Create item');
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, '/api/items');
  assert.equal(JSON.parse(String(requests[0]?.options?.body)).photoUrl, undefined);
  assert.equal(saved, 1);
});

test('unsupported or oversized selections show an error and keep the existing photo', async () => {
  await renderEditor();
  await choose(new dom.window.File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' }));
  assert.match(host.querySelector('[role="alert"]')?.textContent ?? '', /JPEG, PNG, or WebP/);
  const oversized = new dom.window.File(['image'], 'image.png', { type: 'image/png' });
  Object.defineProperty(oversized, 'size', { value: MAX_PHOTO_BYTES + 1 });
  await choose(oversized);
  assert.match(host.querySelector('[role="alert"]')?.textContent ?? '', /10 MB/);
  assert.equal(host.querySelector('img')?.getAttribute('src'), item.photoUrl);
  assert.equal(requests.length, 0);
});

test('item details show photos, report load failures and recover when the source changes', async () => {
  const renderDetail = async (photoUrl: string): Promise<void> => {
    const record = buildRecords({ ...catalog, items: [{ ...item, photoUrl }] })[0]!;
    await act(() => root.render(createElement(ItemDetail, { record, onClose: () => {} })));
  };
  await renderDetail(item.photoUrl!);
  const image = host.querySelector('img');
  assert.equal(image?.alt, 'Photo of Camera');
  await act(() => image?.dispatchEvent(new dom.window.Event('error')));
  assert.equal(host.querySelector('[role="status"]')?.textContent, 'Photo unavailable.');
  await renderDetail('/api/photos/new.webp');
  assert.equal(host.querySelector('img')?.getAttribute('src'), '/api/photos/new.webp');
});

test('search results use small thumbnails for uploads and fall back to the full photo once', async () => {
  const uploaded = '/api/photos/11111111-1111-4111-8111-111111111111.webp';
  const records = buildRecords({
    ...catalog,
    items: [{ ...item, photoUrl: uploaded }, { ...item, id: 'external', photoUrl: 'https://example.com/old-photo.jpg' }],
  });
  await act(() => root.render(createElement(SearchResults, { records, query: '', selectedId: null, onSelect: () => {} })));
  const [thumbnail, external] = [...host.querySelectorAll<HTMLImageElement>('.thumb img')];
  assert.equal(thumbnail?.getAttribute('src'), '/api/photos/11111111-1111-4111-8111-111111111111.thumb.webp');
  assert.equal(thumbnail?.getAttribute('loading'), 'lazy');
  assert.equal(external?.getAttribute('src'), 'https://example.com/old-photo.jpg');
  await act(() => thumbnail?.dispatchEvent(new dom.window.Event('error')));
  assert.equal(thumbnail?.getAttribute('src'), uploaded);
  await act(() => thumbnail?.dispatchEvent(new dom.window.Event('error')));
  assert.equal(thumbnail?.getAttribute('src'), uploaded);
});
