import { useState } from 'react';
import { retiredItems, type CatalogResponse, type Item } from '@garage/shared';

import { BulkEntry } from './BulkEntry.js';
import { CategoryManager } from './CategoryManager.js';
import { FlagQueue } from './FlagQueue.js';
import { ItemEditor } from './ItemEditor.js';
import { ItemsManager } from './ItemsManager.js';
import { LocationManager } from './LocationManager.js';

type StaffTab = 'items' | 'bulk' | 'locations' | 'categories' | 'flags' | 'bin';

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
  ['bin', 'Recycle bin'],
];

/**
 * The staff editing surface. It only ever renders behind an authenticated
 * session — edit affordances are hidden rather than shown-and-disabled
 * (product-spec.md §4) — and every write it makes is re-checked server-side.
 */
export function StaffPanel({ catalog, editingItem, onEditItem, onChanged }: Props): JSX.Element {
  const [tab, setTab] = useState<StaffTab>('items');
  const [creating, setCreating] = useState(false);

  const binCount = retiredItems(catalog.items).length;

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
            {value === 'bin' && binCount > 0 ? <span className="badge">{binCount}</span> : null}
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
          <>
            <div className="add-row new-item-row">
              <button type="button" onClick={() => setCreating(true)}>
                New item
              </button>
            </div>
            <ItemsManager
              catalog={catalog}
              mode="live"
              onEditItem={onEditItem}
              onChanged={onChanged}
            />
          </>
        )
      ) : null}

      {tab === 'bin' ? (
        <ItemsManager catalog={catalog} mode="bin" onChanged={onChanged} />
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
