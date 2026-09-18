import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

export interface FilterOption {
  value: string;
  label: string;
}

interface Props {
  label: string;
  emptyLabel: string;
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  hint?: string;
}

export function MultiSelectFilter({
  label, emptyLabel, options, selected, onChange, disabled = false, hint,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const expanded = open && !disabled;
  const matches = useMemo(() => {
    const tokens = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    return options.filter((option) => {
      const words = option.label.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      return tokens.every((token) => words.some((word) => word.startsWith(token)));
    });
  }, [options, query]);
  const summary = selected.length === 0 ? emptyLabel :
    selected.length === 1 ? options.find((option) => option.value === selected[0])?.label ?? '1 selected' :
      `${selected.length} selected`;

  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!expanded || !buttonRef.current) return;
    const updatePosition = (): void => {
      if (!buttonRef.current) return;
      const bounds = buttonRef.current.getBoundingClientRect();
      if (bounds.bottom < 0 || bounds.top > window.innerHeight ||
          bounds.right < 0 || bounds.left > window.innerWidth) {
        setOpen(false);
        return;
      }
      const width = Math.min(Math.max(bounds.width, 280), window.innerWidth - 16);
      const below = window.innerHeight - bounds.bottom - 8;
      const above = bounds.top - 8;
      const placeBelow = below >= 240 || below >= above;
      setPosition({
        width,
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
        ...(placeBelow ? { top: bounds.bottom + 4 } : { bottom: window.innerHeight - bounds.top + 4 }),
        maxHeight: Math.max(100, Math.min(420, (placeBelow ? below : above) - 4)),
      });
    };
    const scroll = (event: Event): void => {
      if (!(event.target instanceof Node) || !panelRef.current?.contains(event.target)) updatePosition();
    };
    updatePosition();
    searchRef.current?.focus({ preventScroll: true });
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [expanded]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!expanded) return;
    const outside = (event: Event): void => {
      if (event.target instanceof Node &&
          !panelRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [expanded]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="multi-filter-trigger"
        aria-label={`Filter by ${label}`}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        disabled={disabled}
        title={selected.length ? options.filter((option) => selected.includes(option.value)).map((o) => o.label).join(', ') : emptyLabel}
        onClick={() => {
          setQuery('');
          setOpen((current) => !current);
        }}
      >
        <span>{summary}</span><span aria-hidden="true">{'\u25be'}</span>
      </button>
      {/* The top-level portal keeps the popup outside the table's scrolling/clipping area. */}
      {expanded ? createPortal(
        <div
          id={panelId}
          ref={panelRef}
          role="dialog"
          aria-label={`Filter by ${label}`}
          className="multi-filter-panel"
          style={position}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <input
            ref={searchRef}
            type="search"
            aria-label={`Search ${label} options`}
            placeholder="Search options…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {hint ? <p className="hint">{hint}</p> : null}
          <div className="multi-filter-options" role="group" aria-label={`${label} options`}>
            {matches.length === 0 ? <p role="status">No matching options.</p> : matches.map((option) => (
              <button
                key={option.value}
                type="button"
                value={option.value}
                aria-pressed={selected.includes(option.value)}
                onClick={() => onChange(selected.includes(option.value)
                  ? selected.filter((value) => value !== option.value)
                  : [...selected, option.value])}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="multi-filter-actions">
            <span>{selected.length} selected</span>
            <button type="button" disabled={selected.length === 0} onClick={() => onChange([])}>Clear filter</button>
            <button type="button" onClick={close}>Done</button>
          </div>
        </div>, document.body,
      ) : null}
    </>
  );
}
