import type { SearchRecord } from '../search.js';

interface Props {
  records: SearchRecord[];
  query: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Every row shows the location path. A result that doesn't show where the thing
 * is has failed (product-spec.md §6.1).
 */
export function SearchResults({ records, query, selectedId, onSelect }: Props): JSX.Element {
  if (records.length === 0) {
    return (
      <div className="empty">
        <h2>Nothing matches “{query}”.</h2>
        <p>
          The Garage may simply not have it. Try a broader word, or browse a category above — the
          Project Assistant can also suggest items when you don&apos;t know what to search for.
        </p>
      </div>
    );
  }

  return (
    <ul className="results">
      {records.map((record) => (
        <li key={record.item.id}>
          <button
            type="button"
            className={record.item.id === selectedId ? 'result selected' : 'result'}
            onClick={() => onSelect(record.item.id)}
          >
            <span className="thumb" aria-hidden="true">
              {record.item.photoUrl ? <img src={record.item.photoUrl} alt="" /> : null}
            </span>
            <span className="result-body">
              <span className="result-name">
                {record.item.name}
                <span className={`kind kind-${record.item.kind}`}>{record.item.kind}</span>
                {record.item.safetyNotes ? <span className="kind kind-safety">safety</span> : null}
              </span>
              <span className="path">{record.locationText}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
