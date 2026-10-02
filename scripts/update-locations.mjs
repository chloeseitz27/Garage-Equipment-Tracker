import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { locationsFileSchema } from '@garage/shared';
import { config } from '../apps/api/src/config.ts';
import { createRepository } from '../apps/api/src/repository/index.ts';
import { updateLocationCatalog } from '../apps/api/src/repository/location-updates.ts';

const apply = process.argv.includes('--apply');
const seed = locationsFileSchema.parse(JSON.parse(await readFile(join(config.seedDir, 'locations.json'), 'utf8')));
const repository = await createRepository();
const changes = await updateLocationCatalog(repository, seed, apply);
for (const change of changes) console.log(change);
console.log(changes.length
  ? apply ? 'Location catalog updated. Inventory and existing marker positions were preserved.'
    : 'Preview only. Run npm run update:locations -- --apply to apply these changes.'
  : 'Location catalog is already up to date.');
