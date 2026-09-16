import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Environment config. Secrets are read here and nowhere else, and never leave
 * the server process (technical-spec.md §9.1).
 */

// Node loads .env natively; missing file is fine when everything is defaulted.
try {
  process.loadEnvFile();
} catch {
  // no .env — defaults below apply
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

export const config = {
  port: Number(process.env.PORT ?? 3001),
  dataDir: process.env.DATA_DIR ?? join(repoRoot, 'data', 'runtime'),
  seedDir: process.env.SEED_DIR ?? join(repoRoot, 'data', 'seed'),

  /** `json` for local files, `cosmos` for Azure Cosmos DB (technical-spec.md §4). */
  storage: (process.env.STORAGE ?? 'json') as 'json' | 'cosmos',

  cosmos: {
    endpoint: process.env.COSMOS_ENDPOINT ?? '',
    database: process.env.COSMOS_DATABASE ?? 'garage',
    container: process.env.COSMOS_CONTAINER ?? 'catalog',
    /**
     * Optional. Prefer managed identity — with no key set, the app authenticates
     * via DefaultAzureCredential, so no secret exists to leak or rotate.
     */
    key: process.env.COSMOS_KEY ?? '',
  },

  /** Shared passphrase — hackathon only, replaced by Entra ID later (technical-spec.md §8). */
  staffPassphrase: process.env.STAFF_PASSPHRASE ?? 'garage',
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-only-insecure-secret',
  sessionTtlMinutes: Number(process.env.SESSION_TTL_MINUTES ?? 30),

  assistant: {
    provider: process.env.ASSISTANT_PROVIDER ?? 'stub',
    baseUrl: process.env.ASSISTANT_BASE_URL ?? '',
    apiKey: process.env.ASSISTANT_API_KEY ?? '',
    model: process.env.ASSISTANT_MODEL ?? '',
  },
} as const;

export const isUsingDefaultSecrets =
  !process.env.SESSION_SECRET || !process.env.STAFF_PASSPHRASE;
