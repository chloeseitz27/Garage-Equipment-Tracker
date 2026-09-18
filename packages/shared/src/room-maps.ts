export const ROOM_MAP_IDS = ['common', 'advanced'] as const;
export type RoomMapId = (typeof ROOM_MAP_IDS)[number];

export const ROOM_MAPS = {
  common: {
    name: 'Common Makerspace',
    imageUrl: '/maps/common-makerspace.svg',
    width: 1555,
    height: 982,
  },
  advanced: {
    name: 'Advanced Makerspace',
    imageUrl: '/maps/advanced-makerspace.svg',
    width: 1333,
    height: 507,
  },
} satisfies Record<RoomMapId, { name: string; imageUrl: string; width: number; height: number }>;
