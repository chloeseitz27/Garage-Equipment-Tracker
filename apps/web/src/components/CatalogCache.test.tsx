import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { publicCatalog, type CatalogResponse } from '@garage/shared';
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
  access: 'staff',
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
  const value = JSON.stringify({ version: 3, fetchedAt, catalog: publicCatalog(catalog) });
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
  assert.equal(host.querySelector('.brand h1')?.textContent, 'GET IT');
  assert.equal(host.querySelector('.brand p')?.textContent, 'Garage Equipment Tracker & Inventory Tool');
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

test('public cached snapshots cannot be used for staff edits until an authenticated refresh succeeds', async () => {
  saveSnapshot(catalogFixture());
  respond = async () => { throw new Error('Offline'); };
  const fetch = globalThis.fetch;
  globalThis.fetch = (url, options) => options?.method === 'PUT'
    ? Promise.reject(new Error('Save failed: offline')) : fetch(url, options);
  await render('/manage/items/camera/edit');
  assert.match(host.textContent ?? '', /nothing is queued offline/);
  assert.match(host.textContent ?? '', /Staff catalog unavailable/);
  assert.equal(host.querySelector('.editor'), null);
  const saved = JSON.parse(dom.window.localStorage.getItem(CATALOG_CACHE_KEY)!);
  assert.equal(saved.catalog.items[0].name, 'Inspection camera');
  respond = async () => Response.json(remote);
  await click(button('Refresh catalog'));
  assert.doesNotMatch(host.textContent ?? '', /nothing is queued offline/);
  assert.equal(writes, 0);
  assert.ok(host.querySelector('.editor'));
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

test('cross-tab public snapshots trigger an authenticated refresh for staff', async () => {
  await render('/maps');
  remote.locations[1]!.name = 'Other tab bench';
  const newValue = saveSnapshot(remote);
  await act(() => window.dispatchEvent(new dom.window.StorageEvent('storage', {
    key: CATALOG_CACHE_KEY, newValue, storageArea: dom.window.localStorage,
  })));
  assert.equal(reads, 2);
  assert.equal(dom.window.localStorage.getItem(CATALOG_CACHE_KEY), newValue, 'Authenticated reload must not echo a storage write');
  const marker = host.querySelector<HTMLElement>('.map-marker[title="Other tab bench"]');
  assert.ok(marker);
  assert.equal(marker.style.left, '40%');
  assert.equal(marker.style.top, '60%');
  assert.doesNotMatch(host.textContent ?? '', /Showing saved catalog data/);
  await click(button('Refresh catalog'));
  assert.equal(reads, 3);
  assert.doesNotMatch(host.textContent ?? '', /Showing saved catalog data/);
});

const restrictCatalog = (): void => {
  remote.locations[0] = { ...remote.locations[0]!, name: 'Storage Closet', staffOnly: true };
  remote.locations[1] = { ...remote.locations[1]!, name: 'Hidden Shelf' };
};

test('staff see actual locations while storage, sign-out, and subsequent offline browsing show Ask Staff', async () => {
  restrictCatalog();
  let staff = true;
  const original = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    if (url === '/api/auth/session') return Promise.resolve(Response.json({ staff }));
    if (url === '/api/auth/logout') { staff = false; return Promise.resolve(Response.json({ staff })); }
    return original(url, options);
  };
  respond = async () => Response.json(staff ? remote : publicCatalog(remote));
  await render('/?item=camera');
  assert.match(host.querySelector('.item-detail .breadcrumb')?.textContent ?? '', /Storage Closet.*Hidden Shelf/);
  const saved = dom.window.localStorage.getItem(CATALOG_CACHE_KEY)!;
  assert.doesNotMatch(saved, /Storage Closet|Hidden Shelf/);
  assert.match(saved, /Ask Staff/);
  respond = async () => { throw new Error('Offline after sign-out'); };
  await click(button('Sign out'));
  assert.equal(host.querySelector('.item-detail .breadcrumb')?.textContent, 'Ask Staff');
  assert.equal(host.querySelector('.item-detail .room-map'), null);
  assert.doesNotMatch(host.textContent ?? '', /Storage Closet|Hidden Shelf/);
  assert.match(host.textContent ?? '', /Inspection camera/);
});

test('signing in refetches actual location assignments before allowing edits', async () => {
  restrictCatalog();
  let staff = false;
  const original = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    if (url === '/api/auth/session') return Promise.resolve(Response.json({ staff }));
    if (url === '/api/auth/login') { staff = true; return Promise.resolve(Response.json({ staff })); }
    return original(url, options);
  };
  respond = async () => Response.json(staff ? remote : publicCatalog(remote));
  await render('/manage/items/camera/edit');
  assert.equal(host.querySelector('.editor'), null);
  await click(button('Staff sign in'));
  const input = host.querySelector<HTMLInputElement>('input[type="password"]');
  assert.ok(input);
  await typeInput(input, 'test-only');
  await click(button('Sign in'));
  assert.equal(reads, 2);
  const location = host.querySelector<HTMLInputElement>('.editor-location [role="combobox"]');
  assert.equal(location?.value, 'Storage Closet → Hidden Shelf');
  assert.doesNotMatch(dom.window.localStorage.getItem(CATALOG_CACHE_KEY)!, /Storage Closet|Hidden Shelf/);
});

