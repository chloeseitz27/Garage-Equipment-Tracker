import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatLocationPath, getLocationPath, type Flag, type Item, type Location } from '@garage/shared';

import { fetchFlags, resolveFlag } from '../api.js';

interface Props {
  items: Item[];
  locations: Location[];
  onEditItem: (item: Item) => void;
}

const LABELS: Record<Flag['type'], string> = {
  'not-here': 'Not in the stated location',
  low: 'Running low',
  out: 'Out',
};

/**
 * The flag queue (product-spec.md §6.4, §6.5).
 *
 * Reports never mutated the item record, so working the queue means deciding
 * what to do: correct the item, or dismiss the report. Both end in resolving it.
 */
export function FlagQueue({ items, locations, onEditItem }: Props): JSX.Element {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [params, setParams] = useSearchParams();
  const showResolved = params.get('resolved') === '1';
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    fetchFlags()
      .then(setFlags)
      .catch((cause: Error) => setError(cause.message));
  };

  useEffect(load, []);

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const visible = flags.filter((flag) => (showResolved ? true : !flag.resolved));
  const openCount = flags.filter((flag) => !flag.resolved).length;

  const setResolved = async (flag: Flag, resolved: boolean): Promise<void> => {
    setError(null);
    try {
      await resolveFlag(flag.id, resolved);
      load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <div className="manager">
      <h3>
        Flag queue{' '}
        {openCount > 0 ? <span className="badge">{openCount} open</span> : <span className="muted">— all clear</span>}
      </h3>
      <p className="muted small">
        Anonymous reports from the kiosk. They don&apos;t change the item — fix the record, then
        resolve the report.
      </p>

      <label className="inline-check">
        <input
          type="checkbox"
          checked={showResolved}
          onChange={(event) => {
            const checked = event.target.checked;
            setParams((current) => {
              const next = new URLSearchParams(current);
              if (checked) next.set('resolved', '1');
              else next.delete('resolved');
              return next;
            });
          }}
        />
        Show resolved
      </label>

      {error ? <p className="error">{error}</p> : null}

      {visible.length === 0 ? (
        <p className="muted">Nothing in the queue.</p>
      ) : (
        <ul className="flat-list">
          {visible.map((flag) => {
            const item = itemsById.get(flag.itemId);
            return (
              <li key={flag.id} className={flag.resolved ? 'resolved' : ''}>
                <span className="tree-name">
                  {item?.name ?? flag.itemId}
                  <span className="kind kind-safety">{LABELS[flag.type]}</span>
                  <span className="muted small">
                    {new Date(flag.createdAt).toLocaleString()}
                    {item ? ` · ${formatLocationPath(getLocationPath(locations, item.locationId))}` : ''}
                  </span>
                </span>
                <span className="tree-actions">
                  {item ? (
                    <button type="button" onClick={() => onEditItem(item)}>
                      Fix item
                    </button>
                  ) : null}
                  <button type="button" onClick={() => void setResolved(flag, !flag.resolved)}>
                    {flag.resolved ? 'Reopen' : 'Resolve'}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
