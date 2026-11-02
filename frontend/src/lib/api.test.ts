import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, buildHeaders, readCookie, toQuery } from './api';

describe('csrf headers', () => {
  it('reads cookies by name', () => {
    expect(readCookie('es_csrf', 'a=1; es_csrf=tok%3D1; b=2')).toBe('tok=1');
    expect(readCookie('missing', 'a=1')).toBeNull();
  });
  it('adds X-CSRF-Token only to unsafe methods', () => {
    expect(buildHeaders('POST', {}, 'es_csrf=abc')['X-CSRF-Token']).toBe('abc');
    expect(buildHeaders('DELETE', undefined, 'es_csrf=abc')['X-CSRF-Token']).toBe('abc');
    expect(buildHeaders('GET', undefined, 'es_csrf=abc')['X-CSRF-Token']).toBeUndefined();
  });
  it('sends the token on a real fetch call', async () => {
    document.cookie = 'es_csrf=xyz';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await api('/channels/1/reconnect', { method: 'POST' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/channels/1/reconnect');
    expect(init.headers['X-CSRF-Token']).toBe('xyz');
    expect(init.credentials).toBe('same-origin');
  });
  it('builds query strings skipping empties', () => {
    expect(toQuery({ a: 1, b: '', c: undefined, d: 'x y' })).toBe('a=1&d=x+y');
  });
});
afterEach(() => vi.unstubAllGlobals());
