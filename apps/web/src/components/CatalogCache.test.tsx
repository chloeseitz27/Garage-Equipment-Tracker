import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import type { CatalogResponse } from '@garage/shared';
import { CATALOG_CACHE_KEY } from '../catalog-cache.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  Node: { configurable: true, value: dom.window.Node },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
});
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
const { App } = await import('../App.js');

const catalogFixture = (): CatalogResponse => ({
  items: [{
    id: 'camera', name: 'Inspection camera', kind: 'equipment', status: 'available',
    categoryIds: ['tools', 'electronics'], locationId: 'bench', quantity: 1, trainingRequired: 'orientation',
    tags: [], goodFor: [], safetyNotes: 'Ask staff before use.',
  }],
  locations: [
    { id: 'room', name: 'Shop', kind: 'room', parentId: null, mapId: 'common' },
    { id: 'bench', name: 'Bench', kind: 'workbench', parentId: 'room',
      mapPosition: { roomId: 'room', mapId: 'common', x: 0.4, y: 0.6 } },
  ],
  categories: [{ id: 'tools', name: 'Tools' }, { id: 'electronics', name: 'Electronics' }],
});

const originalFetch = globalThis.fetch;
let root: Root;
let host: HTMLDivElement;
let router: ReturnType<typeof createMemoryRouter>;
let remote: CatalogResponse;
let respond: () => Promise<Response>;
let reads: number;
let writes: number;
let requestOptions: RequestInit | undefined;

