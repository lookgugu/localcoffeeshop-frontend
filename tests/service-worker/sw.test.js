// @vitest-environment node
//
// Node's native Request/Response are used deliberately: happy-dom's Request
// drops the `cache` option and resolves relative URLs against localhost:3000,
// which would hide the HTTP-cache bypass sw.js relies on.
/**
 * Service Worker Tests
 *
 * Runs the real public/sw.js and public/service-worker-registration.js against
 * stubbed worker globals (self, caches, fetch, location), then drives them by
 * dispatching install/activate/fetch/message events.
 *
 * Covers:
 * - Registration and update checks
 * - Precaching on install, old-cache cleanup on activate
 * - Network-first for /api/*, cache-first with background revalidation otherwise
 * - Offline fallbacks
 * - SKIP_WAITING message
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PUBLIC_DIR = resolve(__dirname, '../../public');
const ORIGIN = 'http://localhost';
const SW_SOURCE = readFileSync(resolve(PUBLIC_DIR, 'sw.js'), 'utf8');
const REGISTRATION_SOURCE = readFileSync(resolve(PUBLIC_DIR, 'service-worker-registration.js'), 'utf8');

const toUrl = (request) =>
  new URL(typeof request === 'string' ? request : request.url, ORIGIN).href;

// In a real worker `new Request('/x')` resolves against the worker's scope;
// Node's Request needs an absolute URL, so resolve against ORIGIN for it
class WorkerRequest extends Request {
  constructor(input, init) {
    super(typeof input === 'string' ? new URL(input, ORIGIN).href : input, init);
  }
}
const isNonGet = (request) =>
  typeof request !== 'string' && request.method && request.method !== 'GET';

/**
 * Minimal in-memory Cache mirroring the spec rules sw.js depends on:
 * match() never returns a hit for non-GET requests, put() rejects them,
 * and addAll() fetches every URL and fails as a whole if any fetch fails.
 * Writes are dropped once the worker has been terminated.
 */
class FakeCache {
  constructor(fetchFn, isAlive) {
    this.entries = new Map();
    this.fetchFn = fetchFn;
    this.isAlive = isAlive;
  }

  async match(request) {
    if (isNonGet(request)) return undefined;
    return this.entries.get(toUrl(request))?.clone();
  }

  async put(request, response) {
    if (isNonGet(request)) throw new TypeError('Request method must be GET');
    // Real writes are async; land on a later task so un-awaited puts are observable
    await new Promise((r) => setTimeout(r, 0));
    if (!this.isAlive()) return;
    this.entries.set(toUrl(request), response);
  }

  async addAll(requests) {
    // Pass Request objects through unchanged so tests can inspect cache mode
    const responses = await Promise.all(requests.map((r) => this.fetchFn(r)));
    if (responses.some((r) => !r.ok)) throw new TypeError('addAll: bad response');
    requests.forEach((r, i) => this.entries.set(toUrl(r), responses[i]));
  }

  has(url) {
    return this.entries.has(toUrl(url));
  }
}

class FakeCacheStorage {
  constructor(fetchFn, isAlive = () => true) {
    this.caches = new Map();
    this.fetchFn = fetchFn;
    this.isAlive = isAlive;
  }

  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache(this.fetchFn, this.isAlive));
    return this.caches.get(name);
  }

  async keys() {
    return [...this.caches.keys()];
  }

  async delete(name) {
    return this.caches.delete(name);
  }

  async match(request) {
    for (const cache of this.caches.values()) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    return undefined;
  }
}

/**
 * Evaluate sw.js with stubbed globals. Returns handles for dispatching events,
 * the fakes it talks to, and the constants it declares (so tests don't hardcode
 * cache versions).
 */
