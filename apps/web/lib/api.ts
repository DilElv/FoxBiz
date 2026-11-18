export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function api<T>(path: string, options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, { method: options.method ?? 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}), signal: options.signal });
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('auth/login') && typeof window !== 'undefined') window.location.assign('/login');
    const message = body.error?.message;
    throw new ApiError(response.status, Array.isArray(message) ? message.join(' · ') : message ?? 'Permintaan gagal.');
  }
  return body as T;
}
export async function apiUpload<T>(path: string, body: FormData): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, { method: 'POST', body, credentials: 'same-origin', cache: 'no-store' });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') window.location.assign('/login');
    const message = result?.error?.message;
    throw new ApiError(response.status, Array.isArray(message) ? message.join(' · ') : message ?? 'Permintaan gagal.');
  }
  return result as T;
}
export type CurrentUser = { id: string; tenantId: string; tenantName: string; name: string; email: string; role: { id: string; code: string; name: string } | null; permissions: string[]; allOutlets: boolean; outletIds: string[] };
export type Outlet = { id: string; name: string; code: string; address?: string; status?: string };
