import { Link, useSearchParams } from 'react-router-dom';
import { getDescendantLocationIds, liveItems, type CatalogResponse } from '@garage/shared';
import { RoomMap } from './RoomMap.js';

export function RoomMapsPage({ catalog }: { catalog: CatalogResponse }): JSX.Element {
  const [params, setParams] = useSearchParams();
  const rooms = catalog.locations.filter((location) => location.parentId === null && location.kind === 'room' && location.mapId);
  const roomId = params.get('room') ?? rooms[0]?.id;
  const room = rooms.find((candidate) => candidate.id === roomId);
  if (!room) {
    return <section className="manager" aria-label="Maps"><p>No mapped room found.</p><Link to="/maps">View available rooms</Link></section>;
  }
  const locationId = params.get('location') ?? room.id;
  const descendants = getDescendantLocationIds(catalog.locations, room.id);
  const selected = catalog.locations.find((location) => location.id === locationId && descendants.includes(location.id));
  const included = selected ? new Set(getDescendantLocationIds(catalog.locations, selected.id)) : new Set<string>();
  const items = liveItems(catalog.items).filter((item) => included.has(item.locationId));
  const select = (id: string): void => {
    setParams({ room: room.id, location: id });
  };
  return (
    <section className="manager" aria-label="Maps">
      <nav className="tabs sub-tabs" aria-label="Maps">
        {rooms.map((candidate) => (
          <Link key={candidate.id} to={`/maps?${new URLSearchParams({ room: candidate.id })}`} className={candidate.id === room.id ? 'active' : ''}>
            {candidate.name}
          </Link>
        ))}
      </nav>
      <RoomMap room={room} locations={catalog.locations} selectedLocationId={selected?.id} onSelect={select} />
      <h3>{selected?.name ?? 'Location not found in this room'}</h3>
      {items.length ? (
        <ul className="map-item-list">
          {items.map((item) => <li key={item.id}><Link to={`/?${new URLSearchParams({ item: item.id })}`}>{item.name}</Link></li>)}
        </ul>
      ) : <p className="muted">No active items are assigned here yet.</p>}
    </section>
  );
}
