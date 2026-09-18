import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import type { CatalogResponse } from '@garage/shared';

import { fetchCatalog, getSession } from './api.js';
import { DiscoveryView } from './components/DiscoveryView.js';
import { StaffBar } from './components/StaffBar.js';
import { StaffPanel } from './components/StaffPanel.js';
import { ItemDraftContext } from './components/UnsavedItemChanges.js';
import { RoomMapsPage } from './components/RoomMapsPage.js';

function AssistantRedirect(): JSX.Element {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set('mode', 'ask');
  return <Navigate to={{ pathname: '/', search: `?${params}`, hash: location.hash }} replace />;
}

export function App(): JSX.Element {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staff, setStaff] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [dirtyItem, setDirtyItem] = useState(false);

  const loadCatalog = useCallback(
    () => fetchCatalog().then(setCatalog).catch((cause: Error) => setError(cause.message)),
    [],
  );

  useEffect(() => {
    void loadCatalog();
    getSession()
      .then((session) => setStaff(session.staff))
      .catch((cause: Error) => setSessionError(`Could not check staff sign-in: ${cause.message}`))
      .finally(() => setSessionLoading(false));
  }, [loadCatalog]);

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
          <StaffBar staff={staff} beforeSignOut={() =>
            !dirtyItem || window.confirm('You have unsaved changes. Sign out and discard them?')
          } onChange={(signedIn) => {
            setStaff(signedIn);
            setSessionError(null);
          }} />
        </header>
        {sessionError ? <p className="error" role="alert">{sessionError}</p> : null}
        <Routes>
          <Route path="/" element={<DiscoveryView catalog={catalog} staff={staff} />} />
          <Route path="/assistant" element={<AssistantRedirect />} />
          <Route path="/maps" element={<RoomMapsPage catalog={catalog} />} />
          <Route path="/manage/*" element={
            sessionLoading ? <p role="status">Checking staff sign-in…</p> :
              staff ? <StaffPanel catalog={catalog} onChanged={() => void loadCatalog()} /> : (
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
  );
}
