import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  formatLocationPath, getDescendantLocationIds, getLocationPath, resolveLocationMap, type Location,
} from '@garage/shared';
import { RoomMap } from './RoomMap.js';

interface Props {
  label: string;
  locations: Location[];
  excludedIds?: readonly string[];
  selectedIds: string[];
  multiple?: boolean;
  rootSelected?: boolean;
  onSelect: (id: string) => void;
  onSelectRoot?: () => void;
  onClose: () => void;
  onSearch: () => void;
}

export function LocationMapDialog({
  label, locations, excludedIds, selectedIds, multiple = false, rootSelected = false,
  onSelect, onSelectRoot, onClose, onSearch,
}: Props): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const helpId = useId();
  const rooms = useMemo(() => locations.filter((location) =>
    location.parentId === null && location.kind === 'room' && location.mapId &&
    getDescendantLocationIds(locations, location.id).some((id) => !excludedIds?.includes(id)),
  ), [locations, excludedIds]);
  const selected = selectedIds[0] ? resolveLocationMap(locations, selectedIds[0]) : null;
  const [roomId, setRoomId] = useState(selected?.room.id);
  const room = rooms.find((candidate) => candidate.id === roomId) ?? rooms[0];
  const selection = selectedIds.map((id) => formatLocationPath(getLocationPath(locations, id))).join('; ');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    closeRef.current?.focus();
    return () => dialog.close();
  }, []);

  const finish = (action: () => void): void => {
    // Close the native modal before restoring focus to a control outside it.
    dialogRef.current?.close();
    action();
  };
  const choose = (id: string): void => {
    if (multiple) onSelect(id);
    else finish(() => onSelect(id));
  };

  return (
    <dialog
      ref={dialogRef}
      className="location-map-dialog"
      aria-labelledby={titleId}
      aria-describedby={helpId}
      onCancel={(event) => { event.preventDefault(); finish(onClose); }}
    >
      <div className="location-map-heading">
        <h2 id={titleId}>{label}: choose on map</h2>
        <button ref={closeRef} type="button" onClick={() => finish(onClose)}>Close map</button>
      </div>
      <p id={helpId} className="hint">
        {multiple ? 'Click shapes or markers to toggle locations in the filter.' : 'Click a shape or marker to choose that location.'}
        {' '}For locations not shown on the map, use search instead.
      </p>
      <p className="location-map-selection" aria-live="polite">
        Selected: {selection || (rootSelected ? 'Top level (no parent)' : 'None')}
      </p>
      <nav className="tabs sub-tabs" aria-label="Choose room map">
        {rooms.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className={candidate.id === room?.id ? 'active' : ''}
            aria-pressed={candidate.id === room?.id}
            onClick={() => setRoomId(candidate.id)}
          >{candidate.name}</button>
        ))}
      </nav>
      {room ? (
        <>
          <RoomMap
            key={room.id}
            room={room}
            locations={locations}
            selectedLocationId={multiple ? undefined : selectedIds[0]}
            selectedLocationIds={multiple ? selectedIds : undefined}
            excludedIds={excludedIds}
            onSelect={choose}
            caption={multiple ? 'Click a shape or marker to toggle its location.' : 'Click a shape or marker to choose its location.'}
          />
        </>
      ) : <p className="muted">No floor plans are available for these locations. Use search to choose a location.</p>}
      <div className="location-map-actions">
        {room && !excludedIds?.includes(room.id) ? (
          <button type="button" aria-pressed={selectedIds.includes(room.id)} onClick={() => choose(room.id)}>
            {multiple ? 'Toggle entire room' : 'Choose entire room'}: {room.name}
          </button>
        ) : null}
        {onSelectRoot ? (
          <button type="button" aria-pressed={rootSelected} onClick={() => finish(onSelectRoot)}>Top level (no parent)</button>
        ) : null}
        <button type="button" onClick={() => finish(onSearch)}>Use search instead</button>
      </div>
    </dialog>
  );
}
