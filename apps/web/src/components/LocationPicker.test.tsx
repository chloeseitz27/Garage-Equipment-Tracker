import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement, useState, type FormEvent, type ReactElement } from 'react';
import type { Root } from 'react-dom/client';
import { formatLocationPath, getLocationPath, type Item, type Location } from '@garage/shared';
import { LocationPicker } from './LocationPicker.js';
import { ItemEditor } from './ItemEditor.js';
import { BulkEntry } from './BulkEntry.js';
import { ItemsManager } from './ItemsManager.js';
import { LocationManager } from './LocationManager.js';

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
const { createRoot } = await import('react-dom/client');

const locations: Location[] = [
  { id: 'room', name: 'Main Shop', parentId: null, kind: 'room' },
  { id: 'bench', name: 'Electronics Bench', parentId: 'room', kind: 'zone' },
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
  id: 'vise', name: 'Vise', kind: 'equipment', categoryId: 'tools', locationId: 'bin-19',
  tags: [], goodFor: [], status: 'available', quantity: 1, trainingRequired: 'none',
};
const catalog = { locations, categories, items: [item] };
const path = (id: string): string => formatLocationPath(getLocationPath(locations, id));
const originalFetch = globalThis.fetch;
let root: Root;
let host: HTMLDivElement;
let writes: Array<{ url: string; body: Record<string, unknown> }>;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  writes = [];
  globalThis.fetch = async (url, init) => {
    const text = init?.body;
    assert.ok(typeof text === 'string', 'Unexpected request: tests must not access a real API');
    const body: Record<string, unknown> = JSON.parse(text);
    writes.push({ url: String(url), body });
    return new Response(JSON.stringify({ ...body, id: 'saved', created: 1, updated: 1, items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  globalThis.fetch = originalFetch;
});
after(() => dom.window.close());

const render = async (element: ReactElement): Promise<void> => {
  await act(() => root.render(element));
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
  const result = [...host.querySelectorAll('button')].find((node) => node.textContent?.trim() === text);
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

test('parent selectors support null, filter self and descendants, and keep full ancestor paths', async () => {
  await render(createElement(LocationManager, { locations, items: [item], onChanged: () => {} }));
  const row = [...host.querySelectorAll('.tree-node')].find((node) =>
    node.querySelector('.tree-name')?.textContent?.startsWith('Cabinet B'));
  assert.ok(row);
  const edit = row.querySelector<HTMLButtonElement>('button');
  assert.ok(edit);
  await click(edit);
  const input = combobox('Parent location');
  assert.equal(input.value, path('bench'));
  await focus(input);
  assert.equal(options().length, 5); // Four ancestors/unrelated locations and top level.
  assert.equal(options().some((node) => /Cabinet B|Bin B/.test(node.textContent ?? '')), false);
  await type(input, 'electronics');
  assert.equal(options().length, 1);
  assert.match(options()[0]?.textContent ?? '', /Main Shop.*Electronics Bench/);
  await type(input, 'top');
  await key(input, 'Enter');
  assert.equal(input.value, 'Top level (no parent)');
  assert.equal(writes.length, 0);
  await click(button('Save'));
  assert.equal(writes[0]?.url, '/api/locations/cabinet');
  assert.equal(writes[0]?.body.parentId, null);
});

test('new location parents can be changed and reset to top level without an implicit write', async () => {
  await render(createElement(LocationManager, { locations, items: [], onChanged: () => {} }));
  const input = combobox('New location parent');
  assert.equal(input.value, 'Top level (no parent)');
  await choose(input);
  assert.equal(input.value, path('destination'));
  await choose(input, 'top');
  assert.equal(input.value, 'Top level (no parent)');
  const name = host.querySelector<HTMLInputElement>('input[placeholder="New location name"]');
  assert.ok(name);
  await type(name, 'Annex');
  assert.equal(writes.length, 0);
  await click(button('Add location'));
  assert.equal(writes[0]?.url, '/api/locations');
  assert.equal(writes[0]?.body.parentId, null);
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
      id: 'solder', name: 'Solder', kind: 'consumable', categoryId: 'tools', locationId: 'bin-19',
      tags: [], goodFor: [], stockLevel: 'in-stock',
    } satisfies Item,
  ],
};

const checkboxFor = (name: string): HTMLInputElement => {
  const row = [...host.querySelectorAll('.flat-list li')]
    .find((node) => node.querySelector('.tree-name')?.textContent?.startsWith(name));
  const checkbox = row?.querySelector<HTMLInputElement>('.row-check input');
  assert.ok(checkbox, `Missing checkbox for ${name}`);
  return checkbox;
};

const setCategory = async (value: string): Promise<void> => {
  const select = host.querySelector<HTMLSelectElement>('.bulk-bar select');
  assert.ok(select);
  await act(() => {
    select.value = value;
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
};

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
  assert.equal(host.querySelector<HTMLSelectElement>('.bulk-bar select')?.value, 'materials');
  await click(button('Save'));
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0]?.body, {
    ids: ['vise', 'solder'], changes: { locationId: 'destination', categoryId: 'materials' },
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
  assert.deepEqual(writes[0]?.body, { ids: ['vise'], changes: { categoryId: 'materials' } });
});

test('Deselect discards pending edits without a request and clears drafts on reselect', async () => {
  await render(createElement(ItemsManager, { catalog: multiCatalog, mode: 'live', onChanged: () => {} }));
  await click(checkboxFor('Vise'));
  await choose(combobox('Move to'));
  await setCategory('materials');
  await click(button('Deselect'));
  assert.equal(writes.length, 0);
  assert.equal(checkboxFor('Vise').checked, false);
  assert.equal(host.querySelector('.bulk-bar'), null);
  await click(checkboxFor('Solder'));
  assert.equal(combobox('Move to').value, '');
  assert.equal(host.querySelector<HTMLSelectElement>('.bulk-bar select')?.value, '');
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
  const filter = host.querySelector<HTMLInputElement>('input[placeholder="Filter by name or location…"]');
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
  assert.equal(host.querySelector<HTMLSelectElement>('.bulk-bar select')?.value, 'materials');
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
  assert.equal(button('Deselect').disabled, true);
  assert.equal(checkboxFor('Solder').disabled, true);
  assert.equal(combobox('Move to').disabled, true);
  await click(button('Save'));
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

test('the recycle bin uses Deselect and retains its Restore action', async () => {
  const binCatalog = { ...catalog, items: [{ ...item, retiredAt: '2026-09-17T00:00:00.000Z' }] };
  await render(createElement(ItemsManager, { catalog: binCatalog, mode: 'bin', onChanged: () => {} }));
  await click(checkboxFor('Vise'));
  await click(button('Deselect'));
  assert.equal(writes.length, 0);
  assert.equal(checkboxFor('Vise').checked, false);
  await click(checkboxFor('Vise'));
  await click(button('Restore'));
  assert.equal(writes[0]?.url, '/api/items/bulk-retire');
  assert.deepEqual(writes[0]?.body, { ids: ['vise'], retired: false });
});