test('a revoked staff response replaces a private draft instead of deferring redaction', async () => {
  restrictCatalog();
  await render('/manage/items/camera/edit');
  await typeName('Private draft');
  respond = async () => Response.json(publicCatalog(remote));
  await click(button('Refresh catalog'));
  assert.equal(host.querySelector('.editor'), null);
  assert.match(host.textContent ?? '', /Staff sign-in required/);
  assert.doesNotMatch(host.textContent ?? '', /Storage Closet|Hidden Shelf/);
});

test('a sign-out in another tab revokes private viewing even when its session recheck is offline', async () => {
  restrictCatalog();
  await render('/?item=camera');
  assert.match(host.textContent ?? '', /Storage Closet/);
  const original = globalThis.fetch;
  globalThis.fetch = (url, options) => url === '/api/auth/session'
    ? Promise.reject(new Error('Offline')) : original(url, options);
  respond = async () => { throw new Error('Offline'); };
  await act(() => window.dispatchEvent(new dom.window.StorageEvent('storage', {
    key: 'garage-inventory:session-change', newValue: `${Date.now()}:false`, storageArea: dom.window.localStorage,
  })));
  assert.equal(host.querySelector('.item-detail .breadcrumb')?.textContent, 'Ask Staff');
  assert.doesNotMatch(host.textContent ?? '', /Storage Closet|Hidden Shelf/);
});

test('sign-out clears staff assistant results instead of leaving their private location paths visible', async () => {
  restrictCatalog();
  let staff = true;
  const original = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    if (url === '/api/auth/session') return Promise.resolve(Response.json({ staff }));
    if (url === '/api/auth/logout') { staff = false; return Promise.resolve(Response.json({ staff })); }
    if (url === '/api/assistant/recommend') return Promise.resolve(Response.json({
      understoodAs: 'Inspect a project', notInGarage: [],
      garageItems: [{ id: 'camera', name: 'Inspection camera', kind: 'equipment',
        reason: 'For inspection', locationPath: remote.locations }],
    }));
    return original(url, options);
  };
  respond = async () => Response.json(staff ? remote : publicCatalog(remote));
  await render('/');
  const query = host.querySelector<HTMLInputElement>('.search');
  assert.ok(query);
  await typeInput(query, 'Inspect a project');
  await click(button('Ask'));
  assert.match(host.querySelector('.assistant .path')?.textContent ?? '', /Storage Closet/);
  await click(button('Sign out'));
  assert.equal(host.querySelector('.assistant .path'), null);
  assert.doesNotMatch(host.textContent ?? '', /Storage Closet|Hidden Shelf/);
});

test('a late staff catalog response cannot restore private locations after sign-out', async () => {
  restrictCatalog();
  let staff = true;
  const original = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    if (url === '/api/auth/session') return Promise.resolve(Response.json({ staff }));
    if (url === '/api/auth/logout') { staff = false; return Promise.resolve(Response.json({ staff })); }
    return original(url, options);
  };
  await render('/?item=camera');
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  respond = () => staff ? pending : Promise.resolve(Response.json(publicCatalog(remote)));
  await click(button('Refresh catalog'));
  await click(button('Sign out'));
  assert.equal(host.querySelector('.item-detail .breadcrumb')?.textContent, 'Ask Staff');
  await act(async () => { finish(Response.json(remote)); await pending; });
  assert.equal(host.querySelector('.item-detail .breadcrumb')?.textContent, 'Ask Staff');
  assert.doesNotMatch(host.textContent ?? '', /Storage Closet|Hidden Shelf/);
  assert.doesNotMatch(dom.window.localStorage.getItem(CATALOG_CACHE_KEY)!, /Storage Closet|Hidden Shelf/);
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
