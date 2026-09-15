import { existsSync } from 'node:fs';

import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';

import { createAssistantProvider } from './assistant/index.js';
import { config, isUsingDefaultSecrets } from './config.js';
import { JsonCatalogRepository } from './repository/json-repository.js';
import { assistantRoutes } from './routes/assistant.js';
import { authRoutes } from './routes/auth.js';
import { publicRoutes } from './routes/public.js';
import { staffRoutes } from './routes/staff.js';

if (!existsSync(config.dataDir)) {
  console.error(`No data directory at ${config.dataDir}. Run \`npm run seed\` first.`);
  process.exit(1);
}

const repository = new JsonCatalogRepository(config.dataDir);
await repository.load();

const provider = createAssistantProvider();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, assistantProvider: provider.name });
});

app.use('/api', publicRoutes(repository));
app.use('/api/auth', authRoutes());
app.use('/api/assistant', assistantRoutes(repository, provider));
app.use('/api', staffRoutes(repository));

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[api]', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`);
  console.log(`[api] data: ${config.dataDir}`);
  console.log(`[api] assistant provider: ${provider.name}`);
  if (isUsingDefaultSecrets) {
    console.warn('[api] Using default STAFF_PASSPHRASE / SESSION_SECRET. Copy .env.example to .env before demoing.');
  }
});
