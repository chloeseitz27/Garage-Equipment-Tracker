import { XMLParser, XMLValidator } from 'fast-xml-parser';

const GEOMETRY_ATTRIBUTES = {
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  path: ['d', 'fill-rule'],
  polygon: ['points', 'fill-rule'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
} as const;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export interface SvgMapGeometry {
  tag: keyof typeof GEOMETRY_ATTRIBUTES;
  attributes: Record<string, string>;
  transforms: string[];
}
export interface SvgMapRegion {
  locationId: string;
  geometry: SvgMapGeometry[];
}
export interface SvgMap {
  source: string;
  viewBox: string;
  width: number;
  height: number;
  regions: SvgMapRegion[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const attributes = (node: Record<string, unknown>): Record<string, string> =>
  record(node[':@']) ? Object.fromEntries(Object.entries(node[':@']).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  )) : {};

/** Extract inert geometry only. Source SVG is displayed as an image, never injected into the page DOM. */
export function parseSvgMap(source: string): SvgMap {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('Floor plans must not contain XML document types or entities.');
  const valid = XMLValidator.validate(source);
  if (valid !== true) throw new Error(`Invalid floor plan XML: ${valid.err.msg}`);
  const nodes: unknown = new XMLParser({
    preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false, parseAttributeValue: false,
  }).parse(source);
  if (!Array.isArray(nodes)) throw new Error('Floor plan must contain an SVG document.');
  const root = nodes.find((node): node is Record<string, unknown> =>
    record(node) && Object.keys(node).some((key) => key.split(':').pop() === 'svg'));
  if (!root) throw new Error('Floor plan must contain an SVG root.');
  const rootAttributes = attributes(root);
  const rootName = Object.keys(root).find((key) => key.split(':').pop() === 'svg')!;
  const rootNamespace = rootName.includes(':') ? rootAttributes[`xmlns:${rootName.split(':')[0]}`] : rootAttributes.xmlns;
  if (rootNamespace !== SVG_NAMESPACE) throw new Error('Floor plan must declare the SVG XML namespace.');
  const values = rootAttributes.viewBox?.trim().split(/[\s,]+/).map(Number);
  if (!values || values.length !== 4 || values.some((value) => !Number.isFinite(value)) || values[2]! <= 0 || values[3]! <= 0) {
    throw new Error('Floor plan must have a valid, positive viewBox.');
  }
  const regions = new Map<string, { all: SvgMapGeometry[]; primary: SvgMapGeometry[]; explicit: SvgMapGeometry[] }>();
  const walk = (entries: unknown[], transforms: string[], locationId?: string, namespaces: Record<string, string> = {}): void => {
    for (const entry of entries) {
      if (!record(entry)) continue;
      const key = Object.keys(entry).find((name) => name !== ':@' && !name.startsWith('#') && !name.startsWith('?'));
      if (!key) continue;
      const tag = key.split(':').pop()!;
      if (['defs', 'metadata', 'style', 'text', 'title', 'desc', 'script', 'foreignObject'].includes(tag)) continue;
      const attrs = attributes(entry);
      const namespaceContext = { ...namespaces };
      for (const [name, value] of Object.entries(attrs)) {
        if (name === 'xmlns') namespaceContext[''] = value;
        else if (name.startsWith('xmlns:')) namespaceContext[name.slice(6)] = value;
      }
      const prefix = key.includes(':') ? key.split(':')[0]! : '';
      if (namespaceContext[prefix] !== SVG_NAMESPACE) continue;
      const id = attrs['data-location-id'] ?? locationId;
      if (attrs['data-location-id']) {
        if (regions.has(id!)) throw new Error(`Duplicate SVG location ID: ${id}`);
        regions.set(id!, { all: [], primary: [], explicit: [] });
      }
      const nextTransforms = attrs.transform ? [...transforms, attrs.transform] : transforms;
      if (attrs.transform && !/^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\(\s*[-+.\deE,\s]+\)[,\s]*)+$/.test(attrs.transform.trim())) {
        throw new Error(`Unsupported SVG transform for ${id ?? tag}. Use SVG transform attributes with numeric values.`);
      }
      if ((id && (tag === 'use' || tag === 'svg')) || attrs['clip-path'] || attrs.mask || /(?:transform|clip-path|mask)\s*:/.test(attrs.style ?? '')) {
        throw new Error(`Expand clones, nested viewports, clipping/masks, or CSS transforms into ordinary SVG shapes for ${id ?? tag}.`);
      }
      if (id && Object.hasOwn(GEOMETRY_ATTRIBUTES, tag)) {
        const shapeTag = tag as keyof typeof GEOMETRY_ATTRIBUTES;
        const geometry: SvgMapGeometry = {
          tag: shapeTag, transforms: nextTransforms,
          attributes: Object.fromEntries(GEOMETRY_ATTRIBUTES[shapeTag].flatMap((name) =>
            attrs[name] === undefined ? [] : [[name === 'fill-rule' ? 'fillRule' : name, attrs[name]]],
          )),
        };
        if (shapeTag === 'path' || shapeTag === 'polygon') {
          const rule = attrs['fill-rule'] ?? /(?:^|;)\s*fill-rule\s*:\s*(evenodd|nonzero)\b/.exec(attrs.style ?? '')?.[1];
          if (rule) geometry.attributes.fillRule = rule;
        }
        const region = regions.get(id)!;
        region.all.push(geometry);
        if ((attrs.class ?? '').split(/\s+/).some((name) => ['surface', 'station', 'cabinet'].includes(name))) region.primary.push(geometry);
        if (attrs['data-location-shape'] === 'true') region.explicit.push(geometry);
      }
      if (Array.isArray(entry[key])) walk(entry[key], nextTransforms, id, namespaceContext);
    }
  };
  walk([root], []);
  return {
    source, viewBox: values.join(' '), width: values[2]!, height: values[3]!,
    regions: [...regions].map(([locationId, shapes]) => {
      const geometry = shapes.explicit.length ? shapes.explicit : shapes.primary.length ? shapes.primary : shapes.all.slice(0, 1);
      if (!geometry.length) throw new Error(`SVG location ${locationId} has no supported surface shape.`);
      return { locationId, geometry };
    }),
  };
}
