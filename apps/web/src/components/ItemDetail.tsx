import { useState } from 'react';
import { PATH_SEPARATOR, resolveLocationMap, type FlagType, type Location } from '@garage/shared';

import { createFlag } from '../api.js';
import type { SearchRecord } from '../search.js';
import { ActionIcon } from './ActionIcon.js';
import { RoomMap } from './RoomMap.js';

interface Props {
  record: SearchRecord;
  onClose: () => void;
  /** Only supplied when a staff session is active. */
  onEdit?: () => void;
  locations?: Location[];
}

export function ItemDetail({ record, onClose, onEdit, locations = record.locationPath }: Props): JSX.Element {
  const { item, categoryName, locationPath } = record;
  const [flagged, setFlagged] = useState<string | null>(null);
  const mapped = resolveLocationMap(locations, item.locationId);

  const flag = async (type: FlagType): Promise<void> => {
    try {
      await createFlag({ itemId: item.id, type });
      setFlagged('Thanks — staff will take a look.');
    } catch {
      setFlagged('Could not send that report.');
    }
  };

  return (
    <article className="item-detail">
      <button type="button" className="close" onClick={onClose}>
        Close
      </button>
      {onEdit ? (
        <button
          type="button"
          className="close icon-button"
          aria-label={`Edit ${item.name}`}
          title={`Edit ${item.name}`}
          onClick={onEdit}
        >
          <ActionIcon name="edit" />
        </button>
      ) : null}

      <h2>{item.name}</h2>
      <p className="muted">
        {categoryName} · {item.kind}
        {item.kind === 'equipment'
          ? ` · ${item.status}${item.quantity > 1 ? ` · ${item.quantity} available` : ''}`
          : ` · ${item.stockLevel}`}
      </p>

      {/* The breadcrumb is prominent and legible from a step back (product-spec.md §6.3). */}
      <div className="breadcrumb">{locationPath.map((node) => node.name).join(PATH_SEPARATOR)}</div>
      {mapped ? (
        <>
          <RoomMap room={mapped.room} locations={locations} selectedLocationId={item.locationId} />
          {mapped.marker?.location.id !== item.locationId ? (
            <p className="muted small">{mapped.marker ? `Shown at ${mapped.marker.location.name}; this item's exact location is not marked.` : 'Room shown; this location has no marker yet.'}</p>
          ) : null}
        </>
      ) : null}

      {item.description ? <p>{item.description}</p> : null}

      {item.kind === 'equipment' && item.trainingRequired !== 'none' ? (
        <p className="training">Training required: {item.trainingRequired}</p>
      ) : null}

      {/* Verbatim from the catalog record. Never generated (chatbot-spec.md §5). */}
      {item.safetyNotes ? (
        <div className="safety">
          <h3>Safety</h3>
          <p>{item.safetyNotes}</p>
        </div>
      ) : null}

      {item.notes ? <p className="notes">{item.notes}</p> : null}

      {item.tags.length > 0 ? (
        <p className="muted small">Also called: {item.tags.join(', ')}</p>
      ) : null}

      <div className="flags">
        {flagged ? (
          <p className="muted">{flagged}</p>
        ) : (
          <>
            <button type="button" onClick={() => void flag('not-here')}>
              Not here
            </button>
            {item.kind === 'consumable' ? (
              <>
                <button type="button" onClick={() => void flag('low')}>
                  Running low
                </button>
                <button type="button" onClick={() => void flag('out')}>
                  Out
                </button>
              </>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}
