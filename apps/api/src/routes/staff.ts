import { Router } from 'express';
import {
  createCategorySchema,
  createItemSchema,
  createLocationSchema,
  resolveFlagSchema,
  updateItemSchema,
} from '@garage/shared';

import { requireStaff } from '../auth.js';
import { asyncHandler } from '../middleware.js';
import type { CatalogRepository } from '../repository/catalog-repository.js';

/**
 * Staff writes (product-spec.md §6.5). Every route here is enforced
 * server-side; hiding the UI is not access control.
 */
export function staffRoutes(repository: CatalogRepository): Router {
  const router = Router();
  router.use(requireStaff);

  router.post(
    '/items',
    asyncHandler(async (req, res) => {
      const parsed = createItemSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid item', details: parsed.error.issues });
        return;
      }
      res.status(201).json(await repository.createItem(parsed.data));
    }),
  );

  router.put(
    '/items/:id',
    asyncHandler(async (req, res) => {
      const id = req.params.id ?? '';
      const parsed = updateItemSchema.safeParse({ ...req.body, id });
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid item', details: parsed.error.issues });
        return;
      }
      if (!(await repository.getItem(id))) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      await repository.saveItem(parsed.data);
      res.json(parsed.data);
    }),
  );

  router.post(
    '/locations',
    asyncHandler(async (req, res) => {
      const parsed = createLocationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid location', details: parsed.error.issues });
        return;
      }
      res.status(201).json(await repository.createLocation(parsed.data));
    }),
  );

  router.post(
    '/categories',
    asyncHandler(async (req, res) => {
      const parsed = createCategorySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid category', details: parsed.error.issues });
        return;
      }
      res.status(201).json(await repository.createCategory(parsed.data));
    }),
  );

  router.get(
    '/flags',
    asyncHandler(async (_req, res) => {
      res.json(await repository.getFlags());
    }),
  );

  router.patch(
    '/flags/:id',
    asyncHandler(async (req, res) => {
      const parsed = resolveFlagSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid flag update', details: parsed.error.issues });
        return;
      }

      const flag = await repository.setFlagResolved(req.params.id ?? '', parsed.data.resolved);
      if (!flag) {
        res.status(404).json({ error: 'Flag not found' });
        return;
      }
      res.json(flag);
    }),
  );

  return router;
}
