import { ROOM_MAPS, parseSvgMap, type RoomMapId } from '@garage/shared';

const pointOnlyMap = (id: RoomMapId) => {
  const { width, height } = ROOM_MAPS[id];
  return parseSvgMap(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="white"/></svg>`);
};

export const pointMapSources = { common: pointOnlyMap('common'), advanced: pointOnlyMap('advanced') };
