import { useEffect, useId, useMemo, useState } from 'react';
import {
  LOCATION_KINDS, ROOM_MAP_IDS, ROOM_MAPS, formatLocationPath, getDescendantLocationIds,
  getLocationPath, isStaffOnlyLocation, locationPlacementProblem, resolveLocationMap,
  type Location, type LocationKind, type MapPosition, type RoomMapId,
} from '@garage/shared';
import { createLocation, updateLocation } from '../api.js';
import { ActionIcon } from './ActionIcon.js';
import { LocationPicker } from './LocationPicker.js';
import { RoomMap } from './RoomMap.js';
import { useSvgMap } from '../room-map-source.js';

interface Props {
  locations: Location[];
  location?: Location;
  parentId: string | null;
  onSaved: () => void;
  onCancel: () => void;
  onStateChange: (dirty: boolean, busy: boolean) => void;
}

interface LocationDraft {
  name: string;
  kind: LocationKind | '';
  parentId: string | null;
  mapId: RoomMapId | '';
  mapPosition?: MapPosition;
  staffOnly: boolean;
}

export function LocationEditor({ locations, location, parentId, onSaved, onCancel, onStateChange }: Props): JSX.Element {
  const id = useId();
  const rootRoom = location ? location.parentId === null && location.kind === 'room' : parentId === null;
  const [baseline] = useState<LocationDraft>(() => ({
    name: location?.name ?? '',
    kind: location?.kind ?? (rootRoom ? 'room' : ''),
    parentId: location?.parentId ?? parentId,
    mapId: location?.mapId ?? '',
    mapPosition: location?.mapPosition,
    staffOnly: location?.staffOnly ?? false,
  }));
  const [draft, setDraft] = useState(baseline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useEffect(() => { onStateChange(dirty || busy, busy); }, [dirty, busy, onStateChange]);
  useEffect(() => () => onStateChange(false, false), [onStateChange]);

  const candidate: Location = {
    id: location?.id ?? `new-location-${id}`,
    name: draft.name.trim() || 'New location',
    kind: draft.kind || 'bin',
    parentId: draft.parentId,
    mapId: draft.kind === 'room' && draft.parentId === null ? draft.mapId || undefined : undefined,
    mapPosition: draft.mapPosition,
    staffOnly: draft.staffOnly,
  };
  const preview = [...locations.filter((entry) => entry.id !== candidate.id), candidate];
  const mapped = resolveLocationMap(preview, candidate.id);
  const source = useSvgMap(mapped?.room.mapId);
  const svgIds = useMemo(() => new Set(source.map?.regions.map((region) => region.locationId) ?? []), [source.map]);
  const svgLinked = svgIds.has(candidate.id);
  const placementProblem = locationPlacementProblem(candidate, locations, svgIds);
  const inherited = draft.parentId !== null && isStaffOnlyLocation(locations, draft.parentId);
  const parentExists = draft.parentId === null || locations.some((entry) => entry.id === draft.parentId);
  const canSave = draft.name.trim() !== '' && draft.kind !== '' && parentExists && !placementProblem && !busy &&
    (rootRoom || !mapped || Boolean(source.map));
  const placementId = `${id}-placement`;

  const setParent = (nextParent: string | null): void => {
    const nextRoom = nextParent ? resolveLocationMap(locations, nextParent)?.room : undefined;
    setDraft((current) => ({
      ...current, parentId: nextParent,
      mapPosition: current.mapPosition?.roomId === nextRoom?.id && current.mapPosition?.mapId === nextRoom?.mapId
        ? current.mapPosition : undefined,
    }));
    setError(null);
  };
  const place = ({ x, y }: { x: number; y: number }): void => {
    if (busy || svgLinked || !mapped?.room.mapId) return;
    const mapPosition: MapPosition = {
      roomId: mapped.room.id, mapId: mapped.room.mapId, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000,
    };
    setDraft((current) => ({ ...current, mapPosition }));
    setError(null);
  };
  const save = async (): Promise<void> => {
    if (busy) return;
    if (!canSave) {
      setError(placementProblem ?? (!parentExists ? 'The parent location no longer exists.' : 'Name and type are required.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (location) await updateLocation(candidate);
      else {
        const { id: _id, ...input } = candidate;
        await createLocation(input);
      }
      onStateChange(false, false);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the location.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="location-editor" aria-label={location ? `Edit ${location.name}` : rootRoom ? 'New room' : 'New child location'}>
      {!location ? (
        <p className="hint">
          {rootRoom ? 'New top-level room' : `New child of ${formatLocationPath(getLocationPath(locations, parentId ?? ''))}`}
        </p>
      ) : null}
      <fieldset className="location-fields" disabled={busy}>
        <label className="location-name-field">Name
          <input
            aria-label={location ? 'Location name' : 'New location name'}
            autoFocus
            placeholder={rootRoom ? 'Room name' : 'Location name'}
            value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label className="location-type-field">Type
          <select
            aria-label={location ? 'Location type' : 'New location type'}
            value={draft.kind} disabled={rootRoom} required
            onChange={(event) => setDraft({ ...draft, kind: LOCATION_KINDS.find((kind) => kind === event.target.value) ?? '' })}
          >
            <option value="" disabled>Select type...</option>
            {LOCATION_KINDS.map((kind) => <option key={kind} value={kind}>{kind.charAt(0).toUpperCase() + kind.slice(1)}</option>)}
          </select>
        </label>
        {location && !rootRoom ? (
          <LocationPicker
            label="Parent location" locations={locations} allowRoot value={draft.parentId} disabled={busy}
            excludedIds={getDescendantLocationIds(locations, location.id)} onSelect={setParent}
          />
        ) : null}
        {draft.parentId === null && draft.kind === 'room' ? (
          <label>Floor plan
            <select
              aria-label="Floor plan" value={draft.mapId}
              onChange={(event) => setDraft({ ...draft, mapId: ROOM_MAP_IDS.find((mapId) => mapId === event.target.value) ?? '' })}
            >
              <option value="">None</option>
              {ROOM_MAP_IDS.map((mapId) => <option key={mapId} value={mapId}>{ROOM_MAPS[mapId].name}</option>)}
            </select>
          </label>
        ) : null}
        <label className="staff-only-option">
          <input
            type="checkbox" checked={draft.staffOnly} aria-describedby={inherited ? `${id}-access` : undefined}
            onChange={(event) => setDraft({ ...draft, staffOnly: event.target.checked })}
          />
          Staff-only
        </label>
        <div className="location-form-actions">
          <button
            type="button" className="icon-button" aria-label="Save" title={placementProblem ?? 'Save location'}
            aria-describedby={placementProblem ? placementId : undefined} aria-busy={busy}
            disabled={!canSave} onClick={() => void save()}
          ><ActionIcon name="save" /></button>
          <button type="button" className="icon-button secondary" aria-label="Cancel" title="Cancel location changes" onClick={onCancel}>
            <ActionIcon name="cancel" />
          </button>
        </div>
        {inherited ? <p id={`${id}-access`} className="hint location-access-hint">Staff-only access is also required by the parent location.</p> : null}
      </fieldset>
      {mapped && !rootRoom ? (
        <div className="location-placement">
          <p id={placementId} className="hint" role="status">
            {svgLinked ? 'This location follows its SVG shape. Edit the SVG to move or resize it; no pin repositioning is needed.' :
              placementProblem ?? 'Location placed. Click the map to adjust it before saving.'}
          </p>
          <RoomMap
            key={mapped.room.id} room={mapped.room} locations={preview}
            selectedLocationId={placementProblem ? undefined : candidate.id}
            onPlace={busy || svgLinked ? undefined : place}
            onSelect={(_selectedId, point) => {
              if (point) place(point);
              else if (!busy && !svgLinked) setError('Click a spot on the map to place this location.');
            }}
            caption={svgLinked ? 'SVG-linked location' : 'Click to place this location. Its name, parent, and marker are saved together.'}
          />
        </div>
      ) : !rootRoom ? <p className="hint">This room has no floor plan. A map marker is not required.</p> : null}
      {!parentExists ? <p className="error" role="alert">The parent location no longer exists. Cancel and choose a new parent.</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
    </section>
  );
}
