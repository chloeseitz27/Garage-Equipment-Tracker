import { Router } from 'express';
import { recommendRequestSchema, type AssistantProvider } from '@garage/shared';

import { recommendForProject } from '../assistant/recommend.js';
import { asyncHandler, rateLimit } from '../middleware.js';
import type { CatalogRepository } from '../repository/catalog-repository.js';

export function assistantRoutes(
  repository: CatalogRepository,
  provider: AssistantProvider,
): Router {
  const router = Router();

  router.post(
    '/recommend',
    rateLimit({ windowMs: 60_000, max: 10 }),
    asyncHandler(async (req, res) => {
      const parsed = recommendRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
        return;
      }

      // Project descriptions are typed on a shared, unauthenticated kiosk, so
      // the text is never logged or stored (chatbot-spec.md §9).
      const response = await recommendForProject(
        repository,
        provider,
        parsed.data.projectDescription,
      );
      res.json(response);
    }),
  );

  return router;
}
