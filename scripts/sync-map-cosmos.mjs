import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { CosmosClient, BulkOperationType } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { locationsFileSchema, MARKER_BATCH_LIMIT } from '@garage/shared';
import { config } from '../apps/api/src/config.ts';
import { planMapSynchronization } from '../apps/api/src/repository/map-synchronization.ts';

const args = process.argv.slice(2);
let apply = false;
let backup;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--apply') apply = true;
  else if (args[index] === '--backup' && args[index + 1] && !args[index + 1].startsWith('--')) backup = args[++index];
  else throw new Error(`Unexpected argument: ${args[index]}. Use --apply --backup <absolute-path>; in PowerShell invoke npm.cmd or node directly.`);
}
if (apply && (!backup || !isAbsolute(backup))) throw new Error('--apply requires --backup with an absolute file path.');
if (config.storage !== 'cosmos' || !config.cosmos.endpoint) throw new Error('This command requires the configured Cosmos catalog.');
const { endpoint, database, container: containerName, key } = config.cosmos;
const client = key ? new CosmosClient({ endpoint, key }) : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
const container = client.database(database).container(containerName);
const readLocations = async () => (await container.items.query('SELECT * FROM c WHERE c.type = "location"', {
  partitionKey: 'location',
}).fetchAll()).resources;
const readAssignments = async () => (await container.items.query('SELECT c.id, c.locationId FROM c WHERE c.type = "item"', {
  partitionKey: 'item',
}).fetchAll()).resources.sort((a, b) => a.id.localeCompare(b.id));
const documents = await readLocations();
const seed = locationsFileSchema.parse(JSON.parse(await readFile(join(config.seedDir, 'locations.json'), 'utf8')));
const plan = planMapSynchronization(locationsFileSchema.parse(documents), seed);
for (const location of plan.updated) {
  console.log(`${location.id}: ${documents.find((doc) => doc.id === location.id).name} -> ${location.name}; ${JSON.stringify(location.mapPosition)}`);
}
for (const location of plan.created) console.log(`Create ${location.id}: ${location.name}; ${JSON.stringify(location.mapPosition)}`);
const count = plan.updated.length + plan.created.length;
if (count > MARKER_BATCH_LIMIT) throw new Error(`The synchronization exceeds the ${MARKER_BATCH_LIMIT}-operation transaction limit.`);
if (!apply) {
  console.log(`Preview: ${plan.updated.length} updates, ${plan.created.length} additions. No records changed.`);
} else if (count === 0) {
  console.log('All drawn locations are already synchronized.');
} else {
  const assignments = await readAssignments();
  await writeFile(backup, JSON.stringify({
    savedAt: new Date().toISOString(), endpoint, database, container: containerName,
    locations: documents, assignments, plan,
  }, null, 2), { flag: 'wx' });
  const operations = [
    ...plan.updated.map((location) => {
      const document = documents.find((doc) => doc.id === location.id);
      if (typeof document._etag !== 'string') throw new Error(`Missing ETag for ${location.id}; refusing an unguarded write.`);
      return {
        operationType: BulkOperationType.Patch, id: location.id, ifMatch: document._etag,
        resourceBody: { operations: [
          { op: 'set', path: '/name', value: location.name },
          { op: 'set', path: '/mapPosition', value: location.mapPosition },
        ] },
      };
    }),
    ...plan.created.map((location) => ({
      operationType: BulkOperationType.Create, resourceBody: { ...location, type: 'location' },
    })),
  ];
  const response = await container.items.batch(operations, 'location');
  const failed = response.result?.find((entry) => entry.statusCode >= 400);
  if ((response.code !== undefined && response.code >= 400) || failed) {
    throw new Error(`Synchronization transaction failed (${failed?.statusCode ?? response.code}); no changes were applied.`);
  }
  if (!response.result || response.result.length !== count) throw new Error('Could not confirm the transaction result. Inspect the database before retrying.');
  const after = await readLocations();
  const byId = new Map(after.map((document) => [document.id, document]));
  const domain = (document) => Object.fromEntries(Object.entries(document).filter(([field]) => !field.startsWith('_')));
  for (const before of documents) {
    const update = plan.updated.find((location) => location.id === before.id);
    const expected = update ? { ...domain(before), name: update.name, mapPosition: update.mapPosition } : domain(before);
    assert.ok(byId.has(before.id), `Location disappeared during synchronization: ${before.id}`);
    assert.deepEqual(domain(byId.get(before.id)), expected, `Unexpected changes to ${before.id}`);
  }
  for (const created of plan.created) assert.deepEqual(domain(byId.get(created.id)), { ...created, type: 'location' });
  assert.equal(after.length, documents.length + plan.created.length);
  assert.deepEqual(await readAssignments(), assignments, 'Item assignments changed during synchronization; review concurrent edits.');
  console.log(`Verified ${plan.updated.length} updates and ${plan.created.length} additions. Existing IDs, other fields, and item assignments are unchanged.`);
  console.log(`Backup: ${backup}`);
  console.log('Existing API instances may need a restart to clear their in-memory catalog cache.');
}
