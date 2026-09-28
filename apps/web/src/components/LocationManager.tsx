import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { assignLocationIdentities, childLocationKinds, getChildLocations, getLocationPath, isStaffOnlyLocation, locationCodeFromPath, type Item, type Location } from '@garage/shared';
import { createLocation, deleteLocation } from '../api.js';
import { LocationEditor } from './LocationEditor.js';
import { LocationMapEditor } from './LocationMapEditor.js';
import { useCatalogDraft } from '../catalog-draft.js';
import { ActionIcon } from './ActionIcon.js';

interface Props {
  locations: Location[];
  items: Item[];
  onChanged: () => void;
}

type EditorTarget = { mode: 'edit'; id: string } | { mode: 'create'; parentId: string | null };
const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const targetKey = (target: EditorTarget): string => target.mode === 'edit'
  ? `edit:${target.id}` : target.parentId === null ? 'create-room' : `create-child:${target.parentId}`;

export function LocationManager({ locations: catalogLocations, items, onChanged }: Props): JSX.Element {
  const treeId = useId();
  const [locations, setLocations] = useState(catalogLocations);
  useEffect(() => { setLocations(catalogLocations); }, [catalogLocations]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [mapEditDirty, setMapEditDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useCatalogDraft(editor !== null);

  const reportEditor = useCallback((dirty: boolean, busy: boolean): void => {
    setEditorDirty(dirty);
    setEditorBusy(busy);
  }, []);
  const closeEditor = (): void => {
    setEditor(null);
    setEditorDirty(false);
    setEditorBusy(false);
  };
  const openEditor = (target: EditorTarget): boolean => {
    if (editorBusy) return false;
    if (editor && targetKey(editor) === targetKey(target)) return true;
    if (target.mode === 'create' && !childLocationKinds(locations, target.parentId).length) {
      window.alert('Drawers, bins, and shelves cannot contain child locations.');
      return false;
    }
    if (mapEditDirty) {
      window.alert('Save or cancel the highlighted location changes before adding or editing another location.');
      return false;
    }
    if (editorDirty && !window.confirm('Discard the unsaved location changes and open another location?')) return false;
    setEditor(target);
    setEditorDirty(false);
    setError(null);
    if (target.mode === 'create' && target.parentId) {
      const pathIds = getLocationPath(locations, target.parentId).map((location) => location.id);
      setExpandedIds((current) => new Set([...current, ...pathIds]));
    }
    return true;
  };

  const itemCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.locationId, (counts.get(item.locationId) ?? 0) + 1);
    return counts;
  }, [items]);
  const identified = useMemo(() => assignLocationIdentities(locations), [locations]);

  const remove = async (location: Location): Promise<void> => {
    setError(null);
    try {
      await deleteLocation(location.id);
      setLocations((current) => current.filter((entry) => entry.id !== location.id));
      onChanged();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not delete the location.';
      setError(message);
      window.alert(`Cannot delete "${location.name}".\n\n${message}`);
    }
  };

  const locationSaved = (saved: Location): void => {
    setLocations((current) => current.some((entry) => entry.id === saved.id)
      ? current.map((entry) => entry.id === saved.id ? saved : entry)
      : [...current, saved]);
    onChanged();
  };

  const renderEditor = (location?: Location): JSX.Element | null => editor ? (
    <LocationEditor
      key={targetKey(editor)}
      locations={locations}
      location={location}
      parentId={editor.mode === 'create' ? editor.parentId : location?.parentId ?? null}
      onStateChange={reportEditor}
      onCancel={closeEditor}
      onSaved={(saved) => {
        closeEditor();
        locationSaved(saved);
      }}
    />
  ) : null;

  const sortedChildren = (parentId: string | null): Location[] =>
    getChildLocations(locations, parentId).sort((a, b) => nameCollator.compare(a.name, b.name));

  const renderNode = (location: Location, depth: number): JSX.Element => {
    const children = sortedChildren(location.id);
    const held = itemCounts.get(location.id) ?? 0;
    const blocked = children.length > 0 || held > 0;
    const creatingChild = editor?.mode === 'create' && editor.parentId === location.id;
    const hasChildren = children.length > 0 || creatingChild;
    const expanded = expandedIds.has(location.id);
    const childrenId = `${treeId}-${encodeURIComponent(location.id)}`;

    return (
      <li key={location.id}>
        <div className={creatingChild ? 'tree-node creating-child' : 'tree-node'} style={{ paddingLeft: `${depth * 1.25}rem` }}>
          {editor?.mode === 'edit' && editor.id === location.id ? renderEditor(location) : (
            <>
              <span className="tree-name">
                {hasChildren ? (
                  <button
                    type="button" className="icon-button tree-toggle"
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${location.name}`}
                    title={`${expanded ? 'Collapse' : 'Expand'} ${location.name}`}
                    aria-expanded={expanded} aria-controls={childrenId}
                    onClick={() => setExpandedIds((current) => {
                      const next = new Set(current);
                      if (next.has(location.id)) next.delete(location.id);
                      else next.add(location.id);
                      return next;
                    })}
                  ><ActionIcon name="chevron" /></button>
                ) : <span className="tree-toggle-space" aria-hidden="true" />}
                {location.name}
                {locationCodeFromPath(getLocationPath(identified, location.id)) ? (
                  <span className="location-code">{locationCodeFromPath(getLocationPath(identified, location.id))}</span>
                ) : null}
                <span className="kind">{location.kind}</span>
                {isStaffOnlyLocation(locations, location.id) ? <span className="kind">Staff only</span> : null}
                {held > 0 ? <span className="muted small">{held} item(s)</span> : null}
              </span>
              <span className="tree-actions">
                {childLocationKinds(locations, location.id).length > 0 ? <button
                  type="button" className="icon-button" disabled={editorBusy}
                  aria-label={`Add child to ${location.name}`} title={`Add child to ${location.name}`}
                  onClick={() => openEditor({ mode: 'create', parentId: location.id })}
                ><ActionIcon name="add" /></button> : null}
                <button
                  type="button" className="icon-button" disabled={editorBusy}
                  aria-label={`Rename or move ${location.name}`} title={`Rename or move ${location.name}`}
                  onClick={() => openEditor({ mode: 'edit', id: location.id })}
                ><ActionIcon name="edit" /></button>
                <button
                  type="button" className="icon-button danger" aria-label={`Delete ${location.name}`}
                  disabled={editorBusy}
                  title={blocked ? 'Move its items and sub-locations first' : 'Delete this empty location'}
                  onClick={() => {
                    const title = `Cannot delete "${location.name}".`;
                    if (blocked) {
                      const reasons = [
                        children.length > 0 ? `${children.length} sub-location(s). Move or delete them first.` : '',
                        held > 0 ? `${held} item(s), including any in the recycle bin. Move them to another location first.` : '',
                      ].filter(Boolean);
                      window.alert(`${title}\n\nThis location still contains:\n${reasons.join('\n')}`);
                    } else if (editor || mapEditDirty) {
                      window.alert(`${title}\n\nSave or cancel your location edits before deleting locations.`);
                    } else void remove(location);
                  }}
                ><ActionIcon name="delete" /></button>
              </span>
            </>
          )}
        </div>
        {hasChildren ? (
          <ul id={childrenId} hidden={!expanded}>
            {creatingChild ? <li className="new-child-location" style={{ paddingLeft: `${(depth + 1) * 1.25}rem` }}>{renderEditor()}</li> : null}
            {children.map((child) => renderNode(child, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <div className="manager">
      {error ? <p className="error" role="alert">{error}</p> : null}
      <LocationMapEditor
        locations={locations} onChanged={locationSaved} disabled={editor !== null}
        formDirty={editorDirty} formBusy={editorBusy} onDiscardForm={closeEditor}
        onDraftChange={setMapEditDirty}
        onCreateChild={(location) => openEditor({ mode: 'create', parentId: location.id })}
      />
      <ul className="tree">
        {sortedChildren(null).map((root) => renderNode(root, 0))}
        <NewRoomRow
          active={editor?.mode === 'create' && editor.parentId === null}
          disabled={editorBusy}
          onActivate={() => openEditor({ mode: 'create', parentId: null })}
          onStateChange={reportEditor}
          onCancel={closeEditor}
          onSaved={(saved) => {
            closeEditor();
            locationSaved(saved);
          }}
        />
      </ul>
    </div>
  );
}

interface NewRoomRowProps {
  active: boolean;
  disabled: boolean;
  /** Claims the single location editor slot; returns false when another draft blocks it. */
  onActivate: () => boolean;
  onStateChange: (dirty: boolean, busy: boolean) => void;
  onCancel: () => void;
  onSaved: (location: Location) => void;
}

/** The last tree row: type a name and press + to add a top-level room. */
function NewRoomRow({ active, disabled, onActivate, onStateChange, onCancel, onSaved }: NewRoomRowProps): JSX.Element {
  const [name, setName] = useState('');
  const [staffOnly, setStaffOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = name !== '' || staffOnly;
  useEffect(() => {
    if (active) return;
    setName('');
    setStaffOnly(false);
    setError(null);
  }, [active]);
  useEffect(() => { if (active) onStateChange(dirty || busy, busy); }, [active, dirty, busy, onStateChange]);

  const edit = (apply: () => void): void => {
    if (active || onActivate()) apply();
  };
  const discard = (): void => {
    if (busy) return;
    setName('');
    setStaffOnly(false);
    setError(null);
    if (active) onCancel();
  };
  const add = async (): Promise<void> => {
    const trimmed = name.trim();
    if (busy || !trimmed || !(active || onActivate())) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await createLocation({ name: trimmed, kind: 'room', parentId: null, staffOnly });
      setName('');
      setStaffOnly(false);
      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the room.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="tree-new-room">
      <div className="tree-node new-room-row" role="group" aria-label="New room">
        <span className="tree-toggle-space" aria-hidden="true" />
        <input
          aria-label="New room name" placeholder="New Room" value={name}
          disabled={busy || (disabled && !active)}
          onChange={(event) => { const value = event.target.value; edit(() => setName(value)); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void add();
            } else if (event.key === 'Escape' && dirty) {
              event.preventDefault();
              discard();
            }
          }}
        />
        <label className="staff-only-option">
          <input
            type="checkbox" checked={staffOnly} disabled={busy || (disabled && !active)}
            onChange={(event) => { const checked = event.target.checked; edit(() => setStaffOnly(checked)); }}
          />
          Staff-only
        </label>
        <span className="tree-actions">
          <button
            type="button" className="icon-button" aria-label="Add room" title="Add this room"
            aria-busy={busy} disabled={busy || disabled && !active || !name.trim()} onClick={() => void add()}
          ><ActionIcon name="add" /></button>
          <button
            type="button" className="icon-button secondary" aria-label="Discard new room" title="Discard new room"
            disabled={busy || !dirty} onClick={discard}
          ><ActionIcon name="cancel" /></button>
        </span>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </li>
  );
}
