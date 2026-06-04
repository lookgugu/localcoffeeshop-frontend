/**
 * Unit Tests: ApiClient
 *
 * Covers the contracts spelled out in tasks/todo.md candidate #4:
 *   - Envelope unwrap: 2xx + {success: true, data} → returns data
 *   - Retry on 5xx / 429 / network errors / timeouts; 4xx never retried
 *   - SAFETY: synchronous ApiUsageError when a write specifies retries > 0
 *     without an idempotencyKey (assert via fetch spy that fetch was not called)
 *   - Per-attempt timeout via AbortController; ApiTimeoutError thrown
 *   - Base URL resolved from window.APP_CONFIG.API_BASE_URL
 *   - Caller-provided AbortSignal aborts the request
 *
 * The module is UMD-style; Vite's CJS interop gives us the same object that
 * gets assigned to window.ApiClient in the browser via the default import.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../helpers/mockApi.js';
import api from '../../public/api-client.js';

const { errors } = api;
const {
  ApiUsageError,
  ApiTimeoutError,
  ApiNetworkError,
  ApiAbortedError,
  ApiHttpError,
  ApiEnvelopeError,
  ApiParseError,
} = errors;

// Reset the base URL after each test that mutates window.APP_CONFIG.
afterEach(() => {
  delete window.APP_CONFIG;
  api._resetBaseUrl();
});

describe('ApiClient — envelope unwrap', () => {
  it('returns just the data field on 2xx + {success: true, data}', async () => {
    server.use(
      http.get('*/api/v1/test-envelope', () => {
        return HttpResponse.json({
          success: true,
          data: { hello: 'world', n: 42 },
        });
      })
    );

    const result = await api.get('/test-envelope');
    expect(result).toEqual({ hello: 'world', n: 42 });
  });

  it('throws ApiEnvelopeError on 2xx + {success: false}', async () => {
    server.use(
      http.get('*/api/v1/envelope-fail', () => {
        return HttpResponse.json({
          success: false,
          error: { message: 'Server rejected the request' },
        });
      })
    );

    await expect(api.get('/envelope-fail')).rejects.toThrow(ApiEnvelopeError);
    await expect(api.get('/envelope-fail')).rejects.toMatchObject({
      name: 'ApiEnvelopeError',
      message: 'Server rejected the request',
    });
  });

  it('throws ApiParseError when body is not JSON', async () => {
    server.use(
      http.get('*/api/v1/not-json', () => {
        return new HttpResponse('<html>not json</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      })
    );

    await expect(api.get('/not-json')).rejects.toThrow(ApiParseError);
  });

  it('throws ApiParseError when JSON lacks envelope shape', async () => {
    server.use(
      http.get('*/api/v1/no-envelope', () => {
        return HttpResponse.json([1, 2, 3]); // array, no `success` key
      })
    );

    await expect(api.get('/no-envelope')).rejects.toThrow(ApiParseError);
  });
});

describe('ApiClient — retry semantics', () => {
  it('retries on 5xx and succeeds on the Nth attempt', async () => {
    let attempts = 0;
    server.use(
      http.get('*/api/v1/flaky', () => {
        attempts++;
        if (attempts < 3) {
          return HttpResponse.json({ error: 'oops' }, { status: 500 });
        }
        return HttpResponse.json({ success: true, data: { ok: true } });
      })
    );

    const result = await api.get('/flaky', { retries: 3 });
    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(3);
  });

  it('gives up after the configured retry count and throws ApiHttpError', async () => {
    let attempts = 0;
    server.use(
      http.get('*/api/v1/always-500', () => {
        attempts++;
        return HttpResponse.json({ error: 'down' }, { status: 500 });
      })
    );

    const promise = api.get('/always-500', { retries: 2 });
    await expect(promise).rejects.toThrow(ApiHttpError);
    await expect(api.get('/always-500', { retries: 2 })).rejects.toMatchObject({
      name: 'ApiHttpError',
      status: 500,
    });
    // First call attempted 3 times (1 initial + 2 retries); second call same.
    expect(attempts).toBe(6);
  });

  it('does NOT retry on 4xx', async () => {
    let attempts = 0;
    server.use(
      http.get('*/api/v1/bad-request', () => {
        attempts++;
        return HttpResponse.json({ error: 'nope' }, { status: 400 });
      })
    );

    await expect(api.get('/bad-request', { retries: 5 })).rejects.toMatchObject({
      name: 'ApiHttpError',
      status: 400,
    });
    expect(attempts).toBe(1);
  });

  it('retries on 429', async () => {
    let attempts = 0;
    server.use(
      http.get('*/api/v1/rate-limited-once', () => {
        attempts++;
        if (attempts === 1) {
          return HttpResponse.json({ error: 'too many' }, { status: 429 });
        }
        return HttpResponse.json({ success: true, data: 'ok' });
      })
    );

    const result = await api.get('/rate-limited-once', { retries: 1 });
    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('retries on network failure (MSW HttpResponse.error)', async () => {
    let attempts = 0;
    server.use(
      http.get('*/api/v1/net-fail-once', () => {
        attempts++;
        if (attempts === 1) return HttpResponse.error();
        return HttpResponse.json({ success: true, data: 'recovered' });
      })
    );

    const result = await api.get('/net-fail-once', { retries: 1 });
    expect(result).toBe('recovered');
    expect(attempts).toBe(2);
  });

  it('throws ApiNetworkError after exhausting retries on network failure', async () => {
    server.use(
      http.get('*/api/v1/always-net-fail', () => HttpResponse.error())
    );

    await expect(api.get('/always-net-fail', { retries: 1 })).rejects.toThrow(ApiNetworkError);
  });
});

describe('ApiClient — SAFETY: synchronous ApiUsageError for unsafe writes', () => {
  let fetchSpy;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('throws SYNCHRONOUSLY for POST with retries > 0 and no idempotencyKey', () => {
    // NOT awaited — must throw on the synchronous call itself.
    expect(() => api.post('/coffee-shops', { name: 'X' }, { retries: 3 }))
      .toThrow(ApiUsageError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws SYNCHRONOUSLY for PUT with retries > 0 and no idempotencyKey', () => {
    expect(() => api.put('/coffee-shops/1', { name: 'X' }, { retries: 2 }))
      .toThrow(ApiUsageError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws SYNCHRONOUSLY for DELETE with retries > 0 and no idempotencyKey', () => {
    expect(() => api.delete('/coffee-shops/1', { retries: 1 }))
      .toThrow(ApiUsageError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows POST with retries > 0 when idempotencyKey IS provided', async () => {
    server.use(
      http.post('*/api/v1/coffee-shops', async ({ request }) => {
        expect(request.headers.get('Idempotency-Key')).toBe('test-key-123');
        return HttpResponse.json({ success: true, data: { id: 'new-1' } });
      })
    );

    const result = await api.post('/coffee-shops', { name: 'X' }, {
      retries: 3,
      idempotencyKey: 'test-key-123',
    });
    expect(result).toEqual({ id: 'new-1' });
  });

  it('allows POST with retries: 0 and no idempotencyKey (default for writes)', async () => {
    server.use(
      http.post('*/api/v1/no-retry-write', () => {
        return HttpResponse.json({ success: true, data: 'ok' });
      })
    );

    const result = await api.post('/no-retry-write', { x: 1 });
    expect(result).toBe('ok');
  });

  it('allows DELETE with retries: 0 and no idempotencyKey', async () => {
    server.use(
      http.delete('*/api/v1/thing/1', () => {
        return HttpResponse.json({ success: true, data: null });
      })
    );

    await expect(api.delete('/thing/1')).resolves.toBe(null);
  });
});

describe('ApiClient — timeout and abort', () => {
  it('throws ApiTimeoutError when server is slower than opts.timeout', async () => {
    server.use(
      http.get('*/api/v1/slow', async () => {
        await delay(500);
        return HttpResponse.json({ success: true, data: 'late' });
      })
    );

    await expect(api.get('/slow', { timeout: 50, retries: 0 }))
      .rejects.toThrow(ApiTimeoutError);
  });

  it('aborts when caller-supplied AbortSignal fires and surfaces ApiAbortedError', async () => {
    server.use(
      http.get('*/api/v1/long', async () => {
        await delay(500);
        return HttpResponse.json({ success: true, data: 'late' });
      })
    );

    const controller = new AbortController();
    const promise = api.get('/long', { signal: controller.signal, retries: 0 });
    setTimeout(() => controller.abort(), 20);

    await expect(promise).rejects.toThrow(ApiAbortedError);
  });

  it('does NOT retry after caller abort, even when retries are configured', async () => {
    let attempts = 0;
    server.use(
      http.get('*/api/v1/abort-no-retry', async () => {
        attempts++;
        await delay(500);
        return HttpResponse.json({ success: true, data: 'late' });
      })
    );

    const controller = new AbortController();
    const promise = api.get('/abort-no-retry', { signal: controller.signal, retries: 5 });
    setTimeout(() => controller.abort(), 20);

    await expect(promise).rejects.toThrow(ApiAbortedError);
    // Tiny grace window for any (incorrect) retry attempt to fire.
    await new Promise(r => setTimeout(r, 100));
    expect(attempts).toBe(1);
  });

  it('distinguishes ApiAbortedError from ApiNetworkError (caller abort vs offline)', async () => {
    // Network failure path — still surfaces as ApiNetworkError.
    server.use(http.get('*/api/v1/net-down', () => HttpResponse.error()));
    await expect(api.get('/net-down', { retries: 0 })).rejects.toThrow(ApiNetworkError);

    // Caller-initiated abort — distinct ApiAbortedError.
    server.use(
      http.get('*/api/v1/cancelled', async () => {
        await delay(500);
        return HttpResponse.json({ success: true, data: 'late' });
      })
    );
    const controller = new AbortController();
    const promise = api.get('/cancelled', { signal: controller.signal, retries: 0 });
    setTimeout(() => controller.abort(), 20);
    await expect(promise).rejects.toThrow(ApiAbortedError);
  });
});

describe('ApiClient — 204 No Content', () => {
  it('returns null on 204 instead of failing envelope parse', async () => {
    server.use(
      http.delete('*/api/v1/thing/204', () => {
        return new HttpResponse(null, { status: 204 });
      })
    );

    const result = await api.delete('/thing/204');
    expect(result).toBeNull();
  });
});

describe('ApiClient — base URL resolution', () => {
  it('uses window.APP_CONFIG.API_BASE_URL when present', async () => {
    window.APP_CONFIG = { API_BASE_URL: 'https://api.example.com/v2' };
    api._resetBaseUrl();

    let calledUrl = null;
    server.use(
      http.get('https://api.example.com/v2/things', ({ request }) => {
        calledUrl = request.url;
        return HttpResponse.json({ success: true, data: ['a', 'b'] });
      })
    );

    const result = await api.get('/things');
    expect(result).toEqual(['a', 'b']);
    expect(calledUrl).toBe('https://api.example.com/v2/things');
  });

  it('strips trailing slash from base URL', async () => {
    window.APP_CONFIG = { API_BASE_URL: 'https://api.example.com/v2/' };
    api._resetBaseUrl();

    let calledUrl = null;
    server.use(
      http.get('https://api.example.com/v2/probe', ({ request }) => {
        calledUrl = request.url;
        return HttpResponse.json({ success: true, data: 'ok' });
      })
    );

    await api.get('/probe');
    expect(calledUrl).toBe('https://api.example.com/v2/probe');
  });

  it('defaults to /api/v1 when APP_CONFIG is missing', async () => {
    // No APP_CONFIG set — should hit the existing /api/v1 MSW handlers.
    server.use(
      http.get('*/api/v1/default-base', () => {
        return HttpResponse.json({ success: true, data: 'default' });
      })
    );
    const result = await api.get('/default-base');
    expect(result).toBe('default');
  });
});

describe('ApiClient — query params', () => {
  it('appends query params from opts.query', async () => {
    let receivedUrl = null;
    server.use(
      http.get('*/api/v1/search-q', ({ request }) => {
        receivedUrl = request.url;
        return HttpResponse.json({ success: true, data: [] });
      })
    );

    await api.get('/search-q', { query: { q: 'latte', state: 'CA', empty: '' } });
    const url = new URL(receivedUrl);
    expect(url.searchParams.get('q')).toBe('latte');
    expect(url.searchParams.get('state')).toBe('CA');
    expect(url.searchParams.has('empty')).toBe(false);
  });
});

describe('ApiClient — headers', () => {
  it('sends Content-Type: application/json on writes with body', async () => {
    let receivedContentType = null;
    server.use(
      http.post('*/api/v1/echo-headers', ({ request }) => {
        receivedContentType = request.headers.get('Content-Type');
        return HttpResponse.json({ success: true, data: 'ok' });
      })
    );

    await api.post('/echo-headers', { x: 1 });
    expect(receivedContentType).toBe('application/json');
  });

  it('merges caller headers over defaults', async () => {
    let received = null;
    server.use(
      http.get('*/api/v1/auth-test', ({ request }) => {
        received = request.headers.get('Authorization');
        return HttpResponse.json({ success: true, data: 'ok' });
      })
    );

    await api.get('/auth-test', { headers: { Authorization: 'Bearer xyz' } });
    expect(received).toBe('Bearer xyz');
  });
});
