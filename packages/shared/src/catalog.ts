import { z } from 'zod';
import { categoriesFileSchema, itemsFileSchema, locationsFileSchema } from './schema.js';
import { findCatalogProblems } from './integrity.js';

/** Validate public snapshots without losing retirement or floor-plan metadata. */
export const catalogSchema = z.object({
  access: z.enum(['public', 'staff']).optional(),
  items: itemsFileSchema,
  locations: locationsFileSchema,
  categories: categoriesFileSchema,
}).superRefine((catalog, context) => {
  for (const message of findCatalogProblems(catalog)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message });
  }
});
