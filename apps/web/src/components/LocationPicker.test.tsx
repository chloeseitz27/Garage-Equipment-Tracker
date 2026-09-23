import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createContext, createElement, useContext, useState, type FormEvent, type ReactElement } from 'react';
import type { Root } from 'react-dom/client';
import { EQUIPMENT_STATUSES, STOCK_LEVELS, assignLocationIdentities, createLocationSchema, prepareLocation, formatLocationPath, getLocationPath, type Item, type Location, type RecommendResponse } from '@garage/shared';
import { RoomMapSourcesContext } from '../room-map-source.js';
import { pointMapSources } from './map-test-sources.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  Node: { configurable: true, value: dom.window.Node },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
});
// jsdom has no layout; browser verification covers scrolling and popup positioning.
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const { createRoot } = await import('react-dom/client');
// Portal components import react-dom too; initialize it only after the DOM exists.
const { LocationPicker } = await import('./LocationPicker.js');
const { BulkEntry } = await import('./BulkEntry.js');
const { ItemEditor } = await import('./ItemEditor.js');
const { LocationManager } = await import('./LocationManager.js');
const { RoomMapsPage } = await import('./RoomMapsPage.js');
const { RoomMap } = await import('./RoomMap.js');
const { LocationMapEditor } = await import('./LocationMapEditor.js');
const { ItemsManager } = await import('./ItemsManager.js');
const { MultiSelectFilter } = await import('./MultiSelectFilter.js');
const { CategoryManager } = await import('./CategoryManager.js');
const { buildRecords, createSearchIndex } = await import('../search.js');
const { StaffPanel } = await import('./StaffPanel.js');
const { App } = await import('../App.js');
const { createBrowserRouter, createMemoryRouter, RouterProvider, useLocation, useNavigate } = await import('react-router-dom');
const TestElementContext = createContext<ReactElement | null>(null);

const locations: Location[] = [
  { id: 'room', name: 'Main Shop', parentId: null, kind: 'room' },
  { id: 'bench', name: 'Electronics Bench', parentId: 'room', kind: 'station' },
  { id: 'cabinet', name: 'Cabinet B', parentId: 'bench', kind: 'shelf' },
  ...Array.from({ length: 20 }, (_, index): Location => ({
    id: `bin-${index}`,
    name: `Bin B${index}`,
    parentId: 'cabinet',
    kind: 'bin',
  })),
  { id: 'storage', name: 'Storage Room', parentId: null, kind: 'room' },
  { id: 'destination', name: 'Spare Shelf', parentId: 'storage', kind: 'shelf' },
];
const categories = [{ id: 'tools', name: 'Tools' }];
const item: Item = {
  id: 'vise', name: 'Vise', kind: 'equipment', categoryIds: ['tools'], locationId: 'bin-19',
  tags: [], goodFor: [], status: 'available', quantity: 1, trainingRequired: 'none',
};
const catalog = { locations, categories, items: [item] };
const path = (id: string): string => formatLocationPath(getLocationPath(locations, id));
const originalFetch = globalThis.fetch;
const originalConfirm = window.confirm;
const originalAlert = window.alert;
let root: Root;
let host: HTMLDivElement;
let testRouter: ReturnType<typeof createMemoryRouter> | null;
let writes: Array<{ url: string; body: Record<string, unknown> }>;

beforeEach(() => {
  dom.window.localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  testRouter = null;
  writes = [];
  globalThis.fetch = async (url, init) => {
    const text = init?.body;
    assert.ok(typeof text === 'string', 'Unexpected request: tests must not access a real API');
    const body: Record<string, unknown> = JSON.parse(text);
    writes.push({ url: String(url), body });
    if (url === '/api/locations') {
      const input = createLocationSchema.parse(body);
      return jsonResponse(prepareLocation(input, assignLocationIdentities([...locations, ...mapLocations]), 'saved').location);
    }
    return new Response(JSON.stringify({ ...body, id: typeof body.id === 'string' ? body.id : 'saved', created: 1, updated: 1, items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
});

afterEach(async () => {
  await act(() => root.unmount());
  testRouter?.dispose();
  host.remove();
  globalThis.fetch = originalFetch;
  window.confirm = originalConfirm;
  window.alert = originalAlert;
});
after(() => dom.window.close());

function HistoryControls(): ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  return createElement('div', null,
    createElement('output', { 'data-test-url': true }, `${location.pathname}${location.search}`),
    createElement('button', { onClick: () => navigate(-1) }, 'History back'),
    createElement('button', { onClick: () => navigate(1) }, 'History forward'),
  );
}
function TestScreen(): ReactElement {
  const element = useContext(TestElementContext);
  return createElement('div', null, element, createElement(HistoryControls));
}
const render = async (element: ReactElement, initialPath = '/manage/items'): Promise<void> => {
  if (!testRouter) {
    testRouter = createMemoryRouter([{
      path: element.type === StaffPanel ? '/manage/*' : '*',
      element: createElement(TestScreen),
    }], { initialEntries: [initialPath] });
  }
  const router = testRouter;
  await act(() => root.render(createElement(RoomMapSourcesContext.Provider, { value: pointMapSources },
    createElement(TestElementContext.Provider, { value: element }, createElement(RouterProvider, { router })),
  )));
};
const currentUrl = (): string => host.querySelector('[data-test-url]')?.textContent ?? '';
const link = (text: string): HTMLAnchorElement => {
  const result = [...host.querySelectorAll('a')].find((node) => node.textContent?.trim() === text);
  assert.ok(result, `Missing link ${text}`);
  return result;
};
const combobox = (label: string): HTMLInputElement => {
  const labelNode = [...host.querySelectorAll('label')].find((node) => node.textContent === label);
  assert.ok(labelNode, `Missing label ${label}`);
  const input = document.getElementById(labelNode.htmlFor);
  assert.ok(input instanceof dom.window.HTMLInputElement);
  return input;
};
const options = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')];
const focus = async (input: HTMLInputElement): Promise<void> => { await act(() => input.focus()); };
const click = async (element: HTMLElement): Promise<void> => { await act(() => element.click()); };
const type = async (input: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void> => {
  const prototype = input instanceof dom.window.HTMLTextAreaElement
    ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  assert.ok(setter);
  await act(() => {
    setter.call(input, text);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
};
const key = async (input: HTMLInputElement, value: string): Promise<void> => {
  await act(() => { input.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: value, bubbles: true, cancelable: true,
  })); });
};
const button = (text: string): HTMLButtonElement => {
  const result = [...host.querySelectorAll('button')]
    .find((node) => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === text);
  assert.ok(result, `Missing button ${text}`);
  return result;
};
const choose = async (input: HTMLInputElement, text = 'spare'): Promise<void> => {
  await focus(input);
  await type(input, text);
  assert.equal(options().length, 1);
  await click(options()[0]!);
};

function Field(): ReactElement {
  const [value, setValue] = useState('bin-19');
  return createElement(LocationPicker, { locations, value, onSelect: setValue, label: 'Location' });
}

test('a selected path is visible; every location remains reachable, including beyond the old 12-result cap', async () => {
  await render(createElement(Field));
  const input = combobox('Location');
  assert.equal(input.value, path('bin-19'));
  await focus(input);
  assert.equal(options().length, locations.length);
  assert.ok(document.getElementById(input.getAttribute('aria-controls') ?? ''));
  assert.ok(document.getElementById(input.getAttribute('aria-activedescendant') ?? ''));
  assert.equal(options().filter((node) => node.getAttribute('aria-selected') === 'true').length, 1);
  await choose(input);
  assert.equal(input.value, path('destination'));
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  assert.equal(writes.length, 0);
});

test('pasting a full breadcrumb or a punctuated location name finds that location', async () => {
  await render(createElement(Field));
  const input = combobox('Location');
  await focus(input);
  await type(input, path('destination'));
  assert.equal(options().length, 1);
  assert.match(options()[0]?.textContent ?? '', /Spare Shelf/);
});

test('querying, Escape, blur, and outside clicks never change the stored value', async () => {
  await render(createElement(Field));
  const input = combobox('Location');
  await focus(input);
  await type(input, 'not a location');
  assert.equal(options().length, 0);
  assert.match(host.querySelector('[role="status"]')?.textContent ?? '', /No location matches/);
  await key(input, 'Enter');
  await key(input, 'Escape');
  assert.equal(input.value, path('bin-19'));
  await key(input, 'Enter');
  assert.equal(input.value, path('bin-19'));
  await type(input, 'spare');
  await act(() => input.blur());
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  assert.equal(input.value, path('bin-19'));
  await focus(input);
  await type(input, 'storage');
  await act(() => document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })));
  assert.equal(input.value, path('bin-19'));
  assert.equal(input.getAttribute('aria-expanded'), 'false');
});

test('arrow navigation and Enter select without submitting a surrounding form', async () => {
  let submits = 0;
  let selected = '';
  await render(createElement('form', {
    onSubmit: (event: FormEvent) => { event.preventDefault(); submits++; },
  }, createElement(LocationPicker, { locations, onSelect: (id: string) => { selected = id; } })));
  const input = combobox('Location');
  await focus(input);
  await type(input, 'no results');
  await key(input, 'ArrowDown');
  assert.equal(input.getAttribute('aria-activedescendant'), null);
  await type(input, 'storage');
  await key(input, 'ArrowDown');
  const active = document.getElementById(input.getAttribute('aria-activedescendant') ?? '');
  assert.match(active?.textContent ?? '', /Spare Shelf/);
  await key(input, 'Enter');
  assert.equal(selected, 'destination');
  assert.equal(submits, 0);
  assert.equal(input.value, '');
  await key(input, 'Enter');
  assert.equal(selected, 'destination');
});

test('a disabled picker is closed and cannot dispatch a selection', async () => {
  let count = 0;
  const onSelect = (): void => { count++; };
  await render(createElement(LocationPicker, { locations, onSelect }));
  const input = combobox('Location');
  await focus(input);
  await type(input, 'spare');
  await render(createElement(LocationPicker, { locations, onSelect, disabled: true }));
  assert.equal(input.disabled, true);
  assert.equal(options().length, 0);
  await key(input, 'Enter');
  assert.equal(count, 0);
});

test('multiple pickers have distinct labels and listbox ids', async () => {
  await render(createElement('div', null,
    createElement(LocationPicker, { locations, label: 'First', onSelect: () => {} }),
    createElement(LocationPicker, { locations, label: 'Second', onSelect: () => {} })));
  const first = combobox('First');
  const second = combobox('Second');
  assert.notEqual(first.id, second.id);
  await focus(first);
  const firstList = first.getAttribute('aria-controls');
  await focus(second);
  assert.equal(first.getAttribute('aria-expanded'), 'false');
  assert.notEqual(second.getAttribute('aria-controls'), firstList);
});

