import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { findCatalogProblems, locationMapProblem, locationSchema, locationsFileSchema, resolveLocationMap, ROOM_MAPS, searchLocations, type Location } from './index.js';

const locations: Location[] = [
  { id: 'common', name: 'Common Makerspace', kind: 'room', parentId: null, mapId: 'common' },
  { id: 'advanced', name: 'Advanced Makerspace', kind: 'room', parentId: null, mapId: 'advanced' },
  { id: 'table', name: 'Table A', kind: 'table', parentId: 'common' },
  { id: 'bin', name: 'Bin 1', kind: 'bin', parentId: 'table' },
];

const parseSvg = (source: string): Document =>
  new JSDOM(source, { contentType: 'image/svg+xml' }).window.document;
const readSvg = async (room: string): Promise<Document> =>
  parseSvg(await readFile(new URL(`../../../apps/web/public/maps/${room}-makerspace.svg`, import.meta.url), 'utf8'));
const svgNumber = (element: Element, attribute: string): number => {
  const value = element.getAttribute(attribute);
  assert.ok(value !== null && value.trim() !== '', `Missing ${attribute} on ${element.id}`);
  const number = Number(value);
  assert.ok(Number.isFinite(number), `Invalid ${attribute} on ${element.id}`);
  return number;
};
const transformPoint = (element: Element, point: { x: number; y: number }): { x: number; y: number } => {
  let { x, y } = point;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const transforms = [...(node.getAttribute('transform') ?? '').matchAll(/(\w+)\(([^)]+)\)/g)].reverse();
    for (const [, operation, argumentsText] of transforms) {
      const values = argumentsText!.trim().split(/[\s,]+/).map(Number);
      const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = values;
      if (operation === 'translate') { x += a; y += b; }
      else if (operation === 'matrix') [x, y] = [a * x + c * y + e, b * x + d * y + f];
      else if (operation === 'scale') { x *= a; y *= values[1] ?? a; }
      else if (operation === 'rotate') {
        const angle = a * Math.PI / 180;
        [x, y] = [
          b + (x - b) * Math.cos(angle) - (y - c) * Math.sin(angle),
          c + (x - b) * Math.sin(angle) + (y - c) * Math.cos(angle),
        ];
      } else assert.fail(`Unsupported SVG transform: ${operation}`);
    }
  }
  return { x, y };
};
const drawnLocationIds = (svg: Document): string[] =>
  [...svg.querySelectorAll('[data-location-id]')].map((element) => element.getAttribute('data-location-id')!).filter(Boolean);

