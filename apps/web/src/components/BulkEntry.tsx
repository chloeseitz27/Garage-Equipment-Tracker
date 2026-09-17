import { useMemo, useState } from 'react';
import {
  EQUIPMENT_STATUSES,
  STOCK_LEVELS,
  TRAINING_LEVELS,
  parseBulkItems,
  type Category,
  type ItemKind,
  type Location,
} from '@garage/shared';

import { createItemsBulk } from '../api.js';
import { LocationPicker } from './LocationPicker.js';

interface Props {
  categories: Category[];
  locations: Location[];
  onCreated: () => void;
}

const SAMPLE = `# name, kind, status/stock, training, tags (semicolon separated)
Bench Vise, equipment, available, orientation, vise; clamp
Machinist Square, equipment
Blue Painters Tape, consumable, low, , tape; masking`;

/**
 * Bulk entry (product-spec.md §6.5).
 *
 * Cataloging a shelf one modal at a time is the fastest way to abandon this
 * project, so this is built around the real workflow: stand at a shelf, pick
 * that shelf once as the default location, then type or paste one line per item.
 *
 * The format is positional, which is only safe because the preview below shows
 * exactly what will be created before anything is written.
 */
export function BulkEntry({ categories, locations, onCreated }: Props): JSX.Element {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<ItemKind>('equipment');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [status, setStatus] = useState<(typeof EQUIPMENT_STATUSES)[number]>('available');
  const [stockLevel, setStockLevel] = useState<(typeof STOCK_LEVELS)[number]>('in-stock');
  const [trainingRequired, setTrainingRequired] =
    useState<(typeof TRAINING_LEVELS)[number]>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const parsed = useMemo(
    () =>
      parseBulkItems(text, {
        kind,
        categoryId,
        locationId,
        status,
        stockLevel,
        trainingRequired,
      }),
    [text, kind, categoryId, locationId, status, stockLevel, trainingRequired],
  );

  const canSubmit =
    parsed.items.length > 0 && parsed.errorCount === 0 && !busy && categoryId && locationId;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await createItemsBulk(parsed.items);
      setResult(`Added ${response.created} item(s).`);
      setText('');
      onCreated();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="manager">
      <h3>Bulk entry</h3>
      <p className="muted small">
        One item per line. Only the name is required — everything else falls back to the defaults
        below. Columns are <code>name, kind, status/stock, training, tags</code>, separated by
        commas or tabs (so a spreadsheet column paste works). Tags are separated by semicolons.
      </p>

      <div className="field-row">
        <label>
          Default kind
          <select value={kind} onChange={(event) => setKind(event.target.value as ItemKind)}>
            <option value="equipment">Equipment</option>
            <option value="consumable">Consumable</option>
          </select>
        </label>

        <label>
          Default category
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <LocationPicker
          label="Default location"
          locations={locations}
          value={locationId}
          disabled={busy}
          onSelect={setLocationId}
        />
      </div>

      <div className="field-row">
        {kind === 'equipment' ? (
          <>
            <label>
              Default status
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as (typeof EQUIPMENT_STATUSES)[number])
                }
              >
                {EQUIPMENT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Default training
              <select
                value={trainingRequired}
                onChange={(event) =>
                  setTrainingRequired(event.target.value as (typeof TRAINING_LEVELS)[number])
                }
              >
                {TRAINING_LEVELS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <label>
            Default stock level
            <select
              value={stockLevel}
              onChange={(event) => setStockLevel(event.target.value as (typeof STOCK_LEVELS)[number])}
            >
              {STOCK_LEVELS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <label>
        Rows
        <textarea
          rows={8}
          className="bulk-input"
          value={text}
          placeholder={SAMPLE}
          onChange={(event) => setText(event.target.value)}
        />
      </label>

      {parsed.rows.length > 0 ? (
        <div className="preview">
          <h4>
            Preview — {parsed.items.length} to add
            {parsed.errorCount > 0 ? `, ${parsed.errorCount} line(s) to fix` : ''}
          </h4>
          <ul className="flat-list">
            {parsed.rows.map((row) => (
              <li key={row.lineNumber} className={row.error ? 'row-error' : ''}>
                {row.error ? (
                  <span className="error">
                    Line {row.lineNumber}: {row.error} — <code>{row.raw}</code>
                  </span>
                ) : (
                  <span className="tree-name">
                    {row.item?.name}
                    <span className="kind">{row.item?.kind}</span>
                    <span className="muted small">
                      {row.item?.kind === 'equipment'
                        ? `${row.item.status} · ${row.item.trainingRequired}`
                        : row.item?.stockLevel}
                      {row.item?.tags.length ? ` · ${row.item.tags.join(', ')}` : ''}
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
      {result ? <p className="muted">{result}</p> : null}

      <div className="editor-actions">
        <button type="button" disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? 'Adding…' : `Add ${parsed.items.length} item(s)`}
        </button>
        {parsed.errorCount > 0 ? (
          <span className="hint">Fix the flagged lines first — the batch is added all at once.</span>
        ) : null}
      </div>
    </div>
  );
}
