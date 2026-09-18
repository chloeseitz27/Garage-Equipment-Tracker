import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { getSession } from './api.js';
import { useCatalog } from './use-catalog.js';
import { CatalogDraftContext } from './catalog-draft.js';
import { DiscoveryView } from './components/DiscoveryView.js';
import { StaffBar } from './components/StaffBar.js';
import { StaffPanel } from './components/StaffPanel.js';
import { ItemDraftContext } from './components/UnsavedItemChanges.js';
import { RoomMapsPage } from './components/RoomMapsPage.js';
import { ActionIcon } from './components/ActionIcon.js';

function AssistantRedirect(): JSX.Element {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set('mode', 'ask');
  return <Navigate to={{ pathname: '/', search: `?${params}`, hash: location.hash }} replace />;
}

export function App(): JSX.Element {
  const [staff, setStaff] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [dirtyItem, setDirtyItem] = useState(false);
  const [dirtyForms, setDirtyForms] = useState<Set<string>>(() => new Set());
  const reportDraft = useCallback((id: string, dirty: boolean) => {
    setDirtyForms((current) => {
      if (current.has(id) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const {
    catalog, fetchedAt, stale, error, storageWarning, refreshing, verified, updatePending, refresh,
  } = useCatalog(dirtyItem || dirtyForms.size > 0);

  useEffect(() => {
    getSession()
      .then((session) => setStaff(session.staff))
      .catch((cause: Error) => setSessionError(`Could not check staff sign-in: ${cause.message}`))
      .finally(() => setSessionLoading(false));
  }, []);

  if (error && !catalog) {
    return (
      <main className="state">
        <h1>Can&apos;t reach the catalog</h1>
        <p>{error}</p>
        <p className="muted">No saved catalog is available. Check the API connection and try again.</p>
        <button type="button" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? 'Refreshing catalog...' : 'Retry catalog'}
        </button>
      </main>
    );
  }
  if (!catalog) return <main className="state">Loading the catalog…</main>;

  return (
    <CatalogDraftContext.Provider value={reportDraft}>
      <ItemDraftContext.Provider value={setDirtyItem}>
        <div className="app">
          <header>
            <div className="brand">
              <h1>Garage Inventory</h1>
              <p className="muted">Reston Garage — find it, then go get it.</p>
            </div>
            <nav className="tabs" aria-label="Main navigation">
              <NavLink to="/" end>Search &amp; ask</NavLink>
              <NavLink to="/maps">Room maps</NavLink>
              {staff ? <NavLink to="/manage">Manage catalog</NavLink> : null}
            </nav>
            <div className="header-actions">
              <button
                type="button"
                className="icon-button"
                aria-label={refreshing ? 'Refreshing catalog...' : 'Refresh catalog'}
                title={refreshing ? 'Refreshing catalog...' : 'Refresh catalog'}
                aria-busy={refreshing}
                disabled={refreshing}
                onClick={() => void refresh()}
              >
                <ActionIcon name="refresh" />
              </button>
              <StaffBar staff={staff} beforeSignOut={() =>
                !dirtyItem || window.confirm('You have unsaved changes. Sign out and discard them?')
              } onChange={(signedIn) => {
                setStaff(signedIn);
                setSessionError(null);
              }} />
            </div>
          </header>
          {error || !verified || stale || updatePending || storageWarning ? (
            <section className="catalog-status" aria-label="Catalog connection">
              {error ? <p className="error" role="alert">Catalog refresh failed: {error}</p> : null}
              {!verified || stale ? (
                <p role="status">
                  Showing saved catalog data{fetchedAt !== null ? ` fetched ${new Date(fetchedAt).toLocaleString()}` : ''}.
                  {' '}Locations, availability, and safety/training information may be out of date.
                  {!verified ? ' Changes still require an API connection; nothing is queued offline.' : ''}
                </p>
              ) : null}
              {updatePending ? <p role="status">Catalog updates will appear after you save or discard your edits.</p> : null}
              {storageWarning ? <p role="status">{storageWarning}</p> : null}
            </section>
          ) : null}
          {sessionError ? <p className="error" role="alert">{sessionError}</p> : null}
          <Routes>
            <Route path="/" element={<DiscoveryView catalog={catalog} staff={staff} />} />
            <Route path="/assistant" element={<AssistantRedirect />} />
            <Route path="/maps" element={<RoomMapsPage catalog={catalog} />} />
            <Route path="/manage/*" element={
              sessionLoading ? <p role="status">Checking staff sign-in…</p> :
                staff ? <StaffPanel catalog={catalog} onChanged={() => void refresh(true)} /> : (
                  <section className="manager">
                    <h2>Staff sign-in required</h2>
                    <p>Sign in above to open this catalog page.</p>
                    <Link to="/">Return to search</Link>
                  </section>
                )
            } />
            <Route path="*" element={
              <main className="state">
                <h2>Page not found</h2>
                <Link to="/">Return to search</Link>
              </main>
            } />
          </Routes>
        </div>
      </ItemDraftContext.Provider>
    </CatalogDraftContext.Provider>
  );
}
