import { useState } from 'react';

import { ApiError, login, logout } from '../api.js';

const CONNECTION_ERROR = 'Could not connect to the API. Check that the server is running and try again.';

/** Only a 401 means a wrong passphrase; network failures, timeouts, and 5xx proxy errors are outages. */
export function signInError(cause: unknown): string {
  if (!(cause instanceof ApiError)) return CONNECTION_ERROR;
  if (cause.status === 401) return 'Incorrect passphrase';
  if (cause.status >= 500) return CONNECTION_ERROR;
  return cause.message;
}

interface Props {
  staff: boolean;
  onChange: (staff: boolean) => void;
  beforeSignOut?: () => boolean;
}

/**
 * Staff sign-in. Edit affordances are hidden when unauthenticated rather than
 * shown-and-disabled (product-spec.md §4), so this bar is the only staff UI a
 * visitor ever sees.
 */
export function StaffBar({ staff, onChange, beforeSignOut }: Props): JSX.Element {
  const [passphrase, setPassphrase] = useState('');
  const [prompting, setPrompting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async (): Promise<void> => {
    try {
      const session = await login(passphrase);
      onChange(session.staff);
      setPassphrase('');
      setPrompting(false);
      setError(null);
    } catch (cause) {
      setError(signInError(cause));
    }
  };

  const signOut = async (): Promise<void> => {
    if (beforeSignOut && !beforeSignOut()) return;
    setError(null);
    try {
      await logout();
      onChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign out.');
    }
  };

  if (staff) {
    return (
      <div className="staff-bar">
        <span className="staff-badge">Staff</span>
        <button
          type="button"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
        {error ? <span className="error" role="alert">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="staff-bar">
      {prompting ? (
        <>
          <input
            type="password"
            value={passphrase}
            placeholder="Staff passphrase"
            onChange={(event) => setPassphrase(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void signIn();
            }}
          />
          <button type="button" onClick={() => void signIn()}>
            Sign in
          </button>
          {error ? <span className="error" role="alert">{error}</span> : null}
        </>
      ) : (
        <button type="button" onClick={() => setPrompting(true)}>
          Staff sign in
        </button>
      )}
    </div>
  );
}