function loadServiceWorker() {
  const listeners = {};
  let alive = true;
  const fetch = vi.fn(async () => new Response('network', { status: 200 }));
  const caches = new FakeCacheStorage((...args) => fetch(...args), () => alive);
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };

  const constants = new Function(
    'self', 'caches', 'fetch', 'location', 'Request',
    `${SW_SOURCE}\nreturn { STATIC_CACHE, API_CACHE, STATIC_ASSETS };`
  )(self, caches, fetch, { origin: ORIGIN }, WorkerRequest);

  // Lifecycle events: resolve once everything passed to waitUntil settles
  const runLifecycle = async (type) => {
    const pending = [];
    listeners[type]({ waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
  };

  // Promises extending the current fetch event's lifetime (respondWith + waitUntil)
  let lifetime = [];
  let lastFetchEvent = null;

  // Fetch event: returns the response passed to respondWith, or undefined if
  // the worker let the request fall through to the network
  const dispatchFetch = async (url, { method = 'GET', mode } = {}) => {
    const request = new Request(new URL(url, ORIGIN).href, { method });
    // Request's constructor rejects mode: 'navigate', so set it directly
    if (mode) Object.defineProperty(request, 'mode', { value: mode });
    let responded;
    // Each event starts (or wakes) the worker
    alive = true;
    lifetime = [];
    lastFetchEvent = {
      request,
      respondWith: (p) => { responded = p; lifetime.push(p); },
      waitUntil: vi.fn((p) => { lifetime.push(p); }),
    };
    listeners.fetch(lastFetchEvent);
    return responded;
  };

  // Like a browser: once every lifetime promise has settled (including ones
  // added while waiting), the worker may be stopped and later writes are lost
  const terminateWhenIdle = async () => {
    let count;
    do {
      count = lifetime.length;
      await Promise.allSettled(lifetime);
    } while (lifetime.length !== count);
    alive = false;
  };

  const dispatchMessage = (data) => listeners.message({ data });

  return {
    ...constants, self, caches, fetch, runLifecycle, dispatchFetch, dispatchMessage,
    terminateWhenIdle,
    get lastFetchEvent() { return lastFetchEvent; },
  };
}

describe('Service Worker', () => {
  let sw;

  beforeEach(() => {
    // sw.js logs on install/activate/offline paths; keep test output clean
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sw = loadServiceWorker();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Service Worker Registration', () => {
    let window;
    let navigator;
    let registration;

    const loadRegistration = () => {
      new Function('window', 'navigator', REGISTRATION_SOURCE)(window, navigator);
      window.dispatchEvent(new Event('load'));
    };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      window = new EventTarget();
      registration = Object.assign(new EventTarget(), { scope: '/', update: vi.fn() });
      navigator = {
        serviceWorker: { register: vi.fn(async () => registration), controller: null },
      };
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should register /sw.js once the page loads', async () => {
      new Function('window', 'navigator', REGISTRATION_SOURCE)(window, navigator);
      expect(navigator.serviceWorker.register).not.toHaveBeenCalled();

      window.dispatchEvent(new Event('load'));
      await vi.advanceTimersByTimeAsync(0);

      expect(navigator.serviceWorker.register).toHaveBeenCalledWith('/sw.js');
    });

    it('should check for updates every hour', async () => {
      loadRegistration();
      await vi.advanceTimersByTimeAsync(0);
      expect(registration.update).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(registration.update).toHaveBeenCalledTimes(1);
    });

    it('should warn instead of throwing when registration fails', async () => {
      navigator.serviceWorker.register.mockRejectedValue(new Error('blocked'));

      loadRegistration();
      await vi.advanceTimersByTimeAsync(0);

      expect(console.warn).toHaveBeenCalledWith(
        'ServiceWorker registration failed:', expect.any(Error)
      );
    });

    it('should do nothing when service workers are unsupported', () => {
      navigator = {};
      expect(() => loadRegistration()).not.toThrow();
    });
  });

  describe('Install', () => {
    it('should precache every static asset and skip waiting', async () => {
      await sw.runLifecycle('install');

      const staticCache = await sw.caches.open(sw.STATIC_CACHE);
      for (const asset of sw.STATIC_ASSETS) {
        expect(staticCache.has(asset), `${asset} precached`).toBe(true);
      }
      expect(sw.self.skipWaiting).toHaveBeenCalled();
    });

    it('should bypass the HTTP cache when precaching', async () => {
      await sw.runLifecycle('install');

      // /dist/* is served immutable without hashed names; a plain fetch
      // would precache whatever stale copy the browser already holds
      expect(sw.fetch).toHaveBeenCalledTimes(sw.STATIC_ASSETS.length);
      for (const [request] of sw.fetch.mock.calls) {
        expect(request, `${request.url} cache mode`).toBeInstanceOf(Request);
        expect(request.cache).toBe('reload');
      }
    });

    it('should only precache files that exist in public/', () => {
      const missing = sw.STATIC_ASSETS
        .filter((asset) => asset !== '/')
        .filter((asset) => !existsSync(resolve(PUBLIC_DIR, `.${asset}`)));

      expect(missing).toEqual([]);
    });

    it('should precache JS bundles, CSS and consent files', () => {
      expect(sw.STATIC_ASSETS).toEqual(expect.arrayContaining([
        '/dist/app.min.js',
        '/dist/styles.min.css',
        '/geo-consent-default.js',
        '/consent-banner.js',
      ]));
    });

    it('should not precache the removed config-driven analytics.js (#17)', () => {
      expect(sw.STATIC_ASSETS).not.toContain('/analytics.js');
    });

    it('should fail install when precaching fails, so the old worker stays in control', async () => {
      sw.fetch.mockImplementation(async (request) =>
        new Response('', { status: request.url.endsWith('/dist/app.min.js') ? 404 : 200 })
      );

      // A rejected waitUntil aborts the install; swallowing it would activate
      // a worker with a partial cache and then delete the old complete one
      await expect(sw.runLifecycle('install')).rejects.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        '[SW] Failed to cache static assets:', expect.any(Error)
      );
      expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    });
  });

  describe('Activate', () => {
    it('should delete old cache versions and keep current ones', async () => {
      await sw.caches.open('coffee-shop-static-v1');
      await sw.caches.open('coffee-shop-api-v2');
      await sw.caches.open('coffee-shop-v5');
      await sw.caches.open(sw.STATIC_CACHE);
      await sw.caches.open(sw.API_CACHE);

      await sw.runLifecycle('activate');

      expect((await sw.caches.keys()).sort()).toEqual([sw.API_CACHE, sw.STATIC_CACHE].sort());
    });

    it('should leave caches owned by other code alone', async () => {
      await sw.caches.open('some-other-app-cache');

      await sw.runLifecycle('activate');

      expect(await sw.caches.keys()).toContain('some-other-app-cache');
    });

    it('should claim open clients', async () => {
      await sw.runLifecycle('activate');

      expect(sw.self.clients.claim).toHaveBeenCalled();
    });
  });

  describe('Fetch Routing', () => {
    it('should ignore cross-origin requests', async () => {
      const response = await sw.dispatchFetch('https://fonts.googleapis.com/css2?family=Inter');

      expect(response).toBeUndefined();
      expect(sw.fetch).not.toHaveBeenCalled();
    });

    it('should not intercept the production API, which is cross-origin', async () => {
      // netlify.toml sets API_BASE_URL to https://api.localcoffeeshop.co, so
      // in production the network-first branch below never runs. The API
      // tests use a same-origin URL to exercise it as it behaves in local dev.
      const response = await sw.dispatchFetch('https://api.localcoffeeshop.co/api/v1/states');

      expect(response).toBeUndefined();
      expect(sw.fetch).not.toHaveBeenCalled();
    });

    it('should pass non-GET static requests straight to the network', async () => {
      const staticCache = await sw.caches.open(sw.STATIC_CACHE);
      const put = vi.spyOn(staticCache, 'put');
      sw.fetch.mockResolvedValue(new Response('created', { status: 201 }));

      const response = await sw.dispatchFetch('/html/submit.html', { method: 'POST' });
      await sw.terminateWhenIdle();

      expect(response.status).toBe(201);
      // Cache API rejects non-GET puts; the worker must not attempt one
      expect(put).not.toHaveBeenCalled();
    });
  });

  describe('Network-First Strategy (API)', () => {
    it('should return the network response and cache it', async () => {
      sw.fetch.mockResolvedValue(Response.json({ success: true, data: 'from network' }));

      const response = await sw.dispatchFetch('/api/v1/states');

      expect(await response.json()).toEqual({ success: true, data: 'from network' });
      // The cache write must extend the event's lifetime
      expect(sw.lastFetchEvent.waitUntil).toHaveBeenCalled();
      await sw.terminateWhenIdle();
      const apiCache = await sw.caches.open(sw.API_CACHE);
      expect(apiCache.has('/api/v1/states')).toBe(true);
    });

    it('should cache each API URL separately', async () => {
      sw.fetch.mockImplementation(async (request) =>
        Response.json({ url: new URL(request.url).pathname })
      );

      for (const state of ['CA', 'NY', 'TX']) {
        await sw.dispatchFetch(`/api/v1/states/${state}`);
        await sw.terminateWhenIdle();
      }

      const apiCache = await sw.caches.open(sw.API_CACHE);
      for (const state of ['CA', 'NY', 'TX']) {
        const cached = await apiCache.match(`/api/v1/states/${state}`);
        expect(await cached.json()).toEqual({ url: `/api/v1/states/${state}` });
      }
    });

    it('should not cache non-GET requests', async () => {
      const apiCache = await sw.caches.open(sw.API_CACHE);
      const put = vi.spyOn(apiCache, 'put');

      await sw.dispatchFetch('/api/v1/states', { method: 'POST' });

      expect(sw.fetch).toHaveBeenCalledTimes(1);
      // A real Cache rejects non-GET puts, so sw.js must not even attempt one
      expect(put).not.toHaveBeenCalled();
      expect(apiCache.has('/api/v1/states')).toBe(false);
    });

    it('should not cache error responses', async () => {
      sw.fetch.mockResolvedValue(new Response('boom', { status: 500 }));

      const response = await sw.dispatchFetch('/api/v1/states');

      expect(response.status).toBe(500);
      const apiCache = await sw.caches.open(sw.API_CACHE);
      expect(apiCache.has('/api/v1/states')).toBe(false);
    });

    it('should fall back to the cached response, marked with X-SW-Cache, when the network fails', async () => {
      sw.fetch.mockResolvedValueOnce(Response.json({ data: 'from cache' }));
      await sw.dispatchFetch('/api/v1/states');
      await sw.terminateWhenIdle();

      sw.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
      const response = await sw.dispatchFetch('/api/v1/states');

      expect(response.status).toBe(200);
      expect(response.headers.get('X-SW-Cache')).toBe('true');
      expect(await response.json()).toEqual({ data: 'from cache' });
    });

    it('should return a 503 offline envelope when offline with nothing cached', async () => {
      sw.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

      const response = await sw.dispatchFetch('/api/v1/states');

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.offline).toBe(true);
      expect(body.error.message).toContain('offline');
    });
  });

  describe('Cache-First Strategy (static assets)', () => {
    it('should serve from cache without waiting on the network', async () => {
      const staticCache = await sw.caches.open(sw.STATIC_CACHE);
      await staticCache.put('/html/index.html', new Response('cached content'));
      sw.fetch.mockReturnValue(new Promise(() => {})); // network never answers

      const response = await sw.dispatchFetch('/html/index.html');

      expect(await response.text()).toBe('cached content');
    });

    it('should refresh the cached copy in the background (stale-while-revalidate)', async () => {
      const staticCache = await sw.caches.open(sw.STATIC_CACHE);
      await staticCache.put('/dist/app.min.js', new Response('old version'));
      let resolveNetwork;
      sw.fetch.mockReturnValue(new Promise((r) => { resolveNetwork = r; }));

      const response = await sw.dispatchFetch('/dist/app.min.js');
      expect(await response.text()).toBe('old version');

      // The refresh is slower than the cached response. The worker must stay
      // alive (via waitUntil) until it lands, or a browser may stop it first.
      let idle = false;
      const stopped = sw.terminateWhenIdle().then(() => { idle = true; });
      await new Promise((r) => setTimeout(r, 0));
      expect(idle).toBe(false);

      resolveNetwork(new Response('new version'));
      await stopped;

      const cached = await staticCache.match('/dist/app.min.js');
      expect(await cached.text()).toBe('new version');
    });

    it('should revalidate against the server, not the browser HTTP cache', async () => {
      const staticCache = await sw.caches.open(sw.STATIC_CACHE);
      await staticCache.put('/dist/app.min.js', new Response('old version'));

      await sw.dispatchFetch('/dist/app.min.js');
      await sw.terminateWhenIdle();

      // /dist/* is immutable for a year in netlify.toml; a default-mode fetch
      // would be answered from the HTTP cache and never see a new deploy
      expect(sw.fetch).toHaveBeenCalledTimes(1);
      expect(sw.fetch.mock.calls[0][1]).toEqual({ cache: 'no-cache' });
    });

    it('should fetch and cache on a cache miss', async () => {
      sw.fetch.mockResolvedValue(new Response('fresh', {
        headers: { 'Content-Type': 'application/javascript' },
      }));

      const response = await sw.dispatchFetch('/dist/enums.min.js');

      expect(await response.text()).toBe('fresh');
      // The cache write must extend the event's lifetime
      expect(sw.lastFetchEvent.waitUntil).toHaveBeenCalled();
      await sw.terminateWhenIdle();
      const cached = await (await sw.caches.open(sw.STATIC_CACHE)).match('/dist/enums.min.js');
      expect(cached.headers.get('Content-Type')).toBe('application/javascript');
    });

    it('should not cache error responses on a cache miss', async () => {
      sw.fetch.mockResolvedValue(new Response('not found', { status: 404 }));

      const response = await sw.dispatchFetch('/missing.js');

      expect(response.status).toBe(404);
      expect((await sw.caches.open(sw.STATIC_CACHE)).has('/missing.js')).toBe(false);
    });
  });

  describe('Offline Functionality', () => {
    it('should serve precached assets when offline', async () => {
      await sw.runLifecycle('install');
      sw.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

      for (const asset of ['/html/index.html', '/dist/app.min.js', '/dist/styles.min.css']) {
        const response = await sw.dispatchFetch(asset);
        expect(response.status, asset).toBe(200);
      }
    });

    it('should serve the cached homepage for offline navigations', async () => {
      const staticCache = await sw.caches.open(sw.STATIC_CACHE);
      await staticCache.put('/', new Response('<html>Home</html>'));
      sw.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

      const response = await sw.dispatchFetch('/html/state.html?code=CA', { mode: 'navigate' });

      expect(await response.text()).toBe('<html>Home</html>');
    });

    it('should return 503 for offline navigations when the homepage is not cached', async () => {
      sw.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

      const response = await sw.dispatchFetch('/html/state.html?code=CA', { mode: 'navigate' });

      // Previously caches.match('/') resolved undefined and respondWith(undefined)
      // produced a browser network-error page
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(503);
    });

    it('should return 503 for uncached non-navigation requests when offline', async () => {
      sw.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

      const response = await sw.dispatchFetch('/dist/not-cached.js');

      expect(response.status).toBe(503);
      expect(await response.text()).toBe('Offline');
    });
  });

  describe('Skip Waiting Message', () => {
    it('should skip waiting on a SKIP_WAITING message', () => {
      sw.dispatchMessage({ type: 'SKIP_WAITING' });

      expect(sw.self.skipWaiting).toHaveBeenCalled();
    });

    it('should ignore unrelated or empty messages', () => {
      sw.dispatchMessage({ type: 'OTHER_MESSAGE' });
      sw.dispatchMessage(null);

      expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    });
  });
});
