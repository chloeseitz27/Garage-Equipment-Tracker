export function ActionIcon({ name }: { name: 'save' | 'delete' }): JSX.Element {
  return (
    <svg
      className="action-icon"
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
      ) : (
        <>
          <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15" />
          <path d="M10 10v7m4-7v7" />
        </>
      )}
    </svg>
  );
}
