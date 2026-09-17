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

import { bulkRetireItems, bulkUpdateItems, type BulkChanges } from '../api.js';
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
  const [changes, setChanges] = useState<Pick<BulkChanges, 'locationId' | 'categoryId'>>({});

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

  // A draft belongs to this exact selection, not the next set of checked rows.
  useEffect(() => {
    setChanges({});
  }, [selected, mode]);

  const ids = [...selected];
  const allVisibleSelected = rows.length > 0 && rows.every((row) => selected.has(row.item.id));
  const hasChanges = changes.locationId !== undefined || changes.categoryId !== undefined;

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
    if (busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setNote(await action());
      setSelected(new Set());
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the selected items.');
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    if (!hasChanges || ids.length === 0) return;
    await run(async () => {
      const response = await bulkUpdateItems(ids, changes);
      return `Saved changes to ${response.updated} item(s).`;
    });
  };

  const setRetired = (retired: boolean): Promise<void> =>
    run(async () => {
      const response = await bulkRetireItems(ids, retired);
      return retired
        ? `Moved ${response.updated} item(s) to the recycle bin.`
        : `Restored ${response.updated} item(s).`;
    });

  return (
    <div className="manager" aria-busy={busy}>
      <h3>
        {mode === 'bin' ? 'Recycle bin' : 'Items'}{' '}
        <span className="muted small">{rows.length} shown</span>
      </h3>

      <p className="muted small">
        {mode === 'bin' ? (
          <>
            Deleted items. They&apos;re hidden from search and the Project Assistant but never
            destroyed — their records and ids are kept, so restoring one brings back the same
            physical item the assistant may already have recommended.
          </>
        ) : (
          <>
            Select items, choose a location or category, then click Save to apply changes.
            Deselect discards unsaved changes. Delete sends items to the recycle bin, where they
            can be restored.
          </>
        )}
      </p>

      <div className="add-row">
        <input
          placeholder="Filter by name or location…"
          value={filter}
          disabled={busy}
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
                value={changes.locationId ?? ''}
                disabled={busy}
                onSelect={(locationId) => setChanges((current) => ({ ...current, locationId }))}
              />

              <label>
                Category
                <select
                  value={changes.categoryId ?? ''}
                  disabled={busy}
                  onChange={(event) => {
                    const categoryId = event.target.value || undefined;
                    setChanges((current) => ({ ...current, categoryId }));
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

              <button type="button" disabled={busy || !hasChanges} onClick={() => void save()}>
                Save
              </button>

              <button type="button" className="danger" disabled={busy} onClick={() => void setRetired(true)}>
                Delete
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => void setRetired(false)}>
              Restore
            </button>
          )}

          <button type="button" className="secondary" disabled={busy} onClick={() => setSelected(new Set())}>
            Deselect
          </button>
        </div>
      ) : null}

      {error ? <p className="error" role="alert">{error}</p> : null}
      {note ? <p className="muted" role="status">{note}</p> : null}

      {rows.length === 0 ? (
        <p className="muted">
          {mode === 'bin' ? 'The recycle bin is empty.' : 'No items match that filter.'}
        </p>
      ) : (
        <>
          <label className="inline-check select-all">
            <input type="checkbox" checked={allVisibleSelected} disabled={busy} onChange={toggleAll} />
            Select all {rows.length} shown
          </label>

          <ul className="flat-list">
            {rows.map(({ item, path }) => (
              <li key={item.id} className={selected.has(item.id) ? 'row-selected' : ''}>
                <label className="row-check">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    disabled={busy}
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
                    <button type="button" disabled={busy} onClick={() => onEditItem(item)}>
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
