import { useMemo, useState } from 'react';
import {
  LOCATION_KINDS,
  ROOM_MAP_IDS,
  ROOM_MAPS,
  getChildLocations,
  getDescendantLocationIds,
  type Item,
  type Location,
  type LocationKind,
  type RoomMapId,
} from '@garage/shared';

import { createLocation, deleteLocation, updateLocation } from '../api.js';
import { LocationPicker } from './LocationPicker.js';
import { LocationMapEditor } from './LocationMapEditor.js';

interface Props {
  locations: Location[];
  items: Item[];
  onChanged: () => void;
}

/**
 * Location tree management (product-spec.md §6.5).
 *
 * Rendered as the actual hierarchy rather than a flat list, because the tree
 * shape is the thing being edited — and because it doubles as the shelf-audit
 * view showing what each node holds.
 */
export function LocationManager({ locations, items, onChanged }: Props): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftParentId, setDraftParentId] = useState<string | null>(null);
  const [draftKind, setDraftKind] = useState<LocationKind>('bin');
  const [draftMapId, setDraftMapId] = useState<RoomMapId | ''>('');
  const [newName, setNewName] = useState('');
  const [newParentId, setNewParentId] = useState<string | null>(null);
  const [newKind, setNewKind] = useState<LocationKind>('bin');
  const [newMapId, setNewMapId] = useState<RoomMapId | ''>('');
  const [error, setError] = useState<string | null>(null);

  const itemCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.locationId, (counts.get(item.locationId) ?? 0) + 1);
    return counts;
  }, [items]);

  const excludedParentIds = useMemo(
    () => editingId ? getDescendantLocationIds(locations, editingId) : [],
    [locations, editingId],
  );

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await action();
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const startEdit = (location: Location): void => {
    setEditingId(location.id);
    setDraftName(location.name);
    setDraftParentId(location.parentId);
    setDraftKind(location.kind);
    setDraftMapId(location.mapId ?? '');
    setError(null);
  };

  const renderNode = (location: Location, depth: number): JSX.Element => {
    const children = getChildLocations(locations, location.id);
    const held = itemCounts.get(location.id) ?? 0;
    const blocked = children.length > 0 || held > 0;

    return (
      <li key={location.id}>
        <div className="tree-node" style={{ paddingLeft: `${depth * 1.25}rem` }}>
          {editingId === location.id ? (
            <div className="tree-edit">
              <input value={draftName} onChange={(event) => setDraftName(event.target.value)} />
              <select
                value={draftKind}
                onChange={(event) => setDraftKind(event.target.value as LocationKind)}
              >
                {LOCATION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
              <LocationPicker
                label="Parent location"
                locations={locations}
                value={draftParentId}
                allowRoot
                excludedIds={excludedParentIds}
                onSelect={setDraftParentId}
              />
              <label>Floor plan
                <select aria-label="Floor plan" value={draftMapId} onChange={(event) => setDraftMapId(ROOM_MAP_IDS.find((id) => id === event.target.value) ?? '')}>
                  <option value="">None (rooms only)</option>
                  {ROOM_MAP_IDS.map((id) => <option key={id} value={id}>{ROOM_MAPS[id].name}</option>)}
                </select>
              </label>
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    await updateLocation({
                      ...location,
                      id: location.id,
                      name: draftName.trim(),
                      parentId: draftParentId,
                      kind: draftKind,
                      mapId: draftMapId || undefined,
                    });
                    setEditingId(null);
                  })
                }
              >
                Save
              </button>
              <button type="button" className="secondary" onClick={() => setEditingId(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              <span className="tree-name">
                {location.name}
                <span className="kind">{location.kind}</span>
                {held > 0 ? <span className="muted small">{held} item(s)</span> : null}
              </span>
              <span className="tree-actions">
                <button type="button" onClick={() => startEdit(location)}>
                  Rename / move
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={blocked}
                  title={
                    blocked
                      ? 'Move its items and sub-locations first'
                      : 'Delete this empty location'
                  }
                  onClick={() => void run(() => deleteLocation(location.id))}
                >
                  Delete
                </button>
              </span>
            </>
          )}
        </div>
        {children.length > 0 ? (
          <ul>{children.map((child) => renderNode(child, depth + 1))}</ul>
        ) : null}
      </li>
    );
  };

  return (
    <div className="manager">
      <h3>Locations</h3>
      <p className="muted small">
        Items attach at any depth. Deleting is blocked while a node still holds items or
        sub-locations.
      </p>

      {error ? <p className="error">{error}</p> : null}

      <LocationMapEditor locations={locations} onChanged={onChanged} />

      <ul className="tree">{getChildLocations(locations, null).map((root) => renderNode(root, 0))}</ul>

      <div className="add-row">
        <input
          placeholder="New location name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <select
          value={newKind}
          onChange={(event) => setNewKind(event.target.value as LocationKind)}
        >
          {LOCATION_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
        <LocationPicker
          label="New location parent"
          locations={locations}
          value={newParentId}
          allowRoot
          onSelect={setNewParentId}
        />
        <label>Floor plan
          <select aria-label="New room floor plan" value={newMapId} onChange={(event) => setNewMapId(ROOM_MAP_IDS.find((id) => id === event.target.value) ?? '')}>
            <option value="">None (rooms only)</option>
            {ROOM_MAP_IDS.map((id) => <option key={id} value={id}>{ROOM_MAPS[id].name}</option>)}
          </select>
        </label>
        <button
          type="button"
          disabled={!newName.trim()}
          onClick={() =>
            void run(async () => {
              await createLocation({ name: newName.trim(), parentId: newParentId, kind: newKind, mapId: newMapId || undefined });
              setNewName('');
            })
          }
        >
          Add location
        </button>
      </div>
    </div>
  );
}
