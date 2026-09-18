import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCatalog } from './api.js';
import {
  BrowserCatalogCache,
  CATALOG_MAX_AGE_MS,
  CatalogRefreshSupersededError,
  type CatalogSnapshot,
} from './catalog-cache.js';

export function useCatalog(editing: boolean) {
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null);
  const [deferred, setDeferred] = useState<CatalogSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [verified, setVerified] = useState(false);
  const [now, setNow] = useState(Date.now);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const mounted = useRef(false);
  const requestId = useRef(0);
  const [cache] = useState(() => new BrowserCatalogCache({
    fetchCatalog,
    onCacheError: ({ operation, error: cause }) => {
      console.warn(`[catalog cache] ${operation} failed`, cause);
      if (mounted.current) {
        setStorageWarning('Local catalog storage is unavailable or invalid. Saved browsing data may be missing or out of date.');
      }
    },
  }));

  const receive = useCallback((next: CatalogSnapshot) => {
    if (editingRef.current) {
      setDeferred(next);
    } else {
      setSnapshot(next);
      setDeferred(null);
    }
    setNow(Date.now());
  }, []);

  const refresh = useCallback(async (invalidate = false): Promise<void> => {
    const id = ++requestId.current;
    if (invalidate) {
      cache.invalidate();
      setVerified(false);
      setDeferred(null);
    }
    setRefreshing(true);
    try {
      const next = await cache.refresh();
      if (!mounted.current || id !== requestId.current) return;
      receive(next);
      setError(null);
      setVerified(true);
    } catch (cause) {
      if (!mounted.current || id !== requestId.current) return;
      if (cause instanceof CatalogRefreshSupersededError) return;
      setError(cause instanceof Error ? cause.message : 'Could not refresh the catalog.');
      setVerified(false);
    } finally {
      if (mounted.current && id === requestId.current) setRefreshing(false);
    }
  }, [cache, receive]);

  useEffect(() => {
    mounted.current = true;
    const saved = cache.read();
    if (saved) receive(saved);
    void refresh();
    const revalidate = (): void => { void refresh(); };
    const storageChanged = (event: StorageEvent): void => {
      if (event.key !== cache.key && event.key !== null) return;
      if (event.storageArea !== null && event.storageArea !== window.localStorage) return;
      ++requestId.current;
      const saved = cache.reloadFromStorage();
      setVerified(false);
      setRefreshing(false);
      if (saved) receive(saved);
      else {
        setDeferred(null);
        void refresh();
      }
      // A saved snapshot from another tab needs no echoing fetch/write, which
      // would otherwise cause the tabs to revalidate one another indefinitely.
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
  }, [cache, receive, refresh]);

  useEffect(() => {
    if (!editing && deferred) {
      setSnapshot(deferred);
      setDeferred(null);
    }
  }, [editing, deferred]);

  const age = snapshot ? now - snapshot.fetchedAt : 0;
  return {
    catalog: snapshot?.catalog ?? null,
    fetchedAt: snapshot?.fetchedAt ?? null,
    stale: age < 0 || age >= CATALOG_MAX_AGE_MS,
    error,
    storageWarning,
    refreshing,
    verified,
    updatePending: deferred !== null,
    refresh,
  };
}
