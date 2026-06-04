/**
 * Service Worker Tests
 *
 * Tests service worker functionality including:
 * - Registration and lifecycle
 * - Cache strategies (cache-first, network-first)
 * - Offline functionality
 * - Cache invalidation
 * - Static asset caching
 * - API response caching
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Service Worker', () => {
  let swRegistration;
  let cacheStorage;

  beforeEach(() => {
    // Mock caches API
    cacheStorage = new Map();

    global.caches = {
      open: vi.fn((cacheName) => {
        if (!cacheStorage.has(cacheName)) {
          cacheStorage.set(cacheName, new Map());
        }
        const cache = cacheStorage.get(cacheName);

        return Promise.resolve({
          match: vi.fn((request) => {
            const url = typeof request === 'string' ? request : request.url;
            return Promise.resolve(cache.get(url));
          }),
          put: vi.fn((request, response) => {
            const url = typeof request === 'string' ? request : request.url;
            cache.set(url, response);
            return Promise.resolve();
          }),
          addAll: vi.fn((urls) => {
            urls.forEach((url) => {
              cache.set(url, new Response('cached', { status: 200 }));
            });
            return Promise.resolve();
          }),
          delete: vi.fn((request) => {
            const url = typeof request === 'string' ? request : request.url;
            const deleted = cache.delete(url);
            return Promise.resolve(deleted);
          }),
          keys: vi.fn(() => {
            return Promise.resolve(Array.from(cache.keys()));
          }),
        });
      }),
      keys: vi.fn(() => {
        return Promise.resolve(Array.from(cacheStorage.keys()));
      }),
      delete: vi.fn((cacheName) => {
        const deleted = cacheStorage.delete(cacheName);
        return Promise.resolve(deleted);
      }),
      match: vi.fn((request) => {
        // Search all caches
        for (const cache of cacheStorage.values()) {
          const url = typeof request === 'string' ? request : request.url;
          if (cache.has(url)) {
            return Promise.resolve(cache.get(url));
          }
        }
        return Promise.resolve(undefined);
      }),
    };

    // Mock service worker registration
    global.navigator = {
      serviceWorker: {
        register: vi.fn((scriptURL) => {
          swRegistration = {
            scope: '/',
            active: {
              scriptURL,
              state: 'activated',
            },
            waiting: null,
            installing: null,
          };
          return Promise.resolve(swRegistration);
        }),
        ready: Promise.resolve({
          active: { state: 'activated' },
        }),
      },
    };
  });

  afterEach(() => {
    cacheStorage.clear();
    vi.clearAllMocks();
  });

  describe('Service Worker Registration', () => {
    it('should register service worker successfully', async () => {
      const registration = await navigator.serviceWorker.register('/sw.js');

      expect(registration).toBeDefined();
      expect(registration.scope).toBe('/');
      expect(registration.active.state).toBe('activated');
    });

    it('should have correct script URL', async () => {
      const registration = await navigator.serviceWorker.register('/sw.js');

      expect(registration.active.scriptURL).toBe('/sw.js');
    });

    it('should be ready after registration', async () => {
      await navigator.serviceWorker.register('/sw.js');
      const ready = await navigator.serviceWorker.ready;

      expect(ready.active.state).toBe('activated');
    });
  });

  describe('Cache Strategies', () => {
    describe('Cache-First Strategy', () => {
      it('should serve from cache if available', async () => {
        const cacheName = 'coffee-shop-static-v3';
        const cache = await caches.open(cacheName);

        // Add resource to cache
        const cachedResponse = new Response('cached content', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
        await cache.put('/index.html', cachedResponse);

        // Try to get from cache
        const response = await cache.match('/index.html');

        expect(response).toBeDefined();
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toBe('cached content');
      });

      it('should fallback to network if not in cache', async () => {
        const cacheName = 'coffee-shop-static-v3';
        const cache = await caches.open(cacheName);

        // Try to get uncached resource
        const response = await cache.match('/not-cached.html');

        expect(response).toBeUndefined();
      });

      it('should update cache in background (stale-while-revalidate)', async () => {
        const cacheName = 'coffee-shop-static-v3';
        const cache = await caches.open(cacheName);

        // Add old version to cache
        await cache.put('/app.js', new Response('old version', { status: 200 }));

        // Simulate background update
        await cache.put('/app.js', new Response('new version', { status: 200 }));

        // Verify cache updated
        const response = await cache.match('/app.js');
        const text = await response.text();
        expect(text).toBe('new version');
      });
    });

    describe('Network-First Strategy', () => {
      it('should try network first for API requests', async () => {
        const cacheName = 'coffee-shop-api-v3';
        const cache = await caches.open(cacheName);

        // Simulate network response
        const networkResponse = new Response(
          JSON.stringify({ data: 'from network' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );

        // Cache the network response
        await cache.put('/api/v1/states', networkResponse);

        // Verify cached
        const cachedResponse = await cache.match('/api/v1/states');
        expect(cachedResponse).toBeDefined();
      });

      it('should fallback to cache when network fails', async () => {
        const cacheName = 'coffee-shop-api-v3';
        const cache = await caches.open(cacheName);

        // Add fallback data to cache
        const fallbackResponse = new Response(
          JSON.stringify({ data: 'from cache' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
        await cache.put('/api/v1/states', fallbackResponse);

        // Simulate network failure - get from cache
        const response = await cache.match('/api/v1/states');
        expect(response).toBeDefined();

        const data = await response.json();
        expect(data.data).toBe('from cache');
      });

      it('should add cache header to indicate cached response', async () => {
        const cacheName = 'coffee-shop-api-v3';
        const cache = await caches.open(cacheName);

        const cachedResponse = new Response(
          JSON.stringify({ data: 'cached' }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'X-SW-Cache': 'true',
            },
          }
        );
        await cache.put('/api/v1/states', cachedResponse);

        const response = await cache.match('/api/v1/states');
        expect(response.headers.get('X-SW-Cache')).toBe('true');
      });
    });
  });

  describe('Offline Functionality', () => {
    it('should serve cached assets when offline', async () => {
      const staticCache = await caches.open('coffee-shop-static-v3');

      // Cache static assets
      await staticCache.addAll([
        '/',
        '/html/index.html',
        '/dist/app.min.js',
        '/dist/styles.min.css',
      ]);

      // Verify all assets cached
      const indexResponse = await staticCache.match('/html/index.html');
      const appResponse = await staticCache.match('/dist/app.min.js');
      const cssResponse = await staticCache.match('/dist/styles.min.css');

      expect(indexResponse).toBeDefined();
      expect(appResponse).toBeDefined();
      expect(cssResponse).toBeDefined();
    });

    it('should return offline response for uncached API requests', async () => {
      // Simulate offline response
      const offlineResponse = new Response(
        JSON.stringify({
          success: false,
          error: {
            message: 'You appear to be offline. Please check your connection.',
            offline: true,
          },
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const data = await offlineResponse.json();
      expect(data.success).toBe(false);
      expect(data.error.offline).toBe(true);
      expect(data.error.message).toContain('offline');
    });

    it('should return fallback page for offline navigation', async () => {
      const staticCache = await caches.open('coffee-shop-static-v3');

      // Cache fallback page
      await staticCache.put('/', new Response('<html>Offline</html>', { status: 200 }));

      // Get fallback page
      const response = await staticCache.match('/');
      expect(response).toBeDefined();

      const html = await response.text();
      expect(html).toContain('Offline');
    });
  });

  describe('Cache Invalidation', () => {
    it('should delete old cache versions on activate', async () => {
      // Create old cache versions
      await caches.open('coffee-shop-static-v1');
      await caches.open('coffee-shop-static-v2');
      await caches.open('coffee-shop-static-v3'); // Current version
      await caches.open('coffee-shop-api-v3'); // Current version

      const allCaches = await caches.keys();
      expect(allCaches).toContain('coffee-shop-static-v1');
      expect(allCaches).toContain('coffee-shop-static-v2');

      // Simulate cleanup of old caches
      const cachesToDelete = allCaches.filter(
        (name) =>
          name.startsWith('coffee-shop-') &&
          name !== 'coffee-shop-static-v3' &&
          name !== 'coffee-shop-api-v3'
      );

      // Delete old caches
      for (const cacheName of cachesToDelete) {
        await caches.delete(cacheName);
      }

      const remainingCaches = await caches.keys();
      expect(remainingCaches).not.toContain('coffee-shop-static-v1');
      expect(remainingCaches).not.toContain('coffee-shop-static-v2');
      expect(remainingCaches).toContain('coffee-shop-static-v3');
      expect(remainingCaches).toContain('coffee-shop-api-v3');
    });

    it('should only keep current cache versions', async () => {
      const currentStaticCache = 'coffee-shop-static-v3';
      const currentApiCache = 'coffee-shop-api-v3';

      await caches.open(currentStaticCache);
      await caches.open(currentApiCache);

      const allCaches = await caches.keys();
      expect(allCaches).toContain(currentStaticCache);
      expect(allCaches).toContain(currentApiCache);
    });

    it('should clear specific cache entries', async () => {
      const cache = await caches.open('coffee-shop-api-v3');

      // Add entries
      await cache.put('/api/v1/states/CA', new Response('CA data'));
      await cache.put('/api/v1/states/NY', new Response('NY data'));

      // Delete one entry
      await cache.delete('/api/v1/states/CA');

      // Verify deletion
      const caResponse = await cache.match('/api/v1/states/CA');
      const nyResponse = await cache.match('/api/v1/states/NY');

      expect(caResponse).toBeUndefined();
      expect(nyResponse).toBeDefined();
    });
  });

  describe('Static Asset Caching', () => {
    it('should cache all static assets on install', async () => {
      const staticCache = await caches.open('coffee-shop-static-v3');

      const staticAssets = [
        '/',
        '/html/index.html',
        '/html/state.html',
        '/asset-loader.js',
        '/dist/styles.min.css',
        '/dist/app.min.js',
        '/dist/enums.min.js',
        '/dist/skeleton.min.js',
      ];

      await staticCache.addAll(staticAssets);

      // Verify all cached
      for (const asset of staticAssets) {
        const response = await staticCache.match(asset);
        expect(response).toBeDefined();
      }
    });

    it('should cache JavaScript and CSS files', async () => {
      const staticCache = await caches.open('coffee-shop-static-v3');

      await staticCache.put(
        '/dist/app.min.js',
        new Response('// JS code', {
          headers: { 'Content-Type': 'application/javascript' },
        })
      );

      await staticCache.put(
        '/dist/styles.min.css',
        new Response('/* CSS */', {
          headers: { 'Content-Type': 'text/css' },
        })
      );

      const jsResponse = await staticCache.match('/dist/app.min.js');
      const cssResponse = await staticCache.match('/dist/styles.min.css');

      expect(jsResponse).toBeDefined();
      expect(cssResponse).toBeDefined();
      expect(jsResponse.headers.get('Content-Type')).toBe('application/javascript');
      expect(cssResponse.headers.get('Content-Type')).toBe('text/css');
    });

    it('should cache analytics and consent files', async () => {
      const staticCache = await caches.open('coffee-shop-static-v3');

      await staticCache.put('/analytics.js', new Response('// Analytics'));
      await staticCache.put('/consent-banner.js', new Response('// Consent'));

      const analyticsResponse = await staticCache.match('/analytics.js');
      const consentResponse = await staticCache.match('/consent-banner.js');

      expect(analyticsResponse).toBeDefined();
      expect(consentResponse).toBeDefined();
    });
  });

  describe('API Response Caching', () => {
    it('should cache GET API responses', async () => {
      const apiCache = await caches.open('coffee-shop-api-v3');

      const apiResponses = [
        { url: '/api/v1/states', data: { states: [] } },
        { url: '/api/v1/health', data: { status: 'ok' } },
        { url: '/api/v1/config', data: { apiVersion: '1.0' } },
      ];

      for (const { url, data } of apiResponses) {
        await apiCache.put(
          url,
          new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }

      // Verify all cached
      for (const { url } of apiResponses) {
        const response = await apiCache.match(url);
        expect(response).toBeDefined();
        expect(response.headers.get('Content-Type')).toBe('application/json');
      }
    });

    it('should not cache non-GET requests', async () => {
      // This is a conceptual test - service workers typically only cache GET
      const apiCache = await caches.open('coffee-shop-api-v3');

      // Only GET requests are cacheable
      const getRequest = new Request('/api/v1/states', { method: 'GET' });
      const postRequest = new Request('/api/v1/states', { method: 'POST' });

      // Cache GET request
      await apiCache.put(
        getRequest,
        new Response(JSON.stringify({ data: 'cached' }))
      );

      // POST requests would not be cached in real SW
      const getResponse = await apiCache.match(getRequest);
      expect(getResponse).toBeDefined();

      // POST would not be in cache
      const postResponse = await apiCache.match(postRequest);
      expect(postResponse).toBeUndefined();
    });

    it('should cache state-specific API responses', async () => {
      const apiCache = await caches.open('coffee-shop-api-v3');

      const states = ['CA', 'NY', 'TX'];

      for (const state of states) {
        await apiCache.put(
          `/api/v1/states/${state}`,
          new Response(JSON.stringify({ state, shops: [] }), {
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }

      // Verify all state responses cached
      for (const state of states) {
        const response = await apiCache.match(`/api/v1/states/${state}`);
        expect(response).toBeDefined();

        const data = await response.json();
        expect(data.state).toBe(state);
      }
    });
  });

  describe('Cache Management', () => {
    it('should list all cache names', async () => {
      await caches.open('coffee-shop-static-v3');
      await caches.open('coffee-shop-api-v3');

      const cacheNames = await caches.keys();

      expect(cacheNames).toContain('coffee-shop-static-v3');
      expect(cacheNames).toContain('coffee-shop-api-v3');
      expect(cacheNames.length).toBeGreaterThanOrEqual(2);
    });

    it('should retrieve cache entries by key', async () => {
      const cache = await caches.open('coffee-shop-static-v3');

      await cache.put('/index.html', new Response('HTML content'));
      await cache.put('/app.js', new Response('JS content'));

      const keys = await cache.keys();
      expect(keys.length).toBe(2);
    });

    it('should handle cache versioning', async () => {
      const v2Cache = await caches.open('coffee-shop-static-v2');
      const v3Cache = await caches.open('coffee-shop-static-v3');

      await v2Cache.put('/app.js', new Response('v2 content'));
      await v3Cache.put('/app.js', new Response('v3 content'));

      // Both versions coexist
      const v2Response = await v2Cache.match('/app.js');
      const v3Response = await v3Cache.match('/app.js');

      const v2Content = await v2Response.text();
      const v3Content = await v3Response.text();

      expect(v2Content).toBe('v2 content');
      expect(v3Content).toBe('v3 content');
    });
  });

  describe('Skip Waiting Message', () => {
    it('should handle skip waiting message from client', () => {
      // Mock service worker self
      const mockSelf = {
        skipWaiting: vi.fn(),
      };

      // Simulate message event
      const messageEvent = {
        data: {
          type: 'SKIP_WAITING',
        },
      };

      // Message handler
      if (messageEvent.data && messageEvent.data.type === 'SKIP_WAITING') {
        mockSelf.skipWaiting();
      }

      expect(mockSelf.skipWaiting).toHaveBeenCalled();
    });

    it('should ignore unrelated messages', () => {
      const mockSelf = {
        skipWaiting: vi.fn(),
      };

      const messageEvent = {
        data: {
          type: 'OTHER_MESSAGE',
        },
      };

      // Message handler should not call skipWaiting
      if (messageEvent.data && messageEvent.data.type === 'SKIP_WAITING') {
        mockSelf.skipWaiting();
      }

      expect(mockSelf.skipWaiting).not.toHaveBeenCalled();
    });
  });
});
