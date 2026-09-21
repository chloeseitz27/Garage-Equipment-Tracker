import { copyFile, mkdir } from 'node:fs/promises';
import { ROOM_MAPS } from '../packages/shared/dist/room-maps.js';

const destination = new URL('../packages/shared/dist/maps/', import.meta.url);
await mkdir(destination, { recursive: true });
for (const asset of Object.values(ROOM_MAPS)) {
  const name = asset.imageUrl.split('/').pop();
  await copyFile(new URL(`../apps/web/public/maps/${name}`, import.meta.url), new URL(name, destination));
}
