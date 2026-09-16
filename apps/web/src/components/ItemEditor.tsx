import { useEffect, useMemo, useState } from 'react';
import {
  EQUIPMENT_STATUSES,
  STOCK_LEVELS,
  TRAINING_LEVELS,
  formatLocationPath,
  getLocationPath,
  type Category,
  type CreateItemInput,
  type Item,
  type ItemKind,
  type Location,
} from '@garage/shared';

import { createItem, updateItem } from '../api.js';

interface Props {
  item: Item | null;
  categories: Category[];
  locations: Location[];
  onSaved: () => void;
  onCancel: () => void;
}

/** Form state is all strings; it's converted to a typed item on submit. */
interface FormState {
  name: string;
  kind: ItemKind;
  categoryId: string;
  locationId: string;
  description: string;
  photoUrl: string;
  tags: string;
  goodFor: string;
  notes: string;
  safetyNotes: string;
  status: string;
  quantity: string;
  trainingRequired: string;
  stockLevel: string;
}

const toForm = (item: Item | null, categories: Category[], locations: Location[]): FormState => ({
  name: item?.name ?? '',
  kind: item?.kind ?? 'equipment',
  categoryId: item?.categoryId ?? categories[0]?.id ?? '',
  locationId: item?.locationId ?? locations[0]?.id ?? '',
  description: item?.description ?? '',
  photoUrl: item?.photoUrl ?? '',
  tags: item?.tags.join(', ') ?? '',
  goodFor: item?.goodFor.join(', ') ?? '',
  notes: item?.notes ?? '',
  safetyNotes: item?.safetyNotes ?? '',
  status: item?.kind === 'equipment' ? item.status : 'available',
  quantity: item?.kind === 'equipment' ? String(item.quantity) : '1',
  trainingRequired: item?.kind === 'equipment' ? item.trainingRequired : 'none',
  stockLevel: item?.kind === 'consumable' ? item.stockLevel : 'in-stock',
});

const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/** Optional text fields are omitted rather than sent as empty strings. */
const optional = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export function ItemEditor({ item, categories, locations, onSaved, onCancel }: Props): JSX.Element {
  const [form, setForm] = useState<FormState>(() => toForm(item, categories, locations));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(toForm(item, categories, locations));
    setError(null);
  }, [item, categories, locations]);

  // Full paths, so staff pick "Cabinet B" knowing which room it's in.
  const locationOptions = useMemo(
    () =>
      locations
        .map((location) => ({
          id: location.id,
          label: formatLocationPath(getLocationPath(locations, location.id)),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [locations],
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((current) => ({ ...current, [key]: value }));

  const buildInput = (): CreateItemInput | null => {
    const shared = {
      name: form.name.trim(),
      categoryId: form.categoryId,
      locationId: form.locationId,
      description: optional(form.description),
      photoUrl: optional(form.photoUrl),
      tags: splitList(form.tags),
      goodFor: splitList(form.goodFor),
      notes: optional(form.notes),
      safetyNotes: optional(form.safetyNotes),
    };

    if (!shared.name) {
      setError('Name is required.');
      return null;
    }
    if (!shared.categoryId || !shared.locationId) {
      setError('Category and location are required.');
      return null;
    }

    if (form.kind === 'equipment') {
      const quantity = Number(form.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        setError('Quantity must be a whole number of 1 or more.');
        return null;
      }
      return {
        ...shared,
        kind: 'equipment',
        status: form.status as (typeof EQUIPMENT_STATUSES)[number],
        quantity,
        trainingRequired: form.trainingRequired as (typeof TRAINING_LEVELS)[number],
      };
    }

    return {
      ...shared,
      kind: 'consumable',
      stockLevel: form.stockLevel as (typeof STOCK_LEVELS)[number],
    };
  };

  const submit = async (): Promise<void> => {
    setError(null);
    const input = buildInput();
    if (!input) return;

    setBusy(true);
    try {
      // Editing keeps the existing ID: IDs are permanent, and the assistant
      // grounds its recommendations on them (technical-spec.md §3.2).
      if (item) await updateItem({ ...input, id: item.id } as Item);
      else await createItem(input);
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="editor"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3>{item ? `Edit ${item.name}` : 'New item'}</h3>

      <label>
        Name
        <input value={form.name} onChange={(event) => set('name', event.target.value)} required />
      </label>

      <div className="field-row">
        <label>
          Kind
          <select
            value={form.kind}
            onChange={(event) => set('kind', event.target.value as ItemKind)}
            disabled={item !== null}
          >
            <option value="equipment">Equipment</option>
            <option value="consumable">Consumable</option>
          </select>
          {item ? <span className="hint">Kind can&apos;t change after creation.</span> : null}
        </label>

        <label>
          Category
          <select
            value={form.categoryId}
            onChange={(event) => set('categoryId', event.target.value)}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        Location
        <select value={form.locationId} onChange={(event) => set('locationId', event.target.value)}>
          {locationOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {form.kind === 'equipment' ? (
        <div className="field-row">
          <label>
            Status
            <select value={form.status} onChange={(event) => set('status', event.target.value)}>
              {EQUIPMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            {form.status === 'retired' ? (
              <span className="hint">Retired items leave search, but the record is kept.</span>
            ) : null}
          </label>

          <label>
            Quantity
            <input
              type="number"
              min={1}
              value={form.quantity}
              onChange={(event) => set('quantity', event.target.value)}
            />
          </label>

          <label>
            Training required
            <select
              value={form.trainingRequired}
              onChange={(event) => set('trainingRequired', event.target.value)}
            >
              {TRAINING_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <label>
          Stock level
          <select
            value={form.stockLevel}
            onChange={(event) => set('stockLevel', event.target.value)}
          >
            {STOCK_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
          <span className="hint">A coarse manual flag, never a count.</span>
        </label>
      )}

      <label>
        Description
        <textarea
          rows={2}
          value={form.description}
          onChange={(event) => set('description', event.target.value)}
        />
      </label>

      <label>
        Tags / aliases <span className="hint">Comma separated. Alternate names people search for.</span>
        <input value={form.tags} onChange={(event) => set('tags', event.target.value)} />
      </label>

      <label>
        Good for <span className="hint">Comma separated. Project types — improves assistant matching.</span>
        <input value={form.goodFor} onChange={(event) => set('goodFor', event.target.value)} />
      </label>

      <label>
        Photo URL
        <input value={form.photoUrl} onChange={(event) => set('photoUrl', event.target.value)} />
      </label>

      <label>
        Notes
        <textarea
          rows={2}
          value={form.notes}
          onChange={(event) => set('notes', event.target.value)}
        />
      </label>

      <label className="safety-field">
        Safety notes
        <textarea
          rows={3}
          value={form.safetyNotes}
          onChange={(event) => set('safetyNotes', event.target.value)}
        />
        {/* Shown verbatim wherever the item appears, including assistant output. */}
        <span className="hint">
          Shown word for word on the item and in assistant results. This is the one field where a
          wrong value has physical consequences.
        </span>
      </label>

      {error ? <p className="error">{error}</p> : null}

      <div className="editor-actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : item ? 'Save changes' : 'Create item'}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
