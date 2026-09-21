import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createContext, createElement, useContext, type ReactElement } from 'react';
import type { Root } from 'react-dom/client';
import { parseSvgMap, type Location, type SvgMap } from '@garage/shared';
import { RoomMapSourcesContext, refreshSvgMap } from '../room-map-source.js';

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
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
const { RoomMap } = await import('./RoomMap.js');
const { LocationEditor } = await import('./LocationEditor.js');
const { LocationMapEditor } = await import('./LocationMapEditor.js');

const source = (x = 100, transform = 'translate(20,30)') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500">
  <g data-location-id="table" transform="${transform}"><rect class="surface" x="${x}" y="50" width="200" height="100"/><text>Table A</text></g>
  <g data-location-id="unknown"><path class="surface" d="M800 10H900V100H800Z"/></g>
</svg>`;
const room: Location = { id: 'room', name: 'Common Makerspace', kind: 'room', parentId: null, mapId: 'common' };
const locations: Location[] = [
  room,
  { id: 'table', name: 'Table A', parentId: 'room', kind: 'table', mapPosition: { roomId: 'room', mapId: 'common', x: 0.99, y: 0.99 } },
  { id: 'bin', name: 'Bin A1', parentId: 'table', kind: 'bin' },
  { id: 'point', name: 'Standalone bin', parentId: 'room', kind: 'bin', mapPosition: { roomId: 'room', mapId: 'common', x: 0.3, y: 0.7 } },
];
const ElementContext = createContext<ReactElement | null>(null);
const Screen = (): ReactElement | null => useContext(ElementContext);
const originalFetch = globalThis.fetch;
let host: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter> | undefined;
let writes: Array<{ url: string; body: Record<string, unknown> }>;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  router = undefined;
  writes = [];
  globalThis.fetch = async (url, options) => {
    assert.ok(options?.body, `Unexpected request ${url}`);
    const body = JSON.parse(String(options.body));
    writes.push({ url: String(url), body });
    return Response.json({ ...body, id: 'saved' });
  };
});
afterEach(async () => {
  await act(() => root.unmount());
  router?.dispose();
  host.remove();
  globalThis.fetch = originalFetch;
});
after(() => dom.window.close());

const render = async (element: ReactElement, map: SvgMap | null = parseSvgMap(source()), path = '/maps'): Promise<void> => {
  router ??= createMemoryRouter([{ path: '*', element: createElement(Screen) }], { initialEntries: [path] });
  const activeRouter = router;
  await act(() => root.render(createElement(RoomMapSourcesContext.Provider, { value: map ? { common: map } : null },
    createElement(ElementContext.Provider, { value: element }, createElement(RouterProvider, { router: activeRouter })))));
};
const region = (): SVGElement => {
  const element = host.querySelector<SVGElement>('.map-region[data-location-id="table"]');
  assert.ok(element);
  return element;
};
const click = async (element: Element): Promise<void> => {
  await act(() => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
};
const key = async (element: Element, value: string): Promise<void> => {
  await act(() => { element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); });
};
const button = (name: string): HTMLButtonElement => {
  const element = [...host.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === name || button.textContent === name);
  assert.ok(element, `Missing button ${name}`);
  return element;
};

test('selected tables highlight their entire SVG geometry, not the stale database pin', async () => {
  await render(createElement(RoomMap, { room, locations, selectedLocationId: 'table', onSelect: () => {} }));
  assert.equal(host.querySelector('.map-marker[title="Table A"]'), null);
  assert.ok(region().classList.contains('selected'));
  assert.equal(region().getAttribute('aria-pressed'), 'true');
  assert.equal(region().querySelector('rect')?.getAttribute('x'), '100');
  assert.equal(region().querySelector('rect')?.getAttribute('width'), '200');
  assert.equal(region().querySelector('g')?.getAttribute('transform'), 'translate(20,30)');
  assert.ok(host.querySelector('.map-marker[title="Standalone bin"]'));
  assert.equal(host.querySelector('.map-region[data-location-id="unknown"]'), null);
  assert.equal(writes.length, 0);
});

test('geometry edits update the image and selection outline together without catalog writes', async () => {
  const element = createElement(RoomMap, { room, locations, selectedLocationId: 'table', onSelect: () => {} });
  await render(element);
  const before = host.querySelector('img')?.getAttribute('src');
  await render(element, parseSvgMap(source(400, 'rotate(15,500,250)').replace('width="200"', 'width="320"')));
  assert.equal(region().querySelector('rect')?.getAttribute('x'), '400');
  assert.equal(region().querySelector('rect')?.getAttribute('width'), '320');
  assert.equal(region().querySelector('g')?.getAttribute('transform'), 'rotate(15,500,250)');
  assert.notEqual(host.querySelector('img')?.getAttribute('src'), before);
  assert.equal(locations[1]?.mapPosition?.x, 0.99);
  assert.equal(writes.length, 0);
});

test('SVG surfaces select on click, Enter, and Space without placing points or submitting forms', async () => {
  const selected: string[] = [];
  let placed = 0, submitted = 0;
  await render(createElement('form', { onSubmit: () => { submitted++; } },
    createElement(RoomMap, { room, locations, onSelect: (id: string) => { selected.push(id); }, onPlace: () => { placed++; } })));
  await click(region().querySelector('rect')!);
  await key(region(), 'Enter');
  await key(region(), ' ');
  assert.deepEqual(selected, ['table', 'table', 'table']);
  assert.equal(region().getAttribute('tabindex'), '0');
  assert.equal(region().getAttribute('role'), 'button');
  assert.equal(placed, 0);
  assert.equal(submitted, 0);
});

test('shape selection supplies the clicked spot or measured shape center, never the legacy pin', async () => {
  const points: Array<{ x: number; y: number } | undefined> = [];
  await render(createElement(RoomMap, { room, locations, onSelect: (_id, point) => { points.push(point); } }));
  const stage = host.querySelector<HTMLElement>('.room-map-stage');
  assert.ok(stage);
  stage.getBoundingClientRect = () => ({
    x: 10, y: 20, left: 10, top: 20, width: 1000, height: 500, right: 1010, bottom: 520, toJSON: () => ({}),
  });
  region().getBoundingClientRect = () => ({
    x: 130, y: 100, left: 130, top: 100, width: 200, height: 100, right: 330, bottom: 200, toJSON: () => ({}),
  });
  await act(() => { region().querySelector('rect')!.dispatchEvent(new dom.window.MouseEvent('click', {
    bubbles: true, cancelable: true, detail: 1, clientX: 160, clientY: 125,
  })); });
  await key(region(), 'Enter');
  await click(button('Zoom in'));
  stage.getBoundingClientRect = () => ({
    x: -100, y: -50, left: -100, top: -50, width: 1250, height: 625, right: 1150, bottom: 575, toJSON: () => ({}),
  });
  region().getBoundingClientRect = () => ({
    x: 50, y: 50, left: 50, top: 50, width: 250, height: 125, right: 300, bottom: 175, toJSON: () => ({}),
  });
  await key(region(), 'Enter');
  assert.deepEqual(points, [{ x: 0.15, y: 0.21 }, { x: 0.22, y: 0.26 }, { x: 0.22, y: 0.26 }]);
});

test('unmarked descendants highlight the nearest table shape with an approximate-location explanation', async () => {
  const unpinned = locations.map((location) => location.id === 'table' ? { ...location, mapPosition: undefined } : location);
  await render(createElement(RoomMap, { room, locations: unpinned, selectedLocationId: 'bin', onSelect: () => {} }));
  assert.ok(region().classList.contains('selected'));
  assert.match(host.textContent ?? '', /Approximate location:.*Table A/);
  await render(createElement(RoomMap, { room, locations, selectedLocationId: 'point', onSelect: () => {} }));
  assert.equal(region().classList.contains('selected'), false);
  assert.equal(host.querySelector('.map-marker.selected')?.getAttribute('title'), 'Standalone bin');
});

test('shape links navigate normally, while excluded or cross-room locations are not interactive', async () => {
  await render(createElement(RoomMap, { room, locations, selectedLocationId: 'table' }));
  const link = region().closest('a');
  assert.equal(link?.getAttribute('href'), '/maps?room=room&location=table');
  assert.ok(link);
  await click(link);
  assert.equal(router?.state.location.search, '?room=room&location=table');
  await render(createElement(RoomMap, { room, locations, excludedIds: ['table'], onSelect: () => {} }));
  assert.equal(host.querySelector('.map-region'), null);
  const moved = locations.map((location) => location.id === 'table' ? { ...location, parentId: 'elsewhere' } : location);
  await render(createElement(RoomMap, { room, locations: moved, onSelect: () => {} }));
  assert.equal(host.querySelector('.map-region'), null);
});

test('multi-select maps highlight exact selected shapes and fallback points', async () => {
  await render(createElement(RoomMap, { room, locations, selectedLocationIds: ['table', 'point'], onSelect: () => {} }));
  assert.equal(region().getAttribute('aria-pressed'), 'true');
  assert.equal(host.querySelector('.map-marker')?.getAttribute('aria-pressed'), 'true');
});

test('SVG content is never injected as executable DOM', async () => {
  const malicious = parseSvgMap(source().replace('<text>Table A</text>',
    '<script>window.injected=true</script><foreignObject><body onload="alert(1)">Unsafe</body></foreignObject>'));
  await render(createElement(RoomMap, { room, locations, onSelect: () => {} }), malicious);
  assert.equal(host.querySelector('script, foreignObject, [onclick], [onload]'), null);
  assert.equal(region().querySelector('rect')?.attributes.length, 6);
});

test('the point-marker editor cannot override an SVG-linked shape', async () => {
  await render(createElement(LocationMapEditor, { locations, onChanged: () => {} }), parseSvgMap(source()),
    '/manage/locations?room=room&pin=table');
  assert.equal(button('Remove marker').disabled, true);
  assert.equal(button('Save all markers').disabled, true);
  assert.equal(host.querySelector('.room-map-stage')?.classList.contains('placing'), false);
  assert.match(host.textContent ?? '', /SVG-linked shape/);
  assert.equal(writes.length, 0);
});

test('metadata editing accepts a linked SVG shape without requiring a point marker', async () => {
  const location = { ...locations[1]!, mapPosition: undefined };
  await render(createElement(LocationEditor, {
    locations: [room, location], location, parentId: room.id, onSaved: () => {}, onCancel: () => {}, onStateChange: () => {},
  }));
  assert.equal(button('Save').disabled, false);
  assert.equal(host.querySelector('.room-map-stage')?.classList.contains('placing'), false);
  await click(button('Save'));
  assert.equal(writes[0]?.url, '/api/locations/table');
  assert.equal(writes[0]?.body.mapPosition, undefined);
});

test('refreshing an SVG source reads fresh geometry and recovers explicitly from malformed assets', async () => {
  let text = source();
  let options: RequestInit | undefined;
  globalThis.fetch = async (_url, init) => { options = init; return new Response(text); };
  await render(createElement(RoomMap, { room, locations, selectedLocationId: 'table', onSelect: () => {} }), null);
  assert.equal(region().querySelector('rect')?.getAttribute('x'), '100');
  assert.equal(options?.cache, 'no-store');
  text = source(600);
  await act(() => refreshSvgMap('common'));
  assert.equal(region().querySelector('rect')?.getAttribute('x'), '600');
  text = '<not-an-svg/>';
  await act(() => refreshSvgMap('common'));
  assert.match(host.querySelector('[role="alert"]')?.textContent ?? '', /Could not load the floor plan/);
  assert.equal(host.querySelector('.map-region, .map-marker'), null);
  text = source(200);
  await act(() => refreshSvgMap('common'));
  assert.equal(region().querySelector('rect')?.getAttribute('x'), '200');
});
