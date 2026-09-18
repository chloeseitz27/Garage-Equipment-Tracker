import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getDescendantLocationIds, type Location, type MapPosition } from '@garage/shared';
import { updateLocation } from '../api.js';
import { LocationPicker } from './LocationPicker.js';
import { RoomMap } from './RoomMap.js';
import { UnsavedItemDialog, useItemDraftGuard } from './UnsavedItemChanges.js';

interface Props {
  locations: Location[];
  onChanged: () => void;
}

export function LocationMapEditor({ locations, onChanged }: Props): JSX.Element {
  const [params, setParams] = useSearchParams();
  const rooms = locations.filter((location) => location.kind === 'room' && location.parentId === null && location.mapId);
  const room = rooms.find((location) => location.id === (params.get('room') ?? rooms[0]?.id));
  if (!room) return <p className="muted">Assign a floor plan to a room to place location markers.</p>;
  const descendants = getDescendantLocationIds(locations, room.id).filter((id) => id !== room.id);
  const selected = locations.find((location) => location.id === params.get('pin') && descendants.includes(location.id));
  const choose = (id: string): void => { setParams({ room: room.id, pin: id }); };
  return (
    <section className="location-map-editor">
      <h4>Room maps and markers</h4>
      <nav className="tabs sub-tabs" aria-label="Map to edit">
        {rooms.map((candidate) => (
          <Link key={candidate.id} to={`?${new URLSearchParams({ room: candidate.id })}`} className={candidate.id === room.id ? 'active' : ''}>
            {candidate.name}
          </Link>
        ))}
      </nav>
      <LocationPicker
        label="Location to place"
        locations={locations}
        excludedIds={locations.filter((location) => !descendants.includes(location.id)).map((location) => location.id)}
        value={selected?.id ?? ''}
        onSelect={choose}
      />
      <PinEditor key={`${room.id}:${selected?.id ?? ''}`} room={room} location={selected} locations={locations} onSelect={choose} onChanged={onChanged} />
    </section>
  );
}

interface PinProps extends Props {
  room: Location;
  location?: Location;
  onSelect: (id: string) => void;
}
function PinEditor({ room, location, locations, onSelect, onChanged }: PinProps): JSX.Element {
  const initial = (): { x: string; y: string } => {
    const pin = location?.mapPosition;
    return pin?.roomId === room.id && pin.mapId === room.mapId
      ? { x: (pin.x * 100).toFixed(1), y: (pin.y * 100).toFixed(1) }
      : { x: '', y: '' };
  };
  const [baseline, setBaseline] = useState(initial);
  const [point, setPoint] = useState(baseline);
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = JSON.stringify(point) !== JSON.stringify(baseline) || remove;
  const { blocker, dirtyRef, markSaved } = useItemDraftGuard(dirty);
  useEffect(() => {
    if (dirtyRef.current) return;
    const next = initial();
    setBaseline(next);
    setPoint(next);
    setRemove(false);
  }, [location, room, dirtyRef]);

  const x = Number(point.x), y = Number(point.y);
  const valid = point.x !== '' && point.y !== '' && Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 100 && y >= 0 && y <= 100;
  const pin: MapPosition | undefined = valid && room.mapId && !remove
    ? { roomId: room.id, mapId: room.mapId, x: x / 100, y: y / 100 } : undefined;
  const preview = dirty && location ? locations.map((candidate) => candidate.id === location.id
    ? { ...candidate, mapPosition: pin } : candidate) : locations;

  const save = async (): Promise<void> => {
    if (!location || busy) return;
    if (!remove && !valid) { setError('Enter X and Y percentages between 0 and 100.'); return; }
    setBusy(true);
    setError(null);
    try {
      const { mapPosition: _old, ...record } = location;
      await updateLocation(pin ? { ...record, mapPosition: pin } : record);
      setBaseline(point);
      setRemove(false);
      markSaved();
      setNotice('Map marker saved.');
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the marker.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="hint">Choose a location, then click its spot on the map or enter percentages from the top-left corner. Drag to pan when zoomed; dragging does not place a marker. Changes are a preview until saved.</p>
      <RoomMap
        room={room}
        locations={preview}
        selectedLocationId={location?.id}
        onSelect={onSelect}
        onPlace={location && !busy ? ({ x, y }) => {
          setPoint({ x: (x * 100).toFixed(1), y: (y * 100).toFixed(1) });
          setRemove(false);
          setNotice(null);
        } : undefined}
      />
      {location ? (
        <div className="map-pin-controls">
          <label>X (%)
            <input aria-label="Marker X percent" type="number" min={0} max={100} step="0.1" value={point.x} disabled={busy}
              onChange={(event) => { setPoint({ ...point, x: event.target.value }); setRemove(false); }} />
          </label>
          <label>Y (%)
            <input aria-label="Marker Y percent" type="number" min={0} max={100} step="0.1" value={point.y} disabled={busy}
              onChange={(event) => { setPoint({ ...point, y: event.target.value }); setRemove(false); }} />
          </label>
          <button type="button" disabled={busy || !dirty} onClick={() => void save()}>Save marker</button>
          <button type="button" disabled={busy || (!location.mapPosition && !pin)} onClick={() => {
            setPoint({ x: '', y: '' }); setRemove(true); setNotice(null);
          }}>Remove marker</button>
        </div>
      ) : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {blocker.state === 'blocked' ? <UnsavedItemDialog subject="location marker" busy={busy} onStay={blocker.reset} onLeave={blocker.proceed} /> : null}
    </>
  );
}
