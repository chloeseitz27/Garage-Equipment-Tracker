import { existsSync } from 'node:fs';
import { cp, mkdir, readdir } from 'node:fs/promises';

import { config } from '../config.js';
import type { CatalogRepository } from './catalog-repository.js';
import { CosmosCatalogRepository } from './cosmos-repository.js';
import { JsonCatalogRepository } from './json-repository.js';
import { CachedCatalogRepository } from './cached-repository.js';

/**
 * Chooses the storage backend (technical-spec.md §4). Everything above the
 * repository interface is unaware of which one it got.
 */
export async function createRepository(): Promise<CatalogRepository> {
  if (config.storage === 'cosmos') {
    const { endpoint, database, container, key } = config.cosmos;
    if (!endpoint) {
      throw new Error('STORAGE=cosmos requires COSMOS_ENDPOINT to be set.');
    }

    const repository = new CosmosCatalogRepository({ endpoint, database, container, key });
    await repository.load();
    console.log(
      `[api] storage: cosmos (${database}/${container}, auth: ${key ? 'key' : 'managed identity'})`,
    );
    return new CachedCatalogRepository(repository, { ttlMs: config.catalogCacheTtlMs });
  }

  // Local JSON files. In a cloud deployment there's no `npm run seed` step, so
  // seed on first boot when the data directory is missing or empty.
  await ensureSeeded();

  const repository = new JsonCatalogRepository(config.dataDir);
  await repository.load();
  console.log(`[api] storage: json (${config.dataDir})`);
  return repository;
}

async function ensureSeeded(): Promise<void> {
  const hasData = existsSync(config.dataDir) && (await readdir(config.dataDir)).length > 0;
  if (hasData) return;

  if (!existsSync(config.seedDir)) {
    throw new Error(
      `No catalog data at ${config.dataDir} and no seed data at ${config.seedDir}. Run \`npm run seed\`.`,
    );
  }

  await mkdir(config.dataDir, { recursive: true });
  await cp(config.seedDir, config.dataDir, { recursive: true });
  console.log(`[api] seeded ${config.dataDir} from ${config.seedDir}`);
}
