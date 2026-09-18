import type {
  CatalogResponse,
  Category,
  CreateFlagInput,
  CreateItemInput,
  Flag,
  Item,
  Location,
  RecommendResponse,
} from '@garage/shared';

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
};

export const fetchCatalog = (): Promise<CatalogResponse> => request('/api/catalog', {
  cache: 'no-store',
  signal: AbortSignal.timeout(10_000),
});

export const createFlag = (input: CreateFlagInput): Promise<unknown> =>
  request('/api/flags', { method: 'POST', body: JSON.stringify(input) });

export const recommend = (projectDescription: string, signal?: AbortSignal): Promise<RecommendResponse> =>
  request('/api/assistant/recommend', {
    method: 'POST',
    body: JSON.stringify({ projectDescription }),
    signal,
  });

export const getSession = (): Promise<{ staff: boolean }> => request('/api/auth/session');

export const login = (passphrase: string): Promise<{ staff: boolean }> =>
  request('/api/auth/login', { method: 'POST', body: JSON.stringify({ passphrase }) });

export const logout = (): Promise<{ staff: boolean }> =>
  request('/api/auth/logout', { method: 'POST' });

/* --- Staff writes. Every one of these is enforced server-side too. --- */

export const createItem = (input: CreateItemInput): Promise<Item> =>
  request('/api/items', { method: 'POST', body: JSON.stringify(input) });

export const updateItem = (item: Item): Promise<Item> =>
  request(`/api/items/${encodeURIComponent(item.id)}`, {
    method: 'PUT',
    body: JSON.stringify(item),
  });

export const createItemsBulk = (
  items: CreateItemInput[],
): Promise<{ created: number; items: Item[] }> =>
  request('/api/items/bulk', { method: 'POST', body: JSON.stringify({ items }) });

export interface BulkChanges {
  locationId?: string;
  categoryIds?: string[];
  status?: string;
  stockLevel?: string;
}

export const bulkUpdateItems = (
  ids: string[],
  changes: BulkChanges,
): Promise<{ updated: number; items: Item[] }> =>
  request('/api/items/bulk-update', { method: 'POST', body: JSON.stringify({ ids, changes }) });

/** Moves items to or from the recycle bin. Never destroys anything. */
export const bulkRetireItems = (
  ids: string[],
  retired: boolean,
): Promise<{ updated: number; retired: boolean; items: Item[] }> =>
  request('/api/items/bulk-retire', { method: 'POST', body: JSON.stringify({ ids, retired }) });

export const createLocation = (input: Omit<Location, 'id'>): Promise<Location> =>
  request('/api/locations', { method: 'POST', body: JSON.stringify(input) });

export const updateLocation = (location: Location): Promise<Location> =>
  request(`/api/locations/${encodeURIComponent(location.id)}`, {
    method: 'PUT',
    body: JSON.stringify(location),
  });

export const deleteLocation = (id: string): Promise<void> =>
  request(`/api/locations/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const createCategory = (input: Omit<Category, 'id'>): Promise<Category> =>
  request('/api/categories', { method: 'POST', body: JSON.stringify(input) });

export const updateCategory = (category: Category): Promise<Category> =>
  request(`/api/categories/${encodeURIComponent(category.id)}`, {
    method: 'PUT',
    body: JSON.stringify(category),
  });

export const deleteCategory = (id: string): Promise<void> =>
  request(`/api/categories/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const fetchFlags = (): Promise<Flag[]> => request('/api/flags');

export const resolveFlag = (id: string, resolved: boolean): Promise<Flag> =>
  request(`/api/flags/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ resolved }),
  });
