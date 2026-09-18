import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { isRetired, retiredItems, type CatalogResponse } from '@garage/shared';
import { BulkEntry } from './BulkEntry.js';
import { CategoryManager } from './CategoryManager.js';
import { FlagQueue } from './FlagQueue.js';
import { ItemEditor } from './ItemEditor.js';
import { ItemsManager } from './ItemsManager.js';
import { LocationManager } from './LocationManager.js';

interface Props {
  catalog: CatalogResponse;
  onChanged: () => void;
}

const SECTIONS = [
  ['items', 'Items'],
  ['locations', 'Locations'],
  ['categories', 'Categories'],
  ['flags', 'Flag queue'],
  ['recycle-bin', 'Recycle bin'],
] as const;

function EditItemPage({ catalog, onChanged, creating = false }: Props & { creating?: boolean }): JSX.Element {
  const { itemId } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const item = creating ? null : catalog.items.find((candidate) => candidate.id === itemId);
  const close = (): void => { void navigate(`/manage/items${search}`); };
  if (!creating && (!item || isRetired(item))) {
    return (
      <div className="manager">
        <h3>Item not found in the active catalog</h3>
        <Link to="/manage/items">Return to Items</Link>{' · '}
        <Link to="/manage/recycle-bin">Check the recycle bin</Link>
      </div>
    );
  }
  return (
    <ItemEditor
      key={creating ? 'new' : itemId}
      item={item ?? null}
      categories={catalog.categories}
      locations={catalog.locations}
      onSaved={() => { onChanged(); close(); }}
      onCancel={close}
    />
  );
}

export function StaffPanel({ catalog, onChanged }: Props): JSX.Element {
  const navigate = useNavigate();
  const { search } = useLocation();
  const binCount = retiredItems(catalog.items).length;
  const itemsUrl = `/manage/items${search}`;

  return (
    <section className="staff-panel">
      <nav className="tabs sub-tabs" aria-label="Catalog sections">
        {SECTIONS.map(([path, label]) => (
          <NavLink key={path} to={`/manage/${path}`}>
            {label}
            {path === 'recycle-bin' && binCount > 0 ? <span className="badge">{binCount}</span> : null}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to={itemsUrl} replace />} />
        <Route path="items" element={
          <ItemsManager
            catalog={catalog}
            mode="live"
            onEditItem={(item) => { void navigate(`/manage/items/${encodeURIComponent(item.id)}/edit${search}`); }}
            onCreateItem={() => { void navigate(`/manage/items/new${search}`); }}
            bulkEntry={<BulkEntry categories={catalog.categories} locations={catalog.locations} onCreated={onChanged} />}
            onChanged={onChanged}
          />
        } />
        <Route path="items/new" element={<EditItemPage catalog={catalog} onChanged={onChanged} creating />} />
        <Route path="items/:itemId/edit" element={<EditItemPage catalog={catalog} onChanged={onChanged} />} />
        <Route path="locations" element={<LocationManager locations={catalog.locations} items={catalog.items} onChanged={onChanged} />} />
        <Route path="categories" element={<CategoryManager categories={catalog.categories} items={catalog.items} onChanged={onChanged} />} />
        <Route path="flags" element={
          <FlagQueue items={catalog.items} locations={catalog.locations} onEditItem={(item) => {
            void navigate(`/manage/items/${encodeURIComponent(item.id)}/edit`);
          }} />
        } />
        <Route path="recycle-bin" element={<ItemsManager catalog={catalog} mode="bin" onChanged={onChanged} />} />
        <Route path="*" element={
          <div className="manager">
            <h3>Catalog page not found</h3>
            <Link to="/manage/items">Return to Items</Link>
          </div>
        } />
      </Routes>
    </section>
  );
}
