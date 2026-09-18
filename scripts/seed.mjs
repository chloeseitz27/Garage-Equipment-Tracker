#!/usr/bin/env node
/**
 * Copies data/seed -> data/runtime (technical-spec.md §4.2).
 *
 * The app only ever reads and writes data/runtime, which is gitignored, so demo
 * edits never show up as a working-tree diff and a stray `git checkout` can't
 * quietly discard them.
 *
 *   npm run seed     copy only if runtime is empty
 *   npm run reset    overwrite runtime from seed — the "put the demo back" button
 */
import { cp, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seedDir = join(root, 'data', 'seed');
const runtimeDir = join(root, 'data', 'runtime');
const force = process.argv.includes('--force');

if (!existsSync(seedDir)) {
  console.error(`No seed data at ${seedDir}`);
  process.exit(1);
}

await mkdir(runtimeDir, { recursive: true });
const existing = await readdir(runtimeDir);

if (existing.length > 0 && !force) {
  console.log(`data/runtime already has ${existing.length} file(s) — leaving it alone.`);
  console.log('Run `npm run reset` to overwrite it from data/seed.');
  process.exit(0);
}

await cp(seedDir, runtimeDir, { recursive: true, force: true });
const copied = await readdir(runtimeDir);
console.log(`${force ? 'Reset' : 'Seeded'} data/runtime from data/seed (${copied.length} files).`);
