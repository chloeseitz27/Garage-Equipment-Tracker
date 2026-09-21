import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  MARKER_BATCH_LIMIT, getDescendantLocationIds, resolveLocationMap,
  type BulkUpdateMarkersInput, type Location, type MapPosition,
} from '@garage/shared';
import { updateLocationMarkers } from '../api.js';
import { ActionIcon } from './ActionIcon.js';
import { LocationPicker } from './LocationPicker.js';
import { RoomMap } from './RoomMap.js';
import { UnsavedItemDialog, useItemDraftGuard } from './UnsavedItemChanges.js';

interface Props {
  locations: Location[];
  onChanged: () => void;
  disabled?: boolean;
  formDirty?: boolean;
  formBusy?: boolean;
  onDiscardForm?: () => void;
  onDraftChange?: (dirty: boolean) => void;
}

interface Point {
  x: string;
  y: string;
}

interface MarkerDraft {
  roomId: string;
  mapId: MapPosition['mapId'];
  point: Point;
  baseline: Point;
  hadMarker: boolean;
  remove: boolean;
}

const initialPoint = (location: Location | undefined, room: Location | undefined): Point => {
  const pin = location?.mapPosition;
  return pin && pin.roomId === room?.id && pin.mapId === room?.mapId
    ? { x: (pin.x * 100).toFixed(1), y: (pin.y * 100).toFixed(1) }
    : { x: '', y: '' };
};

const draftPosition = (draft: MarkerDraft): MapPosition | undefined => {
  const x = Number(draft.point.x), y = Number(draft.point.y);
  if (draft.remove || !draft.point.x.trim() || !draft.point.y.trim() ||
    !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) return undefined;
  return { roomId: draft.roomId, mapId: draft.mapId, x: x / 100, y: y / 100 };
};

