import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { formatLocationPath, getLocationPath, searchLocations, type Location } from '@garage/shared';
import { LocationMapDialog } from './LocationMapDialog.js';

interface CommonProps {
  locations: Location[];
  excludedIds?: readonly string[];
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  showMapButton?: boolean;
}

type Props = CommonProps & (
  | { allowRoot: true; value: string | null; onSelect: (locationId: string | null) => void }
  | { allowRoot?: false; value?: string; onSelect: (locationId: string) => void }
);

interface PickerOption {
  id: string | null;
  label: string;
  kind?: Location['kind'];
}

const ROOT_LABEL = 'Top level (no parent)';

export function LocationPicker(props: Props): JSX.Element {
  const {
    locations,
    excludedIds,
    value,
    disabled = false,
    placeholder = 'Search locations…',
    label = 'Location',
    showMapButton = true,
  } = props;
  // Search text is a draft. Only choosing an option changes the caller's value.
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mapButtonRef = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const listId = `${inputId}-options`;

  const selectedLabel = useMemo(() => {
    if (value === null && props.allowRoot) return ROOT_LABEL;
    return value ? formatLocationPath(getLocationPath(locations, value)) : '';
  }, [locations, value, props.allowRoot]);

  const matches = useMemo((): PickerOption[] => {
    // Build breadcrumbs before filtering, and keep every match reachable by scrolling.
    const results: PickerOption[] = searchLocations(locations, query ?? '', locations.length)
      .filter((option) => !excludedIds?.includes(option.id));
    const tokens = (query ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const rootWords = ['top', 'level', 'no', 'parent'];
    if (props.allowRoot && tokens.every((token) => rootWords.some((word) => word.startsWith(token)))) {
      results.unshift({ id: null, label: ROOT_LABEL });
    }
    return results;
  }, [locations, query, excludedIds, props.allowRoot]);

  const expanded = open && !disabled;
  const activeIndex = Math.min(Math.max(highlight, 0), matches.length - 1);
  const activeId = expanded && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined;

  const close = (): void => {
    setOpen(false);
    setQuery(null);
  };

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setQuery(null);
    }
    if (disabled || !showMapButton) setMapOpen(false);
  }, [disabled, showMapButton]);

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const choose = (locationId: string | null): void => {
    if (disabled) return;
    if (props.allowRoot) props.onSelect(locationId);
    else if (locationId !== null) props.onSelect(locationId);
    close();
  };

  const closeMap = (): void => {
    setMapOpen(false);
    mapButtonRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (disabled || event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlight(expanded ? Math.min(activeIndex + 1, matches.length - 1) : 0);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setHighlight(expanded ? Math.max(activeIndex - 1, 0) : matches.length - 1);
      return;
    }
    if (event.key === 'Enter' && expanded) {
      event.preventDefault();
      const picked = matches[activeIndex];
      if (picked) choose(picked.id);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  return (
    <div
      className="location-picker"
      ref={containerRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <div className="location-picker-heading">
        <label className="picker-label" htmlFor={inputId}>{label}</label>
        {showMapButton ? (
          <button
            ref={mapButtonRef}
            type="button"
            className="location-map-trigger"
            aria-label={`${label}: choose on map`}
            aria-haspopup="dialog"
            aria-expanded={mapOpen && !disabled}
            disabled={disabled}
            onClick={() => { close(); setMapOpen(true); }}
          >Choose on map</button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={query ?? selectedLabel}
        placeholder={placeholder}
        onFocus={(event) => {
          setOpen(true);
          setHighlight(Math.max(0, matches.findIndex((option) => option.id === value)));
          event.currentTarget.select();
        }}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />

      {expanded ? (
        <ul className="picker-results" id={listId} role="listbox" aria-label={label}>
          {matches.length === 0 ? (
            <li className="picker-empty" role="presentation">
              <span role="status">No location matches “{query}”.</span>
            </li>
          ) : (
            matches.map((option, index) => (
              <li key={option.id ?? 'root'} role="presentation">
                <button
                  id={`${listId}-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={option.id === value}
                  className={index === activeIndex ? 'highlighted' : ''}
                  // Keep keyboard focus on the combobox while clicking an option.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option.id)}
                  onMouseEnter={() => setHighlight(index)}
                >
                  <span className="picker-path">{option.label}</span>
                  {option.kind ? <span className="kind">{option.kind}</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
      {showMapButton && mapOpen && !disabled ? (
        <LocationMapDialog
          label={label}
          locations={locations}
          excludedIds={excludedIds}
          selectedIds={value ? [value] : []}
          rootSelected={props.allowRoot && value === null}
          onSelect={(id) => { closeMap(); choose(id); }}
          onSelectRoot={props.allowRoot ? () => { closeMap(); choose(null); } : undefined}
          onClose={closeMap}
          onSearch={() => {
            setMapOpen(false);
            inputRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