test('SVG assertions tolerate editor whitespace, attribute order, extra attributes, and nested text', () => {
  const svg = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><title
    id="title">Test room</title><g transform="translate(2,3)" id="editor-group"
    data-storage-letter="A" data-location-id="table"><text id="label"><tspan>Table A</tspan></text>
    <rect id="shape" height="10" width="20" y="5" x="10" class="surface"/></g></svg>`);
  assert.equal(svg.querySelector('title')?.textContent, 'Test room');
  const group = svg.querySelector('[data-location-id="table"]')!;
  assert.equal(group.getAttribute('data-storage-letter'), 'A');
  assert.equal(group.querySelector('text')?.textContent, 'Table A');
  const rect = group.querySelector('rect')!;
  assert.deepEqual(transformPoint(rect, { x: svgNumber(rect, 'x'), y: svgNumber(rect, 'y') }), { x: 12, y: 8 });
});

test('a location resolves its mapped room and floor plan', () => {
  const result = resolveLocationMap(locations, 'table');
  assert.equal(result?.room.id, 'common');
  assert.equal(result?.map.imageUrl, '/maps/common-makerspace.svg');
});

test('bins resolve to the same mapped room as their enclosing surface', () => {
  assert.equal(resolveLocationMap(locations, 'bin')?.room.id, 'common');
});

test('a cross-room move resolves the moved subtree from its current hierarchy', () => {
  const moved = locations.map((l) => l.id === 'table' ? { ...l, parentId: 'advanced' } : l);
  const result = resolveLocationMap(moved, 'bin');
  assert.equal(result?.room.id, 'advanced');
});

test('unmapped rooms and invalid location IDs are explicit misses', () => {
  assert.equal(resolveLocationMap(locations, 'missing'), null);
  assert.equal(resolveLocationMap([{ id: 'plain', name: 'Room', kind: 'room', parentId: null }], 'plain'), null);
  assert.equal(resolveLocationMap(locations, 'advanced')?.room.id, 'advanced');
});

test('location schemas strip legacy coordinates and validate supported floor plans', () => {
  const base = locations[2];
  assert.ok(base);
  const parsed = locationSchema.parse({ ...base, mapPosition: { roomId: 'common', mapId: 'common', x: 2, y: -1 } });
  assert.equal('mapPosition' in parsed, false);
  assert.equal(locationSchema.safeParse({ ...locations[0], mapId: 'missing' }).success, false);
  assert.equal(locationSchema.safeParse(base).success, true);
});

test('map ids can only be assigned to top-level rooms', () => {
  const table = locations[2];
  assert.ok(table);
  assert.equal(locationMapProblem(table), null);
  assert.match(locationMapProblem({ ...table, mapId: 'common' }) ?? '', /top-level room/);
  assert.equal(findCatalogProblems({ items: [], categories: [], locations }).length, 0);
});

test('redrawn maps preserve source coordinate systems and include all seeded map locations', async () => {
  const seed = locationsFileSchema.parse(JSON.parse(await readFile(new URL('../../../data/seed/locations.json', import.meta.url), 'utf8')));
  for (const [mapId, asset] of Object.entries(ROOM_MAPS)) {
    const svg = await readSvg(mapId);
    assert.equal(svg.documentElement.getAttribute('viewBox'), `0 0 ${asset.width} ${asset.height}`);
    assert.equal(svg.querySelector('title#title')?.textContent, asset.name);
    assert.equal(svg.querySelector('script'), null);
    const drawnIds = drawnLocationIds(svg);
    assert.equal(new Set(drawnIds).size, drawnIds.length);
    for (const locationId of drawnIds) {
      const location = seed.find((entry) => entry.id === locationId);
      assert.ok(location, `${locationId} must exist in seed data`);
      assert.equal(resolveLocationMap(seed, locationId)?.room.mapId, mapId);
      const groups = svg.querySelectorAll(`[data-location-id="${locationId}"]`);
      assert.equal(groups.length, 1, `${location.name} must have exactly one drawing group`);
      const rect = groups[0]!.querySelector('rect');
      if (rect) {
        const center = transformPoint(rect, {
          x: svgNumber(rect, 'x') + svgNumber(rect, 'width') / 2,
          y: svgNumber(rect, 'y') + svgNumber(rect, 'height') / 2,
        });
        assert.ok(center.x >= 0 && center.x <= asset.width, `${location.name}: SVG surface must be on the floor plan`);
        assert.ok(center.y >= 0 && center.y <= asset.height, `${location.name}: SVG surface must be on the floor plan`);
      }
    }
  }
});

test('the Toolbox keeps its ID but belongs to Advanced Makerspace at the old coat-rack area', async () => {
  const seed = locationsFileSchema.parse(JSON.parse(await readFile(new URL('../../../data/seed/locations.json', import.meta.url), 'utf8')));
  const toolbox = seed.find((location) => location.id === 'loc-common-toolbench');
  assert.ok(toolbox);
  assert.equal(toolbox.name, 'Toolbox');
  assert.equal(toolbox.parentId, 'loc-advanced-makerspace');
  assert.equal(resolveLocationMap(seed, toolbox.id)?.room.name, 'Advanced Makerspace');
  assert.equal((await readSvg('common')).querySelector(`[data-location-id="${toolbox.id}"]`), null);
  assert.ok((await readSvg('advanced')).querySelector(`[data-location-id="${toolbox.id}"]`));
});

test('storage letters run clockwise from Common top-right and Advanced top-left', async () => {
  const seed = locationsFileSchema.parse(JSON.parse(await readFile(new URL('../../../data/seed/locations.json', import.meta.url), 'utf8')));
  const sequences = [
    {
      room: 'common',
      letters: 'ABCDEFGHIJKLM',
      ids: ['table-14', 'workbench-17', 'workbench-2', 'table-4', 'table-10', 'table-5',
        'table-6', 'table-6-5', 'table-7', 'table-8', 'table-9', 'desk-1', 'table-13'],
    },
    {
      room: 'advanced',
      letters: 'STUVWXYZ',
      ids: ['workbench-16', 'table-19', 'table-3', 'table-18', 'table-11', 'new-table-u', 'table-20', 'table-21'],
    },
  ];
  const allLetters: string[] = [];
  for (const { room, letters, ids } of sequences) {
    const svg = await readSvg(room);
    const surfaces = seed.filter((l) => l.parentId === `loc-${room}-makerspace` && ['table', 'desk', 'workbench'].includes(l.kind));
    assert.equal(surfaces.length, ids.length);
    for (const [index, oldId] of ids.entries()) {
      const id = oldId === 'new-table-u' ? 'loc-table-u' : `loc-${room}-${oldId}`;
      const location = surfaces.find((l) => l.id === id);
      const letter = letters[index];
      assert.ok(location && letter);
      const group = svg.querySelector(`[data-location-id="${id}"]`);
      assert.ok(group);
      assert.match(location.name, new RegExp(` ${letter}$`));
      assert.equal(/\d/.test(location.name), false, 'Numbers are reserved for drawers');
      assert.equal(group?.getAttribute('data-storage-letter'), letter);
      assert.ok([...group!.querySelectorAll('text')].some((text) =>
        text.textContent?.trim() === letter || text.textContent?.trim() === location.name), `${location.name}: visible label must match catalog`);
      assert.ok(searchLocations(seed, location.name, seed.length).some((match) => match.id === id));
      allLetters.push(letter);
    }
  }
  assert.equal(allLetters.length, 21);
  assert.equal(new Set(allLetters).size, 21);
});

test('six central work tables stay on the drawing but cannot be selected as storage', async () => {
  const seed = locationsFileSchema.parse(JSON.parse(await readFile(new URL('../../../data/seed/locations.json', import.meta.url), 'utf8')));
  const svg = await readSvg('common');
  assert.equal(svg.querySelectorAll('rect.island').length, 6);
  assert.ok(svg.documentElement.textContent?.includes('NO STORAGE'));
  for (const letter of 'abcdef') {
    const id = `loc-common-table-${letter}`;
    assert.equal(seed.some((location) => location.id === id), false);
    assert.equal(svg.querySelector(`[data-location-id="${id}"]`), null);
    assert.equal(resolveLocationMap(seed, id), null);
  }
  assert.equal(drawnLocationIds(svg).filter((id) => resolveLocationMap(seed, id)?.room.id === 'loc-common-makerspace').length, 15);
  assert.equal(drawnLocationIds(await readSvg('advanced')).filter((id) => resolveLocationMap(seed, id)?.room.id === 'loc-advanced-makerspace').length, 12);
  assert.deepEqual(searchLocations(seed, 'work table'), []);
});

test('Roland and Laser labels agree between the floor plans and catalog without changing IDs', async () => {
  const seed = locationsFileSchema.parse(JSON.parse(await readFile(new URL('../../../data/seed/locations.json', import.meta.url), 'utf8')));
  for (const [id, name, room] of [
    ['loc-common-roland', 'Roland', 'common'],
    ['loc-advanced-laser', 'Laser', 'advanced'],
  ]) {
    const location = seed.find((entry) => entry.id === id);
    assert.ok(location);
    assert.equal(location.name, name);
    const svg = await readSvg(room!);
    const group = svg.querySelector(`[data-location-id="${id}"]`);
    assert.ok(group);
    assert.ok([...group.querySelectorAll('text')].some((text) => text.textContent === name));
    assert.equal(group.textContent?.includes(`${name} station`), false);
    assert.ok(searchLocations(seed, name ?? '', seed.length).some((result) => result.id === id));
  }
});

test('Work Tables text is centered inside the six-table formation, not below it', async () => {
  const svg = await readSvg('common');
  const group = svg.querySelector('[data-work-tables="true"]');
  assert.ok(group);
  const tables = [...group.querySelectorAll('rect')].map((element) => ({
    x: svgNumber(element, 'x'), y: svgNumber(element, 'y'),
    width: svgNumber(element, 'width'), height: svgNumber(element, 'height'),
  }));
  assert.equal(tables.length, 6);
  const centerX = (Math.min(...tables.map((t) => t.x)) + Math.max(...tables.map((t) => t.x + t.width))) / 2;
  const centerY = (Math.min(...tables.map((t) => t.y)) + Math.max(...tables.map((t) => t.y + t.height))) / 2;
  const label = [...group.querySelectorAll('text')].find((text) => text.textContent === 'WORK TABLES');
  assert.ok(label);
  assert.ok(Math.abs(svgNumber(label, 'x') - centerX) <= 1);
  assert.ok(Math.abs(svgNumber(label, 'y') - centerY) <= 15);
  assert.ok(group.textContent?.includes('NO STORAGE'));
});

test('the fire cabinet shape stands along the left wall below the projection', async () => {
  const svg = await readSvg('advanced');
  const rect = svg.querySelector('[data-location-id="loc-advanced-fire-cabinet"] rect');
  assert.ok(rect);
  const { x, y } = transformPoint(rect, { x: svgNumber(rect, 'x'), y: svgNumber(rect, 'y') });
  const width = svgNumber(rect, 'width'), height = svgNumber(rect, 'height');
  assert.equal(width, 46);
  assert.equal(height, 140);
  assert.ok(x >= 22 && x <= 26, 'Back must be against the left wall at x=22');
  const wall = svg.querySelector('#advanced-left-wall')!;
  assert.ok(y >= svgNumber(wall, 'y') + svgNumber(wall, 'height'), 'Cabinet stays below the wall projection and inside the room');
});

test('Advanced floor extends directly beneath the left wall projection without a false recess', async () => {
  const svg = await readSvg('advanced');
  const wall = svg.querySelector('#advanced-left-wall');
  const floor = svg.querySelector('path.floor')?.getAttribute('d');
  assert.ok(wall && floor);
  const left = svgNumber(wall, 'x');
  const bottom = svgNumber(wall, 'y') + svgNumber(wall, 'height');
  const right = left + svgNumber(wall, 'width');
  const boundary = floor.match(/H\s*([\d.]+)\s*V\s*([\d.]+)\s*H\s*([\d.]+)\s*Z\s*$/);
  if (boundary) {
    for (const [actual, expected] of [[Number(boundary[1]), left], [Number(boundary[2]), bottom], [Number(boundary[3]), right]]) {
      assert.ok(Math.abs(actual! - expected!) < 5, 'The floor boundary must meet the wall projection within the drawing stroke');
    }
  }
});

test('structural projections are solid wall sections without post callouts on either plan', async () => {
  for (const [room, walls] of [
    ['common', [{ id: 'common-right-wall', x: 1417, y: 238, width: 120, height: 185 }]],
    ['advanced', [
     { id: 'advanced-left-wall', x: 22, y: 22, width: 140, height: 112 },
     { id: 'advanced-right-wall', x: 1239.1667, y: 22.065531, width: 74.76767, height: 92.868935 },
    ]],
  ] as const) {
    const svg = await readSvg(room);
    assert.equal(/\bpost\b/i.test(svg.documentElement.textContent ?? ''), false);
    assert.match(svg.querySelector('style')?.textContent ?? '', /\.wall\s*\{\s*fill: #526776; stroke: #526776; stroke-width: 4;/);
    for (const expected of walls) {
     const wall = svg.querySelector(`#${expected.id}`);
     assert.ok(wall);
     assert.ok(wall.classList.contains('wall'));
     assert.equal(wall.hasAttribute('rx'), false);
     for (const axis of ['x', 'y', 'width', 'height'] as const) {
       assert.ok(Math.abs(svgNumber(wall, axis) - expected[axis]) < 5);
     }
    }
    assert.ok([...svg.querySelectorAll('text')].some((text) => text.textContent === 'SINK'));
  }
});
