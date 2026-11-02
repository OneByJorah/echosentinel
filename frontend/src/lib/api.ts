// Thin fetch wrapper: cookies + CSRF double-submit + typed errors.

export const API = '/api/v1';

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export function readCookie(name: string, cookieString: string = typeof document !== 'undefined' ? document.cookie : ''): string | null {
  for (const part of cookieString.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function buildHeaders(method: string, body: unknown, cookieString?: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined && !(body instanceof FormData)) h['Content-Type'] = 'application/json';
  if (!SAFE.has(method.toUpperCase())) {
    const token = readCookie('es_csrf', cookieString);
    if (token) h['X-CSRF-Token'] = token;
  }
  return h;
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export function onUnauthorized(fn: Listener) {
  unauthorizedListeners.add(fn);
  return () => {
    unauthorizedListeners.delete(fn);
  };
}

function errorMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const d = (payload as { detail: unknown }).detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d) && d.length && typeof d[0] === 'object' && d[0] && 'msg' in d[0]) return String((d[0] as { msg: unknown }).msg);
  }
  if (status === 403) return 'Your role does not allow this action.';
  if (status === 429) return 'Too many attempts. Wait a moment and try again.';
  return `Request failed (${status})`;
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; query?: Record<string, unknown>; signal?: AbortSignal } = {}): Promise<T> {
  const method = (opts.method ?? 'GET').toUpperCase();
  let url = path.startsWith('/api') ? path : `${API}${path}`;
  if (opts.query) {
    const qs = toQuery(opts.query);
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: buildHeaders(method, opts.body),
    body: opts.body === undefined ? undefined : opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body),
    signal: opts.signal,
  });
  const ct = res.headers.get('content-type') ?? '';
  const payload = ct.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 401 && !path.includes('/auth/login')) unauthorizedListeners.forEach((f) => f());
    throw new ApiError(res.status, errorMessage(res.status, payload), payload);
  }
  return payload as T;
}

export function toQuery(q: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  return p.toString();
}

/** Download a binary response (POST/GET) honoring CSRF and saving via an object URL. */
export async function download(path: string, opts: { method?: string; body?: unknown; filename: string }): Promise<Response> {
  const method = (opts.method ?? 'GET').toUpperCase();
  const res = await fetch(path.startsWith('/api') ? path : `${API}${path}`, {
    method,
    credentials: 'same-origin',
    headers: buildHeaders(method, opts.body),
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new ApiError(res.status, errorMessage(res.status, payload), payload);
  }
  const blob = await res.clone().blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = opts.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return res;
}

export function wsUrl(path: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}
