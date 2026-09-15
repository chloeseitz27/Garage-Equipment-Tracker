import { useEffect, useState } from 'react';

import { getSession, login, logout } from '../api.js';

/**
 * Staff sign-in. Edit affordances are hidden when unauthenticated rather than
 * shown-and-disabled (product-spec.md §4) — so this bar reveals staff UI only
 * once `staff` is true.
 */
export function StaffBar(): JSX.Element {
  const [staff, setStaff] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [prompting, setPrompting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSession()
      .then((session) => setStaff(session.staff))
      .catch(() => setStaff(false));
  }, []);

  const signIn = async (): Promise<void> => {
    try {
      const session = await login(passphrase);
      setStaff(session.staff);
      setPassphrase('');
      setPrompting(false);
      setError(null);
    } catch {
      setError('Incorrect passphrase');
    }
  };

  if (staff) {
    return (
      <div className="staff-bar">
        <span className="staff-badge">Staff</span>
        <button
          type="button"
          onClick={() => {
            void logout().then(() => setStaff(false));
          }}
        >
          Sign out
        </button>
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
          {error ? <span className="error">{error}</span> : null}
        </>
      ) : (
        <button type="button" onClick={() => setPrompting(true)}>
          Staff sign in
        </button>
      )}
    </div>
  );
}
