import { Router } from 'express';
import {
  bulkCreateItemsSchema,
  createCategorySchema,
  createItemSchema,
  createLocationSchema,
  resolveFlagSchema,
  updateCategorySchema,
  updateItemSchema,
  updateLocationSchema,
  wouldCreateCycle,
} from '@garage/shared';

import { requireStaff } from '../auth.js';
import { asyncHandler } from '../middleware.js';
import type { CatalogRepository } from '../repository/catalog-repository.js';

/**
 * Staff writes (product-spec.md §6.5). Every route here is enforced
 * server-side; hiding the UI is not access control.
 *
 * These routes are also where referential integrity is defended. The catalog
 * refuses to load if an item points at a location that doesn't exist
 * (technical-spec.md §10), so a write that would orphan a reference has to be
 * rejected here rather than discovered on the next restart.
 */
export function staffRoutes(repository: CatalogRepository): Router {
  const router = Router();
  router.use(requireStaff);

  /** Confirms an item's category and location both resolve. Returns a message, or null. */
  const checkReferences = async (item: {
    categoryId: string;
    locationId: string;
  }): Promise<string | null> => {
    const [categories, locations] = await Promise.all([
      repository.getCategories(),
      repository.getLocations(),
    ]);

    if (!categories.some((category) => category.id === item.categoryId)) {
      return `Unknown categoryId: ${item.categoryId}`;
    }
    if (!locations.some((location) => location.id === item.locationId)) {
      return `Unknown locationId: ${item.locationId}`;
    }
    return null;
  };

  router.post(
    '/items',
    asyncHandler(async (req, res) => {
      const parsed = createItemSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid item', details: parsed.error.issues });
        return;
      }

      const problem = await checkReferences(parsed.data);
      if (problem) {
        res.status(400).json({ error: problem });
        return;
      }

      res.status(201).json(await repository.createItem(parsed.data));
    }),
  );

  router.post(
    '/items/bulk',
    asyncHandler(async (req, res) => {
      const parsed = bulkCreateItemsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid batch', details: parsed.error.issues });
        return;
      }

      // All or nothing: a batch that would orphan a reference is rejected whole,
      // so staff never have to work out which half of a shelf landed.
      for (const [index, item] of parsed.data.items.entries()) {
        const problem = await checkReferences(item);
        if (problem) {
          res.status(400).json({ error: `Row ${index + 1}: ${problem}` });
          return;
        }
      }

      const created = await repository.createItems(parsed.data.items);
      res.status(201).json({ created: created.length, items: created });
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

      const problem = await checkReferences(parsed.data);
      if (problem) {
        res.status(400).json({ error: problem });
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

      const locations = await repository.getLocations();
      const { parentId } = parsed.data;
      if (parentId !== null && !locations.some((location) => location.id === parentId)) {
        res.status(400).json({ error: `Unknown parentId: ${parentId}` });
        return;
      }

      res.status(201).json(await repository.createLocation(parsed.data));
    }),
  );

  router.put(
    '/locations/:id',
    asyncHandler(async (req, res) => {
      const id = req.params.id ?? '';
      const parsed = updateLocationSchema.safeParse({ ...req.body, id });
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid location', details: parsed.error.issues });
        return;
      }

      const locations = await repository.getLocations();
      if (!locations.some((location) => location.id === id)) {
        res.status(404).json({ error: 'Location not found' });
        return;
      }

      const { parentId } = parsed.data;
      if (parentId !== null && !locations.some((location) => location.id === parentId)) {
        res.status(400).json({ error: `Unknown parentId: ${parentId}` });
        return;
      }

      // A cycle makes the breadcrumb un-derivable for every item beneath it,
      // and stays invisible until someone opens one of those items.
      if (wouldCreateCycle(locations, id, parentId)) {
        res.status(400).json({ error: 'That move would put a location inside itself.' });
        return;
      }

      await repository.saveLocation(parsed.data);
      res.json(parsed.data);
    }),
  );

  router.delete(
    '/locations/:id',
    asyncHandler(async (req, res) => {
      const id = req.params.id ?? '';
      const [locations, items] = await Promise.all([
        repository.getLocations(),
        repository.getItems(),
      ]);

      if (!locations.some((location) => location.id === id)) {
        res.status(404).json({ error: 'Location not found' });
        return;
      }

      // Blocked rather than cascaded: cascading would silently delete items,
      // and emptying a shelf is a decision staff should make explicitly.
      const children = locations.filter((location) => location.parentId === id);
      if (children.length > 0) {
        res.status(409).json({
          error: `Still contains ${children.length} sub-location(s). Move or delete those first.`,
        });
        return;
      }

      const held = items.filter((item) => item.locationId === id);
      if (held.length > 0) {
        res.status(409).json({ error: `Still holds ${held.length} item(s). Move them first.` });
        return;
      }

      await repository.deleteLocation(id);
      res.status(204).end();
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

  router.put(
    '/categories/:id',
    asyncHandler(async (req, res) => {
      const id = req.params.id ?? '';
      const parsed = updateCategorySchema.safeParse({ ...req.body, id });
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid category', details: parsed.error.issues });
        return;
      }

      const categories = await repository.getCategories();
      if (!categories.some((category) => category.id === id)) {
        res.status(404).json({ error: 'Category not found' });
        return;
      }

      await repository.saveCategory(parsed.data);
      res.json(parsed.data);
    }),
  );

  router.delete(
    '/categories/:id',
    asyncHandler(async (req, res) => {
      const id = req.params.id ?? '';
      const [categories, items] = await Promise.all([
        repository.getCategories(),
        repository.getItems(),
      ]);

      if (!categories.some((category) => category.id === id)) {
        res.status(404).json({ error: 'Category not found' });
        return;
      }

      const used = items.filter((item) => item.categoryId === id);
      if (used.length > 0) {
        res.status(409).json({
          error: `Still used by ${used.length} item(s). Recategorize them first.`,
        });
        return;
      }

      await repository.deleteCategory(id);
      res.status(204).end();
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
