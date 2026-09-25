import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { getDescendantLocationIds, resolveLocationMap, type Location } from '@garage/shared';
import { LocationEditor } from './LocationEditor.js';
import { UnsavedItemDialog, useItemDraftGuard } from './UnsavedItemChanges.js';

const PANEL_CLOSE_MS = 200;
// Mirrors the CSS media query that animates the side panel.
const animatePanel = (): boolean => typeof window.matchMedia === 'function' &&
  window.matchMedia('(min-width: 1001px) and (prefers-reduced-motion: no-preference)').matches;

interface Props {
  locations: Location[];
  onChanged: (location: Location) => void;
  /** A tree form owns editing; map selection still offers to leave that form. */
  disabled?: boolean;
  formDirty?: boolean;
  formBusy?: boolean;
  onDiscardForm?: () => void;
  onDraftChange?: (dirty: boolean) => void;
  onCreateChild?: (location: Location) => void;
}

export function LocationMapEditor({
  locations, onChanged, disabled = false, formDirty = false, formBusy = false, onDiscardForm, onDraftChange, onCreateChild,
}: Props): JSX.Element {
  const [params, setParams] = useSearchParams();
  const route = useLocation();
  const previousRoute = useRef(route.key);
  const [savedLocations, setSavedLocations] = useState(locations);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{ room: string; location?: string } | null>(null);
  const rooms = savedLocations.filter((location) => location.kind === 'room' && location.parentId === null && location.mapId);
  const { blocker, markSaved } = useItemDraftGuard(dirty || formDirty, {
    allowSearchChanges: (current, next) => {
      const from = new URLSearchParams(current), to = new URLSearchParams(next);
      return (from.get('room') ?? rooms[0]?.id) === (to.get('room') ?? rooms[0]?.id) &&
        from.get('location') === to.get('location');
    },
  });
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  const reportEditor = useCallback((dirty: boolean, busy: boolean): void => {
    setDirty(dirty);
    setBusy(busy);
    if (dirty) setNotice(null);
  }, []);
  useEffect(() => { onDraftChange?.(dirty || busy); }, [dirty, busy, onDraftChange]);
  useEffect(() => () => onDraftChange?.(false), [onDraftChange]);
  useEffect(() => { setSavedLocations(locations); }, [locations]);
  useEffect(() => {
    if (previousRoute.current === route.key) return;
    previousRoute.current = route.key;
    if (disabled && !formDirty && !formBusy) onDiscardForm?.();
  }, [route.key, disabled, formDirty, formBusy, onDiscardForm]);

  const room = rooms.find((location) => location.id === (params.get('room') ?? rooms[0]?.id));
  const descendants = room ? getDescendantLocationIds(savedLocations, room.id).filter((id) => id !== room.id) : [];
  const selected = savedLocations.find((location) => location.id === params.get('location') && descendants.includes(location.id));
  // Keep a just-deselected panel mounted briefly so it can fade out while the map slides back.
  const [closing, setClosing] = useState<{ location: Location; room: string } | null>(null);
  const [previous, setPrevious] = useState({ selected, room: room?.id });
  if (previous.selected !== selected || previous.room !== room?.id) {
    setPrevious({ selected, room: room?.id });
    if (!selected && previous.selected && room && previous.room === room.id && animatePanel()) {
      setClosing({ location: previous.selected, room: room.id });
    } else if (closing) setClosing(null);
  }
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => setClosing(null), PANEL_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);
  const closingLocation = !selected && closing?.room === room?.id ? closing?.location : undefined;
  const displayed = selected ?? closingLocation;
  const choose = (id: string, targetRoom: Location): void => {
    // A draft can preview another room; navigation must target the saved hierarchy.
    const savedRoom = resolveLocationMap(savedLocations, id)?.room ?? targetRoom;
    navigate({ room: savedRoom.id, location: id });
  };
  const deselect = (): void => {
    if (room && selected) navigate({ room: room.id });
  };
  const navigate = (target: { room: string; location?: string }): void => {
    if (busy || formBusy) return;
    setNotice(null);
    if (disabled && formDirty) {
      setPendingSelection(target);
      return;
    }
    if (disabled) {
      onDiscardForm?.();
      markSaved();
    }
    setParams(target.location ? { room: target.room, location: target.location } : { room: target.room });
  };
  const clearDraft = (): void => {
    setDirty(false);
    setBusy(false);
    setRevision((current) => current + 1);
    setNotice(null);
    markSaved();
  };
  const navigation = (displayRoom: Location): JSX.Element => (
    <nav className="tabs sub-tabs" aria-label="Map to edit">
      {rooms.map((candidate) => (
        <Link
          key={candidate.id}
          to={`?${new URLSearchParams({ room: candidate.id })}`}
          className={candidate.id === displayRoom.id ? 'active' : ''}
          aria-disabled={busy || formBusy}
          onClick={(event) => { if (busy || formBusy) event.preventDefault(); }}
        >{candidate.name}</Link>
      ))}
    </nav>
  );

  return (
    <section className="location-map-editor" aria-label="Maps and locations">
      {notice ? <p role="status">{notice}</p> : null}
      {room ? (
        <LocationEditor
          locations={savedLocations}
          location={displayed}
          parentId={displayed?.parentId ?? null}
          onStateChange={reportEditor}
          mapPanel={{
            room, navigation, onSelect: choose, onDeselect: deselect, onCreateChild, readOnly: disabled, revision,
            closing: Boolean(closingLocation),
          }}
          onCancel={() => {
            clearDraft();
            setParams({ room: room.id });
          }}
          onSaved={(saved) => {
            const next = savedLocations.map((location) => location.id === saved.id ? saved : location);
            setSavedLocations(next);
            setDirty(false);
            setBusy(false);
            markSaved();
            setNotice('Location saved.');
            const savedRoom = resolveLocationMap(next, saved.id)?.room;
            const pendingNavigation = blockerRef.current;
            if (pendingNavigation.state === 'blocked') pendingNavigation.proceed();
            else if (!savedRoom) setParams({ room: room.id });
            else if (savedRoom.id !== room.id) setParams({ room: savedRoom.id, location: saved.id });
            onChanged(saved);
          }}
        />
      ) : <p className="muted">Assign a floor plan to a room to edit its locations on the map.</p>}
      {pendingSelection || blocker.state === 'blocked' ? (
        <UnsavedItemDialog
          subject="location"
          description="Save your location changes before selecting another location, switching rooms, or leaving, or discard them to continue."
          busy={busy || formBusy}
          onStay={() => {
            setPendingSelection(null);
            if (blocker.state === 'blocked') blocker.reset();
          }}
          onLeave={() => {
            if (busy || formBusy) return;
            const target = pendingSelection;
            setPendingSelection(null);
            clearDraft();
            onDiscardForm?.();
            if (blocker.state === 'blocked') blocker.proceed();
            else if (target) setParams(target.location ? { room: target.room, location: target.location } : { room: target.room });
          }}
        />
      ) : null}
    </section>
  );
}
