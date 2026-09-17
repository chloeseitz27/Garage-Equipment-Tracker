import { useEffect, useMemo, useRef, useState } from 'react';
import { searchLocations, type Location } from '@garage/shared';

interface Props {
  locations: Location[];
  onSelect: (locationId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Shown above the input; also labels the field for screen readers. */
  label?: string;
}

/**
 * Type-to-find location picker.
 *
 * Matching runs over the full breadcrumb rather than the node name, so staff can
 * type any part of the path — "electronics", "cabinet b", or "bin b3" all reach
 * the same bin without knowing which room it's in.
 *
 * Fully keyboard operable, per the accessibility requirement in
 * product-spec.md §7: arrows move the highlight, Enter picks, Escape closes.
 */
export function LocationPicker({
  locations,
  onSelect,
  disabled = false,
  placeholder = 'Search locations…',
  label,
}: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => searchLocations(locations, query), [locations, query]);

  useEffect(() => setHighlight(0), [query]);

  // Close when focus or a click leaves the widget entirely.
  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const choose = (locationId: string): void => {
    onSelect(locationId);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlight((current) => Math.min(current + 1, matches.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const picked = matches[highlight];
      if (picked) choose(picked.id);
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="location-picker" ref={containerRef}>
      {label ? <span className="picker-label">{label}</span> : null}

      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label={label ?? 'Search locations'}
        autoComplete="off"
        disabled={disabled}
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />

      {open && !disabled ? (
        <ul className="picker-results" role="listbox">
          {matches.length === 0 ? (
            <li className="picker-empty">No location matches “{query}”.</li>
          ) : (
            matches.map((option, index) => (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlight}
                  className={index === highlight ? 'highlighted' : ''}
                  // mousedown fires before the input's blur, so the click isn't
                  // swallowed by the list closing first.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(option.id);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                >
                  <span className="picker-path">{option.label}</span>
                  <span className="kind">{option.kind}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
