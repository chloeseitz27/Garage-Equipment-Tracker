import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CatalogResponse, RecommendResponse } from '@garage/shared';
import { recommend } from '../api.js';
import { AssistantPanel } from './AssistantPanel.js';
import { ItemDetail } from './ItemDetail.js';
import { SearchResults } from './SearchResults.js';
import { buildRecords, createSearchIndex } from '../search.js';

interface Props {
  catalog: CatalogResponse;
  staff: boolean;
}

export function DiscoveryView({ catalog, staff }: Props): JSX.Element {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const query = params.get('q') ?? '';
  const assistant = params.get('mode') === 'ask' && Boolean(query.trim());
  const categoryId = params.get('category');
  const selectedId = params.get('item');
  const searchInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const [response, setResponse] = useState<RecommendResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const records = useMemo(() => buildRecords(catalog), [catalog]);
  const fuse = useMemo(() => createSearchIndex(records), [records]);
  const results = useMemo(() => {
    const base = query.trim() ? fuse.search(query.trim()).map((hit) => hit.item) : records;
    const filtered = base.filter((record) => !categoryId || record.item.categoryIds.includes(categoryId));
    return query.trim() ? filtered.slice(0, 60) : filtered;
  }, [records, fuse, query, categoryId]);
  const selected = records.find((record) => record.item.id === selectedId);
  const resultsParams = new URLSearchParams(params);
  resultsParams.delete('item');

  useEffect(() => {
    searchInput.current?.focus();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, []);

  useEffect(() => {
    if (!assistant) {
      request.current?.abort();
      request.current = null;
      setBusy(false);
    }
  }, [assistant]);

  const update = (key: string, value: string | null, replace = false): void => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace });
  };

  const showSearch = (): void => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('mode');
      next.delete('item');
      if (!query.trim()) next.delete('category');
      return next;
    });
  };

  const changeQuery = (value: string): void => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set('q', value);
      else next.delete('q');
      if (!value.trim()) {
        next.delete('mode');
        next.delete('category');
        next.delete('item');
      }
      return next;
    }, { replace: true });
  };

  const ask = async (text: string): Promise<void> => {
    if (!text.trim() || busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    setResponse(null);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('q', text);
      next.set('mode', 'ask');
      next.delete('item');
      return next;
    });
    try {
      const result = await recommend(text.trim(), controller.signal);
      if (!controller.signal.aborted) setResponse(result);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Could not get project suggestions. Try again.');
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <main className="discovery">
      <form className="discovery-form" aria-label="Search or ask" onSubmit={(event) => {
        event.preventDefault();
        showSearch();
      }}>
        <label htmlFor="discovery-query">What are you looking for?</label>
        <div className="discovery-input-row">
          <input
            id="discovery-query"
            ref={searchInput}
            className="search"
            type="search"
            aria-label="Search inventory or describe a project"
            aria-describedby="discovery-help"
            value={query}
            placeholder="Find a tool, material, or describe your project..."
            onChange={(event) => changeQuery(event.target.value)}
            maxLength={1000}
            autoComplete="off"
          />
          <div className="discovery-actions">
            <button type="submit" aria-pressed={!assistant}>Search</button>
            <button type="button" aria-pressed={assistant} disabled={busy || !query.trim()} onClick={() => void ask(query)}>
              {busy ? 'Thinking...' : 'Ask'}
            </button>
          </div>
        </div>
        <p id="discovery-help" className="muted">
          Search the inventory, or choose Ask for project suggestions. Enter searches.
        </p>
      </form>
      <div className={`columns discovery-results${selectedId ? '' : ' without-detail'}`}>
        <section className="primary">
          {assistant ? (
            <AssistantPanel response={response} busy={busy} error={error} onSelectItem={(id) => update('item', id)} />
          ) : (
            <>
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
        {selectedId ? <aside className="detail">
          {selected ? (
            <ItemDetail
              key={selected.item.id}
              record={selected}
              locations={catalog.locations}
              onClose={() => update('item', null)}
              onEdit={staff ? () => navigate(`/manage/items/${encodeURIComponent(selected.item.id)}/edit`) : undefined}
            />
          ) : (
            <div>
              <h2>Item not found</h2>
              <p>This item is not in the active catalog.</p>
              <Link to={{ pathname: '/', search: resultsParams.toString() }}>Return to search &amp; ask</Link>
            </div>
          )}
        </aside> : null}
      </div>
    </main>
  );
}
