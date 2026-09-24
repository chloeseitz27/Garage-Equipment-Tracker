import type { z } from 'zod';
import type {
  bulkUpdateMarkersSchema,
  categorySchema,
  consumableSchema,
  createFlagSchema,
  createItemSchema,
  createLocationSchema,
  equipmentSchema,
  equipmentStatusSchema,
  flagSchema,
  flagTypeSchema,
  itemKindSchema,
  itemSchema,
  locationKindSchema,
  locationSchema,
  stockLevelSchema,
  trainingLevelSchema,
} from './schema.js';

export type ItemKind = z.infer<typeof itemKindSchema>;
export type EquipmentStatus = z.infer<typeof equipmentStatusSchema>;
export type StockLevel = z.infer<typeof stockLevelSchema>;
export type TrainingLevel = z.infer<typeof trainingLevelSchema>;
export type LocationKind = z.infer<typeof locationKindSchema>;
export type FlagType = z.infer<typeof flagTypeSchema>;

export type Equipment = z.infer<typeof equipmentSchema>;
export type Consumable = z.infer<typeof consumableSchema>;
export type Item = z.infer<typeof itemSchema>;
export type Location = z.infer<typeof locationSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Flag = z.infer<typeof flagSchema>;

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type CreateFlagInput = z.infer<typeof createFlagSchema>;
export type BulkUpdateMarkersInput = z.infer<typeof bulkUpdateMarkersSchema>;

/** Everything the kiosk needs in one payload (technical-spec.md §5, §7). */
export interface CatalogResponse {
  access?: 'public' | 'staff';
  items: Item[];
  locations: Location[];
  categories: Category[];
}

/**
 * An item plus its derived breadcrumb. The path is never stored
 * (technical-spec.md §3.1) — it is computed on read, in one place.
 */
export type ItemDetail = Item & {
  locationPath: Location[];
};

/** One in-Garage recommendation. Every field but `reason` comes from the catalog record. */
export interface RecommendedItem {
  id: string;
  name: string;
  kind: ItemKind;
  /** The model's only contribution to this entry (technical-spec.md §6.1 step 4). */
  reason: string;
  locationPath: Location[];
  trainingRequired?: TrainingLevel;
  safetyNotes?: string;
}

/** A useful thing the Garage does not own. Carries no catalog record, so no safety data. */
export interface MissingItem {
  name: string;
  reason: string;
}

export interface RecommendResponse {
  /** One-line restatement so a misread is obvious immediately (chatbot-spec.md §7). */
  understoodAs: string;
  garageItems: RecommendedItem[];
  notInGarage: MissingItem[];
}

/** What the model is allowed to return. Note it never returns names, locations, or safety text. */
export interface AssistantRecommendation {
  understoodAs: string;
  garageItems: Array<{ id: string; reason: string }>;
  notInGarage: MissingItem[];
}

export interface AssistantProvider {
  readonly name: string;
  recommend(input: {
    projectDescription: string;
    candidates: Item[];
  }): Promise<AssistantRecommendation>;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
