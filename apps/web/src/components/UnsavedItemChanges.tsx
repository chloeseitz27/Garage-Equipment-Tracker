import { createContext, useContext, useEffect, useId, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

export const ItemDraftContext = createContext<((dirty: boolean) => void) | null>(null);

export function useItemDraftGuard(dirty: boolean, options: { allowSearchChanges?: boolean } = {}) {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const reportDirty = useContext(ItemDraftContext);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    dirtyRef.current && (
      currentLocation.pathname !== nextLocation.pathname ||
      (!options.allowSearchChanges && currentLocation.search !== nextLocation.search) ||
      currentLocation.hash !== nextLocation.hash
    ),
  );

  useEffect(() => { reportDirty?.(dirty); }, [dirty, reportDirty]);
  useEffect(() => () => reportDirty?.(false), [reportDirty]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  const markSaved = (): void => {
    // onSaved navigates immediately, before React commits the new form baseline.
    dirtyRef.current = false;
    reportDirty?.(false);
  };
  return { blocker, dirtyRef, markSaved };
}

interface Props {
  busy: boolean;
  onStay: () => void;
  onLeave: () => void;
  subject?: string;
}

export function UnsavedItemDialog({ busy, onStay, onLeave, subject = 'item' }: Props): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    stayRef.current?.focus();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="unsaved-dialog"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); onStay(); }}
    >
      <h2 id={titleId}>Unsaved changes</h2>
      <p id={descriptionId}>
        {busy ? `Your ${subject} is still being saved. Please wait before leaving.` :
          `This ${subject} has unsaved changes. Leaving this page will discard them.`}
      </p>
      <div className="editor-actions">
        <button ref={stayRef} type="button" onClick={onStay}>Stay on page</button>
        <button type="button" className="discard" disabled={busy} onClick={onLeave}>Discard changes</button>
      </div>
    </dialog>
  );
}
