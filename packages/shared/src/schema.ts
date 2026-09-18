import { z } from 'zod';
import { ROOM_MAP_IDS } from './room-maps.js';

/**
 * Schemas are the source of truth for the data model; the TypeScript types in
 * `types.ts` are inferred from them. Defining the model once means the client,
 * the server, and the seed validator cannot drift apart — which matters because
 * the assistant's grounding layer depends on item IDs and location IDs being
 * exactly right (technical-spec.md §2, §3).
 */

export const ITEM_KINDS = ['equipment', 'consumable'] as const;
/**
 * Operational state of a piece of equipment. Retirement is deliberately NOT a
 * status: it applies to consumables too, so it lives on the shared `retiredAt`
 * field instead of being duplicated per kind.
 */
export const EQUIPMENT_STATUSES = ['available', 'in-use', 'out-for-repair'] as const;
export const STOCK_LEVELS = ['in-stock', 'low', 'out'] as const;
export const TRAINING_LEVELS = ['none', 'orientation', 'supervised', 'certified'] as const;
export const LOCATION_KINDS = ['room', 'zone', 'table', 'workbench', 'cabinet', 'shelf', 'bin'] as const;
export const FLAG_TYPES = ['not-here', 'low', 'out'] as const;

export const itemKindSchema = z.enum(ITEM_KINDS);
export const equipmentStatusSchema = z.enum(EQUIPMENT_STATUSES);
export const stockLevelSchema = z.enum(STOCK_LEVELS);
export const trainingLevelSchema = z.enum(TRAINING_LEVELS);
export const locationKindSchema = z.enum(LOCATION_KINDS);
export const flagTypeSchema = z.enum(FLAG_TYPES);

const idSchema = z.string().min(1);

const categoryIdsSchema = z
  .array(idSchema.refine((id) => id.trim().length > 0, 'Category ids must not be blank'))
  .min(1, 'At least one category is required')
  .refine((ids) => new Set(ids).size === ids.length, 'Category ids must be unique');

/** Read legacy records/payloads without dropping any canonical assignments. */
const migrateCategoryIds = (input: unknown, ctx: z.RefinementCtx): unknown => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  if (!Object.hasOwn(record, 'categoryId')) return input;
  if (!Object.hasOwn(record, 'categoryIds')) {
    return { ...record, categoryIds: [record.categoryId] };
  }
  if (!Array.isArray(record.categoryIds) || !record.categoryIds.includes(record.categoryId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['categoryIds'],
      message: 'Legacy categoryId conflicts with categoryIds',
    });
  }
  return input;
};

const itemBaseShape = {
  id: idSchema,
  name: z.string().min(1),
  categoryIds: categoryIdsSchema,
  locationId: idSchema,
  description: z.string().optional(),
  photoUrl: z.string().optional(),
  tags: z.array(z.string()).default([]),
  goodFor: z.array(z.string()).default([]),
  notes: z.string().optional(),
  /** Verbatim only. Never model-generated (chatbot-spec.md §5). */
  safetyNotes: z.string().optional(),
  /**
   * ISO timestamp set when the item is retired; absent means live.
   *
   * Retirement is a state, never a delete — the record and its id survive
   * because the assistant grounds recommendations on ids (technical-spec.md
   * §3.2). Retired items leave search and assistant results and appear only in
   * the staff recycle bin, where they can be restored.
   */
  retiredAt: z.string().optional(),
};

export const equipmentSchema = z.object({
  ...itemBaseShape,
  kind: z.literal('equipment'),
  status: equipmentStatusSchema,
  quantity: z.number().int().positive(),
  trainingRequired: trainingLevelSchema,
});

export const consumableSchema = z.object({
  ...itemBaseShape,
  kind: z.literal('consumable'),
  /** Coarse manual flag, never a count (product-spec.md §5.1). */
  stockLevel: stockLevelSchema,
});

export const itemSchema = z.preprocess(
  migrateCategoryIds,
  z.discriminatedUnion('kind', [equipmentSchema, consumableSchema]),
);

export const locationSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  parentId: idSchema.nullable(),
  kind: locationKindSchema,
  mapId: z.enum(ROOM_MAP_IDS).optional(),
  mapPosition: z.object({
    roomId: idSchema,
    mapId: z.enum(ROOM_MAP_IDS),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }).optional(),
});

export const categorySchema = z.object({
  id: idSchema,
  name: z.string().min(1),
});

export const flagSchema = z.object({
  id: idSchema,
  itemId: idSchema,
  type: flagTypeSchema,
  createdAt: z.string(),
  resolved: z.boolean(),
});

/** Payload accepted from an anonymous client on POST /api/flags. */
export const createFlagSchema = z.object({
  itemId: idSchema,
  type: flagTypeSchema,
});

/** Staff item writes. The server owns `id` on create (technical-spec.md §3.2). */
export const createItemSchema = z.preprocess(
  migrateCategoryIds,
  z.discriminatedUnion('kind', [
    equipmentSchema.omit({ id: true }),
    consumableSchema.omit({ id: true }),
  ]),
);

export const updateItemSchema = itemSchema;

export const createLocationSchema = locationSchema.omit({ id: true });
export const createCategorySchema = categorySchema.omit({ id: true });

export const updateLocationSchema = locationSchema;
export const updateCategorySchema = categorySchema;

/**
 * Bulk item creation (product-spec.md §6.5). Cataloging a shelf one modal at a
 * time is the fastest way to abandon this project, so staff can commit a whole
 * batch in one write.
 *
 * Capped at 100 because that's the Cosmos transactional-batch limit — keeping
 * the batch inside one transaction is what makes the route's all-or-nothing
 * promise true at the storage layer rather than only during validation.
 */
export const bulkCreateItemsSchema = z.object({
  items: z.array(createItemSchema).min(1).max(100),
});

export const resolveFlagSchema = z.object({
  resolved: z.boolean(),
});

/**
 * Bulk edits to existing items (product-spec.md §6.5 — moving a shelf's worth
 * of items should not be one modal at a time).
 *
 * Capped at 100 to match the Cosmos transactional-batch limit, so the whole
 * selection lands or none of it does.
 */
export const bulkUpdateItemsSchema = z.object({
  ids: z.array(idSchema).min(1).max(100),
  changes: z.preprocess(
    migrateCategoryIds,
    z
      .object({
        locationId: idSchema.optional(),
        categoryIds: categoryIdsSchema.optional(),
        status: equipmentStatusSchema.optional(),
        stockLevel: stockLevelSchema.optional(),
      })
      .refine((changes) => Object.values(changes).some((value) => value !== undefined), {
        message: 'At least one change is required',
      }),
  ),
});

/** Moves items to or from the recycle bin. Never destroys anything. */
export const bulkRetireItemsSchema = z.object({
  ids: z.array(idSchema).min(1).max(100),
  retired: z.boolean(),
});

export const loginSchema = z.object({
  passphrase: z.string().min(1),
});

export const recommendRequestSchema = z.object({
  projectDescription: z.string().min(1).max(1000),
});

/** Shape of each JSON file under data/ — one array per file, easy to diff by hand. */
export const itemsFileSchema = z.array(itemSchema);
export const locationsFileSchema = z.array(locationSchema);
export const categoriesFileSchema = z.array(categorySchema);
export const flagsFileSchema = z.array(flagSchema);