test('the item editor retains and submits the chosen location only on Save', async () => {
  await render(createElement(ItemEditor, { item, categories, locations, onSaved: () => {}, onCancel: () => {} }));
  const input = combobox('Location');
  assert.equal(input.value, path(item.locationId));
  await focus(input);
  await type(input, 'spare');
  await key(input, 'Enter');
  assert.equal(writes.length, 0);
  assert.equal(input.value, path('destination'));
  await click(button('Save changes'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.url, '/api/items/vise');
  assert.equal(writes[0]?.body.locationId, 'destination');
  assert.equal(writes[0]?.body.name, item.name);
});

test('new items use the same picker and changing the edited item refreshes its selected path', async () => {
  const props = { categories, locations, onSaved: () => {}, onCancel: () => {} };
  await render(createElement(ItemEditor, { ...props, item: null }));
  assert.equal(combobox('Location').value, path('room'));
  await render(createElement(ItemEditor, { ...props, item }));
  assert.equal(combobox('Location').value, path('bin-19'));
});

test('bulk-entry location defaults are retained and used for every submitted row', async () => {
  await render(createElement(BulkEntry, { locations, categories, onCreated: () => {} }));
  const input = combobox('Default location');
  assert.equal(input.value, path('room'));
  await choose(input);
  assert.equal(input.value, path('destination'));
  const rows = host.querySelector<HTMLTextAreaElement>('textarea');
  assert.ok(rows);
  await type(rows, 'Vise\nTape, consumable');
  assert.equal(writes.length, 0);
  await click(button('Add 2 item(s)'));
  assert.equal(writes[0]?.url, '/api/items/bulk');
  assert.deepEqual((writes[0]?.body.items as Array<{ locationId: string }>).map((row) => row.locationId),
    ['destination', 'destination']);
  assert.equal(input.value, path('destination'));
});

test('parent selectors filter self, descendants, and invalid parent levels while retaining full paths', async () => {
  await render(createElement(LocationManager, { locations, items: [item], onChanged: () => {} }));
  await click(button('Expand Main Shop'));
  await click(button('Expand Electronics Bench'));
  await click(button('Rename or move Cabinet B'));
  const input = combobox('Parent location');
  assert.equal(input.value, path('bench'));
  await focus(input);
  assert.equal(options().length, 2); // Only surface parents outside the selected subtree.
  assert.equal(options().some((node) => /Cabinet B|Bin B/.test(node.textContent ?? '')), false);
  await type(input, 'electronics');
  assert.equal(options().length, 1);
  assert.match(options()[0]?.textContent ?? '', /Main Shop.*Electronics Bench/);
  await type(input, 'top');
  assert.equal(options().length, 0);
  await type(input, 'spare');
  await key(input, 'Enter');
  assert.equal(input.value, path('destination'));
  assert.equal(writes.length, 0);
  await click(button('Save'));
  assert.equal(writes[0]?.url, '/api/locations/cabinet');
  assert.equal(writes[0]?.body.parentId, 'destination');
});

const selectLocationType = async (kind: string, editing = false): Promise<void> => {
  const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${editing ? 'Location type' : 'New location type'}"]`);
  assert.ok(select);
  await act(() => {
    select.value = kind;
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
};

test('each plus opens a child form with a fixed parent and no preselected type', async () => {
  await render(createElement(LocationManager, { locations, items: [], onChanged: () => {} }));
  assert.equal(host.querySelector('.location-editor'), null);
  assert.equal(host.querySelector('.add-row input'), null);
  await click(button('Add child to Main Shop'));
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="New location type"]');
  const name = host.querySelector<HTMLInputElement>('input[aria-label="New location name"]');
  assert.ok(select && name);
  assert.equal(select.value, '');
  assert.equal(select.selectedOptions[0]?.textContent, 'Select type...');
  assert.deepEqual([...select.options].slice(1).map((option) => option.textContent),
    ['Table', 'Station', 'Desk', 'Workbench', 'Cabinet']);
  assert.equal(host.querySelector('.location-editor [role="combobox"]'), null);
  assert.match(host.querySelector('.new-child-location')?.textContent ?? '', /New child of Main Shop/);
  assert.equal(locationChildren(button('Collapse Main Shop')).hidden, false);
  await type(name, 'New shelf');
  assert.equal(button('Save').disabled, true);
  await click(button('Save'));
  assert.equal(writes.length, 0);
  await selectLocationType('cabinet');
  assert.equal(button('Save').disabled, false);
  assert.equal(host.querySelector('.location-editor .staff-only-option')?.textContent?.trim(), 'Staff-only');
  await click(button('Save'));
  assert.equal(writes[0]?.body.kind, 'cabinet');
  assert.equal(writes[0]?.body.parentId, 'room');
  assert.equal(host.querySelector('.location-editor'), null);
  await click(button('Add child to Main Shop'));
  assert.equal(host.querySelector<HTMLSelectElement>('select[aria-label="New location type"]')?.value, '');
  assert.equal(button('Save').disabled, true);
});

test('new surfaces suggest the next available letter but keep custom names editable', async () => {
  await render(createElement(LocationManager, { locations: mapLocations, items: [], onChanged: () => {} }));
  await click(button('Add child to Common Makerspace'));
  await selectLocationType('desk');
  const input = host.querySelector<HTMLInputElement>('[aria-label="New location name"]');
  assert.ok(input);
  assert.equal(input.value, 'Desk C');
  await selectLocationType('station');
  assert.equal(input.value, 'Station C');
  await type(input, 'Roland');
  await selectLocationType('cabinet');
  assert.equal(input.value, 'Roland');
  assert.match(host.querySelector('.location-editor')?.textContent ?? '', /Location code: C/);
  await placeMarker(25, 40, '.new-child-location .room-map-stage');
  await click(button('Save'));
  assert.equal(writes[0]?.body.name, 'Roland');
  assert.equal(writes[0]?.body.kind, 'cabinet');
  assert.equal(writes[0]?.body.letter, undefined);
});

test('container forms offer only storage types and display generated names and table-wide codes', async () => {
  const withNumbers: Location[] = [...mapLocations.map((location) => location.id === 'bin-a'
    ? { ...location, name: 'Bin 3', number: 3 } : location), {
    id: 'shelf-a', name: 'Shelf 2', parentId: 'table-a', kind: 'shelf', number: 2,
  }];
  await render(createElement(LocationManager, { locations: withNumbers, items: [], onChanged: () => {} }));
  await click(button('Expand Common Makerspace'));
  await click(button('Add child to Table A'));
  const typeSelect = host.querySelector<HTMLSelectElement>('[aria-label="New location type"]');
  assert.ok(typeSelect);
  assert.equal(typeSelect.value, '');
  assert.deepEqual([...typeSelect.options].slice(1).map((option) => option.textContent), ['Drawer', 'Bin', 'Shelf']);
  assert.equal(host.querySelector('input[aria-label="New location name"]'), null);
  await selectLocationType('drawer');
  assert.equal(host.querySelector('output[aria-label="Location name"]')?.textContent, 'Drawer 4');
  assert.match(host.querySelector('.location-editor')?.textContent ?? '', /A4/);
  await selectLocationType('bin');
  assert.equal(host.querySelector('output[aria-label="Location name"]')?.textContent, 'Bin 4');
  assert.equal(writes.length, 0);
});

test('editing keeps the stored type, while saving a new type still uses its canonical lowercase value', async () => {
  await render(createElement(LocationManager, { locations, items: [], onChanged: () => {} }));
  await click(button('Expand Main Shop'));
  await click(button('Rename or move Electronics Bench'));
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Location type"]');
  assert.ok(select);
  assert.equal(select.value, 'station');
  assert.equal(select.selectedOptions[0]?.textContent, 'Station');
  assert.deepEqual([...select.options].slice(1).map((option) => option.textContent),
    ['Table', 'Station', 'Desk', 'Workbench', 'Cabinet']);
  assert.equal(combobox('Parent location').value, path('room'));
  assert.equal(host.querySelector('.location-editor .staff-only-option')?.textContent?.trim(), 'Staff-only');
  await selectLocationType('desk', true);
  await click(button('Save'));
  assert.equal(writes[0]?.body.kind, 'desk');
});

test('the bottom plus creates a top-level room and root-room edits cannot change its parent', async () => {
  await render(createElement(LocationManager, { locations, items: [], onChanged: () => {} }));
  assert.ok(button('Add room').closest('.add-row'));
  await click(button('Add room'));
  assert.equal(host.querySelector('.location-editor [role="combobox"]'), null);
  const kind = host.querySelector<HTMLSelectElement>('[aria-label="New location type"]');
  assert.ok(kind?.disabled);
  assert.equal(kind.value, 'room');
  const name = host.querySelector<HTMLInputElement>('input[aria-label="New location name"]');
  assert.ok(name);
  await type(name, 'Annex');
  assert.equal(writes.length, 0);
  await click(button('Save'));
  assert.equal(writes[0]?.url, '/api/locations');
  assert.equal(writes[0]?.body.parentId, null);
  assert.equal(writes[0]?.body.kind, 'room');
  assert.equal(writes[0]?.body.mapPosition, undefined);
  await click(button('Rename or move Main Shop'));
  assert.equal(host.querySelector('.location-editor [role="combobox"]'), null);
  assert.equal(host.querySelector<HTMLSelectElement>('[aria-label="Location type"]')?.disabled, true);
  assert.equal(host.querySelector<HTMLSelectElement>('[aria-label="Location type"]')?.value, 'room');
});

test('location management creates staff-only storage and retains the flag through a rename', async () => {
  const privateLocations: Location[] = [...locations, {
    id: 'closet', name: 'Storage Closet', kind: 'room', parentId: null, staffOnly: true,
  }, { id: 'private-bin', name: 'Private bin', kind: 'cabinet', parentId: 'closet' }];
  await render(createElement(LocationManager, { locations: privateLocations, items: [], onChanged: () => {} }));
  const row = [...host.querySelectorAll('.tree-node')].find((node) =>
    node.querySelector('.tree-name')?.textContent?.startsWith('Storage Closet'));
  assert.ok(row);
  assert.match(row.textContent ?? '', /Staff only/);
  await click(button('Expand Storage Closet'));
  const child = [...host.querySelectorAll('.tree-node')].find((node) =>
    node.querySelector('.tree-name')?.textContent?.startsWith('Private bin'));
  assert.match(child?.textContent ?? '', /Staff only/);
  await click(button('Rename or move Storage Closet'));
  const checkbox = host.querySelector<HTMLInputElement>('.location-editor input[type="checkbox"]');
  assert.equal(checkbox?.checked, true);
  await click(button('Save'));
  assert.equal(writes[0]?.body.staffOnly, true);
  await click(button('Add room'));
  const name = host.querySelector<HTMLInputElement>('input[aria-label="New location name"]');
  const restriction = host.querySelector<HTMLInputElement>('.location-editor input[type="checkbox"]');
  assert.ok(name && restriction);
  await type(name, 'Basement Storage');
  await click(restriction);
  await click(button('Save'));
  assert.equal(writes[1]?.body.staffOnly, true);
});

const locationChildren = (toggle: HTMLButtonElement): HTMLUListElement => {
  const list = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
  assert.ok(list instanceof dom.window.HTMLUListElement);
  return list;
};

test('location branches start collapsed and expand independently without catalog writes', async () => {
  const props = { locations, items: [item], onChanged: () => {} };
  await render(createElement(LocationManager, props));
  assert.equal(host.querySelector('.manager h3'), null);
  assert.equal(host.querySelector('.location-map-editor h4'), null);
  assert.doesNotMatch(host.textContent ?? '', /Items attach at any depth|Deleting is blocked|Room maps and markers/);
  const shop = button('Expand Main Shop');
  const storage = button('Expand Storage Room');
  assert.equal(shop.getAttribute('aria-expanded'), 'false');
  assert.equal(locationChildren(shop).hidden, true);
  assert.equal(locationChildren(storage).hidden, true);
  assert.ok(shop.querySelector('svg.action-icon-chevron[aria-hidden="true"]'));
  await click(shop);
  assert.equal(shop.getAttribute('aria-expanded'), 'true');
  assert.equal(shop.getAttribute('aria-label'), 'Collapse Main Shop');
  assert.equal(locationChildren(shop).hidden, false);
  const bench = button('Expand Electronics Bench');
  assert.equal(locationChildren(bench).hidden, true);
  await click(bench);
  assert.equal(locationChildren(bench).hidden, false);
  assert.equal(locationChildren(button('Expand Cabinet B')).hidden, true);
  await click(shop);
  assert.equal(locationChildren(shop).hidden, true);
  assert.equal(locationChildren(storage).hidden, true);
  await click(shop);
  assert.equal(locationChildren(bench).hidden, false);
  await render(createElement(LocationManager, { ...props, locations: [...locations] }));
  assert.equal(locationChildren(button('Collapse Main Shop')).hidden, false);
  assert.equal(writes.length, 0);
});

test('collapsing a location branch preserves an in-progress descendant edit', async () => {
  await render(createElement(LocationManager, { locations, items: [item], onChanged: () => {} }));
  await click(button('Expand Main Shop'));
  await click(button('Rename or move Electronics Bench'));
  const name = host.querySelector<HTMLInputElement>('[aria-label="Location name"]');
  assert.ok(name);
  await type(name, 'New bench name');
  await click(button('Collapse Main Shop'));
  assert.ok(name.closest('ul[hidden]'));
  await click(button('Expand Main Shop'));
  assert.equal(name.closest('ul[hidden]'), null);
  assert.equal(name.value, 'New bench name');
  assert.equal(writes.length, 0);
  await click(button('Save'));
  assert.equal(writes[0]?.body.name, 'New bench name');
  assert.equal(writes[0]?.url, '/api/locations/bench');
});

test('location actions use labelled icons and do not toggle the branch when editing', async () => {
  await render(createElement(LocationManager, { locations, items: [], onChanged: () => {} }));
  for (const [label, icon] of [
    ['Rename or move Main Shop', 'edit'], ['Delete Main Shop', 'delete'],
    ['Add child to Main Shop', 'add'], ['Add room', 'add'],
  ] as const) {
    const action = button(label);
    assert.equal(action.textContent, '');
    assert.ok(action.title);
    assert.ok(action.classList.contains('icon-button'));
    assert.ok(action.querySelector(`svg.action-icon-${icon}[aria-hidden="true"]`));
  }
  const children = locationChildren(button('Expand Main Shop'));
  await click(button('Rename or move Main Shop'));
  assert.equal(children.hidden, true);
  for (const [label, icon] of [['Save', 'save'], ['Cancel', 'cancel']] as const) {
    assert.equal(button(label).textContent, '');
    assert.ok(button(label).title);
    assert.ok(button(label).querySelector(`svg.action-icon-${icon}[aria-hidden="true"]`));
  }
  await click(button('Cancel'));
  assert.equal(locationChildren(button('Expand Main Shop')).hidden, true);
  assert.equal(writes.length, 0);
});

test('protected location delete icons explain children, items, or both without sending a request', async () => {
  const messages: string[] = [];
  window.alert = (message) => { messages.push(String(message)); };
  await render(createElement(LocationManager, {
    locations, items: [item, { ...item, id: 'retired-tool', locationId: 'room', retiredAt: '2026-09-21T00:00:00Z' }],
    onChanged: () => {},
  }));
  assert.equal(button('Delete Main Shop').disabled, false);
  await click(button('Delete Main Shop'));
  assert.match(messages[0] ?? '', /Cannot delete "Main Shop"/);
  assert.match(messages[0] ?? '', /1 sub-location\(s\)/);
  assert.match(messages[0] ?? '', /1 item\(s\).*recycle bin/);
  assert.match(messages[0] ?? '', /Move them to another location first/);
  await click(button('Expand Main Shop'));
  await click(button('Delete Electronics Bench'));
  assert.match(messages[1] ?? '', /1 sub-location\(s\)/);
  assert.doesNotMatch(messages[1] ?? '', /item\(s\)/);
  await click(button('Expand Electronics Bench'));
  await click(button('Expand Cabinet B'));
  await click(button('Delete Bin B19'));
  assert.match(messages[2] ?? '', /1 item\(s\)/);
  assert.doesNotMatch(messages[2] ?? '', /sub-location\(s\)/);
  assert.equal(writes.length, 0);
  assert.equal(locationChildren(button('Collapse Main Shop')).hidden, false);
});

test('empty locations can still be deleted, and server-side refusal is explained in a popup', async () => {
  const messages: string[] = [];
  const requests: string[] = [];
  let changed = 0;
  let refuse = true;
  window.alert = (message) => { messages.push(String(message)); };
  globalThis.fetch = async (url, options) => {
    assert.equal(options?.method, 'DELETE');
    requests.push(String(url));
    return refuse
      ? new Response(JSON.stringify({ error: 'Still holds 1 item(s). Move them first.' }), { status: 409 })
      : new Response(null, { status: 204 });
  };
  await render(createElement(LocationManager, { locations, items: [], onChanged: () => { changed++; } }));
  await click(button('Expand Storage Room'));
  await click(button('Delete Spare Shelf'));
  assert.match(messages[0] ?? '', /Cannot delete "Spare Shelf"/);
  assert.match(messages[0] ?? '', /Still holds 1 item\(s\)/);
  assert.match(host.querySelector('[role="alert"]')?.textContent ?? '', /Move them first/);
  assert.equal(changed, 0);
  refuse = false;
  await click(button('Delete Spare Shelf'));
  assert.equal(messages.length, 1);
  assert.equal(changed, 1);
  assert.deepEqual(requests, ['/api/locations/destination', '/api/locations/destination']);
  assert.equal(host.querySelector('[role="alert"]'), null);
});

test('bulk Move to is a draft until Save, including keyboard selection', async () => {
  await render(createElement(ItemsManager, { catalog, mode: 'live', onChanged: () => {} }));
  const checkbox = host.querySelector<HTMLInputElement>('.row-check input');
  assert.ok(checkbox);
  await click(checkbox);
  assert.equal(button('Save').disabled, true);
  const input = combobox('Move to');
  await focus(input);
  await type(input, 'spare');
  await key(input, 'Escape');
  await key(input, 'Enter');
  assert.equal(writes.length, 0);
  await type(input, 'spare');
  await key(input, 'Enter');
  assert.equal(input.value, path('destination'));
  assert.equal(writes.length, 0);
  assert.equal(button('Save').disabled, false);
  await click(button('Save'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.url, '/api/items/bulk-update');
  assert.deepEqual(writes[0]?.body, { ids: ['vise'], changes: { locationId: 'destination' } });
  assert.equal(host.querySelector('.bulk-bar'), null);
  assert.match(host.querySelector('[role="status"]')?.textContent ?? '', /Saved changes/);
});

const multiCatalog = {
  ...catalog,
  categories: [...categories, { id: 'materials', name: 'Materials' }],
  items: [
    item,
    {
      id: 'solder', name: 'Solder', kind: 'consumable', categoryIds: ['tools'], locationId: 'bin-19',
      tags: [], goodFor: [], stockLevel: 'in-stock',
    } satisfies Item,
  ],
};

const checkboxFor = (name: string): HTMLInputElement => {
  const row = [...host.querySelectorAll('.item-table tbody tr')]
    .find((node) => node.querySelector('.item-name')?.textContent === name);
  const checkbox = row?.querySelector<HTMLInputElement>('.row-check input');
  assert.ok(checkbox, `Missing checkbox for ${name}`);
  return checkbox;
};

const setCategories = async (values: string[], label = 'Replace categories'): Promise<void> => {
  const panel = await openFilter(label);
  await click(panelButton(panel, 'Clear selection'));
  for (const value of values) await click(optionButton(panel, value));
  await click(panelButton(panel, 'Done'));
};
const setCategory = (value: string): Promise<void> => setCategories(value ? [value] : []);

test('new items can save multiple categories and require at least one', async () => {
  await render(createElement(ItemEditor, {
    item: null, categories: multiCatalog.categories, locations, onSaved: () => {}, onCancel: () => {},
  }));
  const name = host.querySelector<HTMLInputElement>('.editor label input');
  assert.ok(name);
  await type(name, 'Multi-purpose tool');
  await setCategories([], 'Categories');
  await click(button('Create item'));
  assert.equal(writes.length, 0);
  assert.match(host.querySelector('[role="alert"]')?.textContent ?? '', /At least one category/);
  await setCategories(['tools', 'materials'], 'Categories');
  assert.match(button('Categories').textContent ?? '', /Tools, Materials/);
  await click(button('Create item'));
  assert.equal(writes[0]?.url, '/api/items');
  assert.deepEqual(writes[0]?.body.categoryIds, ['materials', 'tools']);
  assert.equal('categoryId' in (writes[0]?.body ?? {}), false);
});

test('editing keeps every category and allows removing one without losing the others', async () => {
  await render(createElement(ItemEditor, {
    item: { ...item, categoryIds: ['tools', 'materials'] },
    categories: multiCatalog.categories, locations, onSaved: () => {}, onCancel: () => {},
  }));
  assert.equal(button('Categories').title, 'Tools, Materials');
  await choose(combobox('Location'));
  await click(button('Save changes'));
  assert.deepEqual(writes[0]?.body.categoryIds, ['materials', 'tools']);
  const panel = await openFilter('Categories');
  assert.equal(optionButton(panel, 'tools').getAttribute('aria-pressed'), 'true');
  assert.equal(optionButton(panel, 'materials').getAttribute('aria-pressed'), 'true');
  await click(optionButton(panel, 'tools'));
  await click(panelButton(panel, 'Done'));
  await click(button('Save changes'));
  assert.deepEqual(writes[1]?.body.categoryIds, ['materials']);
  assert.equal(writes[1]?.body.locationId, 'destination');
});

test('category selections participate in the unsaved guard but searching options and undoing do not', async () => {
  await render(createElement(StaffPanel, { catalog: multiCatalog, onChanged: () => {} }),
    '/manage/items/vise/edit');
  const panel = await openFilter('Categories');
  const search = panel.querySelector<HTMLInputElement>('input');
  assert.ok(search);
  await type(search, 'mat');
  assert.equal(unloadIsBlocked(), false);
  await click(optionButton(panel, 'materials'));
  assert.equal(unloadIsBlocked(), true);
  await click(optionButton(panel, 'materials'));
  assert.equal(unloadIsBlocked(), false);
  await click(optionButton(panel, 'materials'));
  await click(panelButton(panel, 'Done'));
  await click(link('Locations'));
  assert.ok(host.querySelector('[role="alertdialog"]'));
  await click(button('Stay on page'));
  assert.equal(button('Categories').title, 'Tools, Materials');
});

test('bulk-entry applies every default category to equipment and consumables', async () => {
  await render(createElement(BulkEntry, {
    locations, categories: multiCatalog.categories, onCreated: () => {},
  }));
  const rows = host.querySelector<HTMLTextAreaElement>('textarea');
  assert.ok(rows);
  await type(rows, 'Vise\nTape, consumable');
  await setCategories([], 'Default categories');
  assert.equal(button('Add 2 item(s)').disabled, true);
  await setCategories(['tools', 'materials'], 'Default categories');
  assert.match(host.querySelector('.preview')?.textContent ?? '', /Tools, Materials/);
  await click(button('Add 2 item(s)'));
  const saved = writes[0]?.body.items as Array<{ categoryIds: string[] }>;
  assert.deepEqual(saved.map((row) => row.categoryIds), [
    ['materials', 'tools'], ['materials', 'tools'],
  ]);
});

test('bulk replacement saves the full category set and empty selection leaves categories unchanged', async () => {
  await render(createElement(ItemsManager, { catalog: multiCatalog, mode: 'live', onChanged: () => {} }));
  await click(checkboxFor('Vise'));
  await click(checkboxFor('Solder'));
  await setCategories(['tools', 'materials']);
  assert.match(host.querySelector('.bulk-bar')?.textContent ?? '', /Replaces all categories/);
  await click(button('Save'));
  assert.deepEqual(writes[0]?.body, {
    ids: ['vise', 'solder'], changes: { categoryIds: ['materials', 'tools'] },
  });
  await click(checkboxFor('Vise'));
  await setCategories(['tools', 'materials']);
  await choose(combobox('Move to'));
  await setCategories([]);
  await click(button('Save'));
  assert.deepEqual(writes[1]?.body, { ids: ['vise'], changes: { locationId: 'destination' } });
});

test('category usage includes secondary assignments and retired items', async () => {
  await render(createElement(CategoryManager, {
    categories: multiCatalog.categories,
    items: [
      { ...item, categoryIds: ['tools', 'materials'], retiredAt: '2026-09-18T00:00:00Z' },
      { ...item, id: 'second', categoryIds: ['materials'] },
    ],
    onChanged: () => {},
  }));
  const rows = [...host.querySelectorAll('.flat-list li')];
  assert.match(rows[0]?.textContent ?? '', /Tools1 item/);
  assert.match(rows[1]?.textContent ?? '', /Materials2 item/);
  assert.ok(rows.every((row) => row.querySelector<HTMLButtonElement>('button.danger')?.disabled));
});

test('category actions use labeled icons without changing rename, Save, or Cancel behavior', async () => {
  let refreshes = 0;
  await render(createElement(CategoryManager, {
    categories, items: [item], onChanged: () => { refreshes++; },
  }));
  const rename = button('Rename Tools');
  const remove = button('Delete Tools');
  assert.equal(rename.title, 'Rename Tools');
  assert.equal(rename.textContent?.trim(), '');
  assert.ok(rename.querySelector('svg.action-icon-edit[aria-hidden="true"]'));
  assert.equal(remove.textContent?.trim(), '');
  assert.ok(remove.querySelector('svg.action-icon-delete[aria-hidden="true"]'));
  assert.equal(remove.disabled, true);
  assert.equal(remove.title, 'Recategorize its items first');
  await click(rename);
  const editor = host.querySelector('.category-edit');
  assert.ok(editor?.classList.contains('tree-edit'));
  assert.equal(button('Save').parentElement, editor);
  assert.equal(button('Cancel').parentElement, editor);
  assert.equal(button('Cancel').classList.contains('secondary'), true);
  for (const [name, icon, title] of [
    ['Save', 'save', 'Save category name'],
    ['Cancel', 'cancel', 'Cancel renaming'],
  ] as const) {
    const action = button(name);
    assert.equal(action.textContent?.trim(), '');
    assert.equal(action.title, title);
    assert.ok(action.querySelector(`svg.action-icon-${icon}[aria-hidden="true"]`));
  }
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Category name"]');
  assert.ok(input);
  await type(input, 'Discard this');
  await click(button('Cancel'));
  assert.equal(host.querySelector('.category-edit'), null);
  assert.equal(writes.length, 0);
  await click(button('Rename Tools'));
  const reopened = host.querySelector<HTMLInputElement>('input[aria-label="Category name"]');
  assert.ok(reopened);
  assert.equal(reopened.value, 'Tools');
  await type(reopened, '  Hand tools  ');
  await click(button('Save'));
  assert.deepEqual(writes[0], { url: '/api/categories/tools', body: { id: 'tools', name: 'Hand tools' } });
  assert.equal(refreshes, 1);
  assert.equal(host.querySelector('.category-edit'), null);
});

test('the category delete icon still deletes only an unused category', async () => {
  let refreshes = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(init?.method, 'DELETE');
    assert.equal(String(url), '/api/categories/unused');
    writes.push({ url: String(url), body: {} });
    return new Response(null, { status: 204 });
  };
  await render(createElement(CategoryManager, {
    categories: [{ id: 'unused', name: 'Unused' }], items: [],
    onChanged: () => { refreshes++; },
  }));
  const remove = button('Delete Unused');
  assert.equal(remove.disabled, false);
  assert.equal(remove.title, 'Delete this category');
  assert.ok(remove.querySelector('svg.action-icon-delete'));
  await click(remove);
  assert.equal(writes.length, 1);
  assert.equal(refreshes, 1);
});

test('Save applies location and category to the full selection in one request', async () => {
  let refreshes = 0;
  await render(createElement(ItemsManager, {
    catalog: multiCatalog, mode: 'live', onChanged: () => { refreshes++; },
  }));
  await click(checkboxFor('Vise'));
  await click(checkboxFor('Solder'));
  await choose(combobox('Move to'));
  await setCategory('materials');
  assert.equal(writes.length, 0);
  assert.equal(refreshes, 0);
  assert.equal(combobox('Move to').value, path('destination'));
  assert.equal(button('Replace categories').title, 'Materials');
  await click(button('Save'));
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0]?.body, {
    ids: ['vise', 'solder'], changes: { locationId: 'destination', categoryIds: ['materials'] },
  });
  assert.equal(refreshes, 1);
});

test('category-only drafts can be undone and saved without a location change', async () => {
  await render(createElement(ItemsManager, { catalog: multiCatalog, mode: 'live', onChanged: () => {} }));
  await click(checkboxFor('Vise'));
  await setCategory('materials');
  assert.equal(writes.length, 0);
  assert.equal(button('Save').disabled, false);
  await setCategory('');
  assert.equal(button('Save').disabled, true);
  await setCategory('materials');
  await click(button('Save'));
  assert.deepEqual(writes[0]?.body, { ids: ['vise'], changes: { categoryIds: ['materials'] } });
});

test('unchecking items discards pending edits without a separate Deselect button', async () => {
  await render(createElement(ItemsManager, { catalog: multiCatalog, mode: 'live', onChanged: () => {} }));
  await click(checkboxFor('Vise'));
  await choose(combobox('Move to'));
  await setCategory('materials');
  assert.deepEqual([...host.querySelectorAll('.bulk-actions > button')].map((node) => node.getAttribute('aria-label') ?? node.textContent),
    ['Save', 'Delete']);
  await click(checkboxFor('Vise'));
  assert.equal(writes.length, 0);
  assert.equal(checkboxFor('Vise').checked, false);
  assert.equal(host.querySelector('.bulk-bar'), null);
  await click(checkboxFor('Solder'));
  assert.equal(combobox('Move to').value, '');
  assert.equal(button('Replace categories').title, 'Keep current categories');
  assert.equal(button('Save').disabled, true);
});

test('changing the selection or filtering away selected rows clears the old draft', async () => {
  await render(createElement(ItemsManager, { catalog: multiCatalog, mode: 'live', onChanged: () => {} }));
  await click(checkboxFor('Vise'));
  await choose(combobox('Move to'));
  await click(checkboxFor('Solder'));
  assert.equal(button('Save').disabled, true);
  assert.equal(combobox('Move to').value, '');
  await setCategory('materials');
  const filter = host.querySelector<HTMLInputElement>('input[aria-label="Filter by name"]');
  assert.ok(filter);
  await type(filter, 'Solder');
  assert.equal(host.querySelector('.bulk-bar strong')?.textContent, '1 selected');
  assert.equal(button('Save').disabled, true);
  assert.equal(writes.length, 0);
});

test('a failed Save preserves the draft and checked items for retry', async () => {
  const succeed = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    await succeed(...args);
    return new Response(JSON.stringify({ error: 'Could not save this batch' }), { status: 500 });
  };
  await render(createElement(ItemsManager, { catalog: multiCatalog, mode: 'live', onChanged: () => {} }));
  await click(checkboxFor('Vise'));
  await choose(combobox('Move to'));
  await setCategory('materials');
  await click(button('Save'));
  assert.equal(writes.length, 1);
  assert.equal(checkboxFor('Vise').checked, true);
  assert.equal(combobox('Move to').value, path('destination'));
  assert.equal(button('Replace categories').title, 'Materials');
  assert.match(host.querySelector('[role="alert"]')?.textContent ?? '', /Could not save this batch/);
  assert.equal(host.querySelector('[role="status"]'), null);
  assert.equal(button('Save').disabled, false);
  globalThis.fetch = succeed;
  await click(button('Save'));
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(host.querySelector('.bulk-bar'), null);
});

test('pending saves disable repeated actions and changes to the selection', async () => {
  const succeed = globalThis.fetch;
  let release = (_response: Response): void => { throw new Error('Request not initialized'); };
  const pending = new Promise<Response>((resolve) => { release = resolve; });
  globalThis.fetch = async (...args) => {
    await succeed(...args);
    return pending;
  };
  await render(createElement(ItemsManager, { catalog: multiCatalog, mode: 'live', onChanged: () => {} }));
  await click(checkboxFor('Vise'));
  await choose(combobox('Move to'));
  await click(button('Save'));
  assert.equal(button('Save').disabled, true);
  assert.equal(button('Delete').disabled, true);
  assert.equal(button('Delete Vise').disabled, true);
  assert.equal(host.querySelector<HTMLInputElement>('.select-all input')?.disabled, true);
  assert.equal(checkboxFor('Solder').disabled, true);
  assert.equal(combobox('Move to').disabled, true);
  await click(button('Save'));
  await click(button('Delete Vise'));
  assert.equal(writes.length, 1);
  await act(async () => {
    release(new Response(JSON.stringify({ updated: 1, items: [] }), { status: 200 }));
    await pending;
  });
  assert.equal(host.querySelector('.bulk-bar'), null);
});

