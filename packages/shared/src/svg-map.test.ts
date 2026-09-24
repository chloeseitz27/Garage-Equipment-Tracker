import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseSvgMap } from './svg-map.js';
import { locationPlacementProblem, resolveMapTarget } from './map-location.js';
import type { Location } from './types.js';

const svg = (content: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500">${content}</svg>`;

test('SVG regions preserve actual geometry and every nested transform without using marker coordinates', () => {
  const map = parseSvgMap(svg(`<g transform="translate(40,50)"><g id="editable" data-location-id="table"
    transform="matrix(1,0,0,1,20,30)"><rect class="surface" transform="rotate(-90)" x="10" y="20"
    width="200" height="60" rx="8"/><text x="50" y="50">Table</text></g></g>`));
  assert.deepEqual([map.width, map.height, map.viewBox], [1000, 500, '0 0 1000 500']);
  assert.deepEqual(map.regions, [{
    locationId: 'table',
    geometry: [{
      tag: 'rect', attributes: { x: '10', y: '20', width: '200', height: '60', rx: '8' },
      transforms: ['translate(40,50)', 'matrix(1,0,0,1,20,30)', 'rotate(-90)'],
    }],
  }]);
  assert.equal(parseSvgMap(svg('<g data-location-id="a" transform="translate(10,20), rotate(30)"><rect width="10" height="20"/></g>'))
    .regions[0]?.geometry[0]?.transforms[0], 'translate(10,20), rotate(30)');
});

test('explicit shape markers support multipart paths, polygons, circles, and ellipses', () => {
  const map = parseSvgMap(svg(`<g data-location-id="table">
    <rect width="100" height="100"/>
    <path data-location-shape="true" d="M0 0H20V30Z" fill-rule="evenodd"/>
    <polygon data-location-shape="true" points="0,0 10,0 10,10" style="fill-rule:evenodd;fill:red"/>
    <circle data-location-shape="true" cx="50" cy="50" r="20"/>
    <ellipse data-location-shape="true" cx="80" cy="80" rx="10" ry="5"/>
  </g>`));
  assert.deepEqual(map.regions[0]?.geometry.map((shape) => shape.tag), ['path', 'polygon', 'circle', 'ellipse']);
  assert.equal(map.regions[0]?.geometry[0]?.attributes.fillRule, 'evenodd');
  assert.equal(map.regions[0]?.geometry[1]?.attributes.fillRule, 'evenodd');
});

test('the interactive layer copies only inert geometry, not script, HTML, event handlers, styles, or URLs', () => {
  const map = parseSvgMap(svg(`<g data-location-id="table" onclick="alert(1)">
    <rect class="surface" x="1" y="2" width="30" height="40" style="fill:red" onload="alert(2)" href="javascript:alert(3)"/>
    <script>alert(4)</script><foreignObject><body onload="alert(5)">HTML</body></foreignObject>
  </g>`));
  assert.deepEqual(map.regions[0]?.geometry[0]?.attributes, { x: '1', y: '2', width: '30', height: '40' });
  assert.doesNotMatch(JSON.stringify(map.regions), /alert|javascript|style|onclick|onload|foreignObject|script/);
});

test('SVG namespaces are honored instead of treating foreign XML elements as drawn surfaces', () => {
  const map = parseSvgMap('<s:svg xmlns:s="http://www.w3.org/2000/svg" xmlns:other="urn:other" viewBox="0 0 100 100">' +
    '<s:g data-location-id="table"><s:rect width="30" height="40"/><other:rect width="99" height="99"/></s:g></s:svg>');
  assert.equal(map.regions[0]?.geometry.length, 1);
  assert.equal(map.regions[0]?.geometry[0]?.attributes.width, '30');
  assert.throws(() => parseSvgMap('<svg xmlns="urn:not-svg" viewBox="0 0 100 100"/>'), /namespace/);
});

test('ambiguous IDs, malformed XML, unsupported geometry, and entity declarations fail explicitly', () => {
  for (const source of [
    svg('<g data-location-id="same"><rect width="10" height="10"/></g><g data-location-id="same"><rect width="10" height="10"/></g>'),
    '<svg><g></svg>',
    svg('<g data-location-id="empty"><text>No geometry</text></g>'),
    svg('<g data-location-id="clone"><use href="#elsewhere"/></g>'),
    svg('<g transform="translate(1,2)" clip-path="url(#clip)"><g data-location-id="clipped"><rect width="10" height="10"/></g></g>'),
    '<!DOCTYPE svg [<!ENTITY x "expanded">]>' + svg('<text>&x;</text>'),
    '<svg viewBox="0 0 0 500"/>',
  ]) assert.throws(() => parseSvgMap(source));
});

test('both shipped SVG files expose every linked location through the shared geometry parser', async () => {
  for (const [name, count] of [['common', 15], ['advanced', 12]] as const) {
    const source = await readFile(new URL(`../../../apps/web/public/maps/${name}-makerspace.svg`, import.meta.url), 'utf8');
    const map = parseSvgMap(source);
    assert.equal(map.regions.length, count);
    assert.ok(map.regions.every((region) => region.geometry.length > 0));
  }
});

test('native surfaces take priority over stale pins and storage always inherits its enclosing surface', () => {
  const locations: Location[] = [
    { id: 'room', name: 'Room', parentId: null, kind: 'room', mapId: 'common' },
    { id: 'table', name: 'Table', parentId: 'room', kind: 'table',
      mapPosition: { roomId: 'room', mapId: 'common', x: 0.9, y: 0.9 } },
    { id: 'bin', name: 'Bin', parentId: 'table', kind: 'bin' },
  ];
  const ids = new Set(['table']);
  assert.equal(resolveMapTarget(locations, 'table', ids)?.kind, 'shape');
  assert.equal(resolveMapTarget(locations, 'bin', ids)?.location.id, 'table');
  assert.equal(resolveMapTarget(locations, 'bin', ids)?.kind, 'shape');
  const point: Location = { ...locations[2]!, mapPosition: { roomId: 'room', mapId: 'common', x: 0.2, y: 0.3 } };
  assert.equal(resolveMapTarget([...locations.slice(0, 2), point], 'bin', ids)?.kind, 'shape');
  assert.equal(resolveMapTarget([...locations.slice(0, 2), point], 'bin', new Set(['table', 'bin']))?.location.id, 'table');
  assert.equal(locationPlacementProblem({ id: 'table', parentId: 'room' }, locations, ids), null);
  assert.equal(locationPlacementProblem(locations[2]!, locations, ids), null);
});
