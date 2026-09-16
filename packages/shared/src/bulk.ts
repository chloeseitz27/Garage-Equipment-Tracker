import type {
  CreateItemInput,
  EquipmentStatus,
  ItemKind,
  StockLevel,
  TrainingLevel,
} from './types.js';
import { EQUIPMENT_STATUSES, STOCK_LEVELS, TRAINING_LEVELS } from './schema.js';

/**
 * Bulk entry parsing (product-spec.md §6.5).
 *
 * Staff paste rows straight out of a spreadsheet while walking a shelf. The
 * parser lives here rather than in the UI so the live preview and the tests
 * agree on exactly what a line means — the preview is what makes a positional
 * format safe to use.
 *
 * Columns, tab- or comma-separated:
 *   name | kind | status or stock level | training | tags
 *
 * Only `name` is required; everything else falls back to the defaults chosen in
 * the UI. Tags are separated by semicolons so commas stay usable as a column
 * separator.
 */

export interface BulkDefaults {
  kind: ItemKind;
  categoryId: string;
  locationId: string;
  status: EquipmentStatus;
  stockLevel: StockLevel;
  trainingRequired: TrainingLevel;
}

export interface BulkParsedRow {
  lineNumber: number;
  raw: string;
  item?: CreateItemInput;
  error?: string;
}

export interface BulkParseResult {
  rows: BulkParsedRow[];
  items: CreateItemInput[];
  errorCount: number;
}

const splitColumns = (line: string): string[] =>
  (line.includes('\t') ? line.split('\t') : line.split(',')).map((cell) => cell.trim());

const parseTags = (cell: string | undefined): string[] =>
  (cell ?? '')
    .split(';')
    .map((tag) => tag.trim())
    .filter(Boolean);

export function parseBulkItems(text: string, defaults: BulkDefaults): BulkParseResult {
  const rows: BulkParsedRow[] = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = raw.trim();

    // Blank lines and a leading comment line are skipped silently so staff can
    // annotate a pasted block without it failing validation.
    if (!line || line.startsWith('#')) return;

    const [nameCell, kindCell, stateCell, trainingCell, tagsCell] = splitColumns(line);
    const name = nameCell ?? '';

    if (!name) {
      rows.push({ lineNumber, raw, error: 'Missing name' });
      return;
    }

    let kind: ItemKind = defaults.kind;
    if (kindCell) {
      const normalized = kindCell.toLowerCase();
      if (normalized !== 'equipment' && normalized !== 'consumable') {
        rows.push({ lineNumber, raw, error: `Unknown kind "${kindCell}"` });
        return;
      }
      kind = normalized;
    }

    const tags = parseTags(tagsCell);
    const base = {
      name,
      categoryId: defaults.categoryId,
      locationId: defaults.locationId,
      tags,
      goodFor: [],
    };

    if (kind === 'equipment') {
      const status = (stateCell || defaults.status) as EquipmentStatus;
      if (!EQUIPMENT_STATUSES.includes(status)) {
        rows.push({ lineNumber, raw, error: `Unknown status "${stateCell}"` });
        return;
      }

      const trainingRequired = (trainingCell || defaults.trainingRequired) as TrainingLevel;
      if (!TRAINING_LEVELS.includes(trainingRequired)) {
        rows.push({ lineNumber, raw, error: `Unknown training level "${trainingCell}"` });
        return;
      }

      rows.push({
        lineNumber,
        raw,
        item: { ...base, kind: 'equipment', status, quantity: 1, trainingRequired },
      });
      return;
    }

    const stockLevel = (stateCell || defaults.stockLevel) as StockLevel;
    if (!STOCK_LEVELS.includes(stockLevel)) {
      rows.push({ lineNumber, raw, error: `Unknown stock level "${stateCell}"` });
      return;
    }

    rows.push({ lineNumber, raw, item: { ...base, kind: 'consumable', stockLevel } });
  });

  return {
    rows,
    items: rows.flatMap((row) => (row.item ? [row.item] : [])),
    errorCount: rows.filter((row) => row.error).length,
  };
}