test('Delete sends items to the recycle bin without applying unsaved edits', async () => {
  await render(createElement(ItemsManager, { catalog: multiCatalog, mode: 'live', onChanged: () => {} }));
  await click(checkboxFor('Vise'));
  await click(checkboxFor('Solder'));
  await choose(combobox('Move to'));
  assert.equal(writes.length, 0);
  assert.equal([...host.querySelectorAll('button')].some((node) => node.textContent === 'Retire'), false);
  await click(button('Delete'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.url, '/api/items/bulk-retire');
  assert.deepEqual(writes[0]?.body, { ids: ['vise', 'solder'], retired: true });
  assert.match(host.querySelector('[role="status"]')?.textContent ?? '', /recycle bin/);
});

test('the recycle bin offers only Restore and supports unchecking via select-all', async () => {
  const binCatalog = { ...catalog, items: [{ ...item, retiredAt: '2026-09-17T00:00:00.000Z' }] };
  await render(createElement(ItemsManager, { catalog: binCatalog, mode: 'bin', onChanged: () => {} }));
  await click(checkboxFor('Vise'));
  assert.deepEqual([...host.querySelectorAll('.bulk-bar > button')].map((node) => node.textContent),
    ['Restore']);
  const selectAll = host.querySelector<HTMLInputElement>('.select-all input');
  assert.ok(selectAll);
  await click(selectAll);
  assert.equal(writes.length, 0);
  assert.equal(checkboxFor('Vise').checked, false);
  await click(checkboxFor('Vise'));
  await click(button('Restore'));
  assert.equal(writes[0]?.url, '/api/items/bulk-retire');
  assert.deepEqual(writes[0]?.body, { ids: ['vise'], retired: false });
});

const gridCatalog = {
  ...multiCatalog,
  items: [
    { ...item, id: 'tool10', name: 'Tool 10', locationId: 'bin-10', status: 'out-for-repair' } satisfies Item,
    { ...item, id: 'tool2', name: 'Tool 2', locationId: 'bin-2' },
    {
      id: 'solder', name: 'Solder', kind: 'consumable', categoryIds: ['materials'], locationId: 'destination',
      tags: [], goodFor: [], stockLevel: 'low',
    } satisfies Item,
  ],
};
const gridNames = (): string[] => [...host.querySelectorAll('.item-table tbody .item-name')]
  .map((node) => node.textContent ?? '');

test('multi-category items appear once when any selected category matches, including in the recycle bin', async () => {
  const both = { ...item, categoryIds: ['tools', 'materials'] };
  const categoryCatalog = {
    ...multiCatalog,
    items: [both, { ...item, id: 'retired', name: 'Retired tool', categoryIds: both.categoryIds, retiredAt: '2026-09-18T00:00:00Z' }],
  };
  await render(createElement(ItemsManager, { catalog: categoryCatalog, mode: 'live', onChanged: () => {} }));
  assert.match(host.querySelector('.item-table tbody')?.textContent ?? '', /Materials, Tools/);
  await filterBy('Filter by category', 'materials');
  assert.deepEqual(gridNames(), ['Vise']);
  await filterBy('Filter by category', ['tools', 'materials']);
  assert.deepEqual(gridNames(), ['Vise']);
  await render(createElement(ItemsManager, { catalog: categoryCatalog, mode: 'bin', onChanged: () => {} }));
  assert.deepEqual(gridNames(), ['Retired tool']);
  await filterBy('Filter by category', 'materials');
  assert.deepEqual(gridNames(), ['Retired tool']);
});

test('search indexes each category name without duplicating multi-category items', () => {
  const records = buildRecords({
    ...multiCatalog,
    items: [{ ...item, categoryIds: ['tools', 'materials'] }],
  });
  assert.deepEqual(records[0]?.categoryNames, ['Tools', 'Materials']);
  const search = createSearchIndex(records);
  assert.deepEqual(search.search('Materials').map((hit) => hit.item.item.id), ['vise']);
  assert.deepEqual(search.search('Tools').map((hit) => hit.item.item.id), ['vise']);
});
const sortBy = async (label: string): Promise<void> => {
  const header = host.querySelector<HTMLButtonElement>(`button[aria-label="Sort by ${label}"]`);
  assert.ok(header, `Missing sortable header ${label}`);
  await click(header);
};
const openFilter = async (label: string): Promise<HTMLDivElement> => {
  const trigger = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  assert.ok(trigger, `Missing filter ${label}`);
  await click(trigger);
  const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
  assert.ok(panel instanceof dom.window.HTMLDivElement);
  return panel;
};
const panelButton = (panel: HTMLElement, text: string): HTMLButtonElement => {
  const result = [...panel.querySelectorAll('button')].find((node) => node.textContent === text);
  assert.ok(result, `Missing panel button ${text}`);
  return result;
};
const optionButton = (panel: HTMLElement, value: string): HTMLButtonElement => {
  const option = [...panel.querySelectorAll<HTMLButtonElement>('.multi-filter-options button')]
    .find((node) => node.value === value);
  assert.ok(option, `Missing option ${value}`);
  return option;
};
const filterBy = async (label: string, value: string | string[]): Promise<void> => {
  const control = host.querySelector<HTMLInputElement | HTMLButtonElement>(`[aria-label="${label}"]`);
  assert.ok(control, `Missing filter ${label}`);
  if (control instanceof dom.window.HTMLInputElement) {
    assert.equal(typeof value, 'string');
    await type(control, String(value));
  } else {
    const panel = await openFilter(label);
    await click(panelButton(panel, 'Clear filter'));
    const values = Array.isArray(value) ? value : value ? [value] : [];
    for (const choice of values) await click(optionButton(panel, choice));
    await click(panelButton(panel, 'Done'));
  }
};

test('item information is separated into headed columns with visible category, state and location', async () => {
  await render(createElement(ItemsManager, { catalog: gridCatalog, mode: 'live', onChanged: () => {} }));
  assert.equal(host.querySelectorAll('.item-table thead th[scope="col"]').length, 7);
  assert.deepEqual(gridNames(), ['Solder', 'Tool 2', 'Tool 10']);
  const row = host.querySelector('.item-table tbody tr');
  assert.ok(row);
  const cells = row.querySelectorAll('td');
  assert.equal(cells.length, 7);
  assert.equal(cells[1]?.textContent, 'Solder');
  assert.equal(cells[2]?.textContent, 'Consumable');
  assert.equal(cells[3]?.textContent, 'Materials');
  assert.equal(cells[4]?.textContent, path('destination'));
  assert.equal(cells[5]?.textContent, 'Low stock');
  assert.equal(writes.length, 0);
});

for (const mode of ['live', 'bin'] as const) {
  test(`${mode} tables and filters use readable kind and stock labels without changing stored values`, async () => {
    const states: Item[] = [
      ...EQUIPMENT_STATUSES.map((status): Item => ({ ...item, id: status, name: status, status })),
      ...STOCK_LEVELS.map((stockLevel): Item => ({
        id: stockLevel, name: stockLevel, kind: 'consumable', stockLevel,
        categoryIds: ['tools'], locationId: 'bin-19', tags: [], goodFor: [],
      })),
    ];
    const stateCatalog = {
      ...catalog, items: mode === 'bin' ? states.map((entry) => ({
        ...entry, retiredAt: '2026-09-18T00:00:00Z',
      })) : states,
    };
    await render(createElement(ItemsManager, { catalog: stateCatalog, mode, onChanged: () => {} }));
    const expected: Record<string, [string, string]> = {
      available: ['Equipment', 'Available'],
      'in-use': ['Equipment', 'In use'],
      'out-for-repair': ['Equipment', 'Out for repair'],
      'in-stock': ['Consumable', 'In stock'],
      low: ['Consumable', 'Low stock'],
      out: ['Consumable', 'Out of stock'],
    };
    for (const row of host.querySelectorAll('.item-table tbody tr')) {
      const cells = row.querySelectorAll('td');
      assert.deepEqual([cells[2]?.textContent, cells[5]?.textContent],
        expected[cells[1]?.textContent ?? '']);
    }
    const panel = await openFilter('Filter by status or stock');
    for (const [value, [, label]] of Object.entries(expected)) {
      assert.equal(optionButton(panel, value).textContent, label);
    }
    await click(panelButton(panel, 'Done'));
    await sortBy('Status / stock');
    assert.deepEqual(gridNames(), ['available', 'in-stock', 'in-use', 'low', 'out-for-repair', 'out']);
    await filterBy('Filter by status or stock', 'out');
    assert.deepEqual(gridNames(), ['out']);
    assert.equal(new URL(currentUrl(), 'http://localhost').searchParams.get('state'), 'out');
    assert.equal(writes.length, 0);
  });
}

test('headers toggle sorting in either direction across every item column', async () => {
  await render(createElement(ItemsManager, { catalog: gridCatalog, mode: 'live', onChanged: () => {} }));
  await sortBy('Name');
  assert.deepEqual(gridNames(), ['Tool 10', 'Tool 2', 'Solder']);
  assert.equal(host.querySelector('th[aria-sort="descending"] button')?.getAttribute('aria-label'), 'Sort by Name');
  await sortBy('Name');
  assert.deepEqual(gridNames(), ['Solder', 'Tool 2', 'Tool 10']);
  const cases = [
    { label: 'Kind', asc: ['Solder', 'Tool 2', 'Tool 10'], desc: ['Tool 2', 'Tool 10', 'Solder'] },
    { label: 'Category', asc: ['Solder', 'Tool 2', 'Tool 10'], desc: ['Tool 2', 'Tool 10', 'Solder'] },
    { label: 'Location', asc: ['Tool 2', 'Tool 10', 'Solder'], desc: ['Solder', 'Tool 10', 'Tool 2'] },
    { label: 'Status / stock', asc: ['Tool 2', 'Solder', 'Tool 10'], desc: ['Tool 10', 'Solder', 'Tool 2'] },
  ];
  for (const { label, asc, desc } of cases) {
    await sortBy(label);
    assert.deepEqual(gridNames(), asc, `${label} ascending`);
    await sortBy(label);
    assert.deepEqual(gridNames(), desc, `${label} descending`);
    assert.equal(host.querySelectorAll('th[aria-sort="descending"]').length, 1);
  }
  assert.equal(writes.length, 0);
});

test('column filters combine and select-all targets only the matching rows', async () => {
  await render(createElement(ItemsManager, { catalog: gridCatalog, mode: 'live', onChanged: () => {} }));
  await filterBy('Filter by name', 'TOOL');
  await filterBy('Filter by kind', 'equipment');
  await filterBy('Filter by category', 'tools');
  await filterBy('Filter by location', 'bin-2');
  await filterBy('Filter by status or stock', 'available');
  assert.deepEqual(gridNames(), ['Tool 2']);
  const selectAll = host.querySelector<HTMLInputElement>('.select-all input');
  assert.ok(selectAll);
  assert.equal(selectAll.getAttribute('aria-label'), 'Select all 1 shown');
  await click(selectAll);
  await choose(combobox('Move to'));
  await click(button('Save'));
  assert.deepEqual(writes[0]?.body, { ids: ['tool2'], changes: { locationId: 'destination' } });
  await click(button('Reset filters'));
  assert.deepEqual(gridNames(), ['Solder', 'Tool 2', 'Tool 10']);
  assert.equal(button('Reset filters').disabled, true);
});

test('sorting preserves checked items and pending edits; filtering them out clears both', async () => {
  await render(createElement(ItemsManager, { catalog: gridCatalog, mode: 'live', onChanged: () => {} }));
  await click(checkboxFor('Tool 2'));
  const selectAll = host.querySelector<HTMLInputElement>('.select-all input');
  assert.ok(selectAll);
  assert.equal(selectAll.indeterminate, true);
  await choose(combobox('Move to'));
  await sortBy('Location');
  await sortBy('Location');
  assert.equal(checkboxFor('Tool 2').checked, true);
  assert.equal(combobox('Move to').value, path('destination'));
  assert.equal(button('Save').disabled, false);
  await filterBy('Filter by status or stock', 'low');
  assert.deepEqual(gridNames(), ['Solder']);
  assert.equal(host.querySelector('.bulk-bar'), null);
  assert.equal(selectAll.indeterminate, false);
  assert.equal(writes.length, 0);
});

test('an empty filtered table retains its headers and can be reset', async () => {
  await render(createElement(ItemsManager, { catalog: gridCatalog, mode: 'live', onChanged: () => {} }));
  await filterBy('Filter by category', 'materials');
  await filterBy('Filter by kind', 'equipment');
  assert.deepEqual(gridNames(), []);
  assert.match(host.querySelector('tbody')?.textContent ?? '', /No items match these filters/);
  assert.equal(host.querySelectorAll('thead th[scope="col"]').length, 7);
  assert.equal(host.querySelector<HTMLInputElement>('.select-all input')?.disabled, true);
  await click(button('Reset filters'));
  assert.equal(gridNames().length, 3);
  assert.equal(writes.length, 0);
});

test('the recycle-bin grid defaults to newest first and supports filtering and date sorting', async () => {
  const binCatalog = {
    ...catalog,
    items: [
      { ...item, id: 'old', name: 'Old vise', retiredAt: '2026-01-01T00:00:00.000Z' },
      { ...item, id: 'new', name: 'New vise', retiredAt: '2026-09-17T00:00:00.000Z' },
      item,
    ],
  };
  await render(createElement(ItemsManager, { catalog: binCatalog, mode: 'bin', onChanged: () => {} }));
  assert.equal(host.querySelectorAll('thead th[scope="col"]').length, 8);
  assert.deepEqual(gridNames(), ['New vise', 'Old vise']);
  await sortBy('Deleted');
  assert.deepEqual(gridNames(), ['Old vise', 'New vise']);
  await filterBy('Filter by name', 'New');
  assert.deepEqual(gridNames(), ['New vise']);
  const date = host.querySelector('tbody time');
  assert.equal(date?.getAttribute('datetime'), '2026-09-17T00:00:00.000Z');
  await click(button('Restore'));
  assert.deepEqual(writes[0]?.body, { ids: ['new'], retired: false });
});

test('every categorical filter accepts multiple values with OR within columns and AND between them', async () => {
  await render(createElement(ItemsManager, { catalog: gridCatalog, mode: 'live', onChanged: () => {} }));
  await filterBy('Filter by kind', ['equipment', 'consumable']);
  await filterBy('Filter by category', ['tools', 'materials']);
  await filterBy('Filter by status or stock', ['available', 'low']);
  assert.deepEqual(gridNames(), ['Solder', 'Tool 2']);
  await filterBy('Filter by location', ['bin-2', 'destination']);
  assert.deepEqual(gridNames(), ['Solder', 'Tool 2']);
  await filterBy('Filter by category', 'tools');
  assert.deepEqual(gridNames(), ['Tool 2']);
  await filterBy('Filter by category', []);
  assert.deepEqual(gridNames(), ['Solder', 'Tool 2']);
  assert.equal(writes.length, 0);
});

test('location filters include sub-locations and match IDs rather than similarly named nodes', async () => {
  await render(createElement(ItemsManager, { catalog: gridCatalog, mode: 'live', onChanged: () => {} }));
  await filterBy('Filter by location', ['cabinet']);
  assert.deepEqual(gridNames(), ['Tool 2', 'Tool 10']);
  await filterBy('Filter by location', ['bin-2']);
  assert.deepEqual(gridNames(), ['Tool 2']);
  await filterBy('Filter by location', ['room', 'storage']);
  assert.deepEqual(gridNames(), ['Solder', 'Tool 2', 'Tool 10']);
});

test('searching options preserves selected values outside the search and the popup stays open', async () => {
  await render(createElement(ItemsManager, { catalog: gridCatalog, mode: 'live', onChanged: () => {} }));
  const panel = await openFilter('Filter by category');
  assert.equal(host.querySelector('.item-table-scroll')?.contains(panel), false);
  await click(optionButton(panel, 'tools'));
  assert.equal(document.body.contains(panel), true);
  assert.deepEqual(gridNames(), ['Tool 2', 'Tool 10']);
  const search = panel.querySelector<HTMLInputElement>('input[type="search"]');
  assert.ok(search);
  await type(search, 'mat');
  assert.equal(panel.querySelectorAll('.multi-filter-options button').length, 1);
  await click(optionButton(panel, 'materials'));
  assert.deepEqual(gridNames(), ['Solder', 'Tool 2', 'Tool 10']);
  await click(panelButton(panel, 'Done'));
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Filter by category"]');
  assert.ok(trigger);
  assert.match(trigger.textContent ?? '', /2 selected/);
  assert.equal(document.activeElement, trigger);
  const reopened = await openFilter('Filter by category');
  assert.equal(optionButton(reopened, 'tools').getAttribute('aria-pressed'), 'true');
  assert.equal(optionButton(reopened, 'materials').getAttribute('aria-pressed'), 'true');
  assert.equal(writes.length, 0);
});

test('clearing one column preserves other filters and reset clears all selections', async () => {
  await render(createElement(ItemsManager, { catalog: gridCatalog, mode: 'live', onChanged: () => {} }));
  await filterBy('Filter by kind', 'equipment');
  await filterBy('Filter by status or stock', 'available');
  assert.deepEqual(gridNames(), ['Tool 2']);
  await filterBy('Filter by status or stock', []);
  assert.deepEqual(gridNames(), ['Tool 2', 'Tool 10']);
  await click(button('Reset filters'));
  assert.deepEqual(gridNames(), ['Solder', 'Tool 2', 'Tool 10']);
  assert.equal(button('Reset filters').disabled, true);
  for (const label of ['kind', 'category', 'location', 'status or stock']) {
    const panel = await openFilter(`Filter by ${label}`);
    assert.equal(panel.querySelectorAll('[aria-pressed="true"]').length, 0);
    await click(panelButton(panel, 'Done'));
  }
});

test('select-all and bulk Save target the union of the selected filter values only', async () => {
  await render(createElement(ItemsManager, { catalog: gridCatalog, mode: 'live', onChanged: () => {} }));
  await filterBy('Filter by status or stock', ['available', 'low']);
  const selectAll = host.querySelector<HTMLInputElement>('.select-all input');
  assert.ok(selectAll);
  await click(selectAll);
  await choose(combobox('Move to'));
  assert.equal(writes.length, 0);
  await click(button('Save'));
  assert.deepEqual(writes[0]?.body, { ids: ['solder', 'tool2'], changes: { locationId: 'destination' } });
});

test('option search, keyboard dismissal, and outside focus do not reset active filters', async () => {
  await render(createElement(ItemsManager, { catalog: gridCatalog, mode: 'live', onChanged: () => {} }));
  const panel = await openFilter('Filter by kind');
  await click(optionButton(panel, 'equipment'));
  const search = panel.querySelector<HTMLInputElement>('input[type="search"]');
  assert.ok(search);
  await type(search, 'zzz');
  assert.match(panel.querySelector('[role="status"]')?.textContent ?? '', /No matching options/);
  assert.deepEqual(gridNames(), ['Tool 2', 'Tool 10']);
  await key(search, 'Escape');
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Filter by kind"]');
  assert.ok(trigger);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, trigger);
  assert.deepEqual(gridNames(), ['Tool 2', 'Tool 10']);
  await openFilter('Filter by kind');
  const nameFilter = host.querySelector<HTMLInputElement>('input[aria-label="Filter by name"]');
  assert.ok(nameFilter);
  await focus(nameFilter);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(gridNames(), ['Tool 2', 'Tool 10']);
});

test('filter popup handles an empty list and closes when disabled without changing values', async () => {
  let calls = 0;
  const props = { label: 'test', emptyLabel: 'All', options: [], selected: [], onChange: () => { calls++; } };
  await render(createElement(MultiSelectFilter, props));
  const panel = await openFilter('Filter by test');
  assert.match(panel.textContent ?? '', /No matching options/);
  await render(createElement(MultiSelectFilter, { ...props, disabled: true }));
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Filter by test"]');
  assert.ok(trigger);
  assert.equal(trigger.disabled, true);
  assert.equal(document.body.contains(panel), false);
  await click(trigger);
  assert.equal(calls, 0);
});

test('the filter popup stays open through table scrolling and window resizing', async () => {
  await render(createElement(ItemsManager, { catalog: gridCatalog, mode: 'live', onChanged: () => {} }));
  const panel = await openFilter('Filter by category');
  await click(optionButton(panel, 'tools'));
  const scroller = host.querySelector('.item-table-scroll');
  assert.ok(scroller);
  await act(() => {
    scroller.dispatchEvent(new dom.window.Event('scroll'));
    window.dispatchEvent(new dom.window.Event('resize'));
  });
  assert.equal(document.body.contains(panel), true);
  assert.equal(optionButton(panel, 'tools').getAttribute('aria-pressed'), 'true');
  assert.equal(writes.length, 0);
});

test('multiselect filters behave the same way in the recycle bin without revealing live items', async () => {
  const binCatalog = {
    ...gridCatalog,
    items: [
      ...gridCatalog.items.map((row) => ({ ...row, retiredAt: '2026-09-17T00:00:00.000Z' })),
      item,
    ],
  };
  await render(createElement(ItemsManager, { catalog: binCatalog, mode: 'bin', onChanged: () => {} }));
  await filterBy('Filter by kind', ['equipment', 'consumable']);
  await filterBy('Filter by status or stock', ['available', 'low']);
  assert.deepEqual(gridNames(), ['Solder', 'Tool 2']);
  assert.equal(gridNames().includes('Vise'), false);
});

