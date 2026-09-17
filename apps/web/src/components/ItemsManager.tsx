import { useEffect, useMemo, useState } from 'react';
import {
  formatLocationPath,
  getLocationPath,
  isRetired,
  liveItems,
  retiredItems,
  type CatalogResponse,
  type Item,
} from '@garage/shared';

import { bulkRetireItems, bulkUpdateItems } from '../api.js';
import { LocationPicker } from './LocationPicker.js';

interface Props {
  catalog: CatalogResponse;
  /** `live` is the working catalog; `bin` shows retired items only. */
  mode: 'live' | 'bin';
  onEditItem?: (item: Item) => void;
  onChanged: () => void;
}

/**
 * Multi-select item table shared by the catalog and the recycle bin
 * (product-spec.md §6.5 — editing a shelf one modal at a time is how this
 * project gets abandoned).
 *
 * Both views are the same table over a different slice of the catalog, so
 * selection, bulk actions, and the location/category pickers can't drift apart
 * between them.
 */
export function ItemsManager({ catalog, mode, onEditItem, onChanged }: Props): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const rows = useMemo(() => {
    const pool = mode === 'bin' ? retiredItems(catalog.items) : liveItems(catalog.items);
    const needle = filter.trim().toLowerCase();

    return pool
      .map((item) => ({
        item,
        path: formatLocationPath(getLocationPath(catalog.locations, item.locationId)),
      }))
      .filter(({ item, path }) =>
        needle
          ? item.name.toLowerCase().includes(needle) || path.toLowerCase().includes(needle)
          : true,
      )
      .sort((a, b) =>
        mode === 'bin' ? 0 : a.item.name.localeCompare(b.item.name),
      );
  }, [catalog, filter, mode]);

  // Drop selections that scrolled out of view via the filter, so an action can
  // never hit something the user can no longer see.
  useEffect(() => {
    const visible = new Set(rows.map((row) => row.item.id));
    setSelected((current) => {
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [rows]);

  const locationOptions = useMemo(
    () =>
      catalog.locations
        .map((location) => ({
          id: location.id,
          label: formatLocationPath(getLocationPath(catalog.locations, location.id)),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [catalog.locations],
  );

  const ids = [...selected];
  const allVisibleSelected = rows.length > 0 && rows.every((row) => selected.has(row.item.id));

  const toggle = (id: string): void =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = (): void =>
    setSelected(allVisibleSelected ? new Set() : new Set(rows.map((row) => row.item.id)));

  const run = async (action: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setNote(await action());
      setSelected(new Set());
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const moveTo = (locationId: string): Promise<void> =>
    run(async () => {
      const response = await bulkUpdateItems(ids, { locationId });
      const label = locationOptions.find((option) => option.id === locationId)?.label ?? locationId;
      return `Moved ${response.updated} item(s) to ${label}.`;
    });

  const recategorize = (categoryId: string): Promise<void> =>
    run(async () => {
      const response = await bulkUpdateItems(ids, { categoryId });
      const label = catalog.categories.find((category) => category.id === categoryId)?.name ?? categoryId;
      return `Moved ${response.updated} item(s) to ${label}.`;
    });

  const setRetired = (retired: boolean): Promise<void> =>
    run(async () => {
      const response = await bulkRetireItems(ids, retired);
      return retired
        ? `Moved ${response.updated} item(s) to the recycle bin.`
        : `Restored ${response.updated} item(s).`;
    });

  return (
    <div className="manager">
      <h3>
        {mode === 'bin' ? 'Recycle bin' : 'Items'}{' '}
        <span className="muted small">{rows.length} shown</span>
      </h3>

      <p className="muted small">
        {mode === 'bin' ? (
          <>
            Retired items. They&apos;re hidden from search and the Project Assistant but never
            destroyed — their records and ids are kept, so restoring one brings back the same
            physical item the assistant may already have recommended.
          </>
        ) : (
          <>
            Select items to move, recategorize, or retire. Retiring is reversible and sends items to
            the recycle bin rather than deleting them.
          </>
        )}
      </p>

      <div className="add-row">
        <input
          placeholder="Filter by name or location…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>

      {selected.size > 0 ? (
        <div className="bulk-bar">
          <strong>{selected.size} selected</strong>

          {mode === 'live' ? (
            <>
              <LocationPicker
                label="Move to"
                locations={catalog.locations}
                disabled={busy}
                onSelect={(locationId) => void moveTo(locationId)}
              />

              <label>
                Category
                <select
                  value=""
                  disabled={busy}
                  onChange={(event) => {
                    if (event.target.value) void recategorize(event.target.value);
                  }}
                >
                  <option value="">Choose a category…</option>
                  {catalog.categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>

              <button type="button" className="danger" disabled={busy} onClick={() => void setRetired(true)}>
                Retire
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => void setRetired(false)}>
              Restore
            </button>
          )}

          <button type="button" className="secondary" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="muted">{note}</p> : null}

      {rows.length === 0 ? (
        <p className="muted">
          {mode === 'bin' ? 'The recycle bin is empty.' : 'No items match that filter.'}
        </p>
      ) : (
        <>
          <label className="inline-check select-all">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} />
            Select all {rows.length} shown
          </label>

          <ul className="flat-list">
            {rows.map(({ item, path }) => (
              <li key={item.id} className={selected.has(item.id) ? 'row-selected' : ''}>
                <label className="row-check">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                </label>

                <span className="tree-name">
                  {item.name}
                  <span className="kind">{item.kind}</span>
                  {item.safetyNotes ? <span className="kind kind-safety">safety</span> : null}
                  <span className="muted small">
                    {path}
                    {isRetired(item) && item.retiredAt
                      ? ` · retired ${new Date(item.retiredAt).toLocaleDateString()}`
                      : ''}
                  </span>
                </span>

                <span className="tree-actions">
                  {mode === 'live' && onEditItem ? (
                    <button type="button" onClick={() => onEditItem(item)}>
                      Edit
                    </button>
                  ) : null}
                  {mode === 'bin' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const response = await bulkRetireItems([item.id], false);
                          return `Restored ${response.updated} item(s).`;
                        })
                      }
                    >
                      Restore
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
