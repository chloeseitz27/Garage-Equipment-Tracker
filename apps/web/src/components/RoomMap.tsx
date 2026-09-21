import { useEffect, useId, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { ROOM_MAPS, resolveLocationMap, roomMapMarkers, type Location } from '@garage/shared';

interface Props {
  room: Location;
  locations: Location[];
  selectedLocationId?: string;
  selectedLocationIds?: readonly string[];
  excludedIds?: readonly string[];
  caption?: string;
  onSelect?: (id: string) => void;
  onPlace?: (point: { x: number; y: number }) => void;
}

export function roomMapUrl(roomId: string, locationId?: string): string {
  const params = new URLSearchParams({ room: roomId });
  if (locationId) params.set('location', locationId);
  return `/maps?${params}`;
}

interface MapView {
  zoom: number;
  x: number;
  y: number;
}

const FIT_VIEW: MapView = { zoom: 1, x: 0, y: 0 };
const clampView = (view: MapView): MapView => ({
  zoom: view.zoom,
  x: Math.max(1 - view.zoom, Math.min(0, view.x)),
  y: Math.max(1 - view.zoom, Math.min(0, view.y)),
});

export function RoomMap({
  room, locations, selectedLocationId, selectedLocationIds, excludedIds, caption, onSelect, onPlace,
}: Props): JSX.Element {
  const asset = room.mapId ? ROOM_MAPS[room.mapId] : undefined;
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<MapView>(FIT_VIEW);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    view: MapView;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const helpId = useId();
  const resolved = selectedLocationId ? resolveLocationMap(locations, selectedLocationId) : null;
  const highlighted = resolved?.room.id === room.id ? resolved.marker?.location.id : undefined;
  const highlightedX = highlighted ? resolved?.marker?.position.x : undefined;
  const highlightedY = highlighted ? resolved?.marker?.position.y : undefined;
  useEffect(() => {
    setFailed(false);
    setView(FIT_VIEW);
    dragRef.current = null;
    suppressClick.current = false;
    setDragging(false);
  }, [asset?.imageUrl]);
  useEffect(() => {
    if (highlightedX !== undefined && highlightedY !== undefined) {
      setView((current) => clampView({
        ...current, x: 0.5 - highlightedX * current.zoom, y: 0.5 - highlightedY * current.zoom,
      }));
    }
  }, [highlighted, highlightedX, highlightedY]);

  const changeZoom = (delta: number): void => {
    setView((current) => {
      const zoom = Math.max(1, Math.min(3, current.zoom + delta));
      // Preserve the visible center; when first zooming in, prioritize the highlighted location.
      const x = current.zoom === 1 && highlightedX !== undefined ? highlightedX : (0.5 - current.x) / current.zoom;
      const y = current.zoom === 1 && highlightedY !== undefined ? highlightedY : (0.5 - current.y) / current.zoom;
      return clampView({ zoom, x: 0.5 - x * zoom, y: 0.5 - y * zoom });
    });
  };

  const startPan = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current || event.button !== 0 || event.isPrimary === false) return;
    suppressClick.current = false;
    if (failed || view.zoom === 1) return;
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, view, moved: false };
  };
  const pan = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.clientX, dy = event.clientY - drag.clientY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    if (!drag.moved) {
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.moved = true;
      setDragging(true);
    }
    suppressClick.current = true;
    setView(clampView({
      ...drag.view, x: drag.view.x + dx / bounds.width, y: drag.view.y + dy / bounds.height,
    }));
  };
  const endPan = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (!asset) return <p className="muted">No floor plan is assigned to {room.name}.</p>;
  const markers = roomMapMarkers(locations, room.id).filter((location) => !excludedIds?.includes(location.id));
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
      {failed ? <p className="error" role="alert">Could not load the floor plan for {room.name}.</p> : null}
      <div className="room-map-canvas" style={{ aspectRatio: `${asset.width} / ${asset.height}` }}>
        <div
          className={`room-map-viewport${view.zoom > 1 ? ' zoomed' : ''}${dragging ? ' dragging' : ''}`}
          tabIndex={0}
          role="region"
          aria-label={`${room.name} interactive map`}
          aria-describedby={helpId}
          onPointerDown={startPan}
          onPointerMove={pan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onLostPointerCapture={endPan}
          onClickCapture={(event) => {
            if (suppressClick.current && event.detail !== 0) {
              event.preventDefault();
              event.stopPropagation();
              suppressClick.current = false;
            }
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || failed) return;
            if (event.key === 'Home') {
              event.preventDefault();
              setView(FIT_VIEW);
            } else if (view.zoom > 1 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
              event.preventDefault();
              setView((current) => clampView({
                ...current,
                x: current.x + (event.key === 'ArrowLeft' ? 0.1 : event.key === 'ArrowRight' ? -0.1 : 0),
                y: current.y + (event.key === 'ArrowUp' ? 0.1 : event.key === 'ArrowDown' ? -0.1 : 0),
              }));
            }
          }}
        >
          <div
            className={onPlace ? 'room-map-stage placing' : 'room-map-stage'}
            style={{ transform: `translate(${view.x * 100}%, ${view.y * 100}%) scale(${view.zoom})` }}
            onClick={place}
          >
            <img src={asset.imageUrl} width={asset.width} height={asset.height} alt={`${room.name} floor plan`} draggable={false} onError={() => setFailed(true)} />
            {!failed && markers.map((location) => {
              const pin = location.mapPosition;
              if (!pin) return null;
              const selected = selectedLocationIds ? selectedLocationIds.includes(location.id) : highlighted === location.id;
              const className = selected ? 'map-marker selected' : 'map-marker';
              const style = {
                left: `${pin.x * 100}%`, top: `${pin.y * 100}%`,
                transform: `translate(-50%, -50%) scale(${1 / view.zoom})`,
              };
              const label = `${location.name}${selected ? ' (highlighted)' : ''}`;
              const reveal = (): void => {
                setView((current) => clampView({
                  ...current, x: 0.5 - pin.x * current.zoom, y: 0.5 - pin.y * current.zoom,
                }));
              };
              return onSelect ? (
                <button
                  key={location.id}
                  type="button"
                  className={className}
                  style={style}
                  aria-label={label}
                  aria-pressed={selected}
                  title={location.name}
                  onFocus={(event) => {
                    if (event.currentTarget.matches(':focus-visible')) reveal();
                  }}
                  onClick={(event) => { event.stopPropagation(); onSelect(location.id); }}
                ><span className="map-marker-dot" aria-hidden="true" /></button>
              ) : (
                <Link
                  key={location.id}
                  className={className}
                  style={style}
                  to={roomMapUrl(room.id, location.id)}
                  aria-label={label}
                  aria-current={selected ? 'location' : undefined}
                  title={location.name}
                  onFocus={(event) => {
                    if (event.currentTarget.matches(':focus-visible')) reveal();
                  }}
                ><span className="map-marker-dot" aria-hidden="true" /></Link>
              );
            })}
          </div>
        </div>
        <div className="room-map-controls" role="group" aria-label={`${room.name} map zoom`}>
          <button type="button" aria-label="Zoom out" title="Zoom out" disabled={failed || view.zoom <= 1} onClick={() => changeZoom(-0.25)}>-</button>
          <button type="button" className="map-zoom-reset" aria-label="Reset zoom" title="Reset zoom" disabled={failed || view.zoom === 1} onClick={() => setView(FIT_VIEW)}>
            <span aria-live="polite">{Math.round(view.zoom * 100)}%</span>
          </button>
          <button type="button" aria-label="Zoom in" title="Zoom in" disabled={failed || view.zoom >= 3} onClick={() => changeZoom(0.25)}>+</button>
        </div>
      </div>
      <p id={helpId} className="visually-hidden">Zoom with the plus and minus buttons. Drag to pan when zoomed, or focus the map and use arrow keys. Press Home to reset the view.</p>
      <figcaption>
        {caption ?? (highlighted ? `Highlighted: ${resolved?.marker?.location.name}.` : 'Select a marker to browse that location.')}
      </figcaption>
    </figure>
  );
}