test('filter options use accessible toggle buttons without checkboxes and clicking again deselects', async () => {
  await render(createElement(ItemsManager, { catalog: gridCatalog, mode: 'live', onChanged: () => {} }));
  const panel = await openFilter('Filter by kind');
  assert.equal(panel.querySelectorAll('input[type="checkbox"]').length, 0);
  const equipment = optionButton(panel, 'equipment');
  const consumable = optionButton(panel, 'consumable');
  assert.equal(equipment.type, 'button');
  assert.equal(equipment.tabIndex, 0);
  assert.equal(equipment.getAttribute('aria-pressed'), 'false');
  await click(equipment);
  assert.equal(equipment.getAttribute('aria-pressed'), 'true');
  assert.equal(consumable.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(gridNames(), ['Tool 2', 'Tool 10']);
  await click(consumable);
  assert.equal(consumable.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(gridNames(), ['Solder', 'Tool 2', 'Tool 10']);
  await click(equipment);
  assert.equal(equipment.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(gridNames(), ['Solder']);
  await click(consumable);
  assert.equal(panel.querySelectorAll('[aria-pressed="true"]').length, 0);
  assert.deepEqual(gridNames(), ['Solder', 'Tool 2', 'Tool 10']);
  assert.equal(writes.length, 0);
});

test('catalog sections share one navigation bar without a separate Bulk entry tab', async () => {
  await render(createElement(StaffPanel, {
    catalog, onChanged: () => {},
  }));
  const navigation = host.querySelector('nav[aria-label="Catalog sections"]');
  assert.ok(navigation);
  assert.deepEqual([...navigation.querySelectorAll('a')].map((node) => node.textContent?.trim()),
    ['Items', 'Locations', 'Categories', 'Flag queue', 'Recycle bin']);
  assert.equal(navigation.querySelector('[aria-current="page"]')?.textContent?.trim(), 'Items');
  await click(link('Locations'));
  assert.equal(navigation.querySelector('[aria-current="page"]')?.textContent?.trim(), 'Locations');
  assert.equal(host.querySelector('.bulk-entry-section'), null);
  await click(link('Categories'));
  assert.equal(navigation.querySelector('[aria-current="page"]')?.textContent?.trim(), 'Categories');
  await click(link('Items'));
  assert.ok(host.querySelector('.item-table'));
  assert.ok(host.querySelector('.bulk-entry-section'));
});

test('inline Bulk entry retains drafts when collapsed and submits without leaving the Items grid', async () => {
  let refreshes = 0;
  await render(createElement(StaffPanel, {
    catalog, onChanged: () => { refreshes++; },
  }));
  const section = host.querySelector<HTMLElement>('.bulk-entry-section');
  const toggle = button('Bulk entry');
  assert.ok(section);
  assert.equal(section.hidden, true);
  assert.equal(toggle.getAttribute('aria-controls'), section.id);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  await click(toggle);
  assert.equal(section.hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.ok(host.querySelector('.item-table'));
  const rows = section.querySelector<HTMLTextAreaElement>('.bulk-input');
  assert.ok(rows);
  await type(rows, 'New drill\nNew tape, consumable');
  await choose(combobox('Default location'));
  await click(toggle);
  assert.equal(section.hidden, true);
  await click(toggle);
  assert.equal(rows.value, 'New drill\nNew tape, consumable');
  assert.equal(combobox('Default location').value, path('destination'));
  assert.equal(writes.length, 0);
  await click(button('Add 2 item(s)'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.url, '/api/items/bulk');
  assert.equal(refreshes, 1);
  assert.equal(rows.value, '');
  assert.ok(host.querySelector('.item-table'));
  assert.equal(host.querySelector('nav[aria-label="Catalog sections"] [aria-current="page"]')?.textContent?.trim(), 'Items');
});

test('New item and Bulk entry are header actions and the New item workflow is preserved', async () => {
  await render(createElement(StaffPanel, {
    catalog, onChanged: () => {},
  }));
  const header = host.querySelector('.items-view-header');
  assert.ok(header);
  assert.match(header.querySelector('h3')?.textContent ?? '', /Items.*1 shown/);
  assert.deepEqual([...header.querySelectorAll('button')].map((node) => node.getAttribute('aria-label') ?? node.textContent),
    ['New item', 'Bulk entry']);
  assert.equal(host.querySelectorAll('details, .new-item-row').length, 0);
  await click(button('New item'));
  assert.equal(host.querySelector('.editor h3')?.textContent, 'New item');
  await click(button('Cancel'));
  assert.ok(host.querySelector('.items-view-header'));
  assert.ok(host.querySelector('.item-table'));
  await click(link('Recycle bin'));
  assert.equal(host.querySelector('.items-view-actions'), null);
});

test('catalog navigation creates links and history entries for Back and Forward', async () => {
  await render(createElement(StaffPanel, { catalog, onChanged: () => {} }));
  assert.equal(link('Locations').getAttribute('href'), '/manage/locations');
  await click(link('Locations'));
  assert.equal(currentUrl(), '/manage/locations');
  await click(link('Categories'));
  assert.equal(currentUrl(), '/manage/categories');
  await click(button('History back'));
  assert.equal(currentUrl(), '/manage/locations');
  assert.equal(host.querySelector('nav [aria-current="page"]')?.textContent, 'Locations');
  await click(button('History forward'));
  assert.equal(currentUrl(), '/manage/categories');
  assert.equal(host.querySelector('nav [aria-current="page"]')?.textContent, 'Categories');
});

test('bookmarked item filters, sort order and inline bulk entry are restored from the URL', async () => {
  const initial = '/manage/items?kind=equipment&state=available&state=out-for-repair&sort=name&order=desc&bulk=1';
  await render(createElement(StaffPanel, { catalog: gridCatalog, onChanged: () => {} }), initial);
  assert.deepEqual(gridNames(), ['Tool 10', 'Tool 2']);
  assert.equal(host.querySelector<HTMLElement>('.bulk-entry-section')?.hidden, false);
  assert.equal(button('Bulk entry').getAttribute('aria-expanded'), 'true');
  const filter = await openFilter('Filter by status or stock');
  assert.equal(optionButton(filter, 'available').getAttribute('aria-pressed'), 'true');
  assert.equal(optionButton(filter, 'out-for-repair').getAttribute('aria-pressed'), 'true');
  await click(panelButton(filter, 'Done'));
  await click(button('Bulk entry'));
  assert.equal(new URL(currentUrl(), 'http://localhost').searchParams.has('bulk'), false);
  await click(button('History back'));
  assert.equal(host.querySelector<HTMLElement>('.bulk-entry-section')?.hidden, false);
  assert.equal(writes.length, 0);
});

test('filter and sort history restores the visible grid without saving data', async () => {
  await render(createElement(ItemsManager, { catalog: gridCatalog, mode: 'live', onChanged: () => {} }));
  await filterBy('Filter by kind', 'equipment');
  assert.equal(new URL(currentUrl(), 'http://localhost').searchParams.get('kind'), 'equipment');
  await sortBy('Location');
  assert.equal(new URL(currentUrl(), 'http://localhost').searchParams.get('sort'), 'path');
  await click(button('History back'));
  assert.equal(new URL(currentUrl(), 'http://localhost').searchParams.has('sort'), false);
  assert.deepEqual(gridNames(), ['Tool 2', 'Tool 10']);
  await click(button('History back'));
  assert.deepEqual(gridNames(), ['Solder', 'Tool 2', 'Tool 10']);
  await click(button('History forward'));
  assert.deepEqual(gridNames(), ['Tool 2', 'Tool 10']);
  assert.equal(writes.length, 0);
});

test('New item and Edit have bookmarkable paths and return to the original filtered grid', async () => {
  await render(createElement(StaffPanel, { catalog: gridCatalog, onChanged: () => {} }), '/manage/items?q=Tool');
  await click(button('New item'));
  assert.equal(currentUrl(), '/manage/items/new?q=Tool');
  assert.equal(host.querySelector('.editor h3')?.textContent, 'New item');
  await click(button('History back'));
  assert.equal(currentUrl(), '/manage/items?q=Tool');
  assert.deepEqual(gridNames(), ['Tool 2', 'Tool 10']);
  const row = [...host.querySelectorAll('tbody tr')].find((node) => node.querySelector('.item-name')?.textContent === 'Tool 2');
  const edit = row?.querySelector<HTMLButtonElement>('.item-row-actions button');
  assert.ok(edit);
  await click(edit);
  assert.equal(currentUrl(), '/manage/items/tool2/edit?q=Tool');
  assert.equal(host.querySelector('.editor h3')?.textContent, 'Edit Tool 2');
  await click(button('Cancel'));
  assert.equal(currentUrl(), '/manage/items?q=Tool');
});

test('direct edit URLs load the item without prior selection', async () => {
  await render(createElement(StaffPanel, { catalog, onChanged: () => {} }), '/manage/items/vise/edit');
  assert.equal(host.querySelector('.editor h3')?.textContent, 'Edit Vise');
  assert.equal(combobox('Location').value, path('bin-19'));
});

const jsonResponse = (body: unknown): Response => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json' },
});
const mockAppApi = (staff = true): void => {
  globalThis.fetch = async (url) => {
    if (url === '/api/catalog') return jsonResponse({ ...gridCatalog, access: staff ? 'staff' : 'public' });
    if (url === '/api/auth/session') return jsonResponse({ staff });
    if (url === '/api/auth/login') { staff = true; return jsonResponse({ staff }); }
    if (url === '/api/auth/logout') { staff = false; return jsonResponse({ staff }); }
    if (url === '/api/flags') return jsonResponse([]);
    throw new Error(`Unexpected request: ${url}`);
  };
};

test('public item details and search are bookmarkable, and closing details participates in history', async () => {
  mockAppApi();
  await render(createElement(App), '/?q=Tool&item=tool2');
  assert.equal(host.querySelector<HTMLInputElement>('.search')?.value, 'Tool');
  assert.equal(host.querySelector('.item-detail h2')?.textContent, 'Tool 2');
  await click(button('Close'));
  assert.equal(currentUrl(), '/?q=Tool');
  assert.equal(host.querySelector('.item-detail'), null);
  await click(button('History back'));
  assert.equal(host.querySelector('.item-detail h2')?.textContent, 'Tool 2');
  await click(link('Room maps'));
  assert.equal(currentUrl(), '/maps');
  await click(button('History back'));
  assert.equal(currentUrl(), '/?q=Tool&item=tool2');
  assert.equal(host.querySelector('.item-detail h2')?.textContent, 'Tool 2');
});

test('typing search replaces the current entry rather than creating one entry per keystroke', async () => {
  mockAppApi();
  await render(createElement(App), '/maps');
  await click(link('Search & ask'));
  const input = host.querySelector<HTMLInputElement>('.search');
  assert.ok(input);
  await type(input, 'T');
  await type(input, 'Tool');
  assert.equal(currentUrl(), '/?q=Tool');
  await click(button('History back'));
  assert.equal(currentUrl(), '/maps');
  await click(button('History forward'));
  assert.equal(host.querySelector<HTMLInputElement>('.search')?.value, 'Tool');
});

const recommendation: RecommendResponse = {
  understoodAs: 'A project using tools and solder',
  garageItems: [
    { id: 'tool2', name: 'Tool 2', kind: 'equipment', reason: 'For the assembly', locationPath: getLocationPath(locations, 'bin-2') },
    { id: 'solder', name: 'Solder', kind: 'consumable', reason: 'For the connections', locationPath: getLocationPath(locations, 'destination') },
  ],
  notInGarage: [{ name: 'Project enclosure', reason: 'To house the project' }],
};
const mockAssistantApi = (respond: (init?: RequestInit) => Promise<Response> = async () => jsonResponse(recommendation)): void => {
  mockAppApi(false);
  const appFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (url !== '/api/assistant/recommend') return appFetch(url, init);
    assert.equal(init?.method, 'POST');
    assert.equal(typeof init.body, 'string');
    writes.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return respond(init);
  };
};
const discoveryInput = (): HTMLInputElement => {
  const input = host.querySelector<HTMLInputElement>('.discovery input');
  assert.ok(input);
  return input;
};
const publicNames = (): string[] => [...host.querySelectorAll('.results .result-name')]
  .map((node) => node.firstChild?.textContent?.trim() ?? '');

test('public browsing and item details show every category assignment', async () => {
  mockAppApi(false);
  const appFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => url === '/api/catalog' ? jsonResponse({
    ...multiCatalog, items: [{ ...item, categoryIds: ['tools', 'materials'] }],
  }) : appFetch(url, init);
  await render(createElement(App), '/?category=materials');
  assert.deepEqual(publicNames(), ['Vise']);
  await click(button('Tools'));
  assert.deepEqual(publicNames(), ['Vise']);
  await click(button('All'));
  assert.deepEqual(publicNames(), ['Vise']);
  const result = host.querySelector<HTMLButtonElement>('.result');
  assert.ok(result);
  await click(result);
  assert.match(host.querySelector('.item-detail')?.textContent ?? '', /Tools, Materials/);
  await type(discoveryInput(), 'Materials');
  assert.deepEqual(publicNames(), ['Vise']);
});

test('discovery has one focused input, two actions, live search, and category browsing', async () => {
  mockAssistantApi();
  await render(createElement(App), '/');
  const input = discoveryInput();
  assert.equal(document.activeElement, input);
  assert.equal(host.querySelectorAll('.discovery input, .discovery textarea').length, 1);
  assert.equal(host.querySelector('.examples'), null);
  assert.doesNotMatch(host.textContent ?? '', /Try a project|wooden planter|weather station|team offsite/);
  assert.deepEqual([...host.querySelectorAll('nav[aria-label="Main navigation"] a')]
    .map((node) => node.textContent), ['Search & ask', 'Room maps']);
  assert.equal(button('Ask').disabled, true);
  assert.equal(button('Search').type, 'submit');
  assert.equal(button('Ask').type, 'button');
  assert.equal(host.querySelector('.detail'), null);
  await type(input, '  ');
  assert.equal(button('Ask').disabled, true);
  await type(input, 'Tool');
  assert.deepEqual(publicNames(), ['Tool 10', 'Tool 2']);
  await click(button('Search'));
  assert.deepEqual(publicNames(), ['Tool 10', 'Tool 2']);
  await type(input, '');
  await click(button('Materials'));
  assert.deepEqual(publicNames(), ['Solder']);
  await click(button('All'));
  assert.equal(publicNames().length, 3);
  assert.equal(writes.length, 0, 'Typing, browsing, and Search never call the assistant');
});

test('Ask uses the shared input; recommendations keep tiers, item details, and refinement', async () => {
  mockAssistantApi();
  await render(createElement(App), '/?item=tool2');
  const input = discoveryInput();
  await type(input, '  Build a project  ');
  await click(button('Ask'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.body.projectDescription, 'Build a project');
  assert.equal(new URL(currentUrl(), 'http://localhost').searchParams.get('mode'), 'ask');
  assert.equal(host.querySelector('.item-detail'), null, 'A new ask clears unrelated item details');
  assert.equal(discoveryInput(), input);
  assert.equal(input.value, '  Build a project  ');
  assert.equal(host.querySelectorAll('.discovery input, .discovery textarea').length, 1);
  assert.equal(button('Ask').getAttribute('aria-pressed'), 'true');
  assert.deepEqual([...host.querySelectorAll('.tier h3')].map((node) => node.textContent),
    ['Equipment in the Garage', 'Materials in the Garage', 'Not available here']);
  assert.equal(host.querySelector('.in-garage .path')?.textContent, path('bin-2'));
  assert.equal(host.querySelector('.not-in-garage button'), null);
  const recommendedItem = host.querySelector<HTMLButtonElement>('.in-garage button');
  assert.ok(recommendedItem);
  await click(recommendedItem);
  assert.equal(host.querySelector('.item-detail h2')?.textContent, 'Tool 2');
  await click(button('Close'));
  assert.ok(host.querySelector('.recommendation'));
  await type(input, 'Build a smaller project');
  await click(button('Ask'));
  assert.equal(writes[1]?.body.projectDescription, 'Build a smaller project');
});

test('an empty or whitespace search shows the whole active inventory beyond 60 results', async () => {
  mockAssistantApi();
  const appFetch = globalThis.fetch;
  const inventory = Array.from({ length: 75 }, (_, index) => ({
    ...item, id: `inventory-${index}`, name: `Inventory item ${index}`,
    categoryIds: [index % 2 === 0 ? 'tools' : 'materials'],
  }));
  globalThis.fetch = async (url, init) => url === '/api/catalog'
    ? jsonResponse({ ...gridCatalog, items: [...inventory, { ...item, retiredAt: '2026-09-18T00:00:00Z' }] })
    : appFetch(url, init);
  await render(createElement(App), '/?mode=ask&q=%20%20');
  assert.equal(publicNames().length, 75);
  assert.equal(host.querySelector('.assistant'), null);
  assert.equal(button('Ask').disabled, true);
  await type(discoveryInput(), '');
  assert.deepEqual(publicNames(), inventory.map((entry) => entry.name));
  await click(button('Tools'));
  assert.equal(publicNames().length, 38, 'Explicit category browsing remains available');
  await click(button('Search'));
  assert.equal(publicNames().length, 75, 'Submitting an empty search clears category filters');
  assert.equal(button('All').classList.contains('active'), true);
  assert.equal(writes.length, 0);
});

test('clearing the shared input resets filters and details and leaves Ask mode', async () => {
  mockAssistantApi();
  await render(createElement(App), '/?category=tools&q=Tool&item=tool2');
  await type(discoveryInput(), '');
  assert.equal(currentUrl(), '/');
  assert.equal(publicNames().length, 3);
  assert.equal(host.querySelector('.detail'), null);
  await click(button('Tools'));
  await type(discoveryInput(), 'Build a project');
  await click(button('Ask'));
  assert.ok(host.querySelector('.recommendation'));
  await type(discoveryInput(), '   ');
  assert.equal(publicNames().length, 3);
  assert.equal(host.querySelector('.assistant'), null);
  assert.equal(button('All').classList.contains('active'), true);
  assert.equal(button('Ask').disabled, true);
  assert.equal(writes.length, 1);
});

test('clearing the shared input cancels a pending ask and keeps the inventory visible', async () => {
  let finish = (_response: Response): void => { throw new Error('Uninitialized'); };
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  let signal: RequestInit['signal'];
  mockAssistantApi(async (init) => {
    signal = init?.signal;
    return pending;
  });
  await render(createElement(App), '/?q=Build+a+project');
  await click(button('Ask'));
  await type(discoveryInput(), '');
  assert.equal(signal?.aborted, true);
  assert.equal(publicNames().length, 3);
  await act(async () => { finish(jsonResponse(recommendation)); await pending; });
  assert.equal(publicNames().length, 3);
  assert.equal(host.querySelector('.assistant'), null);
  assert.equal(host.querySelector('[role="alert"]'), null);
});

test('an empty catalog explains that no items exist rather than claiming a blank query did not match', async () => {
  mockAssistantApi();
  const appFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => url === '/api/catalog'
    ? jsonResponse({ ...gridCatalog, items: [] }) : appFetch(url, init);
  await render(createElement(App), '/');
  assert.equal(host.querySelector('.empty h2')?.textContent, 'No items to show.');
  assert.match(host.querySelector('.empty p')?.textContent ?? '', /no active items/);
});

test('Search returns from Ask using the same text and category without another assistant request', async () => {
  mockAssistantApi();
  await render(createElement(App), '/?category=materials');
  const input = discoveryInput();
  await type(input, 'Build a project');
  await click(button('Ask'));
  await type(input, 'Solder');
  const form = host.querySelector<HTMLFormElement>('.discovery-form');
  assert.ok(form);
  await act(() => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(host.querySelector('.assistant'), null);
  assert.equal(discoveryInput(), input);
  assert.deepEqual(publicNames(), ['Solder']);
  assert.equal(button('Materials').classList.contains('active'), true);
  assert.equal(button('Search').getAttribute('aria-pressed'), 'true');
  assert.equal(writes.length, 1);
  await click(button('History back'));
  assert.ok(host.querySelector('.assistant'));
  await click(button('History forward'));
  assert.deepEqual(publicNames(), ['Solder']);
  assert.equal(writes.length, 1, 'History never resubmits an assistant request');
});

test('Search cancels a pending ask and late responses cannot replace a newer answer', async () => {
  let finish = (_response: Response): void => { throw new Error('Uninitialized'); };
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  let signal: RequestInit['signal'];
  mockAssistantApi(async (init) => {
    if (writes.length === 1) {
      signal = init?.signal;
      return pending;
    }
    return jsonResponse({ ...recommendation, understoodAs: 'The newer project' });
  });
  await render(createElement(App), '/');
  await type(discoveryInput(), 'The original project');
  await click(button('Ask'));
  assert.equal(button('Thinking...').disabled, true);
  assert.match(host.querySelector('[role="status"]')?.textContent ?? '', /Finding tools and materials/);
  await click(button('Thinking...'));
  assert.equal(writes.length, 1);
  await click(button('Search'));
  assert.equal(signal?.aborted, true);
  assert.equal(button('Ask').disabled, false);
  await type(discoveryInput(), 'A newer project');
  await click(button('Ask'));
  assert.equal(host.querySelector('.understood')?.textContent, 'The newer project');
  await act(async () => { finish(jsonResponse(recommendation)); await pending; });
  assert.equal(host.querySelector('.understood')?.textContent, 'The newer project');
  assert.equal(host.querySelector('[role="alert"]'), null);
});

test('assistant failures keep the shared input editable and retry clears the error', async () => {
  mockAssistantApi(async () => writes.length === 1
    ? new Response(JSON.stringify({ error: 'Assistant is unavailable. Try again.' }), { status: 503 })
    : jsonResponse({ understoodAs: 'A small project', garageItems: [], notInGarage: [] }));
  await render(createElement(App), '/?q=Build+a+project');
  await click(button('Ask'));
  assert.match(host.querySelector('[role="alert"]')?.textContent ?? '', /Assistant is unavailable/);
  assert.equal(discoveryInput().value, 'Build a project');
  assert.equal(button('Ask').disabled, false);
  await type(discoveryInput(), 'A small project');
  await click(button('Ask'));
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.match(host.querySelector('.recommendation')?.textContent ?? '', /doesn't appear to have much/);
  assert.equal(writes.length, 2);
});

test('leaving discovery cancels the pending request', async () => {
  let finish = (_response: Response): void => { throw new Error('Uninitialized'); };
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  let signal: RequestInit['signal'];
  mockAssistantApi(async (init) => {
    signal = init?.signal;
    return pending;
  });
  await render(createElement(App), '/?q=Build+a+project');
  await click(button('Ask'));
  await click(link('Room maps'));
  assert.equal(signal?.aborted, true);
  await act(async () => { finish(jsonResponse(recommendation)); await pending; });
  assert.equal(currentUrl(), '/maps');
  assert.equal(host.querySelector('.assistant'), null);
});

test('legacy assistant bookmarks redirect with query and item intact without submitting', async () => {
  mockAssistantApi();
  await render(createElement(App), '/assistant?q=Build+a+project&item=tool2&category=tools');
  const url = new URL(currentUrl(), 'http://localhost');
  assert.equal(url.pathname, '/');
  assert.equal(url.searchParams.get('mode'), 'ask');
  assert.equal(url.searchParams.get('category'), 'tools');
  assert.equal(discoveryInput().value, 'Build a project');
  assert.equal(host.querySelector('.item-detail h2')?.textContent, 'Tool 2');
  assert.equal(button('Ask').getAttribute('aria-pressed'), 'true');
  assert.equal(host.querySelector('[aria-current="page"]')?.textContent, 'Search & ask');
  assert.equal(writes.length, 0);
});

test('missing item recovery preserves the unified query and action', async () => {
  mockAssistantApi();
  await render(createElement(App), '/?mode=ask&q=Build+a+project&item=missing');
  assert.match(host.textContent ?? '', /Item not found/);
  const recovery = link('Return to search & ask');
  assert.equal(new URL(recovery.href).searchParams.has('item'), false);
  await click(recovery);
  assert.equal(discoveryInput().value, 'Build a project');
  assert.equal(button('Ask').getAttribute('aria-pressed'), 'true');
  assert.equal(host.querySelector('.detail'), null);
});

test('a protected bookmark waits for sign-in and opens the requested page after login', async () => {
  let finishSession = (_response: Response): void => { throw new Error('Uninitialized'); };
  const pendingSession = new Promise<Response>((resolve) => { finishSession = resolve; });
  mockAppApi(false);
  const respond = globalThis.fetch;
  globalThis.fetch = (url, init) => url === '/api/auth/session' ? pendingSession : respond(url, init);
  await render(createElement(App), '/manage/categories');
  assert.match(host.textContent ?? '', /Checking staff sign-in/);
  assert.equal(currentUrl(), '/manage/categories');
  await act(async () => { finishSession(jsonResponse({ staff: false })); await pendingSession; });
  assert.match(host.textContent ?? '', /Staff sign-in required/);
  assert.equal(currentUrl(), '/manage/categories');
  assert.equal(host.querySelector('.staff-panel'), null);
  await click(button('Staff sign in'));
  const passphrase = host.querySelector<HTMLInputElement>('input[type="password"]');
  assert.ok(passphrase);
  await type(passphrase, 'test-only');
  await click(button('Sign in'));
  assert.equal(currentUrl(), '/manage/categories');
  assert.equal(host.querySelector('.manager h3')?.textContent, 'Categories');
  assert.equal(currentUrl().includes('test-only'), false);
  await click(button('Sign out'));
  assert.equal(host.querySelector('.staff-panel'), null);
  assert.match(host.textContent ?? '', /Staff sign-in required/);
});

test('unknown pages and missing-item links show an explicit not-found state', async () => {
  mockAppApi();
  await render(createElement(App), '/missing-page');
  assert.match(host.textContent ?? '', /Page not found/);
  await click(link('Return to search'));
  assert.equal(currentUrl(), '/');
});

test('the browser router follows real popstate events for browser Back and Forward', { timeout: 5000 }, async () => {
  mockAppApi();
  window.history.replaceState(null, '', '/manage/categories');
  const browserRouter = createBrowserRouter([{ path: '*', element: createElement(App) }]);
  testRouter = browserRouter;
  await act(() => root.render(createElement(RoomMapSourcesContext.Provider, { value: pointMapSources },
    createElement(RouterProvider, { router: browserRouter }))));
  assert.equal(host.querySelector('.manager h3')?.textContent, 'Categories');
  await click(link('Locations'));
  assert.equal(window.location.pathname, '/manage/locations');
  const back = new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
  await act(async () => { window.history.back(); await back; });
  assert.equal(window.location.pathname, '/manage/categories');
  assert.equal(host.querySelector('.manager h3')?.textContent, 'Categories');
  const forward = new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
  await act(async () => { window.history.forward(); await forward; });
  assert.equal(window.location.pathname, '/manage/locations');
  assert.ok(host.querySelector('.location-map-editor'));
  assert.ok(host.querySelector('.manager .tree'));
});

test('flag-queue bookmarks preserve Show resolved in the URL', async () => {
  mockAppApi();
  const respond = globalThis.fetch;
  globalThis.fetch = (url, init) => url === '/api/flags' ? Promise.resolve(jsonResponse([
    { id: 'report', itemId: 'tool2', type: 'not-here', createdAt: '2026-09-17T00:00:00Z', resolved: true },
  ])) : respond(url, init);
  await render(createElement(App), '/manage/flags?resolved=1');
  const checkbox = host.querySelector<HTMLInputElement>('.inline-check input');
  assert.ok(checkbox);
  assert.equal(checkbox.checked, true);
  assert.ok(host.querySelector('.flat-list li.resolved'));
  await click(checkbox);
  assert.equal(currentUrl(), '/manage/flags');
  assert.equal(host.querySelector('.flat-list li.resolved'), null);
  await click(button('History back'));
  assert.equal(checkbox.checked, true);
  assert.ok(host.querySelector('.flat-list li.resolved'));
});

test('bulk Save and row Delete use labeled icons without visible text', async () => {
  await render(createElement(ItemsManager, { catalog: multiCatalog, mode: 'live', onChanged: () => {} }));
  const remove = button('Delete Vise');
  assert.equal(remove.textContent?.trim(), '');
  assert.match(remove.title, /Vise.*recycle bin/);
  assert.equal(remove.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
  await click(checkboxFor('Vise'));
  const save = button('Save');
  assert.equal(save.textContent?.trim(), '');
  assert.equal(save.title, 'Save changes to selected items');
  assert.equal(save.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
  assert.equal(save.disabled, true);
  await choose(combobox('Move to'));
  await click(save);
  assert.deepEqual(writes[0]?.body, { ids: ['vise'], changes: { locationId: 'destination' } });
});

test('row Delete needs no checked selection and sends only that item to the recycle bin', async () => {
  let refreshes = 0;
  await render(createElement(ItemsManager, {
    catalog: multiCatalog, mode: 'live', onChanged: () => { refreshes++; },
  }));
  assert.equal(host.querySelector('.bulk-bar'), null);
  await click(button('Delete Vise'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.url, '/api/items/bulk-retire');
  assert.deepEqual(writes[0]?.body, { ids: ['vise'], retired: true });
  assert.equal(refreshes, 1);
  assert.match(host.querySelector('[role="status"]')?.textContent ?? '', /Moved Vise to the recycle bin/);
});

test('deleting an unselected row preserves unrelated checked items and unsaved bulk edits', async () => {
  await render(createElement(ItemsManager, { catalog: multiCatalog, mode: 'live', onChanged: () => {} }));
  await click(checkboxFor('Vise'));
  await choose(combobox('Move to'));
  await click(button('Delete Solder'));
  assert.deepEqual(writes[0]?.body, { ids: ['solder'], retired: true });
  assert.equal(checkboxFor('Vise').checked, true);
  assert.equal(combobox('Move to').value, path('destination'));
  assert.equal(button('Save').disabled, false);
  assert.equal(writes.length, 1);
});

test('deleting a checked row removes only its selection and discards the old bulk draft', async () => {
  await render(createElement(ItemsManager, { catalog: multiCatalog, mode: 'live', onChanged: () => {} }));
  await click(checkboxFor('Vise'));
  await click(checkboxFor('Solder'));
  await choose(combobox('Move to'));
  await click(button('Delete Vise'));
  assert.deepEqual(writes[0]?.body, { ids: ['vise'], retired: true });
  assert.equal(checkboxFor('Vise').checked, false);
  assert.equal(checkboxFor('Solder').checked, true);
  assert.equal(combobox('Move to').value, '');
  assert.equal(button('Save').disabled, true);
});

test('a failed row Delete surfaces its error and preserves selection for retry', async () => {
  let refreshes = 0;
  const succeed = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    await succeed(...args);
    return new Response(JSON.stringify({ error: 'Could not delete item' }), { status: 500 });
  };
  await render(createElement(ItemsManager, {
    catalog: multiCatalog, mode: 'live', onChanged: () => { refreshes++; },
  }));
  await click(checkboxFor('Vise'));
  await choose(combobox('Move to'));
  await click(button('Delete Vise'));
  assert.equal(refreshes, 0);
  assert.equal(checkboxFor('Vise').checked, true);
  assert.equal(combobox('Move to').value, path('destination'));
  assert.match(host.querySelector('[role="alert"]')?.textContent ?? '', /Could not delete item/);
  assert.equal(button('Delete Vise').disabled, false);
  globalThis.fetch = succeed;
  await click(button('Delete Vise'));
  assert.equal(refreshes, 1);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], writes[1]);
});

test('recycle-bin rows retain Restore and do not offer permanent Delete', async () => {
  const binCatalog = { ...catalog, items: [{ ...item, retiredAt: '2026-09-17T00:00:00.000Z' }] };
  await render(createElement(ItemsManager, { catalog: binCatalog, mode: 'bin', onChanged: () => {} }));
  assert.equal(host.querySelector('.item-row-actions [aria-label^="Delete "]'), null);
  await click(button('Restore'));
  assert.deepEqual(writes[0]?.body, { ids: ['vise'], retired: false });
});

const editorName = (): HTMLInputElement => {
  const input = host.querySelector<HTMLInputElement>('.editor input');
  assert.ok(input);
  return input;
};
const unloadIsBlocked = (): boolean => {
  const event = new dom.window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

test('unchanged item forms allow navigation and do not warn on unload', async () => {
  await render(createElement(StaffPanel, { catalog, onChanged: () => {} }), '/manage/items/vise/edit');
  assert.equal(unloadIsBlocked(), false);
  await click(link('Categories'));
  assert.equal(currentUrl(), '/manage/categories');
  assert.equal(host.querySelector('[role="alertdialog"]'), null);
});

test('leaving a dirty item warns; staying or Escape preserves it, and discarding completes Cancel', async () => {
  await render(createElement(StaffPanel, { catalog, onChanged: () => {} }), '/manage/items/vise/edit');
  await type(editorName(), 'Updated vise');
  assert.equal(unloadIsBlocked(), true);
  await click(link('Categories'));
  assert.equal(currentUrl(), '/manage/items/vise/edit');
  let dialog = host.querySelector<HTMLDialogElement>('[role="alertdialog"]');
  assert.ok(dialog?.open);
  assert.match(dialog.textContent ?? '', /unsaved changes/i);
  assert.equal(document.activeElement, button('Stay on page'));
  await click(button('Stay on page'));
  assert.equal(currentUrl(), '/manage/items/vise/edit');
  assert.equal(editorName().value, 'Updated vise');
  await click(button('Cancel'));
  dialog = host.querySelector<HTMLDialogElement>('[role="alertdialog"]');
  assert.ok(dialog);
  await act(() => { dialog.dispatchEvent(new dom.window.Event('cancel', { cancelable: true })); });
  assert.equal(host.querySelector('[role="alertdialog"]'), null);
  assert.equal(editorName().value, 'Updated vise');
  await click(button('Cancel'));
  await click(button('Discard changes'));
  assert.equal(currentUrl(), '/manage/items');
  assert.equal(unloadIsBlocked(), false);
  assert.equal(writes.length, 0);
});

test('undoing an edit back to its original value clears the warning', async () => {
  await render(createElement(StaffPanel, { catalog, onChanged: () => {} }), '/manage/items/vise/edit');
  await type(editorName(), 'Changed');
  assert.equal(unloadIsBlocked(), true);
  await type(editorName(), 'Vise');
  assert.equal(unloadIsBlocked(), false);
  await click(button('Cancel'));
  assert.equal(currentUrl(), '/manage/items');
  assert.equal(host.querySelector('[role="alertdialog"]'), null);
});

test('new-item drafts are protected, including invalid unsaved values', async () => {
  await render(createElement(StaffPanel, { catalog, onChanged: () => {} }), '/manage/items/new');
  assert.equal(unloadIsBlocked(), false);
  const notes = host.querySelector<HTMLTextAreaElement>('.safety-field textarea');
  assert.ok(notes);
  await type(notes, 'Draft safety text');
  await click(link('Locations'));
  assert.ok(host.querySelector('[role="alertdialog"]'));
  await click(button('Stay on page'));
  assert.equal(notes.value, 'Draft safety text');
  assert.equal(currentUrl(), '/manage/items/new');
});

test('typing a location query does not dirty the form, but choosing a location does', async () => {
  await render(createElement(StaffPanel, { catalog, onChanged: () => {} }), '/manage/items/vise/edit');
  const input = combobox('Location');
  await focus(input);
  await type(input, 'spare');
  assert.equal(unloadIsBlocked(), false);
  await key(input, 'Enter');
  assert.equal(unloadIsBlocked(), true);
  await click(button('Cancel'));
  assert.ok(host.querySelector('[role="alertdialog"]'));
});

test('Back and Forward both block leaving a dirty item and retain their intended destinations', async () => {
  await render(createElement(StaffPanel, { catalog, onChanged: () => {} }), '/manage/items');
  await click(button('Edit Vise'));
  await type(editorName(), 'Unsaved');
  await click(button('History back'));
  assert.equal(currentUrl(), '/manage/items/vise/edit');
  assert.ok(host.querySelector('[role="alertdialog"]'));
  await click(button('Stay on page'));
  assert.equal(editorName().value, 'Unsaved');
  await click(button('History back'));
  await click(button('Discard changes'));
  assert.equal(currentUrl(), '/manage/items');
  await click(button('History forward'));
  assert.equal(editorName().value, 'Vise');
  await click(link('Categories'));
  await click(button('History back'));
  await type(editorName(), 'Another draft');
  await click(button('History forward'));
  assert.equal(currentUrl(), '/manage/items/vise/edit');
  await click(button('Discard changes'));
  assert.equal(currentUrl(), '/manage/categories');
  assert.equal(writes.length, 0);
});

test('successful Save leaves without a warning and removes unload protection', async () => {
  let refreshes = 0;
  await render(createElement(StaffPanel, {
    catalog, onChanged: () => { refreshes++; },
  }), '/manage/items/vise/edit');
  await type(editorName(), 'Saved vise');
  await click(button('Save changes'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.body.name, 'Saved vise');
  assert.equal(refreshes, 1);
  assert.equal(currentUrl(), '/manage/items');
  assert.equal(host.querySelector('[role="alertdialog"]'), null);
  assert.equal(unloadIsBlocked(), false);
});

test('failed Save keeps the draft and its navigation warning', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Save failed' }), { status: 500 });
  await render(createElement(StaffPanel, { catalog, onChanged: () => {} }), '/manage/items/vise/edit');
  await type(editorName(), 'Still unsaved');
  await click(button('Save changes'));
  assert.equal(currentUrl(), '/manage/items/vise/edit');
  assert.equal(editorName().value, 'Still unsaved');
  assert.match(host.querySelector('[role="alert"]')?.textContent ?? '', /Save failed/);
  assert.equal(unloadIsBlocked(), true);
  await click(link('Categories'));
  assert.ok(host.querySelector('[role="alertdialog"]'));
  await click(button('Stay on page'));
  assert.equal(editorName().value, 'Still unsaved');
});

test('a catalog refresh cannot replace an unsaved item draft', async () => {
  const props = { categories, locations, onSaved: () => {}, onCancel: () => {} };
  await render(createElement(ItemEditor, { ...props, item }));
  await type(editorName(), 'My local draft');
  await render(createElement(ItemEditor, {
    ...props, item: { ...item, name: 'Remote update' }, locations: [...locations],
  }));
  assert.equal(editorName().value, 'My local draft');
  assert.equal(unloadIsBlocked(), true);
});

test('pending saves protect the snapshot and finish without a second leave warning', async () => {
  let release = (_response: Response): void => { throw new Error('Uninitialized'); };
  const pending = new Promise<Response>((resolve) => { release = resolve; });
  globalThis.fetch = () => pending;
  await render(createElement(StaffPanel, { catalog, onChanged: () => {} }), '/manage/items/vise/edit');
  await type(editorName(), 'Saving now');
  await click(button('Save changes'));
  assert.equal(host.querySelector<HTMLFieldSetElement>('.editor-fields')?.disabled, true);
  await click(link('Locations'));
  assert.ok(host.querySelector('[role="alertdialog"]'));
  assert.equal(button('Discard changes').disabled, true);
  await act(async () => {
    release(jsonResponse({ ...item, name: 'Saving now' }));
    await pending;
  });
  assert.equal(currentUrl(), '/manage/items');
  assert.equal(host.querySelector('[role="alertdialog"]'), null);
  assert.equal(unloadIsBlocked(), false);
});

test('sign-out asks before discarding an unsaved item', async () => {
  mockAppApi();
  const respond = globalThis.fetch;
  let signOuts = 0;
  globalThis.fetch = (url, init) => {
    if (url === '/api/auth/logout') signOuts++;
    return respond(url, init);
  };
  let confirmations = 0;
  window.confirm = () => { confirmations++; return false; };
  await render(createElement(App), '/manage/items/tool2/edit');
  await type(editorName(), 'Private draft');
  await click(button('Sign out'));
  assert.equal(confirmations, 1);
  assert.equal(signOuts, 0);
  assert.equal(editorName().value, 'Private draft');
  window.confirm = () => true;
  await click(button('Sign out'));
  assert.equal(signOuts, 1);
  assert.equal(host.querySelector('.editor'), null);
  assert.match(host.textContent ?? '', /Staff sign-in required/);
  assert.equal(unloadIsBlocked(), false);
});

test('real browser Back restores the edit URL while the warning is pending', { timeout: 5000 }, async () => {
  mockAppApi();
  window.history.replaceState(null, '', '/manage/items');
  const browserRouter = createBrowserRouter([{ path: '*', element: createElement(App) }]);
  testRouter = browserRouter;
  await act(() => root.render(createElement(RoomMapSourcesContext.Provider, { value: pointMapSources },
    createElement(RouterProvider, { router: browserRouter }))));
  await click(button('Edit Tool 2'));
  const editUrl = window.location.pathname;
  await type(editorName(), 'Browser draft');
  const restored = new Promise<void>((resolve) => {
    let events = 0;
    const listener = (): void => {
      // The initial Back pop is followed by the router restoring the blocked edit entry.
      if (++events === 2) {
        window.removeEventListener('popstate', listener);
        resolve();
      }
    };
    window.addEventListener('popstate', listener);
  });
  await act(async () => { window.history.back(); await restored; });
  assert.equal(window.location.pathname, editUrl);
  assert.equal(editorName().value, 'Browser draft');
  assert.ok(host.querySelector('[role="alertdialog"]'));
  await click(button('Stay on page'));
  assert.equal(window.location.pathname, editUrl);
  assert.equal(editorName().value, 'Browser draft');
});

test('the New item plus and row Edit paintbrush retain accessible names and navigation', async () => {
  await render(createElement(StaffPanel, { catalog, onChanged: () => {} }));
  const add = button('New item');
  assert.equal(add.textContent?.trim(), '');
  assert.equal(add.title, 'New item');
  assert.ok(add.querySelector('svg.action-icon-add[aria-hidden="true"]'));
  await click(add);
  assert.equal(currentUrl(), '/manage/items/new');
  await click(button('Cancel'));
  const edit = button('Edit Vise');
  assert.equal(edit.textContent?.trim(), '');
  assert.equal(edit.title, 'Edit Vise');
  assert.ok(edit.querySelector('svg.action-icon-edit[aria-hidden="true"]'));
  await click(edit);
  assert.equal(currentUrl(), '/manage/items/vise/edit');
  assert.equal(editorName().value, 'Vise');
  assert.equal(writes.length, 0);
});

test('the item-detail paintbrush opens the editor for that item', async () => {
  mockAppApi();
  await render(createElement(App), '/?item=tool2');
  const edit = button('Edit Tool 2');
  assert.equal(edit.textContent?.trim(), '');
  assert.equal(edit.title, 'Edit Tool 2');
  assert.ok(edit.querySelector('svg.action-icon-edit'));
  await click(edit);
  assert.equal(currentUrl(), '/manage/items/tool2/edit');
  assert.equal(editorName().value, 'Tool 2');
});

test('the item-detail paintbrush stays hidden from visitors', async () => {
  mockAppApi(false);
  await render(createElement(App), '/?item=tool2');
  assert.ok(host.querySelector('.item-detail'));
  assert.equal(host.querySelector('.item-detail .action-icon-edit'), null);
});

const mapLocations: Location[] = [
  { id: 'common', name: 'Common Makerspace', kind: 'room', parentId: null, mapId: 'common' },
  { id: 'advanced', name: 'Advanced Makerspace', kind: 'room', parentId: null, mapId: 'advanced' },
  { id: 'table-a', name: 'Table A', kind: 'table', parentId: 'common', mapPosition: { roomId: 'common', mapId: 'common', x: 0.5, y: 0.6 } },
  { id: 'bin-a', name: 'Bin A', kind: 'bin', parentId: 'table-a' },
  { id: 'table-3', name: 'Table 3', kind: 'table', parentId: 'advanced', mapPosition: { roomId: 'advanced', mapId: 'advanced', x: 0.8, y: 0.14 } },
];
const markerLocations: Location[] = mapLocations.map((location) => location.id === 'bin-a'
  ? { ...location, mapPosition: { roomId: 'common', mapId: 'common', x: 0.7, y: 0.6 } } : location);
const mappedCatalog = {
  categories, locations: mapLocations,
  items: [
    { ...item, locationId: 'bin-a' },
    { ...item, id: 'retired-vise', name: 'Retired vise', locationId: 'bin-a', retiredAt: '2026-01-01T00:00:00Z' },
  ],
};

const mapDialog = (): HTMLDialogElement => {
  const dialog = document.querySelector<HTMLDialogElement>('.location-map-dialog');
  assert.ok(dialog?.open, 'Expected an open map picker');
  return dialog;
};
const pickerMarker = (name: string): HTMLButtonElement => {
  const marker = [...mapDialog().querySelectorAll<HTMLButtonElement>('.map-marker')]
    .find((node) => node.title === name);
  assert.ok(marker, `Missing map picker marker ${name}`);
  return marker;
};
function MappedField(): ReactElement {
  const [value, setValue] = useState('bin-a');
  return createElement(LocationPicker, { locations: mapLocations, value, onSelect: setValue });
}

test('the item editor location panel follows draft locations and highlights approximate ancestors', async () => {
  await render(createElement(ItemEditor, {
    item: mappedCatalog.items[0]!, categories, locations: mapLocations, onSaved: () => {}, onCancel: () => {},
  }));
  const panel = host.querySelector<HTMLElement>('.editor-location');
  assert.ok(panel);
  assert.ok(panel.contains(combobox('Location')));
  assert.equal(panel.querySelector('.location-map-trigger'), null);
  assert.equal(panel.querySelector('img')?.getAttribute('data-map-src'), '/maps/common-makerspace.svg');
  assert.equal(panel.querySelector('.map-marker.selected')?.getAttribute('title'), 'Table A');
  assert.match(panel.textContent ?? '', /Approximate location:.*Table A/);
  await choose(combobox('Location'), 'table 3');
  assert.equal(panel.querySelector('img')?.getAttribute('data-map-src'), '/maps/advanced-makerspace.svg');
  assert.equal(panel.querySelector('.map-marker.selected')?.getAttribute('title'), 'Table 3');
  assert.equal(panel.textContent?.includes('Approximate location'), false);
  assert.equal(panel.querySelector('a'), null);
  assert.equal(writes.length, 0);
  assert.equal(currentUrl(), '/manage/items');
});

test('clicking the inline item map changes only the draft until Save', async () => {
  await render(createElement(ItemEditor, {
    item: mappedCatalog.items[0]!, categories, locations: mapLocations, onSaved: () => {}, onCancel: () => {},
  }));
  const marker = host.querySelector<HTMLButtonElement>('.editor-location .map-marker');
  assert.ok(marker);
  await click(marker);
  assert.equal(combobox('Location').value, 'Common Makerspace → Table A');
  assert.equal(writes.length, 0);
  assert.equal(unloadIsBlocked(), true);
  await click(button('Save changes'));
  assert.equal(writes[0]?.url, '/api/items/vise');
  assert.equal(writes[0]?.body.locationId, 'table-a');
});

test('item room tabs switch maps without moving the item until a marker is chosen', async () => {
  await render(createElement(ItemEditor, {
    item: mappedCatalog.items[0]!, categories, locations: mapLocations, onSaved: () => {}, onCancel: () => {},
  }));
  const panel = host.querySelector<HTMLElement>('.editor-location');
  assert.ok(panel);
  const initial = combobox('Location').value;
  assert.equal(button('Common Makerspace').getAttribute('aria-pressed'), 'true');
  await click(button('Advanced Makerspace'));
  assert.equal(button('Advanced Makerspace').getAttribute('aria-pressed'), 'true');
  assert.equal(button('Common Makerspace').getAttribute('aria-pressed'), 'false');
  assert.equal(panel.querySelector('img')?.getAttribute('data-map-src'), '/maps/advanced-makerspace.svg');
  assert.equal(panel.querySelector('.map-marker.selected'), null);
  assert.equal(combobox('Location').value, initial);
  assert.equal(unloadIsBlocked(), false);
  assert.match(panel.textContent ?? '', /Switching room tabs does not move the item/);
  assert.equal(panel.textContent?.includes('Approximate location'), false);
  assert.equal(writes.length, 0);
  const marker = panel.querySelector<HTMLButtonElement>('.map-marker');
  assert.ok(marker);
  await click(marker);
  assert.equal(combobox('Location').value, 'Advanced Makerspace → Table 3');
  assert.equal(unloadIsBlocked(), true);
  assert.equal(writes.length, 0);
  await click(button('Save changes'));
  assert.equal(writes[0]?.body.locationId, 'table-3');
});

test('location search returns the room tabs to the chosen location, including reselecting the current value', async () => {
  await render(createElement(ItemEditor, {
    item: mappedCatalog.items[0]!, categories, locations: mapLocations, onSaved: () => {}, onCancel: () => {},
  }));
  await click(button('Advanced Makerspace'));
  await choose(combobox('Location'), 'bin a');
  assert.equal(button('Common Makerspace').getAttribute('aria-pressed'), 'true');
  assert.equal(host.querySelector('.editor-location .map-marker.selected')?.getAttribute('title'), 'Table A');
  assert.equal(unloadIsBlocked(), false);
  await choose(combobox('Location'), 'table 3');
  assert.equal(button('Advanced Makerspace').getAttribute('aria-pressed'), 'true');
  assert.equal(host.querySelector('.editor-location .map-marker.selected')?.getAttribute('title'), 'Table 3');
  assert.equal(writes.length, 0);
});

test('an unmapped item can browse room tabs and select a mapped location', async () => {
  await render(createElement(ItemEditor, {
    item, categories, locations: [...locations, ...mapLocations], onSaved: () => {}, onCancel: () => {},
  }));
  assert.match(host.querySelector('.editor-location')?.textContent ?? '', /selected location has no floor plan/);
  await click(button('Advanced Makerspace'));
  assert.equal(combobox('Location').value, path(item.locationId));
  const marker = host.querySelector<HTMLButtonElement>('.editor-location .map-marker');
  assert.ok(marker);
  await click(marker);
  assert.equal(combobox('Location').value, 'Advanced Makerspace → Table 3');
  assert.equal(writes.length, 0);
});

test('new and unmapped items keep the location panel usable without implying a precise marker', async () => {
  const props = { categories, onSaved: () => {}, onCancel: () => {} };
  await render(createElement(ItemEditor, { ...props, item: null, locations: mapLocations }));
  assert.ok(host.querySelector('.editor-location img'));
  assert.equal(host.querySelector('.editor-location .map-marker.selected'), null);
  assert.match(host.querySelector('.editor-location')?.textContent ?? '', /Room shown; this location has no marker or linked SVG shape yet/);
  await render(createElement(ItemEditor, { ...props, item, locations }));
  assert.equal(host.querySelector('.editor-location img'), null);
  assert.match(host.querySelector('.editor-location')?.textContent ?? '', /No floor plan is available/);
  await choose(combobox('Location'));
  assert.equal(combobox('Location').value, path('destination'));
  assert.equal(writes.length, 0);
});

test('the right-hand location panel cannot change the snapshot while saving', async () => {
  let release = (_response: Response): void => { throw new Error('Uninitialized'); };
  const pending = new Promise<Response>((resolve) => { release = resolve; });
  globalThis.fetch = () => pending;
  await render(createElement(ItemEditor, {
    item: mappedCatalog.items[0]!, categories, locations: mapLocations, onSaved: () => {}, onCancel: () => {},
  }));
  await click(button('Save changes'));
  const panel = host.querySelector<HTMLFieldSetElement>('.editor-location');
  assert.equal(panel?.disabled, true);
  assert.equal(combobox('Location').disabled, true);
  assert.equal(panel?.querySelector('.location-map-trigger'), null);
  assert.equal(button('Cancel').disabled, true);
  assert.equal(button('Advanced Makerspace').disabled, true);
  await click(button('Advanced Makerspace'));
  assert.equal(panel?.querySelector('img')?.getAttribute('data-map-src'), '/maps/common-makerspace.svg');
  const marker = panel?.querySelector<HTMLButtonElement>('.map-marker');
  assert.ok(marker);
  await click(marker);
  assert.equal(combobox('Location').value, 'Common Makerspace → Table A → Bin A');
  await act(async () => {
    release(jsonResponse(mappedCatalog.items[0]));
    await pending;
  });
  assert.equal(panel?.disabled, false);
});

test('map selection opens at the current room and chooses a marker without submitting or navigating', async () => {
  let submits = 0;
  await render(createElement('form', {
    onSubmit: (event: FormEvent) => { event.preventDefault(); submits++; },
  }, createElement(MappedField)));
  const trigger = button('Location: choose on map');
  await click(trigger);
  assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(mapDialog().querySelector('img')?.getAttribute('data-map-src'), '/maps/common-makerspace.svg');
  assert.equal(pickerMarker('Table A').getAttribute('aria-pressed'), 'true');
  assert.match(mapDialog().textContent ?? '', /Approximate location:.*Table A/);
  await click(panelButton(mapDialog(), 'Advanced Makerspace'));
  assert.match(combobox('Location').value, /Bin A$/);
  await click(pickerMarker('Table 3'));
  assert.equal(combobox('Location').value, 'Advanced Makerspace → Table 3');
  assert.equal(document.querySelector('.location-map-dialog'), null);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, trigger);
  assert.equal(currentUrl(), '/manage/items');
  assert.equal(submits, 0);
  assert.equal(writes.length, 0);
  await click(trigger);
  assert.equal(mapDialog().querySelector('img')?.getAttribute('data-map-src'), '/maps/advanced-makerspace.svg');
  assert.equal(pickerMarker('Table 3').getAttribute('aria-pressed'), 'true');
});

test('closing or cancelling the map preserves the location, and search remains available', async () => {
  await render(createElement(MappedField));
  const trigger = button('Location: choose on map');
  const initial = combobox('Location').value;
  await click(trigger);
  await click(panelButton(mapDialog(), 'Advanced Makerspace'));
  await click(panelButton(mapDialog(), 'Close map'));
  assert.equal(combobox('Location').value, initial);
  await click(trigger);
  await act(() => { mapDialog().dispatchEvent(new dom.window.Event('cancel', { cancelable: true })); });
  assert.equal(document.querySelector('.location-map-dialog'), null);
  assert.equal(combobox('Location').value, initial);
  assert.equal(document.activeElement, trigger);
  await click(trigger);
  await click(panelButton(mapDialog(), 'Use search instead'));
  assert.equal(document.activeElement, combobox('Location'));
  assert.equal(combobox('Location').getAttribute('aria-expanded'), 'true');
  await choose(combobox('Location'), 'bin a');
  assert.equal(combobox('Location').value, initial);
  assert.equal(writes.length, 0);
});

test('a disabled picker closes its map and cannot select through a stale marker', async () => {
  let selections = 0;
  const props = { locations: mapLocations, value: 'table-a', onSelect: () => { selections++; } };
  await render(createElement(LocationPicker, props));
  await click(button('Location: choose on map'));
  const marker = pickerMarker('Table A');
  await render(createElement(LocationPicker, { ...props, disabled: true }));
  assert.equal(document.querySelector('.location-map-dialog'), null);
  assert.equal(button('Location: choose on map').disabled, true);
  await click(marker);
  assert.equal(selections, 0);
});

test('empty maps and failed images explicitly offer search without changing the selection', async () => {
  await render(createElement(Field));
  await click(button('Location: choose on map'));
  assert.match(mapDialog().textContent ?? '', /No floor plans are available/);
  await click(panelButton(mapDialog(), 'Use search instead'));
  await choose(combobox('Location'));
  assert.equal(combobox('Location').value, path('destination'));
  await render(createElement(MappedField));
  await click(button('Location: choose on map'));
  const image = mapDialog().querySelector('img');
  assert.ok(image);
  await act(() => { image.dispatchEvent(new dom.window.Event('error')); });
  assert.match(mapDialog().querySelector('[role="alert"]')?.textContent ?? '', /Could not load the floor plan/);
  assert.equal(mapDialog().querySelector('.map-marker'), null);
  await click(panelButton(mapDialog(), 'Use search instead'));
  assert.match(combobox('Location').value, /Bin A$/);
});

test('map choices honor exclusions, hide stale pins, and retain complete ancestor paths', async () => {
  const withStalePin = mapLocations.map((location): Location => location.id === 'bin-a'
    ? { ...location, mapPosition: { roomId: 'advanced', mapId: 'advanced', x: 0.4, y: 0.4 } }
    : location);
  let chosen: string | null = '';
  await render(createElement(LocationPicker, {
    locations: withStalePin, value: 'bin-a', allowRoot: true, excludedIds: ['table-a'],
    onSelect: (id: string | null) => { chosen = id; },
  }));
  await click(button('Location: choose on map'));
  assert.match(mapDialog().textContent ?? '', /Common Makerspace → Table A → Bin A/);
  assert.equal(mapDialog().querySelector('.map-marker'), null);
  await click(panelButton(mapDialog(), 'Choose entire room: Common Makerspace'));
  assert.equal(chosen, 'common');
  await click(button('Location: choose on map'));
  await click(panelButton(mapDialog(), 'Top level (no parent)'));
  assert.equal(chosen, null);
  assert.equal(writes.length, 0);
});

test('item location changes remain drafts until Save and survive a failed save', async () => {
  await render(createElement(ItemEditor, {
    item: mappedCatalog.items[0]!, categories, locations: mapLocations, onSaved: () => {}, onCancel: () => {},
  }));
  await choose(combobox('Location'), 'table 3');
  assert.equal(writes.length, 0);
  const save = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Save failed' }), { status: 500 });
  await click(button('Save changes'));
  assert.match(host.textContent ?? '', /Save failed/);
  assert.equal(combobox('Location').value, 'Advanced Makerspace → Table 3');
  globalThis.fetch = save;
  await click(button('Save changes'));
  assert.equal(writes[0]?.url, '/api/items/vise');
  assert.equal(writes[0]?.body.locationId, 'table-3');
});

test('new items and bulk-entry rows save locations picked on a map', async () => {
  await render(createElement(ItemEditor, {
    item: null, categories, locations: mapLocations, onSaved: () => {}, onCancel: () => {},
  }));
  await type(editorName(), 'Map-selected item');
  assert.equal(host.querySelector('.location-map-trigger'), null);
  const marker = host.querySelector<HTMLButtonElement>('.editor-location .map-marker');
  assert.ok(marker);
  await click(marker);
  assert.equal(writes.length, 0);
  await click(button('Create item'));
  assert.equal(writes[0]?.url, '/api/items');
  assert.equal(writes[0]?.body.locationId, 'table-a');
  await render(createElement(BulkEntry, { categories, locations: mapLocations, onCreated: () => {} }));
  await click(button('Default location: choose on map'));
  await click(pickerMarker('Table A'));
  const rows = host.querySelector('textarea');
  assert.ok(rows);
  await type(rows, 'Vise\nTape, consumable');
  assert.equal(writes.length, 1);
  await click(button('Add 2 item(s)'));
  assert.equal(writes[1]?.url, '/api/items/bulk');
  assert.deepEqual((writes[1]?.body.items as Array<{ locationId: string }>).map((row) => row.locationId),
    ['table-a', 'table-a']);
});

test('bulk Move to accepts map selection and writes only on Save', async () => {
  await render(createElement(ItemsManager, { catalog: mappedCatalog, mode: 'live', onChanged: () => {} }));
  const checkbox = host.querySelector<HTMLInputElement>('.row-check input');
  assert.ok(checkbox);
  await click(checkbox);
  await click(button('Move to: choose on map'));
  await click(pickerMarker('Table A'));
  assert.equal(writes.length, 0);
  assert.equal(button('Save').disabled, false);
  await click(button('Save'));
  assert.deepEqual(writes[0]?.body, { ids: ['vise'], changes: { locationId: 'table-a' } });
});

test('creating a child in a mapped room requires placement and saves metadata and marker together', async () => {
  let changed = 0;
  await render(createElement(LocationManager, { locations: mapLocations, items: [], onChanged: () => { changed++; } }));
  await click(button('Expand Common Makerspace'));
  await click(button('Add child to Table A'));
  assert.equal(host.querySelector('input[aria-label="New location name"]'), null);
  await selectLocationType('bin');
  assert.equal(host.querySelector('.location-editor [role="combobox"]'), null);
  assert.equal(host.querySelector('.location-editor .map-marker.selected'), null);
  assert.equal(button('Save').disabled, true);
  assert.match(host.querySelector('.location-placement [role="status"]')?.textContent ?? '', /Place this location/);
  await click(button('Save'));
  assert.equal(writes.length, 0);
  const current = currentUrl();
  await chooseMarkerLocation('table-a');
  assert.equal(currentUrl(), current, 'The saved-marker map stays inactive while the location form is open');
  await placeMarker(25, 40, '.location-editor .room-map-stage');
  assert.equal(button('Save').disabled, false);
  assert.equal(host.querySelector<HTMLElement>('.location-editor .map-marker.selected')?.style.left, '25%');
  await click(button('Save'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.url, '/api/locations');
  assert.equal(writes[0]?.body.name, undefined, 'The server generates storage names');
  assert.equal(writes[0]?.body.parentId, 'table-a');
  assert.equal(writes[0]?.body.kind, 'bin');
  assert.deepEqual(writes[0]?.body.mapPosition, { roomId: 'common', mapId: 'common', x: 0.25, y: 0.4 });
  assert.equal(writes[0]?.body.id, undefined, 'The server assigns the real id');
  assert.equal(changed, 1);
  assert.equal(host.querySelector('.location-editor'), null);
  assert.equal(unloadIsBlocked(), false);
});

test('children of unmapped staff storage need no marker and retain their fixed parent', async () => {
  const storage: Location = { id: 'storage', name: 'Storage Closet', kind: 'room', parentId: null, staffOnly: true };
  await render(createElement(LocationManager, { locations: [...mapLocations, storage], items: [], onChanged: () => {} }));
  await click(button('Add child to Storage Closet'));
  const name = host.querySelector<HTMLInputElement>('[aria-label="New location name"]');
  assert.ok(name);
  await type(name, 'Private shelf');
  await selectLocationType('cabinet');
  assert.equal(host.querySelector('.location-editor .room-map'), null);
  assert.match(host.querySelector('.location-editor')?.textContent ?? '', /A map marker is not required/);
  assert.match(host.querySelector('.location-editor')?.textContent ?? '', /required by the parent/);
  assert.equal(button('Save').disabled, false);
  await click(button('Save'));
  assert.equal(writes[0]?.body.parentId, storage.id);
  assert.equal(writes[0]?.body.mapPosition, undefined);
});

test('editing an unmarked mapped location requires explicit placement even when its parent is marked', async () => {
  await render(createElement(LocationManager, { locations: mapLocations, items: [], onChanged: () => {} }));
  await click(button('Expand Common Makerspace'));
  await click(button('Expand Table A'));
  await click(button('Rename or move Bin A'));
  assert.equal(button('Save').disabled, true);
  assert.equal(host.querySelector('.location-editor .map-marker.selected'), null);
  const marker = host.querySelector<HTMLButtonElement>('.location-editor .map-marker[title="Table A"]');
  assert.ok(marker);
  await click(marker);
  assert.equal(button('Save').disabled, false);
  await click(button('Save'));
  assert.equal(writes[0]?.url, '/api/locations/bin-a');
  assert.deepEqual(writes[0]?.body.mapPosition, mapLocations[2]?.mapPosition);
});

test('unsaved child creation blocks room changes and explicit discard removes the pending form', async () => {
  await render(createElement(LocationManager, { locations: mapLocations, items: [], onChanged: () => {} }),
    '/manage/locations?room=common');
  await click(button('Add child to Common Makerspace'));
  const name = host.querySelector<HTMLInputElement>('[aria-label="New location name"]');
  assert.ok(name);
  await type(name, 'Unsaved shelf');
  await selectLocationType('cabinet');
  await placeMarker(25, 40, '.location-editor .room-map-stage');
  assert.equal(unloadIsBlocked(), true);
  await click(link('Advanced Makerspace'));
  assert.ok(host.querySelector('[role="alertdialog"]'));
  assert.equal(currentUrl(), '/manage/locations?room=common');
  await click(button('Stay on page'));
  assert.equal(name.value, 'Unsaved shelf');
  assert.equal(host.querySelector<HTMLElement>('.location-editor .map-marker.selected')?.style.left, '25%');
  await click(link('Advanced Makerspace'));
  await click(button('Discard changes'));
  assert.equal(currentUrl(), '/manage/locations?room=advanced');
  assert.equal(host.querySelector('.location-editor'), null);
  assert.equal(unloadIsBlocked(), false);
  assert.equal(writes.length, 0);
});

test('failed location creation preserves fields and placement for retry', async () => {
  await render(createElement(LocationManager, { locations: mapLocations, items: [], onChanged: () => {} }));
  await click(button('Add child to Common Makerspace'));
  const name = host.querySelector<HTMLInputElement>('[aria-label="New location name"]');
  assert.ok(name);
  await type(name, 'New shelf');
  await selectLocationType('cabinet');
  await placeMarker(25, 40, '.location-editor .room-map-stage');
  const succeed = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Save unavailable' }), { status: 503 });
  await click(button('Save'));
  assert.match(host.querySelector('.location-editor [role="alert"]')?.textContent ?? '', /Save unavailable/);
  assert.equal(name.value, 'New shelf');
  assert.equal(button('Save').disabled, false);
  assert.equal(unloadIsBlocked(), true);
  globalThis.fetch = succeed;
  await click(button('Save'));
  assert.deepEqual(writes[0]?.body.mapPosition, { roomId: 'common', mapId: 'common', x: 0.25, y: 0.4 });
});

test('pending location saves lock metadata, placement, and creation targets', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  await render(createElement(LocationManager, { locations: mapLocations, items: [], onChanged: () => {} }),
    '/manage/locations?room=common');
  await click(button('Add child to Common Makerspace'));
  const name = host.querySelector<HTMLInputElement>('[aria-label="New location name"]');
  assert.ok(name);
  await type(name, 'New shelf');
  await selectLocationType('cabinet');
  await placeMarker(25, 40, '.location-editor .room-map-stage');
  globalThis.fetch = () => pending;
  await click(button('Save'));
  assert.equal(host.querySelector<HTMLFieldSetElement>('.location-editor fieldset')?.disabled, true);
  assert.equal(button('Cancel').matches(':disabled'), true);
  assert.equal(button('Add room').disabled, true);
  await placeMarker(75, 80, '.location-editor .room-map-stage');
  assert.equal(host.querySelector<HTMLElement>('.location-editor .map-marker.selected')?.style.left, '25%');
  await click(link('Advanced Makerspace'));
  assert.equal(currentUrl(), '/manage/locations?room=common');
  await act(async () => {
    finish(jsonResponse({
      id: 'new-shelf', name: 'New shelf', parentId: 'common', kind: 'cabinet',
      mapPosition: { roomId: 'common', mapId: 'common', x: 0.25, y: 0.4 },
    }));
    await pending;
  });
  assert.equal(host.querySelector('.location-editor'), null);
  assert.equal(unloadIsBlocked(), false);
});

test('switching creation targets asks before discarding and highlighted-location drafts are protected', async () => {
  await render(createElement(LocationManager, { locations: mapLocations, items: [], onChanged: () => {} }),
    '/manage/locations?room=common&pin=table-a');
  let alert = '';
  window.alert = (message) => { alert = String(message); };
  await placeMarker(25, 40);
  await click(button('Add child to Common Makerspace'));
  assert.match(alert, /Save or cancel the highlighted location/);
  assert.equal(host.querySelector('[aria-label="New child location"]'), null);
  await click(button('Cancel'));
  await click(button('Add child to Common Makerspace'));
  const name = host.querySelector<HTMLInputElement>('[aria-label="New location name"]');
  assert.ok(name);
  await type(name, 'Draft');
  window.confirm = () => false;
  await click(button('Add room'));
  assert.match(host.querySelector('.location-editor')?.textContent ?? '', /New child of Common Makerspace/);
  window.confirm = () => true;
  await click(button('Add room'));
  assert.match(host.querySelector('.location-editor')?.textContent ?? '', /New top-level room/);
  assert.equal(host.querySelector<HTMLInputElement>('[aria-label="New location name"]')?.value, '');
  assert.equal(writes.length, 0);
});

test('location management excludes self and descendants on the map and requires remapping across rooms', async () => {
  const withMappedChild = mapLocations.map((location): Location => location.id === 'bin-a'
    ? { ...location, mapPosition: { roomId: 'common', mapId: 'common', x: 0.6, y: 0.6 } }
    : location);
  await render(createElement(LocationManager, { locations: withMappedChild, items: [], onChanged: () => {} }));
  await click(button('Expand Common Makerspace'));
  await click(button('Rename or move Table A'));
  await click(button('Parent location: choose on map'));
  assert.equal(mapDialog().querySelector('.map-marker'), null);
  await click(panelButton(mapDialog(), 'Advanced Makerspace'));
  await click(panelButton(mapDialog(), 'Choose entire room: Advanced Makerspace'));
  assert.equal(combobox('Parent location').value, 'Advanced Makerspace');
  assert.equal(writes.length, 0);
  assert.equal(button('Save').disabled, true);
  assert.equal(host.querySelector('.location-editor .map-marker.selected'), null);
  await placeMarker(30, 40, '.location-editor .room-map-stage');
  await click(button('Save'));
  assert.equal(writes[0]?.url, '/api/locations/table-a');
  assert.equal(writes[0]?.body.parentId, 'advanced');
  assert.deepEqual(writes[0]?.body.mapPosition, { roomId: 'advanced', mapId: 'advanced', x: 0.3, y: 0.4 });
  await click(button('Add child to Table A'));
  assert.equal(host.querySelector('.location-editor [role="combobox"]'), null);
  assert.equal(host.querySelector('input[aria-label="New location name"]'), null);
  await selectLocationType('bin');
  assert.equal(button('Save').disabled, true);
  await placeMarker(25, 40, '.location-editor .room-map-stage');
  await click(button('Save'));
  assert.equal(writes[1]?.url, '/api/locations');
  assert.equal(writes[1]?.body.parentId, 'table-a');
});

test('map selection populates the location edit panel without recreating the map', async () => {
  await render(createElement(LocationMapEditor, {
    locations: markerLocations, onChanged: () => {},
  }), '/manage/locations?room=common');
  const editor = host.querySelector('.location-map-editor');
  assert.ok(editor);
  assert.ok(editor.querySelector('nav[aria-label="Map to edit"]'));
  const stage = editor.querySelector('.room-map-stage');
  assert.ok(stage);
  assert.equal(editor.querySelector('.location-fields'), null);
  assert.equal(editor.querySelector('.location-picker'), null);
  assert.equal(editor.querySelector('[role="combobox"]'), null);
  assert.doesNotMatch(editor.textContent ?? '', /Location to place|Choose on map|Choose a location, then click its spot/);
  await chooseMarkerLocation('table-a');
  assert.equal(currentUrl(), '/manage/locations?room=common&pin=table-a');
  assert.equal(markerPercent('X'), 50);
  assert.equal(mapLocationName().value, 'Table A');
  await click(button('Zoom in'));
  assert.equal(writes.length, 0);
  await chooseMarkerLocation('bin-a');
  assert.equal(mapStorageName(), 'Bin 1');
  assert.equal(editor.querySelector('.room-map-stage'), stage);
  assert.match((stage as HTMLElement).style.transform, /scale\(1.25\)/);
  await placeMarker(25, 40);
  await chooseMarkerLocation('table-a');
  assert.ok(host.querySelector('[role="alertdialog"]'));
  assert.equal(currentUrl(), '/manage/locations?room=common&pin=bin-a');
  await click(button('Stay on page'));
  assert.equal(markerPercent('X'), 25);
  assert.equal(writes.length, 0);
});

for (const mode of ['live', 'bin'] as const) {
  test(`${mode} location filters toggle map markers across rooms without writing items`, async () => {
    await render(createElement(ItemsManager, { catalog: mappedCatalog, mode, onChanged: () => {} }));
    const panel = await openFilter('Filter by location');
    await click(panelButton(panel, 'Choose on map'));
    await click(pickerMarker('Table A'));
    assert.equal(pickerMarker('Table A').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(gridNames(), [mode === 'live' ? 'Vise' : 'Retired vise']);
    await click(panelButton(mapDialog(), 'Advanced Makerspace'));
    await click(pickerMarker('Table 3'));
    assert.match(currentUrl(), /location=table-a&location=table-3/);
    await click(panelButton(mapDialog(), 'Common Makerspace'));
    await click(pickerMarker('Table A'));
    assert.equal(gridNames().length, 0);
    assert.match(currentUrl(), /location=table-3/);
    await click(panelButton(mapDialog(), 'Advanced Makerspace'));
    await click(pickerMarker('Table 3'));
    assert.equal(currentUrl().includes('location='), false);
    await click(panelButton(mapDialog(), 'Use search instead'));
    const searchPanel = document.querySelector<HTMLElement>('.multi-filter-panel');
    assert.ok(searchPanel);
    await click(optionButton(searchPanel, 'bin-a'));
    await click(panelButton(searchPanel, 'Done'));
    assert.match(currentUrl(), /location=bin-a/);
    assert.equal(writes.length, 0);
  });
}

test('room maps use the correct images, include active descendant items, and navigate by URL', async () => {
  await render(createElement(RoomMapsPage, { catalog: mappedCatalog }), '/maps?room=common&location=bin-a');
  assert.equal(host.querySelector('[role="combobox"]'), null);
  assert.equal(host.textContent?.includes('Browse a location'), false);
  assert.equal(host.querySelector('.room-map img')?.getAttribute('data-map-src'), '/maps/common-makerspace.svg');
  assert.equal(host.querySelector('.map-marker.selected')?.getAttribute('title'), 'Table A');
  assert.match(host.textContent ?? '', /nearest mapped location: Table A/);
  assert.equal(link('Vise').getAttribute('href'), '/?item=vise');
  assert.equal([...host.querySelectorAll('a')].some((a) => a.textContent === 'Retired vise'), false);
  await click(link('Advanced Makerspace'));
  assert.equal(currentUrl(), '/maps?room=advanced');
  assert.equal(host.querySelector('.room-map img')?.getAttribute('data-map-src'), '/maps/advanced-makerspace.svg');
  const marker = host.querySelector<HTMLButtonElement>('.map-marker');
  assert.ok(marker);
  await click(marker);
  assert.equal(currentUrl(), '/maps?room=advanced&location=table-3');
  assert.equal(writes.length, 0);
});

test('room-map image errors are visible and do not leave misleading markers', async () => {
  const room = mapLocations[0];
  assert.ok(room);
  await render(createElement(RoomMap, { room, locations: mapLocations }));
  const image = host.querySelector('img');
  assert.ok(image);
  await act(() => { image.dispatchEvent(new dom.window.Event('error')); });
  assert.match(host.querySelector('[role="alert"]')?.textContent ?? '', /Could not load the floor plan/);
  assert.equal(host.querySelector('.map-marker'), null);
});

test('the highlighted location saves metadata and normalized point placement together', async () => {
  let changed = 0;
  await render(createElement(LocationMapEditor, {
    locations: mapLocations, onChanged: () => { changed++; },
  }), '/manage/locations?room=common&pin=table-a');
  assert.equal(host.querySelector('.location-map-editor input[type="number"]'), null);
  assert.doesNotMatch(host.querySelector('.location-map-editor')?.textContent ?? '', /X \(%\)|Y \(%\)|enter percentages/);
  assert.equal(markerPercent('X'), 50);
  await type(mapLocationName(), 'Table A renamed');
  await placeMarker(25, 40);
  assert.equal(writes.length, 0);
  assert.equal(host.querySelector<HTMLElement>('.map-marker.selected')?.style.left, '25%');
  await click(button('Save'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.url, '/api/locations/table-a');
  assert.equal(writes[0]?.body.name, 'Table A renamed');
  assert.deepEqual(writes[0]?.body.mapPosition, { roomId: 'common', mapId: 'common', x: 0.25, y: 0.4 });
  assert.equal(host.querySelector<HTMLElement>('.map-marker.selected')?.style.left, '25%');
  assert.equal(mapLocationName().value, 'Table A renamed');
  assert.equal(button('Save').disabled, true);
  assert.equal(unloadIsBlocked(), false);
  assert.equal(changed, 1);
});

test('the selected location fields replace the marker action toolbar below a single map', async () => {
  await render(createElement(LocationMapEditor, { locations: mapLocations, onChanged: () => {} }),
    '/manage/locations?room=common&pin=table-a');
  const map = host.querySelector('.location-map-editor .room-map');
  const fields = host.querySelector('.location-map-editor .location-fields');
  assert.ok(map && fields);
  assert.ok(map.compareDocumentPosition(fields) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(host.querySelectorAll('.location-map-editor .room-map').length, 1);
  assert.equal(host.querySelector('.map-pin-controls, .map-batch-actions'), null);
  for (const label of ['Remove marker', 'Undo marker change', 'Save all markers', 'Discard all marker changes']) {
    assert.equal(host.querySelector(`button[aria-label="${label}"]`), null);
  }
  assert.equal(mapLocationName().value, 'Table A');
  assert.equal(host.querySelector<HTMLSelectElement>('[aria-label="Location type"]')?.value, 'table');
  assert.equal(combobox('Parent location').value, 'Common Makerspace');
  assert.ok(fields.querySelector('input[type="checkbox"]'));
  assert.ok(button('Save').querySelector('.action-icon-save'));
  assert.ok(button('Cancel').querySelector('.action-icon-cancel'));
});

test('the selection panel lists direct children and opens an unplaced child for editing', async () => {
  const nested: Location[] = [...mapLocations,
    { id: 'bin-b', name: 'Private bin', parentId: 'table-a', kind: 'bin', staffOnly: true },
    { id: 'drawer', name: 'Inner drawer', parentId: 'bin-a', kind: 'bin' },
  ];
  await render(createElement(LocationMapEditor, { locations: nested, onChanged: () => {} }),
    '/manage/locations?room=common&pin=table-a');
  const children = host.querySelector('.location-map-editor .location-children');
  const fields = host.querySelector('.location-map-editor .location-fields');
  assert.ok(children && fields);
  assert.ok(fields.compareDocumentPosition(children) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.deepEqual([...children.querySelectorAll<HTMLButtonElement>('.location-child-select')].map((row) => row.dataset.locationId),
    ['bin-a', 'bin-b']);
  assert.match(children.querySelector('[data-location-id="bin-b"]')?.textContent ?? '', /Staff only/);
  assert.doesNotMatch(children.textContent ?? '', /Inner drawer|Table 3/);
  await click(button('Edit child Bin 1'));
  assert.equal(currentUrl(), '/manage/locations?room=common&pin=bin-a');
  assert.equal(mapStorageName(), 'Bin 1');
  assert.match(combobox('Parent location').value, /Table A/);
  assert.equal(host.querySelector('.location-map-editor .map-marker.selected')?.getAttribute('data-location-id'), 'table-a');
  assert.match(host.querySelector('.location-map-editor')?.textContent ?? '', /Approximate location/);
  assert.equal(button('Save').disabled, true, 'An ancestor highlight does not count as direct placement');
  assert.deepEqual([...host.querySelectorAll<HTMLButtonElement>('.location-child-select')].map((row) => row.dataset.locationId), ['drawer']);
  assert.equal(writes.length, 0);
});

test('the selection-panel plus opens a visible child form with a fixed parent and updates the child list after saving', async () => {
  let changed = 0;
  await render(createElement(LocationManager, { locations: mapLocations, items: [], onChanged: () => { changed++; } }),
    '/manage/locations?room=common&pin=table-a');
  assert.equal(locationChildren(button('Expand Common Makerspace')).hidden, true);
  const add = host.querySelector<HTMLButtonElement>('.location-map-editor .location-children-heading button');
  assert.ok(add);
  assert.equal(add.getAttribute('aria-label'), 'Add child to Table A');
  assert.equal(add.title, 'Add child to Table A');
  assert.ok(add.querySelector('.action-icon-add[aria-hidden="true"]'));
  await click(add);
  const editor = host.querySelector<HTMLElement>('[aria-label="New child location"]');
  assert.ok(editor);
  assert.equal(editor.closest('ul[hidden]'), null, 'All ancestors must expand for a child created from the map panel');
  assert.match(editor.textContent ?? '', /New child of Common Makerspace.*Table A/);
  assert.equal(editor.querySelector('[role="combobox"]'), null);
  assert.equal(editor.querySelector('input[aria-label="New location name"]'), null);
  await selectLocationType('drawer');
  assert.equal(button('Save').disabled, true);
  await placeMarker(25, 40, '.new-child-location .room-map-stage');
  await click(button('Save'));
  assert.equal(writes[0]?.body.parentId, 'table-a');
  assert.equal(writes[0]?.body.kind, 'drawer');
  assert.deepEqual(writes[0]?.body.mapPosition, { roomId: 'common', mapId: 'common', x: 0.25, y: 0.4 });
  assert.equal(changed, 1);
  assert.equal(currentUrl(), '/manage/locations?room=common&pin=table-a');
  assert.equal(mapLocationName().value, 'Table A');
  assert.deepEqual([...host.querySelectorAll<HTMLButtonElement>('.location-child-select')].map((row) => row.dataset.locationId),
    ['bin-a', 'saved']);
  await click(button('Edit child Drawer 2'));
  assert.equal(currentUrl(), '/manage/locations?room=common&pin=saved');
  assert.equal(mapStorageName(), 'Drawer 2');
  assert.equal(host.querySelector<HTMLSelectElement>('[aria-label="Location type"]')?.value, 'drawer');
  assert.match(host.querySelector('.location-children')?.textContent ?? '', /No child locations yet/);
});

test('child creation and child selection do not discard an unsaved parent edit', async () => {
  await render(createElement(LocationManager, { locations: mapLocations, items: [], onChanged: () => {} }),
    '/manage/locations?room=common&pin=table-a');
  let message = '';
  window.alert = (value) => { message = String(value); };
  await type(mapLocationName(), 'Unsaved parent');
  const add = host.querySelector<HTMLButtonElement>('.location-children-heading button');
  assert.ok(add);
  await click(add);
  assert.match(message, /Save or cancel the highlighted location/);
  assert.equal(host.querySelector('[aria-label="New child location"]'), null);
  assert.equal(mapLocationName().value, 'Unsaved parent');
  await click(button('Edit child Bin 1'));
  assert.ok(host.querySelector('[role="alertdialog"]'));
  await click(button('Stay on page'));
  assert.equal(currentUrl(), '/manage/locations?room=common&pin=table-a');
  assert.equal(mapLocationName().value, 'Unsaved parent');
  await click(button('Edit child Bin 1'));
  await click(button('Discard changes'));
  assert.equal(currentUrl(), '/manage/locations?room=common&pin=bin-a');
  assert.equal(mapStorageName(), 'Bin 1');
  assert.equal(writes.length, 0);
});

test('child navigation uses the saved room when a parent move is discarded', async () => {
  await render(createElement(LocationMapEditor, { locations: mapLocations, onChanged: () => {} }),
    '/manage/locations?room=common&pin=table-a');
  await choose(combobox('Parent location'), 'advanced');
  await placeMarker(30, 40);
  assert.equal(link('Advanced Makerspace').className, 'active');
  await chooseMarkerLocation('table-a');
  assert.equal(host.querySelector('[role="alertdialog"]'), null, 'Clicking the same location must not navigate to its draft room');
  assert.match(combobox('Parent location').value, /Advanced Makerspace/);
  await click(button('Edit child Bin 1'));
  assert.ok(host.querySelector('[role="alertdialog"]'));
  await click(button('Discard changes'));
  assert.equal(currentUrl(), '/manage/locations?room=common&pin=bin-a');
  assert.equal(mapStorageName(), 'Bin 1');
  assert.match(combobox('Parent location').value, /Common Makerspace/);
  assert.equal(writes.length, 0);
});

test('child controls stay disabled until a pending parent save finishes', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  await render(createElement(LocationManager, { locations: mapLocations, items: [], onChanged: () => {} }),
    '/manage/locations?room=common&pin=table-a');
  await type(mapLocationName(), 'Saved parent');
  globalThis.fetch = () => pending;
  await click(button('Save'));
  const add = host.querySelector<HTMLButtonElement>('.location-children-heading button');
  assert.ok(add);
  assert.equal(add.disabled, true);
  assert.equal(button('Edit child Bin 1').disabled, true);
  await click(button('Edit child Bin 1'));
  assert.equal(currentUrl(), '/manage/locations?room=common&pin=table-a');
  await act(async () => { finish(jsonResponse({ ...mapLocations[2], name: 'Saved parent' })); await pending; });
  assert.equal(mapLocationName().value, 'Saved parent');
  assert.equal(button('Edit child Bin 1').disabled, false);
  assert.equal(add.disabled, false);
  assert.equal(add.getAttribute('aria-label'), 'Add child to Saved parent');
});

test('room-map click placement positions the marker and keeps changes unsaved', async () => {
  await render(createElement(LocationMapEditor, {
    locations: mapLocations, onChanged: () => {},
  }), '/manage/locations?room=common&pin=bin-a');
  const stage = host.querySelector<HTMLElement>('.room-map-stage');
  assert.ok(stage);
  stage.getBoundingClientRect = () => ({
    x: 10, y: 20, left: 10, top: 20, width: 1000, height: 500, right: 1010, bottom: 520,
    toJSON: () => ({}),
  });
  await act(() => { stage.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 260, clientY: 270 })); });
  assert.equal(markerPercent('X'), 25);
  assert.equal(markerPercent('Y'), 50);
  assert.equal(writes.length, 0);
  await click(link('Advanced Makerspace'));
  assert.ok(host.querySelector('[role="alertdialog"]'));
  assert.equal(currentUrl(), '/manage/locations?room=common&pin=bin-a');
  await click(button('Stay on page'));
  assert.equal(markerPercent('X'), 25);
  await click(button('Save'));
  await click(link('Advanced Makerspace'));
  assert.equal(host.querySelector('[role="alertdialog"]'), null);
  assert.equal(currentUrl(), '/manage/locations?room=advanced');
  await click(link('Common Makerspace'));
  await chooseMarkerLocation('bin-a');
  assert.equal(markerPercent('X'), 25);
});

test('location rename preserves existing floor plan and marker metadata', async () => {
  await render(createElement(LocationManager, { locations: mapLocations, items: [], onChanged: () => {} }),
    '/manage/locations?room=common');
  await click(button('Expand Common Makerspace'));
  await click(button('Rename or move Table A'));
  const name = host.querySelector<HTMLInputElement>('[aria-label="Location name"]');
  assert.ok(name);
  await type(name, 'Table A renamed');
  await click(button('Save'));
  assert.deepEqual(writes[0]?.body.mapPosition, mapLocations[2]?.mapPosition);
  assert.equal(writes[0]?.body.name, 'Table A renamed');
});

test('item detail highlights the assigned room and falls back to a mapped parent', async () => {
  mockAppApi();
  const respond = globalThis.fetch;
  globalThis.fetch = (url, init) => url === '/api/catalog' ? Promise.resolve(jsonResponse(mappedCatalog)) : respond(url, init);
  await render(createElement(App), '/?item=vise');
  assert.equal(host.querySelector('.item-detail .room-map img')?.getAttribute('data-map-src'), '/maps/common-makerspace.svg');
  assert.equal(host.querySelector('.item-detail .map-marker.selected')?.getAttribute('title'), 'Table A');
  assert.match(host.querySelector('.item-detail')?.textContent ?? '', /selected sub-location is not marked/);
  const pin = host.querySelector<HTMLAnchorElement>('.item-detail .map-marker.selected');
  assert.ok(pin);
  await click(pin);
  assert.equal(currentUrl(), '/maps?room=common&location=table-a');
});

test('cancelling the highlighted edit restores saved placement and clears the selection', async () => {
  await render(createElement(LocationMapEditor, {
    locations: mapLocations, onChanged: () => {},
  }), '/manage/locations?room=common&pin=table-a');
  const stage = host.querySelector<HTMLElement>('.location-map-editor .room-map-stage');
  assert.ok(stage);
  await click(button('Zoom in'));
  await type(mapLocationName(), 'Unsaved name');
  await placeMarker(25, 40);
  await click(button('Cancel'));
  assert.equal(writes.length, 0);
  assert.equal(host.querySelector('.map-marker.selected'), null);
  assert.equal(host.querySelector('.location-map-editor .location-fields'), null);
  assert.equal(host.querySelector('.location-map-editor .room-map-stage'), stage);
  assert.match(stage.style.transform, /scale\(1.25\)/);
  assert.equal(currentUrl(), '/manage/locations?room=common');
  await chooseMarkerLocation('table-a');
  assert.equal(mapLocationName().value, 'Table A');
  assert.equal(markerPercent('X'), 50);
  assert.equal(unloadIsBlocked(), false);
});

test('failed map saves keep the click-placement draft', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Could not save marker' }), { status: 500 });
  await render(createElement(LocationMapEditor, {
    locations: mapLocations, onChanged: () => {},
  }), '/manage/locations?room=common&pin=table-a');
  await placeMarker(25, 60);
  await click(button('Save'));
  assert.match(host.querySelector('[role="alert"]')?.textContent ?? '', /Could not save marker/);
  assert.equal(markerPercent('X'), 25);
  assert.equal(button('Save').disabled, false);
});

const mapLocationName = (): HTMLInputElement => {
  const input = host.querySelector<HTMLInputElement>('.location-map-editor [aria-label="Location name"]');
  assert.ok(input);
  return input;
};
const mapStorageName = (): string => {
  const output = host.querySelector<HTMLOutputElement>('.location-map-editor output[aria-label="Location name"]');
  assert.ok(output, 'Storage location name must be displayed, not editable');
  return output.value;
};

const markerPercent = (axis: 'X' | 'Y'): number => {
  const marker = host.querySelector<HTMLElement>('.location-map-editor .map-marker.selected');
  assert.ok(marker);
  return Number.parseFloat(axis === 'X' ? marker.style.left : marker.style.top);
};

const placeMarker = async (x: number, y: number, selector = '.location-map-editor .room-map-stage'): Promise<void> => {
  const stage = host.querySelector<HTMLElement>(selector);
  assert.ok(stage);
  stage.getBoundingClientRect = () => ({
    x: 10, y: 20, left: 10, top: 20, width: 1000, height: 500, right: 1010, bottom: 520,
    toJSON: () => ({}),
  });
  await act(() => { stage.dispatchEvent(new dom.window.MouseEvent('click', {
    bubbles: true, clientX: 10 + x * 10, clientY: 20 + y * 5,
  })); });
};

const chooseMarkerLocation = async (id: string): Promise<void> => {
  const marker = [...host.querySelectorAll<HTMLButtonElement>('.location-map-editor .map-marker')]
    .find((marker) => marker.dataset.locationId === id);
  assert.ok(marker, `Missing map marker ${id}`);
  await click(marker);
};

test('selecting another location requires saving or explicitly discarding the current draft', async () => {
  await render(createElement(LocationMapEditor, { locations: markerLocations, onChanged: () => {} }),
    '/manage/locations?pin=table-a');
  await type(mapLocationName(), 'Local name');
  await placeMarker(25, 60);
  await chooseMarkerLocation('table-a');
  assert.equal(host.querySelector('[role="alertdialog"]'), null, 'Implicit and explicit default rooms share the same draft');
  await chooseMarkerLocation('bin-a');
  assert.equal(currentUrl(), '/manage/locations?room=common&pin=table-a');
  assert.ok(host.querySelector('[role="alertdialog"]'));
  await click(button('Stay on page'));
  assert.equal(mapLocationName().value, 'Local name');
  await chooseMarkerLocation('bin-a');
  await click(button('Discard changes'));
  assert.equal(currentUrl(), '/manage/locations?room=common&pin=bin-a');
  assert.equal(mapStorageName(), 'Bin 1');
  await chooseMarkerLocation('table-a');
  assert.equal(mapLocationName().value, 'Table A');
  assert.equal(markerPercent('X'), 50);
  assert.equal(writes.length, 0);
});

test('switching rooms protects metadata edits and cancelling the warning retains them', async () => {
  await render(createElement(LocationMapEditor, { locations: markerLocations, onChanged: () => {} }),
    '/manage/locations?room=common&pin=table-a');
  await type(mapLocationName(), 'Unsaved table');
  await click(link('Advanced Makerspace'));
  assert.equal(currentUrl(), '/manage/locations?room=common&pin=table-a');
  assert.match(host.querySelector('[role="alertdialog"]')?.textContent ?? '', /switching rooms/);
  const dialog = host.querySelector('[role="alertdialog"]');
  assert.ok(dialog);
  await act(() => { dialog.dispatchEvent(new dom.window.Event('cancel', { cancelable: true })); });
  assert.equal(host.querySelector('[role="alertdialog"]'), null);
  assert.equal(mapLocationName().value, 'Unsaved table');
  await click(link('Advanced Makerspace'));
  await click(button('Discard changes'));
  assert.equal(currentUrl(), '/manage/locations?room=advanced');
  assert.equal(host.querySelector('.location-map-editor .location-fields'), null);
  assert.equal(unloadIsBlocked(), false);
  await click(link('Common Makerspace'));
  await chooseMarkerLocation('table-a');
  assert.equal(markerPercent('X'), 50);
  assert.equal(mapLocationName().value, 'Table A');
  assert.equal(writes.length, 0);
});

test('room changes through browser Back and Forward cannot bypass unsaved marker protection', async () => {
  await render(createElement(LocationMapEditor, { locations: mapLocations, onChanged: () => {} }),
    '/manage/locations?room=common&pin=table-a');
  await click(link('Advanced Makerspace'));
  await click(button('History back'));
  await placeMarker(25, 60);
  await click(button('History forward'));
  assert.ok(host.querySelector('[role="alertdialog"]'));
  assert.equal(currentUrl(), '/manage/locations?room=common&pin=table-a');
  await click(button('Discard changes'));
  assert.equal(currentUrl(), '/manage/locations?room=advanced');
  await chooseMarkerLocation('table-3');
  await placeMarker(20, 14);
  await click(button('History back'));
  assert.ok(host.querySelector('[role="alertdialog"]'));
  assert.equal(currentUrl(), '/manage/locations?room=advanced&pin=table-3');
  await click(button('Stay on page'));
  assert.equal(markerPercent('X'), 20);
  assert.equal(writes.length, 0);
});

test('browser history protects dirty selection changes and leaving still prompts', async () => {
  await render(createElement(StaffPanel, { catalog: { ...mappedCatalog, locations: markerLocations }, onChanged: () => {} }),
    '/manage/locations?room=common&pin=table-a');
  await chooseMarkerLocation('bin-a');
  await click(button('History back'));
  assert.equal(currentUrl(), '/manage/locations?room=common&pin=table-a');
  await placeMarker(25, 60);
  await click(button('History forward'));
  assert.equal(currentUrl(), '/manage/locations?room=common&pin=table-a');
  assert.ok(host.querySelector('[role="alertdialog"]'));
  await click(button('Stay on page'));
  assert.equal(unloadIsBlocked(), true);
  await click(link('Items'));
  assert.ok(host.querySelector('[role="alertdialog"]'));
  await click(button('Stay on page'));
  assert.equal(markerPercent('X'), 25);
  await click(link('Items'));
  await click(button('Discard changes'));
  assert.equal(currentUrl(), '/manage/items');
  assert.equal(unloadIsBlocked(), false);
  assert.equal(writes.length, 0);
});

test('point location placement stays inside the floor plan when saved through the panel', async () => {
  await render(createElement(LocationMapEditor, { locations: markerLocations, onChanged: () => {} }),
    '/manage/locations?room=common&pin=table-a');
  await placeMarker(120, -10);
  assert.equal(markerPercent('X'), 100);
  assert.equal(markerPercent('Y'), 0);
  assert.equal(writes.length, 0);
  await click(button('Save'));
  assert.deepEqual(writes[0]?.body.mapPosition, { roomId: 'common', mapId: 'common', x: 1, y: 0 });
});

test('a failed panel save preserves metadata and placement for retry', async () => {
  await render(createElement(LocationMapEditor, { locations: markerLocations, onChanged: () => {} }),
    '/manage/locations?room=common&pin=table-a');
  await placeMarker(25, 60);
  await type(mapLocationName(), 'My table');
  const succeed = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Save unavailable' }), { status: 503 });
  await click(button('Save'));
  assert.match(host.querySelector('[role="alert"]')?.textContent ?? '', /Save unavailable/);
  assert.equal(mapLocationName().value, 'My table');
  assert.equal(unloadIsBlocked(), true);
  await click(link('Advanced Makerspace'));
  assert.ok(host.querySelector('[role="alertdialog"]'));
  await click(button('Stay on page'));
  assert.equal(markerPercent('X'), 25);
  globalThis.fetch = succeed;
  await click(button('Save'));
  assert.equal(writes[0]?.body.name, 'My table');
  assert.deepEqual(writes[0]?.body.mapPosition, { roomId: 'common', mapId: 'common', x: 0.25, y: 0.6 });
  assert.equal(unloadIsBlocked(), false);
});

test('changing the selected location parent requires remapping and follows the saved room', async () => {
  await render(createElement(LocationMapEditor, { locations: markerLocations, onChanged: () => {} }),
    '/manage/locations?room=common&pin=table-a');
  await choose(combobox('Parent location'), 'advanced');
  assert.equal(button('Save').disabled, true);
  assert.equal(host.querySelector('.location-map-editor img')?.getAttribute('data-map-src'), '/maps/advanced-makerspace.svg');
  assert.equal(link('Advanced Makerspace').className, 'active');
  assert.equal(writes.length, 0);
  await placeMarker(30, 40);
  await click(button('Save'));
  assert.equal(writes[0]?.body.parentId, 'advanced');
  assert.deepEqual(writes[0]?.body.mapPosition, { roomId: 'advanced', mapId: 'advanced', x: 0.3, y: 0.4 });
  assert.equal(currentUrl(), '/manage/locations?room=advanced&pin=table-a');
  assert.equal(mapLocationName().value, 'Table A');
  assert.equal(host.querySelector('[role="alertdialog"]'), null);
});

test('catalog refreshes update pristine panel fields but do not replace unsaved metadata', async () => {
  const props = { onChanged: () => {} };
  await render(createElement(LocationMapEditor, { ...props, locations: mapLocations }),
    '/manage/locations?room=common&pin=table-a');
  const renamed = mapLocations.map((location) => location.id === 'table-a' ? { ...location, name: 'Renamed table' } : location);
  await render(createElement(LocationMapEditor, { ...props, locations: renamed }));
  assert.equal(mapLocationName().value, 'Renamed table');
  await type(mapLocationName(), 'Local draft');
  const refreshed = renamed.map((location) => location.id === 'table-a' ? { ...location, name: 'Remote name' } : location);
  await render(createElement(LocationMapEditor, { ...props, locations: refreshed }));
  assert.equal(mapLocationName().value, 'Local draft');
  await click(button('Cancel'));
  assert.equal(unloadIsBlocked(), false);
  assert.equal(writes.length, 0);
});

test('pending panel saves lock placement and selection and complete a blocked navigation after saving', async () => {
  let release = (_response: Response): void => { throw new Error('Uninitialized'); };
  const pending = new Promise<Response>((resolve) => { release = resolve; });
  await render(createElement(StaffPanel, { catalog: { ...mappedCatalog, locations: markerLocations }, onChanged: () => {} }),
    '/manage/locations?room=common&pin=table-a');
  await placeMarker(25, 60);
  globalThis.fetch = () => pending;
  await click(button('Save'));
  assert.equal(button('Save').getAttribute('aria-busy'), 'true');
  assert.equal(button('Save').disabled, true);
  await placeMarker(75, 80);
  assert.equal(markerPercent('X'), 25);
  assert.equal(markerPercent('Y'), 60);
  await chooseMarkerLocation('bin-a');
  assert.equal(currentUrl(), '/manage/locations?room=common&pin=table-a');
  assert.equal(button('Cancel').matches(':disabled'), true);
  await click(link('Advanced Makerspace'));
  assert.equal(currentUrl(), '/manage/locations?room=common&pin=table-a');
  await click(link('Items'));
  assert.ok(host.querySelector('[role="alertdialog"]'));
  assert.equal(button('Discard changes').disabled, true);
  await act(async () => {
    release(jsonResponse({
      ...mapLocations[2], mapPosition: { roomId: 'common', mapId: 'common', x: 0.25, y: 0.6 },
    }));
    await pending;
  });
  assert.equal(currentUrl(), '/manage/items');
  assert.equal(host.querySelector('[role="alertdialog"]'), null);
  assert.equal(unloadIsBlocked(), false);
});

test('map zoom scales the plan and marker together without changing stored coordinates', async () => {
  const room = mapLocations[0];
  assert.ok(room);
  await render(createElement(RoomMap, { room, locations: mapLocations, selectedLocationId: 'table-a' }));
  const stage = host.querySelector<HTMLElement>('.room-map-stage');
  const marker = host.querySelector<HTMLElement>('.map-marker.selected');
  assert.ok(stage && marker);
  assert.equal(button('Zoom out').disabled, true);
  assert.equal(marker.style.left, '50%');
  await click(button('Zoom in'));
  assert.match(stage.style.transform, /scale\(1.25\)/);
  assert.equal(stage.style.minWidth, '');
  assert.equal(marker.style.left, '50%');
  assert.match(marker.style.transform, /scale\(0.8\)/);
  for (let count = 0; count < 7; count++) await click(button('Zoom in'));
  assert.equal(button('Zoom in').disabled, true);
  assert.match(stage.style.transform, /scale\(3\)/);
  await click(button('Reset zoom'));
  assert.equal(stage.style.transform, 'translate(0%, 0%) scale(1)');
  assert.equal(button('Zoom out').disabled, true);
  assert.equal(writes.length, 0);
});

const mapViewport = (): HTMLDivElement => {
  const viewport = host.querySelector<HTMLDivElement>('.room-map-viewport');
  assert.ok(viewport);
  viewport.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500,
    toJSON: () => ({}),
  });
  const captured = new Set<number>();
  viewport.setPointerCapture = (id: number) => { captured.add(id); };
  viewport.hasPointerCapture = (id: number) => captured.has(id);
  viewport.releasePointerCapture = (id: number) => { captured.delete(id); };
  return viewport;
};
const pointer = async (
  target: HTMLElement, eventType: string, x: number, y: number, pointerId = 1, pointerType = 'mouse',
): Promise<void> => {
  const event = new dom.window.MouseEvent(eventType, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: pointerType },
    isPrimary: { value: true },
  });
  await act(() => { target.dispatchEvent(event); });
};

