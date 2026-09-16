import { useMemo, useState } from 'react';
import {
  formatLocationPath,
  getLocationPath,
  type CatalogResponse,
  type Item,
} from '@garage/shared';

import { BulkEntry } from './BulkEntry.js';
import { CategoryManager } from './CategoryManager.js';
import { FlagQueue } from './FlagQueue.js';
import { ItemEditor } from './ItemEditor.js';
import { LocationManager } from './LocationManager.js';

type StaffTab = 'items' | 'bulk' | 'locations' | 'categories' | 'flags';

interface Props {
  catalog: CatalogResponse;
  editingItem: Item | null;
  onEditItem: (item: Item | null) => void;
  onChanged: () => void;
}

const TABS: Array<[StaffTab, string]> = [
  ['items', 'Items'],
  ['bulk', 'Bulk entry'],
  ['locations', 'Locations'],
  ['categories', 'Categories'],
  ['flags', 'Flag queue'],
];

/**
 * The staff editing surface. It only ever renders behind an authenticated
 * session — edit affordances are hidden rather than shown-and-disabled
 * (product-spec.md §4) — and every write it makes is re-checked server-side.
 */
export function StaffPanel({ catalog, editingItem, onEditItem, onChanged }: Props): JSX.Element {
  const [tab, setTab] = useState<StaffTab>('items');
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return catalog.items
      .map((item) => ({
        item,
        path: formatLocationPath(getLocationPath(catalog.locations, item.locationId)),
      }))
      .filter(({ item, path }) =>
        needle
          ? item.name.toLowerCase().includes(needle) || path.toLowerCase().includes(needle)
          : true,
      )
      .sort((a, b) => a.item.name.localeCompare(b.item.name));
  }, [catalog, filter]);

  const showEditor = creating || editingItem !== null;

  const closeEditor = (): void => {
    setCreating(false);
    onEditItem(null);
  };

  return (
    <section className="staff-panel">
      <nav className="tabs sub-tabs">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={tab === value ? 'active' : ''}
            onClick={() => {
              setTab(value);
              closeEditor();
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'items' ? (
        showEditor ? (
          <ItemEditor
            item={editingItem}
            categories={catalog.categories}
            locations={catalog.locations}
            onSaved={() => {
              closeEditor();
              onChanged();
            }}
            onCancel={closeEditor}
          />
        ) : (
          <div className="manager">
            <h3>Items</h3>
            <p className="muted small">
              Retiring an item removes it from search and assistant results but keeps the record —
              set its status to <code>retired</code> rather than deleting it.
            </p>

            <div className="add-row">
              <input
                placeholder="Filter by name or location…"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              <button type="button" onClick={() => setCreating(true)}>
                New item
              </button>
            </div>

            <ul className="flat-list">
              {rows.map(({ item, path }) => (
                <li key={item.id}>
                  <span className="tree-name">
                    {item.name}
                    <span className="kind">{item.kind}</span>
                    {item.kind === 'equipment' && item.status === 'retired' ? (
                      <span className="kind">retired</span>
                    ) : null}
                    {item.safetyNotes ? <span className="kind kind-safety">safety</span> : null}
                    <span className="muted small">{path}</span>
                  </span>
                  <span className="tree-actions">
                    <button type="button" onClick={() => onEditItem(item)}>
                      Edit
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}

      {tab === 'bulk' ? (
        <BulkEntry
          categories={catalog.categories}
          locations={catalog.locations}
          onCreated={onChanged}
        />
      ) : null}

      {tab === 'locations' ? (
        <LocationManager
          locations={catalog.locations}
          items={catalog.items}
          onChanged={onChanged}
        />
      ) : null}

      {tab === 'categories' ? (
        <CategoryManager
          categories={catalog.categories}
          items={catalog.items}
          onChanged={onChanged}
        />
      ) : null}

      {tab === 'flags' ? (
        <FlagQueue
          items={catalog.items}
          locations={catalog.locations}
          onEditItem={(item) => {
            setTab('items');
            onEditItem(item);
          }}
        />
      ) : null}
    </section>
  );
}
