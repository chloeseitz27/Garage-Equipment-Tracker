import { createContext, useContext, useEffect, useId } from 'react';

export const CatalogDraftContext = createContext<((id: string, dirty: boolean) => void) | null>(null);

/** Keep automatic catalog refreshes from replacing any active management form. */
export function useCatalogDraft(dirty: boolean): void {
  const id = useId();
  const report = useContext(CatalogDraftContext);
  useEffect(() => { report?.(id, dirty); }, [id, dirty, report]);
  useEffect(() => () => report?.(id, false), [id, report]);
}
