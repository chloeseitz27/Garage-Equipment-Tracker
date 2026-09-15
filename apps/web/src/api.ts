import type {
  CatalogResponse,
  CreateFlagInput,
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

  return (await response.json()) as T;
};

export const fetchCatalog = (): Promise<CatalogResponse> => request('/api/catalog');

export const createFlag = (input: CreateFlagInput): Promise<unknown> =>
  request('/api/flags', { method: 'POST', body: JSON.stringify(input) });

export const recommend = (projectDescription: string): Promise<RecommendResponse> =>
  request('/api/assistant/recommend', {
    method: 'POST',
    body: JSON.stringify({ projectDescription }),
  });

export const getSession = (): Promise<{ staff: boolean }> => request('/api/auth/session');

export const login = (passphrase: string): Promise<{ staff: boolean }> =>
  request('/api/auth/login', { method: 'POST', body: JSON.stringify({ passphrase }) });

export const logout = (): Promise<{ staff: boolean }> =>
  request('/api/auth/logout', { method: 'POST' });
