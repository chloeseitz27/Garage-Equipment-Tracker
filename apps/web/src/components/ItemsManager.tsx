import { useEffect, useMemo, useRef, useState } from 'react';
import {
  EQUIPMENT_STATUSES,
  STOCK_LEVELS,
  formatLocationPath,
  getLocationPath,
  indexLocations,
  liveItems,
  retiredItems,
  type CatalogResponse,
  type Item,
} from '@garage/shared';

import { bulkRetireItems, bulkUpdateItems, type BulkChanges } from '../api.js';
import { LocationPicker } from './LocationPicker.js';
import { MultiSelectFilter } from './MultiSelectFilter.js';

interface Props {
  catalog: CatalogResponse;
  /** `live` is the working catalog; `bin` shows retired items only. */
  mode: 'live' | 'bin';
  onEditItem?: (item: Item) => void;
  onChanged: () => void;
}

type SortKey = 'name' | 'kind' | 'category' | 'path' | 'state' | 'deletedAt';
interface SortOrder {
  key: SortKey;
  direction: 'ascending' | 'descending';
}
interface Filters {
  name: string;
  kinds: string[];
  categoryIds: string[];
  locationIds: string[];
  states: string[];
}
const EMPTY_FILTERS: Filters = { name: '', kinds: [], categoryIds: [], locationIds: [], states: [] };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

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
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [changes, setChanges] = useState<Pick<BulkChanges, 'locationId' | 'categoryId'>>({});
  const selectAllRef = useRef<HTMLInputElement>(null);
  const sortKey = sort?.key ?? (mode === 'bin' ? 'deletedAt' : 'name');
  const sortDirection = sort?.direction ?? (mode === 'bin' ? 'descending' : 'ascending');

  const locationOptions = useMemo(() => {
    const index = indexLocations(catalog.locations);
    return catalog.locations.map((location) => ({
      value: location.id,
      label: formatLocationPath(getLocationPath(index, location.id)),
    })).sort((a, b) => collator.compare(a.label, b.label));
  }, [catalog.locations]);

  const rows = useMemo(() => {
    const pool = mode === 'bin' ? retiredItems(catalog.items) : liveItems(catalog.items);
    const nameQuery = filters.name.trim().toLowerCase();
    const locationIndex = indexLocations(catalog.locations);
    const categoryNames = new Map(catalog.categories.map((category) => [category.id, category.name]));

    return pool
      .map((item) => {
        const locationPath = getLocationPath(locationIndex, item.locationId);
        return {
          item,
          name: item.name,
          kind: item.kind,
          category: categoryNames.get(item.categoryId) ?? item.categoryId,
          path: formatLocationPath(locationPath),
          locationIds: locationPath.map((location) => location.id),
          state: item.kind === 'equipment' ? item.status : item.stockLevel,
          deletedAt: item.retiredAt ?? '',
        };
      })
      .filter((row) =>
        row.name.toLowerCase().includes(nameQuery) &&
        (!filters.locationIds.length || row.locationIds.some((id) => filters.locationIds.includes(id))) &&
        (!filters.kinds.length || filters.kinds.includes(row.kind)) &&
        (!filters.categoryIds.length || filters.categoryIds.includes(row.item.categoryId)) &&
        (!filters.states.length || filters.states.includes(row.state)),
      )
      .sort((a, b) => {
        const result = collator.compare(a[sortKey], b[sortKey]);
        return (sortDirection === 'ascending' ? result : -result) ||
          collator.compare(a.name, b.name) || collator.compare(a.item.id, b.item.id);
      });
  }, [catalog, filters, mode, sortKey, sortDirection]);

  // Filtered-out rows must not remain targets of a bulk action. Sorting keeps the selection.
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
  const hasFilters = Object.values(filters).some((value) => value.length > 0);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selected.size > 0 && !allVisibleSelected;
    }
  }, [selected.size, allVisibleSelected]);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]): void => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const sortHeader = (key: SortKey, label: string): JSX.Element => (
    <th scope="col" aria-sort={sortKey === key ? sortDirection : 'none'}>
      <button
        type="button"
        className="item-sort"
        aria-label={`Sort by ${label}`}
        disabled={busy}
        onClick={() => setSort({
          key,
          direction: sortKey === key && sortDirection === 'ascending' ? 'descending' : 'ascending',
        })}
      >
        {label}
        <span aria-hidden="true">
          {sortKey === key ? (sortDirection === 'ascending' ? ' \u25b2' : ' \u25bc') : ' \u2195'}
        </span>
      </button>
    </th>
  );

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
            Changing the selection discards unsaved changes. Delete sends items to the recycle bin,
            where they can be restored.
          </>
        )}
      </p>

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

              <div className="bulk-actions">
                <button type="button" disabled={busy || !hasChanges} onClick={() => void save()}>
                  Save
                </button>
                <button type="button" className="danger" disabled={busy} onClick={() => void setRetired(true)}>
                  Delete
                </button>
              </div>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => void setRetired(false)}>
              Restore
            </button>
          )}
        </div>
      ) : null}

      {error ? <p className="error" role="alert">{error}</p> : null}
      {note ? <p className="muted" role="status">{note}</p> : null}

      <div
        className="item-table-scroll"
        role="region"
        aria-label={mode === 'bin' ? 'Recycle bin table' : 'Items table'}
        tabIndex={0}
      >
        <table className={mode === 'bin' ? 'item-table item-table-bin' : 'item-table'}>
          <caption className="visually-hidden">
            {mode === 'bin' ? 'Deleted items' : 'Catalog items'}. Sort using column headers and filter below them.
          </caption>
          <colgroup>
            <col className="item-column-check" />
            <col className="item-column-name" />
            <col className="item-column-kind" />
            <col className="item-column-category" />
            <col />
            <col className="item-column-state" />
            {mode === 'bin' ? <col className="item-column-deleted" /> : null}
            <col className="item-column-actions" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">
                <label className="row-check select-all">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    aria-label={`Select all ${rows.length} shown`}
                    checked={allVisibleSelected}
                    disabled={busy || rows.length === 0}
                    onChange={toggleAll}
                  />
                </label>
              </th>
              {sortHeader('name', 'Name')}
              {sortHeader('kind', 'Kind')}
              {sortHeader('category', 'Category')}
              {sortHeader('path', 'Location')}
              {sortHeader('state', 'Status / stock')}
              {mode === 'bin' ? sortHeader('deletedAt', 'Deleted') : null}
              <th scope="col">Actions</th>
            </tr>
            <tr className="item-filters">
              <td />
              <td>
                <input
                  type="search"
                  aria-label="Filter by name"
                  placeholder="Filter name…"
                  value={filters.name}
                  disabled={busy}
                  onChange={(event) => setFilter('name', event.target.value)}
                />
              </td>
              <td>
                <MultiSelectFilter
                  label="kind"
                  emptyLabel="All kinds"
                  options={[
                    { value: 'equipment', label: 'Equipment' },
                    { value: 'consumable', label: 'Consumable' },
                  ]}
                  selected={filters.kinds}
                  disabled={busy}
                  onChange={(values) => setFilter('kinds', values)}
                />
              </td>
              <td>
                <MultiSelectFilter
                  label="category"
                  emptyLabel="All categories"
                  options={catalog.categories.map((category) => ({ value: category.id, label: category.name }))}
                  selected={filters.categoryIds}
                  disabled={busy}
                  onChange={(values) => setFilter('categoryIds', values)}
                />
              </td>
              <td>
                <MultiSelectFilter
                  label="location"
                  emptyLabel="All locations"
                  options={locationOptions}
                  selected={filters.locationIds}
                  disabled={busy}
                  hint="Includes items in selected locations and their sub-locations."
                  onChange={(values) => setFilter('locationIds', values)}
                />
              </td>
              <td>
                <MultiSelectFilter
                  label="status or stock"
                  emptyLabel="All states"
                  options={[...EQUIPMENT_STATUSES, ...STOCK_LEVELS].map((state) => ({
                    value: state, label: state.replaceAll('-', ' '),
                  }))}
                  selected={filters.states}
                  disabled={busy}
                  onChange={(values) => setFilter('states', values)}
                />
              </td>
              {mode === 'bin' ? <td /> : null}
              <td>
                <button
                  type="button"
                  className="item-reset"
                  disabled={busy || !hasFilters}
                  onClick={() => setFilters(EMPTY_FILTERS)}
                >
                  Reset filters
                </button>
              </td>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={mode === 'bin' ? 8 : 7} className="muted">
                  {hasFilters ? 'No items match these filters.' :
                    mode === 'bin' ? 'The recycle bin is empty.' : 'No items in the catalog.'}
                </td>
              </tr>
            ) : rows.map(({ item, category, path, state }) => (
              <tr key={item.id} className={selected.has(item.id) ? 'row-selected' : ''}>
                <td>
                  <label className="row-check">
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.name}`}
                      checked={selected.has(item.id)}
                      disabled={busy}
                      onChange={() => toggle(item.id)}
                    />
                  </label>
                </td>
                <td>
                  <span className="item-name">{item.name}</span>
                  {item.safetyNotes ? <span className="kind kind-safety">safety</span> : null}
                </td>
                <td>{item.kind}</td>
                <td>{category}</td>
                <td className="item-location">{path}</td>
                <td>{state.replaceAll('-', ' ')}</td>
                {mode === 'bin' ? (
                  <td>
                    {item.retiredAt ? (
                      <time dateTime={item.retiredAt}>{new Date(item.retiredAt).toLocaleString()}</time>
                    ) : null}
                  </td>
                ) : null}
                <td className="item-row-actions">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