test('compact map controls live inside the map and do not place markers', async () => {
  const room = mapLocations[0];
  assert.ok(room);
  let placements = 0;
  await render(createElement(RoomMap, {
    room, locations: mapLocations, onPlace: () => { placements++; },
  }));
  const controls = host.querySelector('.room-map-canvas > .room-map-controls');
  assert.ok(controls);
  assert.equal(host.querySelector('.room-map-scroll'), null);
  assert.equal(button('Zoom in').textContent, '+');
  assert.equal(button('Zoom out').textContent, '-');
  assert.equal(button('Reset zoom').textContent, '100%');
  assert.equal(host.querySelector<HTMLElement>('.room-map-stage')?.style.minWidth, '');
  await click(button('Zoom in'));
  assert.equal(button('Reset zoom').textContent, '125%');
  await click(button('Zoom out'));
  assert.equal(button('Reset zoom').textContent, '100%');
  assert.equal(placements, 0);
});

test('zoomed maps pan by dragging, clamp to their edges, and do not place a marker after dragging', async () => {
  const room = mapLocations[0];
  assert.ok(room);
  let placements = 0;
  await render(createElement(RoomMap, {
    room, locations: mapLocations, onPlace: () => { placements++; },
  }));
  const viewport = mapViewport();
  const stage = host.querySelector<HTMLElement>('.room-map-stage');
  assert.ok(stage);
  stage.getBoundingClientRect = viewport.getBoundingClientRect;
  await click(button('Zoom in'));
  await pointer(viewport, 'pointerdown', 500, 250);
  await pointer(viewport, 'pointermove', 400, 200);
  assert.equal(viewport.classList.contains('dragging'), true);
  assert.equal(viewport.hasPointerCapture(1), true);
  assert.equal(stage.style.transform, 'translate(-22.5%, -22.5%) scale(1.25)');
  await pointer(viewport, 'pointermove', -2000, -2000);
  assert.equal(stage.style.transform, 'translate(-25%, -25%) scale(1.25)');
  await pointer(viewport, 'pointerup', -2000, -2000);
  assert.equal(viewport.classList.contains('dragging'), false);
  assert.equal(viewport.hasPointerCapture(1), false);
  await act(() => { stage.dispatchEvent(new dom.window.MouseEvent('click', {
    bubbles: true, cancelable: true, detail: 1, clientX: 400, clientY: 200,
  })); });
  assert.equal(placements, 0);
  await pointer(viewport, 'pointerdown', 400, 200);
  await pointer(viewport, 'pointerup', 400, 200);
  await act(() => { stage.dispatchEvent(new dom.window.MouseEvent('click', {
    bubbles: true, cancelable: true, detail: 1, clientX: 400, clientY: 200,
  })); });
  assert.equal(placements, 1, 'A subsequent deliberate click can still place a marker');
});

