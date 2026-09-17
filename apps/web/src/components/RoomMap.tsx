import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { ROOM_MAPS, resolveLocationMap, roomMapMarkers, type Location } from '@garage/shared';

interface Props {
  room: Location;
  locations: Location[];
  selectedLocationId?: string;
  onSelect?: (id: string) => void;
  onPlace?: (point: { x: number; y: number }) => void;
}

export function roomMapUrl(roomId: string, locationId?: string): string {
  const params = new URLSearchParams({ room: roomId });
  if (locationId) params.set('location', locationId);
  return `/maps?${params}`;
}

export function RoomMap({ room, locations, selectedLocationId, onSelect, onPlace }: Props): JSX.Element {
  const asset = room.mapId ? ROOM_MAPS[room.mapId] : undefined;
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const markerRef = useRef<HTMLElement | null>(null);
  const resolved = selectedLocationId ? resolveLocationMap(locations, selectedLocationId) : null;
  const highlighted = resolved?.room.id === room.id ? resolved.marker?.location.id : undefined;
  useEffect(() => { setFailed(false); setZoom(1); }, [asset?.imageUrl]);
  useEffect(() => {
    if (highlighted) markerRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [highlighted, asset?.imageUrl, zoom]);

  if (!asset) return <p className="muted">No floor plan is assigned to {room.name}.</p>;
  const markers = roomMapMarkers(locations, room.id);
  const place = (event: MouseEvent<HTMLDivElement>): void => {
    if (!onPlace || failed) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    onPlace({
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    });
  };
  return (
    <figure className="room-map">
      <div className="room-map-controls" role="group" aria-label={`${room.name} map zoom`}>
        <button type="button" disabled={zoom <= 1} onClick={() => setZoom((current) => Math.max(1, current - 0.25))}>Zoom out</button>
        <span aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" disabled={zoom >= 3} onClick={() => setZoom((current) => Math.min(3, current + 0.25))}>Zoom in</button>
        <button type="button" disabled={zoom === 1} onClick={() => setZoom(1)}>Reset zoom</button>
      </div>
      {failed ? <p className="error" role="alert">Could not load the floor plan for {room.name}.</p> : null}
      <div className="room-map-scroll">
        <div
          className={onPlace ? 'room-map-stage placing' : 'room-map-stage'}
          style={{ width: `${zoom * 100}%`, minWidth: `${650 * zoom}px` }}
          onClick={place}
        >
          <img src={asset.imageUrl} width={asset.width} height={asset.height} alt={`${room.name} floor plan`} draggable={false} onError={() => setFailed(true)} />
          {!failed && markers.map((location) => {
            const pin = location.mapPosition;
            if (!pin) return null;
            const selected = highlighted === location.id;
            const className = selected ? 'map-marker selected' : 'map-marker';
            const style = { left: `${pin.x * 100}%`, top: `${pin.y * 100}%` };
            const label = `${location.name}${selected ? ' (highlighted)' : ''}`;
            return onSelect ? (
              <button
                key={location.id}
                ref={(node) => { if (selected) markerRef.current = node; }}
                type="button"
                className={className}
                style={style}
                aria-label={label}
                aria-pressed={selected}
                title={location.name}
                onClick={(event) => { event.stopPropagation(); onSelect(location.id); }}
              ><span className="map-marker-dot" aria-hidden="true" /></button>
            ) : (
              <Link
                key={location.id}
                ref={(node) => { if (selected) markerRef.current = node; }}
                className={className}
                style={style}
                to={roomMapUrl(room.id, location.id)}
                aria-label={label}
                aria-current={selected ? 'location' : undefined}
                title={location.name}
              ><span className="map-marker-dot" aria-hidden="true" /></Link>
            );
          })}
        </div>
      </div>
      <figcaption>
        {highlighted ? `Highlighted: ${resolved?.marker?.location.name}.` : 'Select a marker to browse that location.'}
      </figcaption>
    </figure>
  );
}
