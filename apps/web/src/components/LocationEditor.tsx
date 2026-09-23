import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ROOM_MAP_IDS, ROOM_MAPS, assignLocationIdentities, childLocationKinds, formatLocationPath, getChildLocations, getDescendantLocationIds,
  getLocationPath, isStaffOnlyLocation, locationPlacementProblem, resolveLocationMap,
  locationCodeFromPath, locationHierarchyProblem, locationKindLabel, locationLevel, prepareLocation,
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
  onSaved: (location: Location) => void;
  onCancel: () => void;
  onStateChange: (dirty: boolean, busy: boolean) => void;
  mapPanel?: {
    room: Location;
    readOnly?: boolean;
    revision?: number;
    navigation: (room: Location) => ReactNode;
    onSelect: (id: string, room: Location) => void;
    onCreateChild?: (location: Location) => void;
  };
}

interface LocationDraft {
  name: string;
  kind: LocationKind | '';
  parentId: string | null;
  mapId: RoomMapId | '';
  mapPosition?: MapPosition;
  staffOnly: boolean;
}

const toDraft = (location: Location | undefined, parentId: string | null, rootRoom: boolean): LocationDraft => ({
  name: location?.name ?? '',
  kind: rootRoom ? 'room' : location?.kind ?? '',
  parentId: location?.parentId ?? parentId,
  mapId: location?.mapId ?? '',
  mapPosition: location?.mapPosition,
  staffOnly: location?.staffOnly ?? false,
});

