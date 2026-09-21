import { useEffect, useRef, useState } from 'react';
import {
  EQUIPMENT_STATUSES,
  STOCK_LEVELS,
  TRAINING_LEVELS,
  resolveLocationMap,
  type Category,
  type CreateItemInput,
  type Item,
  type ItemKind,
  type Location,
} from '@garage/shared';

import { createItem, updateItem } from '../api.js';
import { LocationPicker } from './LocationPicker.js';
import { CategoryPicker } from './CategoryPicker.js';
import { RoomMap } from './RoomMap.js';
import { UnsavedItemDialog, useItemDraftGuard } from './UnsavedItemChanges.js';

interface Props {
  item: Item | null;
  categories: Category[];
  locations: Location[];
  onSaved: () => void;
  onCancel: () => void;
}

/** Text fields are converted to a typed item on submit. */
interface FormState {
  name: string;
  kind: ItemKind;
  categoryIds: string[];
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
  categoryIds: item ? [...item.categoryIds].sort() : categories[0] ? [categories[0].id] : [],
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
  const [baseline, setBaseline] = useState<FormState>(() => toForm(item, categories, locations));
  const [form, setForm] = useState<FormState>(baseline);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const { blocker, dirtyRef, markSaved } = useItemDraftGuard(dirty);
  const mapped = resolveLocationMap(locations, form.locationId);
  const rooms = locations.filter((location) => location.parentId === null && location.kind === 'room' && location.mapId);
  const [roomId, setRoomId] = useState(mapped?.room.id);
  const room = rooms.find((candidate) => candidate.id === roomId) ?? rooms[0];

  useEffect(() => {
    setRoomId(mapped?.room.id);
  }, [form.locationId, mapped?.room.id]);

  useEffect(() => {
    // Catalog refreshes must not overwrite a draft while the user is editing it.
    if (dirtyRef.current) return;
    const next = toForm(item, categories, locations);
    setForm(next);
    setBaseline(next);
    setError(null);
  }, [item, categories, locations, dirtyRef]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((current) => ({ ...current, [key]: value }));

  const selectLocation = (locationId: string): void => {
    if (busy) return;
    set('locationId', locationId);
    setRoomId(resolveLocationMap(locations, locationId)?.room.id);
  };

  const buildInput = (): CreateItemInput | null => {
    const shared = {
      name: form.name.trim(),
      categoryIds: form.categoryIds,
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
    if (!shared.categoryIds.length || !shared.locationId) {
      setError('At least one category and a location are required.');
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
    if (busy) return;
    setError(null);
    const input = buildInput();
    if (!input) return;

    setBusy(true);
    try {
      // Editing keeps the existing ID: IDs are permanent, and the assistant
      // grounds its recommendations on them (technical-spec.md §3.2).
      if (item) await updateItem({ ...input, id: item.id } as Item);
      else await createItem(input);
      if (!mounted.current) return;
      setBaseline(form);
      markSaved();
      onSaved();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not save the item.');
    } finally {
      if (mounted.current) setBusy(false);
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
      <fieldset className="editor-fields" disabled={busy}>
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

          <CategoryPicker
            categories={categories}
            selected={form.categoryIds}
            disabled={busy}
            onChange={(ids) => set('categoryIds', ids)}
          />
        </div>

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

      </fieldset>
      <fieldset className="editor-fields editor-location" disabled={busy}>
        <legend className="visually-hidden">Item location</legend>
        <LocationPicker
          label="Location"
          showMapButton={false}
          locations={locations}
          value={form.locationId}
          disabled={busy}
          onSelect={selectLocation}
        />
        {room ? (
          <div>
            <nav className="tabs sub-tabs" aria-label="Item room maps">
              {rooms.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  className={candidate.id === room.id ? 'active' : ''}
                  aria-pressed={candidate.id === room.id}
                  disabled={busy}
                  onClick={() => setRoomId(candidate.id)}
                >{candidate.name}</button>
              ))}
            </nav>
            <RoomMap
              key={room.id}
              room={room}
              locations={locations}
              selectedLocationId={form.locationId}
              onSelect={selectLocation}
              caption="Click a marker to change the location. Changes are saved with the item."
            />
            {mapped?.room.id === room.id && mapped.marker?.location.id !== form.locationId ? (
              <p className="hint">
                {mapped.marker
                  ? `Approximate location: shown at ${mapped.marker.location.name}; the selected sub-location is not marked.`
                  : 'Room shown; this location has no marker yet.'}
              </p>
            ) : null}
            {mapped?.room.id !== room.id ? (
              <p className="hint">
                {mapped
                  ? `The selected location is in ${mapped.room.name}. Switching room tabs does not move the item.`
                  : 'The selected location has no floor plan. Click a marker to choose a new location.'}
              </p>
            ) : null}
          </div>
        ) : <p className="hint">No floor plan is available for this location. Use search to select another location.</p>}
      </fieldset>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="editor-actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : item ? 'Save changes' : 'Create item'}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {blocker.state === 'blocked' ? (
        <UnsavedItemDialog busy={busy} onStay={blocker.reset} onLeave={blocker.proceed} />
      ) : null}
    </form>
  );
}
