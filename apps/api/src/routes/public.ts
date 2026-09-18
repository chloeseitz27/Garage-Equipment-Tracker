import { Router } from 'express';
import { createFlagSchema, getLocationPath, type ItemDetail } from '@garage/shared';

import { asyncHandler } from '../middleware.js';
import type { CatalogRepository } from '../repository/catalog-repository.js';

/** Anonymous read access is the default — the kiosk must be usable with zero friction. */
export function publicRoutes(repository: CatalogRepository): Router {
  const router = Router();

  // The whole catalog in one payload. Client-side search runs over this
  // (technical-spec.md §5, §7).
  router.get(
    '/catalog',
    asyncHandler(async (_req, res) => {
      const [items, locations, categories] = await Promise.all([
        repository.getItems(),
        repository.getLocations(),
        repository.getCategories(),
      ]);
      res.set('Cache-Control', 'no-store').json({ items, locations, categories });
    }),
  );

  router.get(
    '/items/:id',
    asyncHandler(async (req, res) => {
      const item = await repository.getItem(req.params.id ?? '');
      if (!item) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      const locations = await repository.getLocations();
      const detail: ItemDetail = { ...item, locationPath: getLocationPath(locations, item.locationId) };
      res.json(detail);
    }),
  );

  // The only write path available to anonymous users (product-spec.md §6.4).
  // Flags create a staff queue entry; they never mutate the item record.
  router.post(
    '/flags',
    asyncHandler(async (req, res) => {
      const parsed = createFlagSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid flag', details: parsed.error.issues });
        return;
      }

      const item = await repository.getItem(parsed.data.itemId);
      if (!item) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      res.status(201).json(await repository.addFlag(parsed.data));
    }),
  );

  return router;
}