export function LocationMapEditor({
  locations, onChanged, disabled = false, formDirty = false, formBusy = false, onDiscardForm, onDraftChange,
}: Props): JSX.Element {
  const [params, setParams] = useSearchParams();
  const [savedLocations, setSavedLocations] = useState(locations);
  const [drafts, setDrafts] = useState<Map<string, MarkerDraft>>(() => new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = drafts.size > 0;
  const rooms = savedLocations.filter((location) => location.kind === 'room' && location.parentId === null && location.mapId);
  const { blocker, markSaved } = useItemDraftGuard(dirty || formDirty, {
    allowSearchChanges: (current, next) =>
      (new URLSearchParams(current).get('room') ?? rooms[0]?.id) ===
      (new URLSearchParams(next).get('room') ?? rooms[0]?.id),
  });
  useEffect(() => { onDraftChange?.(dirty || busy); }, [dirty, busy, onDraftChange]);
  useEffect(() => () => onDraftChange?.(false), [onDraftChange]);

  // Keep successful saves visible until the catalog refresh arrives; drafts stay separate.
  useEffect(() => { setSavedLocations(locations); }, [locations]);

  const room = rooms.find((location) => location.id === (params.get('room') ?? rooms[0]?.id));
  const descendants = room ? getDescendantLocationIds(savedLocations, room.id).filter((id) => id !== room.id) : [];
  const selected = savedLocations.find((location) => location.id === params.get('pin') && descendants.includes(location.id));
  const draft = selected ? drafts.get(selected.id) : undefined;
  const preview = savedLocations.map((location) => {
    const change = drafts.get(location.id);
    if (!change) return location;
    const mapped = resolveLocationMap(savedLocations, location.id);
    if (mapped?.room.id !== change.roomId || mapped.room.mapId !== change.mapId) return location;
    return { ...location, mapPosition: draftPosition(change) };
  });
  const choose = (id: string): void => {
    if (room && !busy && !disabled) setParams({ room: room.id, pin: id });
  };

  const updateDraft = (point: Point, remove = false): void => {
    if (!selected || !room?.mapId || busy || disabled) return;
    const current = drafts.get(selected.id);
    const next: MarkerDraft = {
      roomId: room.id, mapId: room.mapId, baseline: initialPoint(selected, room),
      hadMarker: Boolean(selected.mapPosition), ...current, point, remove,
    };
    const unchanged = remove ? !next.hadMarker :
      point.x === next.baseline.x && point.y === next.baseline.y;
    if (!current && !unchanged && drafts.size >= MARKER_BATCH_LIMIT) {
      setError(`Save or discard the current ${MARKER_BATCH_LIMIT} marker changes before editing another marker.`);
      return;
    }
    setDrafts((previous) => {
      const changes = new Map(previous);
      if (unchanged) changes.delete(selected.id);
      else changes.set(selected.id, next);
      return changes;
    });
    setError(null);
    setNotice(null);
  };

  const save = async (): Promise<void> => {
    if (!dirty || busy || disabled) return;
    setError(null);
    setNotice(null);
    const markers: BulkUpdateMarkersInput['markers'] = [];
    for (const [id, change] of drafts) {
      const location = savedLocations.find((candidate) => candidate.id === id);
      const mapped = resolveLocationMap(savedLocations, id);
      if (!location || mapped?.room.id !== change.roomId || mapped.room.mapId !== change.mapId) {
        setError(`${location?.name ?? id}: the location, room, or floor plan changed. Discard this draft and place it again.`);
        return;
      }
      const position = draftPosition(change);
      if (!change.remove && !position) {
        setParams({ room: change.roomId, pin: id });
        setError(`${location.name}: click a valid spot on the map. No markers were saved.`);
        return;
      }
      markers.push({
        id, roomId: change.roomId, mapId: change.mapId,
        position: position ? { x: position.x, y: position.y } : null,
      });
    }
    setBusy(true);
    try {
      const result = await updateLocationMarkers({ markers });
      const updates = new Map(result.locations.map((location) => [location.id, location]));
      setSavedLocations((current) => current.map((location) => updates.get(location.id) ?? location));
      setDrafts(new Map());
      if (!formDirty) markSaved();
      setNotice(`${result.updated} marker change(s) saved.`);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the markers.');
    } finally {
      setBusy(false);
    }
  };

  const discard = (id?: string): void => {
    if (busy) return;
    setDrafts((current) => {
      const next = new Map(current);
      if (id) next.delete(id);
      else next.clear();
      return next;
    });
    setError(null);
    setNotice(null);
  };

  return (
    <section className="location-map-editor" aria-label="Room maps and markers">
      {error ? <p className="error" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {room ? (
        <>
          <nav className="tabs sub-tabs" aria-label="Map to edit">
            {rooms.map((candidate) => (
              <Link
                key={candidate.id}
                to={`?${new URLSearchParams({ room: candidate.id })}`}
                className={candidate.id === room.id ? 'active' : ''}
                aria-disabled={busy || formBusy}
                onClick={(event) => { if (busy || formBusy) event.preventDefault(); }}
              >{candidate.name}</Link>
            ))}
          </nav>
          <LocationPicker
            label="Location to place"
            locations={preview}
            excludedIds={savedLocations.filter((location) => !descendants.includes(location.id)).map((location) => location.id)}
            value={selected?.id ?? ''}
            disabled={busy || disabled}
            onSelect={choose}
          />
          <p className="hint">{disabled ? 'Finish the location form below to resume editing saved markers.' : 'Choose a location, then click its spot on the map. Switch locations within this room to move more markers, then Save all markers. Save or discard changes before switching rooms. Drag to pan when zoomed; dragging does not place a marker.'}</p>
          <RoomMap
            key={room.id}
            room={room}
            locations={preview}
            selectedLocationId={selected?.id}
            onSelect={choose}
            onPlace={selected && !busy && !disabled ? ({ x, y }) => updateDraft({ x: (x * 100).toFixed(1), y: (y * 100).toFixed(1) }) : undefined}
          />
        </>
      ) : <p className="muted">Assign a floor plan to a room to place location markers.</p>}
      <div className="map-pin-controls">
        {selected ? (
          <>
            <button
              type="button" className="icon-button" aria-label="Remove marker" title="Remove marker"
              disabled={busy || disabled || Boolean(draft?.remove) || (!selected.mapPosition && !draft)}
              onClick={() => updateDraft({ x: '', y: '' }, true)}
            ><ActionIcon name="delete" /></button>
            <button
              type="button" className="icon-button" aria-label="Undo marker change" title="Undo marker change"
              disabled={busy || disabled || !draft} onClick={() => discard(selected.id)}
            ><ActionIcon name="undo" /></button>
          </>
        ) : null}
        <div className="map-batch-actions">
          <span role="status">{drafts.size} unsaved marker change(s)</span>
          <button
            type="button" className="icon-button"
            aria-label={busy ? 'Saving markers...' : 'Save all markers'}
            title={busy ? 'Saving markers...' : 'Save all markers'}
            aria-busy={busy} disabled={busy || disabled || !dirty} onClick={() => void save()}
          ><ActionIcon name="save" /></button>
          <button
            type="button" className="icon-button" aria-label="Discard all marker changes" title="Discard all marker changes"
            disabled={busy || disabled || !dirty} onClick={() => discard()}
          ><ActionIcon name="cancel" /></button>
        </div>
      </div>
      {blocker.state === 'blocked' ? (
        <UnsavedItemDialog
          subject={formDirty ? 'location' : 'location marker batch'}
          description="Save your location and marker changes before switching rooms or leaving, or discard them to continue."
          busy={busy || formBusy}
          onStay={blocker.reset}
          onLeave={() => {
            if (busy || formBusy) return;
            discard();
            onDiscardForm?.();
            markSaved();
            blocker.proceed();
          }}
        />
      ) : null}
    </section>
  );
}
