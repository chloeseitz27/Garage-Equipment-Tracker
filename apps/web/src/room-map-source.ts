import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { ROOM_MAPS, parseSvgMap, type RoomMapId, type SvgMap } from '@garage/shared';

interface MapState {
  map?: SvgMap;
  error?: string;
  loading: boolean;
}
interface Entry {
  state: MapState;
  listeners: Set<() => void>;
  pending?: Promise<void>;
}
const entries = new Map<RoomMapId, Entry>();
const EMPTY: MapState = { loading: false };
const entryFor = (id: RoomMapId): Entry => {
  let entry = entries.get(id);
  if (!entry) {
    entry = { state: { loading: true }, listeners: new Set() };
    entries.set(id, entry);
  }
  return entry;
};

export const RoomMapSourcesContext = createContext<Partial<Record<RoomMapId, SvgMap>> | null>(null);

export function refreshSvgMap(id: RoomMapId): Promise<void> {
  const entry = entryFor(id);
  if (entry.pending) return entry.pending;
  entry.pending = (async () => {
    try {
      const response = await fetch(ROOM_MAPS[id].imageUrl, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Floor plan request failed (${response.status}).`);
      const source = await response.text();
      if (entry.state.map?.source !== source) entry.state = { loading: false, map: parseSvgMap(source) };
    } catch (cause) {
      entry.state = { loading: false, error: cause instanceof Error ? cause.message : 'Could not read the floor plan.' };
    }
  })().finally(() => {
    entry.pending = undefined;
    for (const listener of entry.listeners) listener();
  });
  return entry.pending;
}

export function useSvgMap(id: RoomMapId | undefined): MapState {
  const supplied = useContext(RoomMapSourcesContext);
  const suppliedState = useMemo((): MapState | undefined => supplied && id ? {
    loading: false, map: supplied[id], error: supplied[id] ? undefined : 'No floor plan was supplied.',
  } : undefined, [supplied, id]);
  const subscribe = useCallback((listener: () => void) => {
    if (!id || supplied) return () => {};
    const entry = entryFor(id);
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); };
  }, [id, supplied]);
  const snapshot = useCallback(() => suppliedState ?? (id ? entryFor(id).state : EMPTY), [id, suppliedState]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!id || supplied) return;
    const refresh = (): void => { void refreshSvgMap(id); };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [id, supplied]);
  return state;
}
