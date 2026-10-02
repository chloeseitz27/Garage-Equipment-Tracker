import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { publicCatalog } from '@garage/shared';
import { fetchCatalog } from './api.js';
import {
  BrowserCatalogCache,
  CATALOG_MAX_AGE_MS,
  CatalogRefreshSupersededError,
  type CatalogSnapshot,
} from './catalog-cache.js';

export function useCatalog(editing: boolean, staff = false, enabled = true) {
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null);
  const [deferred, setDeferred] = useState<CatalogSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [verified, setVerified] = useState(false);
  const verifiedStaff = useRef(staff);
  const [now, setNow] = useState(Date.now);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const mounted = useRef(false);
  const requestId = useRef(0);
  const cache = useMemo(() => new BrowserCatalogCache({
    fetchCatalog: async () => {
      const catalog = await fetchCatalog();
      return staff ? catalog : publicCatalog(catalog);
    },
    onCacheError: ({ operation, error: cause }) => {
      console.warn(`[catalog cache] ${operation} failed`, cause);
      if (mounted.current) {
        setStorageWarning('Local catalog storage is unavailable or invalid. Saved browsing data may be missing or out of date.');
      }
    },
  }), [staff]);

  const receive = useCallback((next: CatalogSnapshot) => {
    if (editingRef.current && !(staff && next.catalog.access === 'public')) {
      setDeferred(next);
    } else {
      setSnapshot(next);
      setDeferred(null);
    }
    setNow(Date.now());
  }, [staff]);

  const refresh = useCallback(async (invalidate = false, persist = true): Promise<void> => {
    if (!enabled) return;
    const id = ++requestId.current;
    if (invalidate) {
      cache.invalidate();
      setVerified(false);
      setDeferred(null);
    }
    setRefreshing(true);
    try {
      const next = await cache.refresh(persist);
      if (!mounted.current || id !== requestId.current) return;
      receive(next);
      setError(null);
      verifiedStaff.current = staff;
      setVerified(true);
    } catch (cause) {
      if (!mounted.current || id !== requestId.current) return;
      if (cause instanceof CatalogRefreshSupersededError) return;
      setError(cause instanceof Error ? cause.message : 'Could not refresh the catalog.');
      setVerified(false);
    } finally {
      if (mounted.current && id === requestId.current) setRefreshing(false);
    }
  }, [cache, receive, enabled]);

  useEffect(() => {
    mounted.current = true;
    setDeferred(null);
    setVerified(false);
    const saved = cache.read();
    setSnapshot(saved);
    setError(null);
    void refresh();
    const revalidate = (): void => { void refresh(); };
    const storageChanged = (event: StorageEvent): void => {
      if (event.key !== cache.key && event.key !== null) return;
      if (event.storageArea !== null && event.storageArea !== window.localStorage) return;
      ++requestId.current;
      const saved = cache.reloadFromStorage();
      setVerified(false);
      setRefreshing(false);
      if (saved && !staff) receive(saved);
      else {
        setDeferred(null);
        void refresh(false, false);
      }
      // Staff revalidate for private data without echoing another storage event.
    };
    window.addEventListener('focus', revalidate);
    window.addEventListener('online', revalidate);
    window.addEventListener('storage', storageChanged);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      mounted.current = false;
      ++requestId.current;
      window.removeEventListener('focus', revalidate);
      window.removeEventListener('online', revalidate);
      window.removeEventListener('storage', storageChanged);
      window.clearInterval(timer);
    };
  }, [cache, receive, refresh, staff]);

  useEffect(() => {
    if (!editing && deferred) {
      setSnapshot(deferred);
      setDeferred(null);
    }
  }, [editing, deferred]);

  const age = snapshot ? now - snapshot.fetchedAt : 0;
  return {
    catalog: snapshot ? (staff ? snapshot.catalog : publicCatalog(snapshot.catalog)) : null,
    fetchedAt: snapshot?.fetchedAt ?? null,
    stale: age < 0 || age >= CATALOG_MAX_AGE_MS,
    error,
    storageWarning,
    refreshing,
    verified: verified && verifiedStaff.current === staff,
    updatePending: deferred !== null,
    refresh,
  };
}