export function LocationEditor({ locations, location, parentId, onSaved, onCancel, onStateChange, mapPanel }: Props): JSX.Element {
  const id = useId();
  const editable = !mapPanel || Boolean(location && !mapPanel.readOnly);
  const rootRoom = location ? location.parentId === null : !mapPanel && parentId === null;
  const identified = useMemo(() => assignLocationIdentities(locations), [locations]);
  const identity = location ? identified.find((entry) => entry.id === location.id) : undefined;
  const [baseline, setBaseline] = useState<LocationDraft>(() => toDraft(identity, parentId, rootRoom));
  const [draft, setDraft] = useState(baseline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const dirty = editable && JSON.stringify(draft) !== JSON.stringify(baseline);
  const revision = mapPanel?.revision ?? 0;
  const original = useRef({ location, parentId, revision });
  // Change form targets before paint without remounting the map and losing its zoom.
  useLayoutEffect(() => {
    const previous = original.current;
    if (previous.location === location && previous.parentId === parentId && previous.revision === revision) return;
    const targetChanged = previous.location?.id !== location?.id || (!location && previous.parentId !== parentId) ||
      previous.revision !== revision;
    if (!targetChanged && (dirty || busy)) return;
    const next = toDraft(identity, parentId, rootRoom);
    original.current = { location, parentId, revision };
    setBaseline(next);
    setDraft(next);
    setError(null);
  }, [location, parentId, rootRoom, dirty, busy, revision, identity]);
  useEffect(() => { onStateChange(dirty || busy, busy); }, [dirty, busy, onStateChange]);
  useEffect(() => () => onStateChange(false, false), [onStateChange]);

  const allowedKinds = childLocationKinds(locations, draft.parentId);
  const selectedKind = allowedKinds.includes(draft.kind as LocationKind) ? draft.kind : '';
  const level = draft.parentId === null ? 'room' : locationLevel(locations, draft.parentId) === 'room' ? 'surface' : 'storage';
  const previous = identity;
  const prepared = prepareLocation({
    ...draft, kind: selectedKind || allowedKinds[0]!, mapId: draft.mapId || undefined,
  }, identified, location?.id ?? `new-location-${id}`, previous);
  const candidate: Location = {
    ...prepared.location,
    id: location?.id ?? `new-location-${id}`,
    name: prepared.location.name || 'New location',
    mapId: draft.kind === 'room' && draft.parentId === null ? draft.mapId || undefined : undefined,
  };
  const preview = editable ? [...locations.filter((entry) => entry.id !== candidate.id), candidate] : locations;
  const mapped = editable ? resolveLocationMap(preview, candidate.id) : null;
  const displayRoom = mapped?.room ?? mapPanel?.room;
  const source = useSvgMap(displayRoom?.mapId);
  const svgIds = useMemo(() => new Set(source.map?.regions.map((region) => region.locationId) ?? []), [source.map]);
  const svgLinked = Boolean(mapped && svgIds.has(candidate.id));
  const placementProblem = locationPlacementProblem(candidate, locations, svgIds);
  const inherited = draft.parentId !== null && isStaffOnlyLocation(locations, draft.parentId);
  const parentExists = draft.parentId === null || locations.some((entry) => entry.id === draft.parentId);
  const hierarchyProblem = locationHierarchyProblem(candidate, locations);
  const canSave = editable && (level !== 'room' || draft.name.trim() !== '') && selectedKind !== '' && parentExists &&
    !hierarchyProblem && !placementProblem && !busy &&
    (rootRoom || !mapped || Boolean(source.map)) && (!mapPanel || dirty);
  const placementId = `${id}-placement`;
  const children = location && mapPanel ? getChildLocations(identified, location.id) : [];

  const setParent = (nextParent: string | null): void => {
    const nextRoom = nextParent ? resolveLocationMap(locations, nextParent)?.room : undefined;
    setDraft((current) => ({
      ...current, parentId: nextParent,
      kind: childLocationKinds(locations, nextParent).includes(current.kind as LocationKind) ? current.kind : '',
      mapPosition: current.mapPosition?.roomId === nextRoom?.id && current.mapPosition?.mapId === nextRoom?.mapId
        ? current.mapPosition : undefined,
    }));
    setError(null);
  };
  const place = ({ x, y }: { x: number; y: number }): void => {
    if (!editable || busy || svgLinked || !mapped?.room.mapId) return;
    const mapPosition: MapPosition = {
      roomId: mapped.room.id, mapId: mapped.room.mapId, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000,
    };
    setDraft((current) => ({ ...current, mapPosition }));
    setError(null);
  };
  const save = async (): Promise<void> => {
    if (busy) return;
    if (!canSave) {
      setError(hierarchyProblem ?? placementProblem ?? (!parentExists ? 'The parent location no longer exists.' : 'Name and type are required.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let saved: Location;
      if (location) saved = await updateLocation(candidate);
      else {
        // Leave automatic defaults blank so the server allocates against the latest catalog.
        const { id: _id, letter: _letter, number: _number, ...input } = candidate;
        saved = await createLocation({ ...input, name: level === 'storage' ? undefined : draft.name.trim() || undefined });
      }
      if (!mounted.current) return;
      const next = toDraft(saved, saved.parentId, saved.kind === 'room' && saved.parentId === null);
      setBaseline(next);
      setDraft(next);
      onStateChange(false, false);
      onSaved(saved);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not save the location.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const placementHint = (
    <p id={placementId} className="hint" role="status">
      {svgLinked ? 'This location follows its SVG shape. Edit the SVG to move or resize it; no pin repositioning is needed.' :
        placementProblem ?? 'Location placed. Click the map to adjust it before saving.'}
    </p>
  );
  const mapContent = (
    <>
      {mapPanel?.navigation(displayRoom ?? mapPanel.room)}
      {displayRoom && (!rootRoom || mapPanel) ? (
        <div className="location-placement">
          {!mapPanel && editable ? placementHint : null}
          <RoomMap
            key={displayRoom.id} room={displayRoom} locations={preview}
            selectedLocationId={editable ? (!placementProblem || mapPanel ? candidate.id : undefined) : location?.id}
            onPlace={editable && mapped && !busy && !svgLinked ? place : undefined}
            onSelect={(selectedId, point) => {
              if (mapPanel) mapPanel.onSelect(selectedId, displayRoom);
              else if (point) place(point);
              else if (!busy && !svgLinked) setError('Click a spot on the map to place this location.');
            }}
            caption={!editable ? undefined : mapPanel && !mapped ? 'The selected parent has no floor plan.' : svgLinked ? '' : mapPanel
              ? 'Select a location, or click empty map space to place this location.'
              : 'Click to place this location. Its name, parent, and marker are saved together.'}
          />
        </div>
      ) : !rootRoom && editable ? <p className="hint">This room has no floor plan. A map marker is not required.</p> : null}
    </>
  );
  return (
    <section className={mapPanel ? `location-map-panel${editable ? ' location-editor' : ''}` : 'location-editor'}
      aria-label={location ? `Edit ${location.name}` : mapPanel ? 'Location map' : rootRoom ? 'New room' : 'New child location'}>
      {mapPanel ? mapContent : null}
      {!location && !mapPanel ? (
        <p className="hint">
          {rootRoom ? 'New top-level room' : `New child of ${formatLocationPath(getLocationPath(locations, parentId ?? ''))}`}
        </p>
      ) : null}
      {editable ? (
        <div className="location-editor-fields">
          <fieldset className="location-fields" disabled={busy}>
            {level !== 'storage' ? <label className="location-name-field">Name
              <input
                aria-label={location ? 'Location name' : 'New location name'}
                autoFocus={!mapPanel}
                required={level === 'room'}
                placeholder={rootRoom ? 'Room name' : 'Location name'}
                value={draft.name || (level === 'surface' && draft.kind ? prepared.location.name : '')}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label> : <label className="location-name-field">Location
              <output aria-label="Location name">{selectedKind ? prepared.location.name : 'Choose a type'}</output>
            </label>}
            <label className="location-type-field">Type
              <select
                aria-label={location ? 'Location type' : 'New location type'}
                value={rootRoom ? 'room' : selectedKind} disabled={rootRoom} required
                onChange={(event) => {
                  const kind = allowedKinds.find((kind) => kind === event.target.value) ?? '';
                  const automaticName = level === 'surface' && previous?.letter &&
                    draft.name === `${locationKindLabel(previous.kind)} ${previous.letter}`;
                  setDraft({ ...draft, kind, name: automaticName && kind ? `${locationKindLabel(kind)} ${previous.letter}` : draft.name });
                }}
              >
                <option value="" disabled>Select type...</option>
                {allowedKinds.map((kind) => <option key={kind} value={kind}>{locationKindLabel(kind)}</option>)}
              </select>
            </label>
            {location && !rootRoom ? (
              <LocationPicker
                label="Parent location" locations={locations} allowRoot rootSelectable={candidate.kind === 'room'}
                value={draft.parentId} disabled={busy}
                excludedIds={[...getDescendantLocationIds(locations, location.id),
                  ...locations.filter((entry) => !childLocationKinds(locations, entry.id).includes(candidate.kind)).map((entry) => entry.id)]}
                onSelect={setParent}
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
            {level !== 'room' && selectedKind ? (
              <p className="hint location-access-hint" role="status">
                {level === 'storage' ? `${prepared.location.name} · ` : 'Location code: '}
                <strong>{locationCodeFromPath(getLocationPath([...identified.filter((entry) => entry.id !== candidate.id), candidate], candidate.id))}</strong>
                {!location ? ' (assigned when saved)' : ''}
              </p>
            ) : null}
            {inherited ? <p id={`${id}-access`} className="hint location-access-hint">Staff-only access is also required by the parent location.</p> : null}
          </fieldset>
          {mapPanel && mapped && !rootRoom ? placementHint : null}
          {mapPanel && !mapped && !rootRoom ? <p className="hint">The selected parent has no floor plan. A map marker is not required.</p> : null}
          {!parentExists ? <p className="error" role="alert">The parent location no longer exists. Cancel and choose a new parent.</p> : null}
          {error ? <p className="error" role="alert">{error}</p> : null}
          {hierarchyProblem ? <p className="hint" role="status">{hierarchyProblem}</p> : null}
          {mapPanel && location ? (
            <section className="location-children" aria-label="Child locations">
              <div className="location-children-heading">
                <h4>Child locations ({children.length})</h4>
                {mapPanel.onCreateChild ? (
                  <button
                    type="button" className="icon-button"
                    aria-label={`Add child to ${location.name}`} title={`Add child to ${location.name}`}
                    disabled={busy} onClick={() => mapPanel.onCreateChild?.(location)}
                  ><ActionIcon name="add" /></button>
                ) : null}
              </div>
              {children.length ? (
                <ul className="flat-list location-child-list">
                  {children.map((child) => (
                    <li key={child.id}>
                      <button
                        type="button" className="location-child-select"
                        data-location-id={child.id}
                        aria-label={`Edit child ${child.name}`} disabled={busy}
                        onClick={() => mapPanel.onSelect(child.id, resolveLocationMap(locations, child.id)?.room ?? mapPanel.room)}
                      >
                        <span>{child.name}</span>
                        {locationCodeFromPath(getLocationPath(identified, child.id)) ? (
                          <span className="location-code">{locationCodeFromPath(getLocationPath(identified, child.id))}</span>
                        ) : null}
                        <span className="kind">{child.kind}</span>
                        {isStaffOnlyLocation(locations, child.id) ? <span className="kind">Staff only</span> : null}
                        <ActionIcon name="chevron" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="hint">No child locations yet.</p>}
            </section>
          ) : null}
        </div>
      ) : null}
      {!mapPanel ? mapContent : null}
    </section>
  );
}
