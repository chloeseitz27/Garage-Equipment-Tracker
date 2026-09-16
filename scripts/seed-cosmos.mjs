#!/usr/bin/env node
/**
 * Imports data/seed into a Cosmos container (technical-spec.md §4).
 *
 * Validates and integrity-checks before writing anything, so a broken seed
 * can't land half-imported. Safe to re-run: documents are upserted by id.
 *
 *   node scripts/seed-cosmos.mjs
 *
 * Reads COSMOS_ENDPOINT / COSMOS_DATABASE / COSMOS_CONTAINER, and COSMOS_KEY if
 * set. With no key it authenticates via DefaultAzureCredential, so `az login`
 * as the account holding the Cosmos data-plane role is enough.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import {
  categoriesFileSchema,
  findCatalogProblems,
  flagsFileSchema,
  itemsFileSchema,
  locationsFileSchema,
} from '@garage/shared';

try {
  process.loadEnvFile();
} catch {
  // no .env — rely on the ambient environment
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seedDir = process.env.SEED_DIR ?? join(root, 'data', 'seed');

const endpoint = process.env.COSMOS_ENDPOINT;
const databaseId = process.env.COSMOS_DATABASE ?? 'garage';
const containerId = process.env.COSMOS_CONTAINER ?? 'catalog';
const key = process.env.COSMOS_KEY;

if (!endpoint) {
  console.error('COSMOS_ENDPOINT is not set.');
  process.exit(1);
}

const readJson = async (name) => JSON.parse(await readFile(join(seedDir, name), 'utf8'));

const parse = (schema, raw, name) => {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  console.error(`${name} failed validation:`);
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  process.exit(1);
};

const items = parse(itemsFileSchema, await readJson('items.json'), 'items.json');
const locations = parse(locationsFileSchema, await readJson('locations.json'), 'locations.json');
const categories = parse(categoriesFileSchema, await readJson('categories.json'), 'categories.json');
const flags = parse(flagsFileSchema, await readJson('flags.json'), 'flags.json');

const problems = findCatalogProblems({ items, locations, categories, flags });
if (problems.length > 0) {
  console.error(`Seed data is inconsistent; nothing was written:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}

const client = key
  ? new CosmosClient({ endpoint, key })
  : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });

const container = client.database(databaseId).container(containerId);

const groups = [
  ['item', items],
  ['location', locations],
  ['category', categories],
  ['flag', flags],
];

let written = 0;
for (const [type, records] of groups) {
  for (const record of records) {
    await container.items.upsert({ ...record, type });
    written += 1;
  }
  console.log(`  ${type.padEnd(9)} ${records.length}`);
}

console.log(`\nImported ${written} documents into ${databaseId}/${containerId}.`);
