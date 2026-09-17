import { useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CatalogResponse } from '@garage/shared';
import { AssistantPanel } from './AssistantPanel.js';
import { ItemDetail } from './ItemDetail.js';
import { SearchResults } from './SearchResults.js';
import { buildRecords, createSearchIndex } from '../search.js';

interface Props {
  catalog: CatalogResponse;
  staff: boolean;
  assistant?: boolean;
}

export function DiscoveryView({ catalog, staff, assistant = false }: Props): JSX.Element {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const query = params.get('q') ?? '';
  const categoryId = params.get('category');
  const selectedId = params.get('item');
  const searchInput = useRef<HTMLInputElement>(null);
  const records = useMemo(() => buildRecords(catalog), [catalog]);
  const fuse = useMemo(() => createSearchIndex(records), [records]);
  const results = useMemo(() => {
    const base = query.trim() ? fuse.search(query.trim()).map((hit) => hit.item) : records;
    return base.filter((record) => !categoryId || record.item.categoryId === categoryId).slice(0, 60);
  }, [records, fuse, query, categoryId]);
  const selected = records.find((record) => record.item.id === selectedId);

  useEffect(() => {
    if (!assistant) searchInput.current?.focus();
  }, [assistant]);

  const update = (key: string, value: string | null, replace = false): void => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace });
  };

  return (
    <div className="columns">
      <section className="primary">
        {assistant ? <AssistantPanel onSelectItem={(id) => update('item', id)} /> : (
          <>
            <input
              ref={searchInput}
              className="search"
              type="search"
              aria-label="Search inventory"
              value={query}
              placeholder="Search for a tool or material…"
              onChange={(event) => update('q', event.target.value, true)}
              autoComplete="off"
            />
            <div className="chips">
              <button type="button" className={categoryId === null ? 'chip active' : 'chip'} onClick={() => update('category', null)}>
                All
              </button>
              {catalog.categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={categoryId === category.id ? 'chip active' : 'chip'}
                  onClick={() => update('category', category.id)}
                >
                  {category.name}
                </button>
              ))}
            </div>
            <SearchResults records={results} query={query} selectedId={selectedId} onSelect={(id) => update('item', id)} />
          </>
        )}
      </section>
      <aside className="detail">
        {selected ? (
          <ItemDetail
            key={selected.item.id}
            record={selected}
            onClose={() => update('item', null)}
            onEdit={staff ? () => navigate(`/manage/items/${encodeURIComponent(selected.item.id)}/edit`) : undefined}
          />
        ) : selectedId ? (
          <div>
            <h2>Item not found</h2>
            <p>This item is not in the active catalog.</p>
            <Link to={assistant ? '/assistant' : '/'}>Return to {assistant ? 'Project Assistant' : 'search'}</Link>
          </div>
        ) : <p className="muted">Select an item to see where it lives.</p>}
      </aside>
    </div>
  );
}