beforeEach(() => {
  dom.window.localStorage.clear();
  remote = catalogFixture();
  reads = 0;
  writes = 0;
  respond = async () => Response.json(remote);
  globalThis.fetch = async (url, options) => {
    if (url === '/api/catalog') {
      reads++;
      requestOptions = options;
      return respond();
    }
    if (url === '/api/auth/session') return Response.json({ staff: true });
    if (url === '/api/items/camera' && options?.method === 'PUT') {
      writes++;
      remote.items = [JSON.parse(String(options.body))];
      return Response.json(remote.items[0]);
    }
    throw new Error(`Unexpected test request: ${url}`);
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
});
after(() => dom.window.close());

const render = async (path = '/'): Promise<void> => {
  router = createMemoryRouter([{ path: '*', element: createElement(App) }], { initialEntries: [path] });
  await act(() => root.render(createElement(RouterProvider, { router })));
};
const saveSnapshot = (catalog: CatalogResponse, fetchedAt = Date.now()): string => {
  const value = JSON.stringify({ version: 2, fetchedAt, catalog });
  dom.window.localStorage.setItem(CATALOG_CACHE_KEY, value);
  return value;
};
const button = (text: string): HTMLButtonElement => {
  const result = [...host.querySelectorAll('button')]
    .find((node) => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === text);
  assert.ok(result, `Missing button: ${text}`);
  return result;
};
const click = async (node: HTMLElement): Promise<void> => { await act(() => node.click()); };
const event = async (type: string): Promise<void> => {
  await act(() => window.dispatchEvent(new dom.window.Event(type)));
};
const typeInput = async (input: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
  const prototype = input instanceof dom.window.HTMLTextAreaElement
    ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!;
  await act(() => {
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
};
const typeName = async (name: string): Promise<void> => {
  const input = host.querySelector<HTMLInputElement>('.editor input');
  assert.ok(input);
  await typeInput(input, name);
};
test('saved data renders while loading; failure leaves browsing visible and a retry recovers', async () => {
  saveSnapshot(catalogFixture(), Date.now() - 600_000);
  let reject!: (error: Error) => void;
  respond = () => new Promise<Response>((_resolve, fail) => { reject = fail; });
  await render();
  assert.match(host.textContent ?? '', /Inspection camera/);
  assert.match(host.textContent ?? '', /Showing saved catalog data/);
  assert.match(host.textContent ?? '', /safety\/training information may be out of date/);
  assert.ok(host.querySelector('.catalog-status'));
  assert.equal(host.querySelector('.catalog-status button'), null);
  await act(() => reject(new Error('Offline')));
  assert.match(host.textContent ?? '', /Catalog refresh failed: Offline/);
  assert.ok(host.querySelector('.search'));
  remote.items[0]!.name = 'Updated camera';
  respond = async () => Response.json(remote);
  await click(button('Refresh catalog'));
  assert.match(host.textContent ?? '', /Updated camera/);
  assert.doesNotMatch(host.textContent ?? '', /Catalog refresh failed|Showing saved catalog data/);
  assert.equal(host.querySelector('.catalog-status'), null);
  assert.equal(requestOptions?.cache, 'no-store');
  assert.ok(requestOptions?.signal instanceof AbortSignal);
});

test('a failed first visit displays an actionable error and clears it after retry', async () => {
  respond = async () => { throw new Error('No connection'); };
  await render();
  assert.match(host.textContent ?? '', /No saved catalog is available/);
  respond = async () => Response.json(remote);
  await click(button('Retry catalog'));
  assert.match(host.textContent ?? '', /Inspection camera/);
  assert.doesNotMatch(host.textContent ?? '', /No connection|No saved catalog/);
});

test('the refresh icon is labelled, indicates progress, and updates the saved catalog', async () => {
  await render();
  const refreshButton = button('Refresh catalog');
  assert.ok(refreshButton.closest('header .header-actions'));
  assert.ok(refreshButton.parentElement?.querySelector('.staff-bar'));
  assert.equal(host.querySelector('.catalog-status'), null);
  assert.equal(refreshButton.textContent, '');
  assert.equal(refreshButton.title, 'Refresh catalog');
  assert.equal(refreshButton.disabled, false);
  assert.equal(refreshButton.getAttribute('aria-busy'), 'false');
  const icon = refreshButton.querySelector('svg.action-icon-refresh');
  assert.ok(icon);
  assert.equal(icon.getAttribute('aria-hidden'), 'true');
  assert.equal(icon.getAttribute('focusable'), 'false');

  let finish!: (response: Response) => void;
  respond = () => new Promise<Response>((resolve) => { finish = resolve; });
  await click(refreshButton);
  assert.equal(reads, 2);
  assert.equal(button('Refreshing catalog...'), refreshButton);
  assert.equal(refreshButton.title, 'Refreshing catalog...');
  assert.equal(refreshButton.disabled, true);
  assert.equal(refreshButton.getAttribute('aria-busy'), 'true');
  await click(refreshButton);
  assert.equal(reads, 2);

  remote.items[0]!.name = 'Refreshed camera';
  await act(() => finish(Response.json(remote)));
  assert.equal(button('Refresh catalog'), refreshButton);
  assert.equal(refreshButton.title, 'Refresh catalog');
  assert.equal(refreshButton.disabled, false);
  assert.equal(refreshButton.getAttribute('aria-busy'), 'false');
  assert.match(host.textContent ?? '', /Refreshed camera/);
  const persisted = JSON.parse(dom.window.localStorage.getItem(CATALOG_CACHE_KEY)!);
  assert.equal(persisted.catalog.items[0].name, 'Refreshed camera');
});

test('cached staff pages warn about connectivity and never queue or pretend to save offline', async () => {
  saveSnapshot(catalogFixture());
  respond = async () => { throw new Error('Offline'); };
  const fetch = globalThis.fetch;
  globalThis.fetch = (url, options) => options?.method === 'PUT'
    ? Promise.reject(new Error('Save failed: offline')) : fetch(url, options);
  await render('/manage/items/camera/edit');
  assert.match(host.textContent ?? '', /nothing is queued offline/);
  await typeName('Offline draft');
  await click(button('Save changes'));
  assert.match(host.textContent ?? '', /Save failed: offline/);
  assert.equal(host.querySelector<HTMLInputElement>('.editor input')?.value, 'Offline draft');
  const saved = JSON.parse(dom.window.localStorage.getItem(CATALOG_CACHE_KEY)!);
  assert.equal(saved.catalog.items[0].name, 'Inspection camera');
  respond = async () => Response.json(remote);
  await click(button('Refresh catalog'));
  assert.doesNotMatch(host.textContent ?? '', /nothing is queued offline/);
  assert.equal(writes, 0);
});

test('saving an item invalidates persisted data and repopulates it with the updated response', async () => {
  await render('/manage/items/camera/edit');
  await typeName('Saved camera');
  let finish!: (response: Response) => void;
  respond = () => new Promise<Response>((resolve) => { finish = resolve; });
  await click(button('Save changes'));
  assert.equal(writes, 1);
  assert.equal(dom.window.localStorage.getItem(CATALOG_CACHE_KEY), null);
  assert.match(host.textContent ?? '', /Showing saved catalog data/);
  await act(() => finish(Response.json(remote)));
  assert.doesNotMatch(host.textContent ?? '', /Showing saved catalog data/);
  const persisted = JSON.parse(dom.window.localStorage.getItem(CATALOG_CACHE_KEY)!);
  assert.equal(persisted.catalog.items[0].name, 'Saved camera');
  assert.match(host.textContent ?? '', /Saved camera/);
});

test('focus and reconnection refresh, but a remote retirement cannot destroy an unsaved draft', async () => {
  await render('/manage/items/camera/edit');
  await typeName('Unsaved name');
  remote.items[0]!.retiredAt = '2026-09-18T00:00:00Z';
  await event('focus');
  assert.equal(reads, 2);
  assert.equal(host.querySelector<HTMLInputElement>('.editor input')?.value, 'Unsaved name');
  assert.match(host.textContent ?? '', /updates will appear after you save or discard/);
  await event('online');
  assert.equal(reads, 3);
  assert.equal(host.querySelector<HTMLInputElement>('.editor input')?.value, 'Unsaved name');
  await click(button('Cancel'));
  await click(button('Discard changes'));
  assert.equal(host.querySelector('.editor'), null);
  assert.match(host.querySelector('.item-table tbody')?.textContent ?? '', /No items in the catalog/);
  assert.equal(host.querySelector('a[href="/manage/recycle-bin"] .badge')?.textContent, '1');
});

test('cross-tab snapshots update the page without triggering a fetch/write feedback loop', async () => {
  await render('/maps');
  remote.locations[1]!.name = 'Other tab bench';
  const newValue = saveSnapshot(remote);
  await act(() => window.dispatchEvent(new dom.window.StorageEvent('storage', {
    key: CATALOG_CACHE_KEY, newValue, storageArea: dom.window.localStorage,
  })));
  assert.equal(reads, 1);
  const marker = host.querySelector<HTMLElement>('.map-marker[title="Other tab bench"]');
  assert.ok(marker);
  assert.equal(marker.style.left, '40%');
  assert.equal(marker.style.top, '60%');
  assert.match(host.textContent ?? '', /Showing saved catalog data/);
  await click(button('Refresh catalog'));
  assert.equal(reads, 2);
  assert.doesNotMatch(host.textContent ?? '', /Showing saved catalog data/);
});

test('background refresh preserves a category rename until it is cancelled', async () => {
  remote.categories.push({ id: 'empty', name: 'Empty category' });
  await render('/manage/categories');
  const row = [...host.querySelectorAll('li')].find((node) => node.textContent?.includes('Empty category'));
  assert.ok(row);
  const rename = row.querySelector<HTMLButtonElement>('button[aria-label="Rename Empty category"]');
  assert.ok(rename);
  await click(rename);
  const input = row.querySelector('input');
  assert.ok(input);
  await typeInput(input, 'Unsaved category name');
  remote.categories = remote.categories.filter((category) => category.id !== 'empty');
  await event('focus');
  assert.equal(input.isConnected, true);
  assert.equal(input.value, 'Unsaved category name');
  assert.match(host.textContent ?? '', /updates will appear after you save or discard/);
  await click(button('Cancel'));
  assert.doesNotMatch(host.textContent ?? '', /Empty category|updates will appear/);
});

test('bulk selections and pasted drafts both hold pending updates until cleared', async () => {
  await render('/manage/items?bulk=1');
  const selected = host.querySelector<HTMLInputElement>('.item-table tbody input[type="checkbox"]');
  assert.ok(selected);
  await click(selected);
  const category = host.querySelector<HTMLButtonElement>('.bulk-bar button[aria-label="Replace categories"]');
  assert.ok(category);
  await click(category);
  const panel = document.getElementById(category.getAttribute('aria-controls') ?? '');
  assert.ok(panel);
  const choices = [...panel.querySelectorAll<HTMLButtonElement>('.multi-filter-options button')];
  for (const choice of choices) await click(choice);
  const done = [...panel.querySelectorAll('button')].find((node) => node.textContent === 'Done');
  assert.ok(done);
  await click(done);
  const text = host.querySelector<HTMLTextAreaElement>('.bulk-entry-section textarea');
  assert.ok(text);
  await typeInput(text, 'New tool');
  remote.items[0]!.retiredAt = '2026-09-18T00:00:00Z';
  await event('focus');
  assert.equal(selected.checked, true);
  assert.equal(category.title, 'Tools, Electronics');
  assert.equal(text.value, 'New tool');
  assert.match(host.textContent ?? '', /updates will appear after you save or discard/);
  await click(selected);
  assert.match(host.querySelector('.item-table tbody')?.textContent ?? '', /Inspection camera/);
  await typeInput(text, '');
  assert.match(host.querySelector('.item-table tbody')?.textContent ?? '', /No items in the catalog/);
  assert.doesNotMatch(host.textContent ?? '', /updates will appear after you save or discard/);
});

test('cross-tab invalidation refreshes and unrelated storage events are ignored', async () => {
  await render();
  await act(() => window.dispatchEvent(new dom.window.StorageEvent('storage', {
    key: 'unrelated', newValue: 'anything',
  })));
  assert.equal(reads, 1);
  dom.window.localStorage.removeItem(CATALOG_CACHE_KEY);
  remote.items[0]!.name = 'Other tab edit';
  await act(() => window.dispatchEvent(new dom.window.StorageEvent('storage', {
    key: CATALOG_CACHE_KEY, newValue: null, storageArea: dom.window.localStorage,
  })));
  assert.equal(reads, 2);
  assert.match(host.textContent ?? '', /Other tab edit/);
});

test('a retired consumable in saved data stays excluded from visitor results', async () => {
  const catalog = catalogFixture();
  catalog.items = [{
    id: 'ties', name: 'Retired cable ties', kind: 'consumable', stockLevel: 'low',
    categoryIds: ['tools'], locationId: 'bench', tags: [], goodFor: [],
    retiredAt: '2026-09-18T00:00:00Z',
  }];
  saveSnapshot(catalog);
  respond = async () => { throw new Error('Offline'); };
  await render();
  assert.doesNotMatch(host.textContent ?? '', /Retired cable ties/);
  assert.match(host.textContent ?? '', /Catalog refresh failed/);
});