test('touch panning cancels cleanly and fit-to-map does not drag the image', async () => {
  const room = mapLocations[0];
  assert.ok(room);
  await render(createElement(RoomMap, { room, locations: mapLocations }));
  const viewport = mapViewport();
  const stage = host.querySelector<HTMLElement>('.room-map-stage');
  assert.ok(stage);
  await pointer(viewport, 'pointerdown', 400, 200, 1, 'touch');
  await pointer(viewport, 'pointermove', 300, 100, 1, 'touch');
  assert.equal(stage.style.transform, 'translate(0%, 0%) scale(1)');
  await click(button('Zoom in'));
  await pointer(viewport, 'pointerdown', 400, 200, 1, 'touch');
  await pointer(viewport, 'pointermove', 450, 225, 1, 'touch');
  assert.equal(stage.style.transform, 'translate(-7.5%, -7.5%) scale(1.25)');
  await pointer(viewport, 'pointercancel', 450, 225, 1, 'touch');
  assert.equal(viewport.classList.contains('dragging'), false);
  assert.equal(viewport.hasPointerCapture(1), false);
  const stopped = stage.style.transform;
  await pointer(viewport, 'pointermove', 200, 100, 1, 'touch');
  assert.equal(stage.style.transform, stopped);
});

test('map keyboard panning is bounded and Home restores the fitted view', async () => {
  const room = mapLocations[0];
  assert.ok(room);
  await render(createElement(RoomMap, { room, locations: mapLocations }));
  const viewport = mapViewport();
  const stage = host.querySelector<HTMLElement>('.room-map-stage');
  assert.ok(stage);
  await click(button('Zoom in'));
  const press = async (key: string): Promise<void> => {
    await act(() => { viewport.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      key, bubbles: true, cancelable: true,
    })); });
  };
  await press('ArrowRight');
  await press('ArrowDown');
  assert.equal(stage.style.transform, 'translate(-22.5%, -22.5%) scale(1.25)');
  await press('ArrowRight');
  await press('ArrowDown');
  assert.equal(stage.style.transform, 'translate(-25%, -25%) scale(1.25)');
  await press('Home');
  assert.equal(stage.style.transform, 'translate(0%, 0%) scale(1)');
  assert.equal(button('Reset zoom').textContent, '100%');
});

