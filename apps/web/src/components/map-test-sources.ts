import { ROOM_MAPS, parseSvgMap, type RoomMapId } from '@garage/shared';

const emptyMap = (id: RoomMapId) => {
  const { width, height } = ROOM_MAPS[id];
  return parseSvgMap(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="white"/></svg>`);
};

export const emptyMapSources = { common: emptyMap('common'), advanced: emptyMap('advanced') };
export const benchMapSources = {
  ...emptyMapSources,
  common: parseSvgMap(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ROOM_MAPS.common.width} ${ROOM_MAPS.common.height}">
    <rect width="${ROOM_MAPS.common.width}" height="${ROOM_MAPS.common.height}" fill="white"/>
    <g data-location-id="bench"><rect x="100" y="120" width="200" height="120"/></g>
  </svg>`),
};
export const pointMapSources = {
  common: parseSvgMap(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ROOM_MAPS.common.width} ${ROOM_MAPS.common.height}">
    <rect width="${ROOM_MAPS.common.width}" height="${ROOM_MAPS.common.height}" fill="white"/>
    <g data-location-id="table-a"><rect x="100" y="100" width="220" height="120"/></g>
    <g data-location-id="table-b"><rect x="400" y="100" width="220" height="120"/></g>
  </svg>`),
  advanced: parseSvgMap(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ROOM_MAPS.advanced.width} ${ROOM_MAPS.advanced.height}">
    <rect width="${ROOM_MAPS.advanced.width}" height="${ROOM_MAPS.advanced.height}" fill="white"/>
    <g data-location-id="table-3"><rect x="300" y="80" width="220" height="120"/></g>
  </svg>`),
};
