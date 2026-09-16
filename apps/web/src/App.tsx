import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogResponse, Item } from '@garage/shared';

import { fetchCatalog, getSession } from './api.js';
import { AssistantPanel } from './components/AssistantPanel.js';
import { ItemDetail } from './components/ItemDetail.js';
import { SearchResults } from './components/SearchResults.js';
import { StaffBar } from './components/StaffBar.js';
import { StaffPanel } from './components/StaffPanel.js';
import { buildRecords, createSearchIndex, type SearchRecord } from './search.js';

type Tab = 'search' | 'assistant' | 'manage';

export function App(): JSX.Element {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('search');
  const [staff, setStaff] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const loadCatalog = useCallback(
    () => fetchCatalog().then(setCatalog).catch((cause: Error) => setError(cause.message)),
    [],
  );

  useEffect(() => {
    void loadCatalog();
    getSession()
      .then((session) => setStaff(session.staff))
      .catch(() => setStaff(false));
  }, [loadCatalog]);

  // The search field is focused on load (product-spec.md §3).
  useEffect(() => {
    if (catalog && tab === 'search') searchInput.current?.focus();
  }, [catalog, tab]);

  // Signing out drops any staff-only view immediately.
  useEffect(() => {
    if (!staff && tab === 'manage') setTab('search');
  }, [staff, tab]);

  const records = useMemo(() => (catalog ? buildRecords(catalog) : []), [catalog]);
  const fuse = useMemo(() => createSearchIndex(records), [records]);

  const results = useMemo((): SearchRecord[] => {
    const trimmed = query.trim();
    const base = trimmed ? fuse.search(trimmed).map((hit) => hit.item) : records;
    const filtered = categoryId
      ? base.filter((record) => record.item.categoryId === categoryId)
      : base;
    return filtered.slice(0, 60);
  }, [query, categoryId, fuse, records]);

  const selected = useMemo(
    () => records.find((record) => record.item.id === selectedId) ?? null,
    [records, selectedId],
  );

  if (error) {
    return (
      <main className="state">
        <h1>Can&apos;t reach the catalog</h1>
        <p>{error}</p>
        <p className="muted">Is the API running? Try `npm run seed` then `npm run dev`.</p>
      </main>
    );
  }

  if (!catalog) return <main className="state">Loading the catalog…</main>;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <h1>Garage Inventory</h1>
          <p className="muted">Reston Garage — find it, then go get it.</p>
        </div>
        <nav className="tabs">
          <button
            type="button"
            className={tab === 'search' ? 'active' : ''}
            onClick={() => setTab('search')}
          >
            Search &amp; browse
          </button>
          <button
            type="button"
            className={tab === 'assistant' ? 'active' : ''}
            onClick={() => setTab('assistant')}
          >
            Project Assistant
          </button>
          {/* Hidden entirely when signed out, not shown-and-disabled. */}
          {staff ? (
            <button
              type="button"
              className={tab === 'manage' ? 'active' : ''}
              onClick={() => setTab('manage')}
            >
              Manage catalog
            </button>
          ) : null}
        </nav>
        <StaffBar staff={staff} onChange={setStaff} />
      </header>

      {tab === 'manage' && staff ? (
        <StaffPanel
          catalog={catalog}
          editingItem={editingItem}
          onEditItem={setEditingItem}
          onChanged={() => void loadCatalog()}
        />
      ) : (
        <div className="columns">
          <section className="primary">
            {tab === 'search' ? (
              <>
                <input
                  ref={searchInput}
                  className="search"
                  type="search"
                  value={query}
                  placeholder="Search for a tool or material…"
                  onChange={(event) => setQuery(event.target.value)}
                  autoComplete="off"
                />

                <div className="chips">
                  <button
                    type="button"
                    className={categoryId === null ? 'chip active' : 'chip'}
                    onClick={() => setCategoryId(null)}
                  >
                    All
                  </button>
                  {catalog.categories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      className={categoryId === category.id ? 'chip active' : 'chip'}
                      onClick={() => setCategoryId(category.id)}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>

                <SearchResults
                  records={results}
                  query={query}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </>
            ) : (
              <AssistantPanel onSelectItem={setSelectedId} />
            )}
          </section>

          <aside className="detail">
            {selected ? (
              <ItemDetail
                record={selected}
                onClose={() => setSelectedId(null)}
                onEdit={
                  staff
                    ? () => {
                        setEditingItem(selected.item);
                        setTab('manage');
                      }
                    : undefined
                }
              />
            ) : (
              <p className="muted">Select an item to see where it lives.</p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
