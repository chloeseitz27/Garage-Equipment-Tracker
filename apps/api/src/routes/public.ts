import { Router } from 'express';
import { assignLocationIdentities, createFlagSchema, getLocationPath, publicCatalog, type ItemDetail, type CatalogResponse } from '@garage/shared';
import { isStaff } from '../auth.js';

import { asyncHandler } from '../middleware.js';
import type { CatalogRepository } from '../repository/catalog-repository.js';

/** Anonymous read access is the default — the kiosk must be usable with zero friction. */
export function publicRoutes(repository: CatalogRepository): Router {
  const router = Router();

  // The whole catalog in one payload. Client-side search runs over this
  // (technical-spec.md §5, §7).
  router.get(
    '/catalog',
    asyncHandler(async (req, res) => {
      const [items, locations, categories] = await Promise.all([
        repository.getItems(),
        repository.getLocations(),
        repository.getCategories(),
      ]);
      const catalog: CatalogResponse = { items, locations: assignLocationIdentities(locations), categories, access: 'staff' };
      res.set('Cache-Control', 'private, no-store').vary('Cookie').json(isStaff(req) ? catalog : publicCatalog(catalog));
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

      const locations = assignLocationIdentities(await repository.getLocations());
      const visible = isStaff(req) ? { items: [item], locations } : publicCatalog({ items: [item], locations, categories: [] });
      const visibleItem = visible.items[0]!;
      const detail: ItemDetail = { ...visibleItem, locationPath: getLocationPath(visible.locations, visibleItem.locationId) };
      res.set('Cache-Control', 'private, no-store').vary('Cookie').json(detail);
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
