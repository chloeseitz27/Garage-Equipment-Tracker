import { readFile } from 'node:fs/promises';
import { ROOM_MAPS, parseSvgMap, type RoomMapId } from '@garage/shared';

export async function svgLocationIds(mapId: RoomMapId): Promise<Set<string>> {
  const name = ROOM_MAPS[mapId].imageUrl.split('/').pop()!;
  let source: string;
  try {
    source = await readFile(new URL(`../../web/public/maps/${name}`, import.meta.url), 'utf8');
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    source = await readFile(new URL(`maps/${name}`, import.meta.resolve('@garage/shared')), 'utf8');
  }
  return new Set(parseSvgMap(source).regions.map((region) => region.locationId));
}
