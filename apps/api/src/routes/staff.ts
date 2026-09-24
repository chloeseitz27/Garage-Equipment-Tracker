import { Router } from 'express';
import {
  bulkCreateItemsSchema,
  bulkRetireItemsSchema,
  bulkUpdateItemsSchema,
  bulkUpdateMarkersSchema,
  createCategorySchema,
  createItemSchema,
  createLocationSchema,
  itemSchema,
  locationMapProblem,
  locationPlacementProblem,
  getLocationPath,
  locationHierarchyProblem,
  prepareLocation,
  MARKER_BATCH_LIMIT,
  resolveFlagSchema,
  resolveLocationMap,
  updateCategorySchema,
  updateItemSchema,
  updateLocationSchema,
  wouldCreateCycle,
  type Item,
  type Location,
  type RoomMapId,
} from '@garage/shared';

import { requireStaff } from '../auth.js';
import { asyncHandler } from '../middleware.js';
import { svgLocationIds } from '../room-map-source.js';
import { identifiedLocations, serializeLocationWrite } from '../location-write.js';
import { randomUUID } from 'node:crypto';
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

  /**
   * Category and location ids, read once. The bulk route validates up to 100
   * rows, and re-reading the reference sets per row would be a round trip each
   * against a network-backed store.
   */
  const loadReferenceSets = async (): Promise<{ categories: Set<string>; locations: Set<string> }> => {
    const [categories, locations] = await Promise.all([
      repository.getCategories(),
      repository.getLocations(),
    ]);
    return {
      categories: new Set(categories.map((category) => category.id)),
      locations: new Set(locations.map((location) => location.id)),
    };
  };

  /** Returns a message naming the unresolved reference, or null. */
  const checkAgainst = (
    sets: { categories: Set<string>; locations: Set<string> },
    item: { categoryIds: string[]; locationId: string },
  ): string | null => {
    for (const categoryId of item.categoryIds) {
      if (!sets.categories.has(categoryId)) return `Unknown categoryId: ${categoryId}`;
    }
    if (!sets.locations.has(item.locationId)) return `Unknown locationId: ${item.locationId}`;
    return null;
  };

  const checkReferences = async (item: {
    categoryIds: string[];
    locationId: string;
  }): Promise<string | null> => checkAgainst(await loadReferenceSets(), item);

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
      const sets = await loadReferenceSets();
      for (const [index, item] of parsed.data.items.entries()) {
        const problem = checkAgainst(sets, item);
        if (problem) {
          res.status(400).json({ error: `Row ${index + 1}: ${problem}` });
          return;
        }
      }

      const created = await repository.createItems(parsed.data.items);
      res.status(201).json({ created: created.length, items: created });
    }),
  );

  /**
   * Applies the same change to many items at once — moving a shelf, or
   * recategorizing a batch (product-spec.md §6.5).
   */
  router.post(
    '/items/bulk-update',
    asyncHandler(async (req, res) => {
      const parsed = bulkUpdateItemsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid bulk update', details: parsed.error.issues });
        return;
      }

      const { ids, changes } = parsed.data;
      const all = await repository.getItems();
      const byId = new Map(all.map((item) => [item.id, item]));

      const missing = ids.filter((id) => !byId.has(id));
      if (missing.length > 0) {
        res.status(404).json({ error: `Unknown item id(s): ${missing.join(', ')}` });
        return;
      }

      const selected = ids.map((id) => byId.get(id) as Item);

      // status and stockLevel are kind-specific. Applying one to the wrong kind
      // would produce a record that fails schema validation, so reject the whole
      // request rather than silently skipping part of the selection.
      if (changes.status !== undefined && selected.some((item) => item.kind !== 'equipment')) {
        res.status(400).json({ error: 'Status applies to equipment only.' });
        return;
      }
      if (changes.stockLevel !== undefined && selected.some((item) => item.kind !== 'consumable')) {
        res.status(400).json({ error: 'Stock level applies to consumables only.' });
        return;
      }

      const sets = await loadReferenceSets();
      const updated: Item[] = [];

      for (const item of selected) {
        const merged = {
          ...item,
          ...(changes.locationId !== undefined ? { locationId: changes.locationId } : {}),
          ...(changes.categoryIds !== undefined ? { categoryIds: changes.categoryIds } : {}),
          ...(changes.status !== undefined ? { status: changes.status } : {}),
          ...(changes.stockLevel !== undefined ? { stockLevel: changes.stockLevel } : {}),
        };

        const problem = checkAgainst(sets, merged);
        if (problem) {
          res.status(400).json({ error: problem });
          return;
        }

        // Re-validate rather than trusting the merge: a bad write here would
        // only surface when the catalog next refuses to load.
        const validated = itemSchema.safeParse(merged);
        if (!validated.success) {
          res.status(400).json({ error: `${item.id} would become invalid`, details: validated.error.issues });
          return;
        }

        updated.push(validated.data);
      }

      await repository.saveItems(updated);
      res.json({ updated: updated.length, items: updated });
    }),
  );

  /**
   * Moves items to or from the recycle bin.
   *
   * Retiring is a state, never a delete: the record and its id survive, because
   * the assistant grounds recommendations on ids and a reused id would resolve
   * to the wrong physical object (technical-spec.md §3.2). There is deliberately
   * no route that destroys an item.
   */
  router.post(
    '/items/bulk-retire',
    asyncHandler(async (req, res) => {
      const parsed = bulkRetireItemsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
        return;
      }

      const { ids, retired } = parsed.data;
      const all = await repository.getItems();
      const byId = new Map(all.map((item) => [item.id, item]));

      const missing = ids.filter((id) => !byId.has(id));
      if (missing.length > 0) {
        res.status(404).json({ error: `Unknown item id(s): ${missing.join(', ')}` });
        return;
      }

      const retiredAt = new Date().toISOString();
      const updated = ids.map((id) => {
        const item = byId.get(id) as Item;
        if (retired) return { ...item, retiredAt };

        const { retiredAt: _dropped, ...restored } = item;
        return restored as Item;
      });

      await repository.saveItems(updated);
      res.json({ updated: updated.length, retired, items: updated });
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
    asyncHandler(async (req, res) => serializeLocationWrite(repository, async () => {
      const parsed = createLocationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid location', details: parsed.error.issues });
        return;
      }

      const locations = await identifiedLocations(repository);
      const { parentId } = parsed.data;
      if (parentId !== null && !locations.some((location) => location.id === parentId)) {
        res.status(400).json({ error: `Unknown parentId: ${parentId}` });
        return;
      }

      const id = `loc-${randomUUID()}`;
      const hierarchyProblem = locationHierarchyProblem({ ...parsed.data, id }, locations);
      if (hierarchyProblem) { res.status(400).json({ error: hierarchyProblem }); return; }
      const { location } = prepareLocation(parsed.data, locations, id);
      if (!location.name) {
        res.status(400).json({ error: location.kind === 'station' ? 'Station name is required.' : 'Room name is required.' });
        return;
      }
      const mapProblem = locationMapProblem(location, locations) ?? locationPlacementProblem(location, locations);
      if (mapProblem) {
        res.status(400).json({ error: mapProblem });
        return;
      }
      const { id: _id, ...input } = location;
      res.status(201).json(await repository.createLocation(input, id));
    })),
  );

  router.post(
    '/locations/markers',
    asyncHandler(async (req, res) => serializeLocationWrite(repository, async () => {
      const parsed = bulkUpdateMarkersSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid marker batch', details: parsed.error.issues });
        return;
      }
      const locations = await repository.getLocations();
      const updated: Location[] = [];
      const svgMaps = new Map<RoomMapId, Promise<Set<string>>>();
      for (const marker of parsed.data.markers) {
        const location = locations.find((candidate) => candidate.id === marker.id);
        if (!location) {
          res.status(404).json({ error: `Location no longer exists: ${marker.id}` });
          return;
        }
        const mapped = resolveLocationMap(locations, location.id);
        if (!mapped || mapped.room.id === location.id || mapped.room.id !== marker.roomId || mapped.room.mapId !== marker.mapId) {
          res.status(409).json({ error: `${location.name}: the room or floor plan changed. Discard this marker draft and place it again.` });
          return;
        }
        const surface = getLocationPath(locations, location.id).length === 2;
        if (!surface && marker.position !== null) {
          res.status(400).json({ error: `${location.name} inherits its enclosing surface's map location and cannot have a separate pin.` });
          return;
        }
        if (surface) {
          let shapes = svgMaps.get(marker.mapId);
          if (!shapes) { shapes = svgLocationIds(marker.mapId); svgMaps.set(marker.mapId, shapes); }
          if ((await shapes).has(location.id)) {
            res.status(409).json({ error: `${location.name} is linked to an SVG shape. Edit the floor plan SVG to move or resize it.` });
            return;
          }
        }
        // Merge only marker data so a batch cannot overwrite a rename or hierarchy edit.
        const { mapPosition: _old, ...record } = location;
        updated.push(marker.position === null ? record : {
          ...record, mapPosition: { roomId: marker.roomId, mapId: marker.mapId, ...marker.position },
        });
      }
      await repository.saveLocations(updated);
      res.json({ updated: updated.length, locations: updated });
    })),
  );

  router.put(
    '/locations/:id',
    asyncHandler(async (req, res) => serializeLocationWrite(repository, async () => {
      const id = req.params.id ?? '';
      const parsed = updateLocationSchema.safeParse({ ...req.body, id });
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid location', details: parsed.error.issues });
        return;
      }

      const locations = await identifiedLocations(repository);
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

      const previous = locations.find((location) => location.id === id)!;
      const hierarchyProblem = locationHierarchyProblem(parsed.data, locations);
      if (hierarchyProblem) { res.status(400).json({ error: hierarchyProblem }); return; }
      const prepared = prepareLocation(parsed.data, locations, id, previous);
      if (!prepared.location.name) {
        res.status(400).json({ error: prepared.location.kind === 'station' ? 'Station name is required.' : 'Room name is required.' });
        return;
      }
      if (prepared.descendants.length + 1 > MARKER_BATCH_LIMIT) {
        res.status(400).json({ error: 'Move fewer than 100 storage locations at once to keep numbering changes atomic.' });
        return;
      }
      const room = parsed.data.parentId ? resolveLocationMap(locations, parsed.data.parentId)?.room : undefined;
      const surface = getLocationPath(locations, parsed.data.parentId ?? '').length === 1;
      const shapes = surface && room?.mapId ? await svgLocationIds(room.mapId) : new Set<string>();
      const mapProblem = locationMapProblem(prepared.location, locations, previous) ??
        locationPlacementProblem(prepared.location, locations, shapes);
      if (mapProblem) {
        res.status(400).json({ error: mapProblem });
        return;
      }
      await repository.saveLocations([prepared.location, ...prepared.descendants]);
      res.json(prepared.location);
    })),
  );

  router.delete(
    '/locations/:id',
    asyncHandler(async (req, res) => serializeLocationWrite(repository, async () => {
      const id = req.params.id ?? '';
      const [locations, items] = await Promise.all([
        identifiedLocations(repository),
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
    })),
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

      const used = items.filter((item) => item.categoryIds.includes(id));
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
