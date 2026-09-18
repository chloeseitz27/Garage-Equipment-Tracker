export function ActionIcon({ name }: { name: 'save' | 'delete' | 'edit' | 'add' }): JSX.Element {
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
          <path d="m10 13 8-9a2.1 2.1 0 0 1 3 3l-9 8Z" />
          <path d="M10 13c-3-1-5 1-5 4 0 2-2 3-2 3s6 2 8-1c1-1 2-3 1-4" />
        </>
      ) : <path d="M12 5v14M5 12h14" />}
    </svg>
  );
}
