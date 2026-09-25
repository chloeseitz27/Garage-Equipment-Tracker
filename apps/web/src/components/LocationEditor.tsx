import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ROOM_MAP_IDS, ROOM_MAPS, assignLocationIdentities, childLocationKinds, formatLocationPath, getChildLocations, getDescendantLocationIds,
  getLocationPath, isStaffOnlyLocation, resolveLocationMap,
  locationCodeFromPath, locationHierarchyProblem, locationKindLabel, locationLevel, prepareLocation,
  type Location, type LocationKind, type RoomMapId,
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
    onDeselect?: () => void;
    /** The panel is fading out after deselection; it stays visible but inert. */
    closing?: boolean;
  };
}

interface LocationDraft {
  name: string;
  kind: LocationKind | '';
  parentId: string | null;
  mapId: RoomMapId | '';
  staffOnly: boolean;
}

const toDraft = (location: Location | undefined, parentId: string | null, rootRoom: boolean): LocationDraft => ({
  name: location?.name ?? '',
  kind: rootRoom ? 'room' : location?.kind ?? '',
  parentId: location?.parentId ?? parentId,
  mapId: location?.mapId ?? '',
  staffOnly: location?.staffOnly ?? false,
});

export function LocationEditor({ locations, location, parentId, onSaved, onCancel, onStateChange, mapPanel }: Props): JSX.Element {
  const id = useId();
  const editable = !mapPanel || Boolean(location && !mapPanel.readOnly);
  const closing = Boolean(mapPanel?.closing);
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
  const compactCreation = !location && !mapPanel && level === 'storage';
  const previous = identity;
  const prepared = prepareLocation({
    ...draft, kind: selectedKind || draft.kind || allowedKinds[0] || 'bin', mapId: draft.mapId || undefined,
  }, identified, location?.id ?? `new-location-${id}`, previous);
  const candidate: Location = {
    ...prepared.location,
    id: location?.id ?? `new-location-${id}`,
    name: prepared.location.name || 'New location',
    mapId: draft.kind === 'room' && draft.parentId === null ? draft.mapId || undefined : undefined,
  };
  const preview = editable ? [...locations.filter((entry) => entry.id !== candidate.id), candidate] : locations;
  const mapped = editable ? resolveLocationMap(preview, candidate.id) : null;
  const surface = getLocationPath(preview, candidate.id)[1];
  const displayRoom = mapped?.room ?? mapPanel?.room;
  const source = useSvgMap(level === 'surface' || mapPanel ? displayRoom?.mapId : undefined);
  const svgIds = useMemo(() => new Set(source.map?.regions.map((region) => region.locationId) ?? []), [source.map]);
  const svgLinked = level === 'surface' && Boolean(mapped && svgIds.has(candidate.id));
  const inherited = draft.parentId !== null && isStaffOnlyLocation(locations, draft.parentId);
  const parentExists = draft.parentId === null || locations.some((entry) => entry.id === draft.parentId);
  const hierarchyProblem = locationHierarchyProblem(candidate, locations);
  const nameRequired = level === 'room' || selectedKind === 'station';
  const code = locationCodeFromPath(getLocationPath([...identified.filter((entry) => entry.id !== candidate.id), candidate], candidate.id));
  const canSave = editable && (!nameRequired || draft.name.trim() !== '') && selectedKind !== '' && parentExists &&
    !hierarchyProblem && !busy && (!mapPanel || dirty);
  const children = location && mapPanel ? getChildLocations(identified, location.id) : [];
  const canHaveChildren = Boolean(location && childLocationKinds(locations, location.id).length);
  const ancestors = mapPanel && location ? getLocationPath(preview, candidate.id).slice(0, -1) : [];

  const setParent = (nextParent: string | null): void => {
    setDraft((current) => ({
      ...current, parentId: nextParent,
      kind: childLocationKinds(locations, nextParent).includes(current.kind as LocationKind) ? current.kind : '',
    }));
    setError(null);
  };
  const save = async (): Promise<void> => {
    if (busy) return;
    if (!canSave) {
      setError(hierarchyProblem ?? (!parentExists ? 'The parent location no longer exists.' : 'Name and type are required.'));
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

  const floorPlanHint = svgLinked ? 'This location follows its SVG shape. Edit the SVG to move or resize it.' :
    'This location is not on the floor plan yet. Add an SVG shape with this location id to draw it on the map.';
  const mapContent = (
    <>
      {mapPanel?.navigation(displayRoom ?? mapPanel.room)}
      {displayRoom && (mapPanel || level === 'surface') ? (
        <div className="location-placement">
          <RoomMap
            key={displayRoom.id} room={displayRoom} locations={preview}
            showCaption={!mapPanel}
            selectedLocationId={closing ? undefined : editable ? candidate.id : location?.id}
            onDeselect={mapPanel && location && !busy && !closing ? mapPanel.onDeselect : undefined}
            onSelect={(selectedId) => {
              if (mapPanel) mapPanel.onSelect(selectedId, displayRoom);
            }}
            caption={!editable ? undefined : mapPanel && !mapped ? 'The selected parent has no floor plan.' : svgLinked || level === 'storage' ? '' : floorPlanHint}
          />
        </div>
      ) : level === 'storage' && editable ? (
        <p className="hint">This location uses {surface?.name ?? 'its enclosing surface'}&apos;s floor-plan shape.</p>
      ) : !rootRoom && editable ? <p className="hint">This room has no floor plan. The location can still be saved.</p> : null}
    </>
  );
  const nameInput = (
    <input
      className={mapPanel ? 'location-title-input' : undefined}
      aria-label={location ? 'Location name' : 'New location name'}
      title={mapPanel ? 'Edit location name' : undefined}
      autoFocus={!mapPanel}
      required={nameRequired}
      disabled={busy}
      placeholder={rootRoom ? 'Room name' : selectedKind === 'station' ? 'Station name' : 'Location name'}
      value={draft.name || (level === 'surface' && draft.kind ? prepared.location.name : '')}
      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
    />
  );
  const Container = compactCreation ? 'div' : 'section';
  return (
    <Container className={compactCreation ? 'location-child-form' : mapPanel ? `location-map-panel${editable && !closing ? ' location-editor' : ''}` : 'location-editor'}
      role={compactCreation ? 'group' : undefined}
      aria-label={location ? `Edit ${location.name}` : mapPanel ? 'Location map' : rootRoom ? 'New room' : 'New child location'}>
      {mapPanel ? mapContent : null}
      {!location && !mapPanel && !compactCreation ? (
        <p className="hint">
          {rootRoom ? 'New top-level room' : `New child of ${formatLocationPath(getLocationPath(locations, parentId ?? ''))}`}
        </p>
      ) : null}
      {editable ? (
        <div className={closing ? 'location-editor-fields closing' : 'location-editor-fields'}
          ref={(element) => { element?.toggleAttribute('inert', closing); }} aria-hidden={closing || undefined}>
          {mapPanel && location ? (
            <div className="location-selection-heading">
              {ancestors.length ? (
                <nav className="location-breadcrumbs" aria-label="Location breadcrumbs">
                  <ol>
                    {ancestors.map((ancestor, index) => {
                      const ancestorRoom = resolveLocationMap(locations, ancestor.id)?.room;
                      return (
                        <li key={ancestor.id}>
                          {index > 0 ? <span aria-hidden="true">/</span> : null}
                          {!ancestorRoom ? <span>{ancestor.name}</span> : ancestor.parentId === null ? (
                            <Link
                              to={`?${new URLSearchParams({ room: ancestorRoom.id })}`}
                              aria-disabled={busy}
                              onClick={(event) => { if (busy) event.preventDefault(); }}
                            >{ancestor.name}</Link>
                          ) : (
                            <button type="button" disabled={busy}
                              onClick={() => mapPanel.onSelect(ancestor.id, ancestorRoom)}>{ancestor.name}</button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </nav>
              ) : null}
              {level === 'storage' ? (
                <h3 className="location-selection-title">
                  <output aria-label="Location name">{selectedKind ? prepared.location.name : 'Choose a type'}</output>
                </h3>
              ) : nameInput}
            </div>
          ) : null}
          <fieldset className="location-fields" disabled={busy}>
            {!mapPanel ? level !== 'storage' ? <label className="location-name-field">Name
              {nameInput}
            </label> : !compactCreation ? <label className="location-name-field">Location
              <output aria-label="Location name">{selectedKind ? prepared.location.name : 'Choose a type'}</output>
            </label> : null : null}
            <label className="location-type-field">Type
              <select
                aria-label={location ? 'Location type' : 'New location type'}
                autoFocus={compactCreation}
                value={rootRoom ? 'room' : selectedKind} disabled={rootRoom} required
                onChange={(event) => {
                  const kind = allowedKinds.find((kind) => kind === event.target.value) ?? '';
                  const automaticName = level === 'surface' && previous?.letter &&
                    draft.name === `${locationKindLabel(previous.kind)} ${previous.letter}`;
                  setDraft({ ...draft, kind, name: automaticName && kind
                    ? kind === 'station' ? '' : `${locationKindLabel(kind)} ${previous.letter}`
                    : draft.name });
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
                type="button" className="icon-button" aria-label="Save" title="Save location"
                aria-busy={busy}
                disabled={!canSave} onClick={() => void save()}
              ><ActionIcon name="save" /></button>
              <button type="button" className="icon-button secondary" aria-label="Cancel" title="Cancel location changes" onClick={onCancel}>
                <ActionIcon name="cancel" />
              </button>
            </div>
            {!mapPanel && !compactCreation && level !== 'room' && selectedKind && (code || (level === 'storage' && !location)) ? (
              <p className="hint location-access-hint" role="status">
                {code ? <>
                  {level === 'storage' ? `${prepared.location.name} · ` : 'Location code: '}
                  <strong>{code}</strong>
                  {!location ? ' (assigned when saved)' : ''}
                </> : 'Number assigned when saved.'}
              </p>
            ) : null}
            {inherited ? <p id={`${id}-access`} className="hint location-access-hint">Staff-only access is also required by the parent location.</p> : null}
          </fieldset>
          {mapPanel && mapped && level === 'surface' ? <p className="hint" role="status">{floorPlanHint}</p> : null}
          {mapPanel && !mapped && !rootRoom ? <p className="hint">The selected parent has no floor plan. The location can still be saved.</p> : null}
          {!parentExists ? <p className="error" role="alert">The parent location no longer exists. Cancel and choose a new parent.</p> : null}
          {error ? <p className="error" role="alert">{error}</p> : null}
          {hierarchyProblem ? <p className="hint" role="status">{hierarchyProblem}</p> : null}
          {mapPanel && location && (canHaveChildren || children.length > 0) ? (
            <section className="location-children" aria-label="Child locations">
              <div className="location-children-heading">
                <h4>Child locations ({children.length})</h4>
                {canHaveChildren && mapPanel.onCreateChild ? (
                  <button
                    type="button" className="icon-button"
                    aria-label={`Add child to ${location.name}`} title={`Add child to ${location.name}`}
                    disabled={busy} onClick={() => mapPanel.onCreateChild?.(location)}
                  ><ActionIcon name="add" /></button>
                ) : null}
              </div>
              {!canHaveChildren ? <p className="hint">Storage locations cannot contain children. Move these existing locations to a table, station, desk, workbench, or cabinet.</p> : null}
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
      {!mapPanel && !compactCreation ? mapContent : null}
    </Container>
  );
}
