import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Environment config. Secrets are read here and nowhere else, and never leave
 * the server process (technical-spec.md §9.1).
 */

const here = dirname(fileURLToPath(import.meta.url));
// apps/api/src (tsx) or apps/api/dist (built) — three levels up either way.
const repoRoot = resolve(here, '..', '..', '..');

/*
  Resolve .env against the repo root, not the working directory.
  process.loadEnvFile() with no argument uses cwd, and npm workspace scripts run
  with cwd set to apps/api — so the root .env was silently ignored and every
  setting fell back to its default.
*/
try {
  process.loadEnvFile(join(repoRoot, '.env'));
} catch {
  // No .env. Defaults below apply, and in Azure the settings come from the
  // App Service configuration rather than a file.
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  dataDir: process.env.DATA_DIR ?? join(repoRoot, 'data', 'runtime'),
  seedDir: process.env.SEED_DIR ?? join(repoRoot, 'data', 'seed'),

  /** `json` for local files, `cosmos` for Azure Cosmos DB (technical-spec.md §4). */
  storage: (process.env.STORAGE ?? 'json') as 'json' | 'cosmos',
  catalogCacheTtlMs: Number(process.env.CATALOG_CACHE_TTL_MS ?? 3_600_000),

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
