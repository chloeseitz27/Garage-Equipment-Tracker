export function ActionIcon({ name }: { name: 'save' | 'delete' | 'edit' | 'add' | 'cancel' | 'refresh' | 'undo' | 'chevron' }): JSX.Element {
  return (
    <svg
      className={`action-icon action-icon-${name}`}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'save' ? (
        <>
          <path d="M4 3h12l5 5v13H3V3z" />
          <path d="M7 3v6h10V4M7 21v-8h10v8" />
        </>
      ) : name === 'delete' ? (
        <>
          <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15" />
          <path d="M10 10v7m4-7v7" />
        </>
      ) : name === 'edit' ? (
        <>
          <path d="M12 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
          <path d="M18.4 2.6a2 2 0 0 1 3 3L12 15l-4 1 1-4Z" />
        </>
      ) : name === 'refresh' ? (
        <>
          <path d="M20 7v5h-5M4 17v-5h5" />
          <path d="M6.3 6.3A8 8 0 0 1 20 12M17.7 17.7A8 8 0 0 1 4 12" />
        </>
      ) : name === 'undo' ? (
        <>
          <path d="m7 6-4 4 4 4" />
          <path d="M3 10h10a6 6 0 0 1 0 12h-3" />
        </>
      ) : name === 'chevron' ? <path d="m9 5 7 7-7 7" /> :
        name === 'cancel' ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M12 5v14M5 12h14" />}
    </svg>
  );
}
