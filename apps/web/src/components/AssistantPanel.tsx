import { formatLocationPath, type RecommendResponse } from '@garage/shared';

interface Props {
  response: RecommendResponse | null;
  busy: boolean;
  error: string | null;
  onSelectItem: (id: string) => void;
}

/**
 * One-shot, refinable by re-asking (chatbot-spec.md §2). The two tiers are kept
 * visually distinct — an item in "In the Garage" always resolves to a real
 * record with a real location (§3.2).
 */
export function AssistantPanel({ response, busy, error, onSelectItem }: Props): JSX.Element {
  const equipment = response?.garageItems.filter((entry) => entry.kind === 'equipment') ?? [];
  const consumables = response?.garageItems.filter((entry) => entry.kind === 'consumable') ?? [];

  return (
    <div className="assistant">
      <h2>Project suggestions</h2>
      {busy ? <p role="status">Finding tools and materials for your project...</p> : null}
      {!response && !busy && !error ? (
        <p className="muted">Describe your project in the box above, then choose Ask.</p>
      ) : null}

      {error ? <p className="error" role="alert">{error}</p> : null}

      {response ? (
        <div className="recommendation">
          <p className="understood">{response.understoodAs}</p>

          {response.garageItems.length === 0 ? (
            <p>
              The Garage doesn&apos;t appear to have much for this project. Try describing it
              differently, or ask a staff member.
            </p>
          ) : (
            <>
              {[
                ['Equipment in the Garage', equipment] as const,
                ['Materials in the Garage', consumables] as const,
              ].map(([heading, entries]) =>
                entries.length === 0 ? null : (
                  <section key={heading} className="tier in-garage">
                    <h3>{heading}</h3>
                    <ul>
                      {entries.map((entry) => (
                        <li key={entry.id}>
                          <button type="button" onClick={() => onSelectItem(entry.id)}>
                            <strong>{entry.name}</strong>
                            {entry.trainingRequired && entry.trainingRequired !== 'none' ? (
                              <span className="kind kind-safety">{entry.trainingRequired}</span>
                            ) : null}
                            {/* Location comes from the catalog record, never the model. */}
                            <span className="path">{formatLocationPath(entry.locationPath)}</span>
                            <span className="reason">{entry.reason}</span>
                            {entry.safetyNotes ? (
                              <span className="safety-inline">{entry.safetyNotes}</span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ),
              )}
            </>
          )}

          {response.notInGarage.length > 0 ? (
            <section className="tier not-in-garage">
              <h3>Not available here</h3>
              <p className="muted small">
                Useful for this project, but the Garage does not have these. You&apos;ll need to
                bring or buy them.
              </p>
              <ul>
                {response.notInGarage.map((entry) => (
                  <li key={entry.name}>
                    <strong>{entry.name}</strong>
                    <span className="reason">{entry.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
