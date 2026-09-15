#!/usr/bin/env node
/**
 * Validates data/seed against the schema and checks referential integrity
 * (technical-spec.md §10). Broken seed data breaks the demo silently, so this
 * should run in CI and before any demo.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  categoriesFileSchema,
  findCatalogProblems,
  flagsFileSchema,
  itemsFileSchema,
  locationsFileSchema,
} from '@garage/shared';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.argv[2] ?? join(root, 'data', 'seed');

const readJson = async (name) => JSON.parse(await readFile(join(dir, name), 'utf8'));

const parse = (schema, raw, name) => {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;

  console.error(`\n${name} failed schema validation:`);
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
  console.error(`\n${problems.length} integrity problem(s) in ${dir}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const equipment = items.filter((item) => item.kind === 'equipment').length;
console.log(
  `${dir} is valid: ${items.length} items (${equipment} equipment, ${items.length - equipment} consumable), ` +
    `${locations.length} locations, ${categories.length} categories.`,
);
