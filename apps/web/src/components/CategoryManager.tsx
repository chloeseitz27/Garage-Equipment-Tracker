import { useMemo, useState } from 'react';
import type { Category, Item } from '@garage/shared';

import { createCategory, deleteCategory, updateCategory } from '../api.js';

interface Props {
  categories: Category[];
  items: Item[];
  onChanged: () => void;
}

/** The flat, staff-managed category list used for browsing and filtering. */
export function CategoryManager({ categories, items, onChanged }: Props): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
    return counts;
  }, [items]);

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await action();
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <div className="manager">
      <h3>Categories</h3>
      <p className="muted small">
        Categories are for browsing; tags are for search recall. A category in use can&apos;t be
        deleted until its items are recategorized.
      </p>

      {error ? <p className="error">{error}</p> : null}

      <ul className="flat-list">
        {categories.map((category) => {
          const used = usage.get(category.id) ?? 0;
          return (
            <li key={category.id}>
              {editingId === category.id ? (
                <>
                  <input value={draftName} onChange={(event) => setDraftName(event.target.value)} />
                  <button
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        await updateCategory({ id: category.id, name: draftName.trim() });
                        setEditingId(null);
                      })
                    }
                  >
                    Save
                  </button>
                  <button type="button" className="secondary" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="tree-name">
                    {category.name}
                    <span className="muted small">{used} item(s)</span>
                  </span>
                  <span className="tree-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(category.id);
                        setDraftName(category.name);
                        setError(null);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={used > 0}
                      title={used > 0 ? 'Recategorize its items first' : 'Delete this category'}
                      onClick={() => void run(() => deleteCategory(category.id))}
                    >
                      Delete
                    </button>
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <div className="add-row">
        <input
          placeholder="New category name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <button
          type="button"
          disabled={!newName.trim()}
          onClick={() =>
            void run(async () => {
              await createCategory({ name: newName.trim() });
              setNewName('');
            })
          }
        >
          Add category
        </button>
      </div>
    </div>
  );
}
