import cookieParser from 'cookie-parser';import express, { type NextFunction, type Request, type Response } from 'express';

import { createAssistantProvider } from './assistant/index.js';
import { config, isUsingDefaultSecrets } from './config.js';
import { createRepository } from './repository/index.js';
import { assistantRoutes } from './routes/assistant.js';
import { authRoutes } from './routes/auth.js';
import { publicRoutes } from './routes/public.js';
import { staffRoutes } from './routes/staff.js';

const repository = await createRepository();

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
  // body-parser marks a malformed or oversized body as a 4xx; that's the
  // client's mistake, not an internal failure, so don't report it as a 500.
  const status = (error as { status?: number; statusCode?: number }).status ??
    (error as { statusCode?: number }).statusCode;

  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: 'Malformed request' });
    return;
  }

  console.error('[api]', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`);
  console.log(`[api] assistant provider: ${provider.name}`);
  if (isUsingDefaultSecrets) {
    console.warn('[api] Using default STAFF_PASSPHRASE / SESSION_SECRET. Copy .env.example to .env before demoing.');
  }
});