test('switching rooms resets zoom and pan without changing catalog coordinates', async () => {
  const common = mapLocations[0], advanced = mapLocations[1];
  assert.ok(common && advanced);
  await render(createElement(RoomMap, { room: common, locations: mapLocations }));
  await click(button('Zoom in'));
  await render(createElement(RoomMap, { room: advanced, locations: mapLocations }));
  assert.equal(host.querySelector<HTMLElement>('.room-map-stage')?.style.transform, 'translate(0%, 0%) scale(1)');
  assert.equal(button('Reset zoom').textContent, '100%');
  assert.equal(writes.length, 0);
});

test('dragging over a map marker does not select it; clicking it still works', async () => {
  const room = mapLocations[0];
  assert.ok(room);
  const selected: string[] = [];
  await render(createElement(RoomMap, { room, locations: mapLocations, onSelect: (id) => selected.push(id) }));
  const viewport = mapViewport();
  const marker = host.querySelector<HTMLButtonElement>('.map-marker');
  assert.ok(marker);
  await click(button('Zoom in'));
  await pointer(marker, 'pointerdown', 500, 250);
  await pointer(viewport, 'pointermove', 450, 225);
  await pointer(viewport, 'pointerup', 450, 225);
  await act(() => { marker.dispatchEvent(new dom.window.MouseEvent('click', {
    bubbles: true, cancelable: true, detail: 1,
  })); });
  assert.deepEqual(selected, []);
  await pointer(marker, 'pointerdown', 500, 250);
  await pointer(marker, 'pointerup', 500, 250);
  await click(marker);
  assert.deepEqual(selected, ['table-a']);
});

test('marker placement stays normalized on a zoomed map', async () => {
  await render(createElement(LocationMapEditor, {
    locations: mapLocations, onChanged: () => {},
  }), '/manage/locations?room=common&pin=bin-a');
  await click(button('Zoom in'));
  const stage = host.querySelector<HTMLElement>('.room-map-stage');
  assert.ok(stage);
  stage.getBoundingClientRect = () => ({
    x: 10, y: 20, left: 10, top: 20, width: 1250, height: 625, right: 1260, bottom: 645,
    toJSON: () => ({}),
  });
  await act(() => { stage.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 322.5, clientY: 332.5 })); });
  assert.equal(markerPercent('X'), 25);
  assert.equal(markerPercent('Y'), 50);
  assert.equal(writes.length, 0);
});
