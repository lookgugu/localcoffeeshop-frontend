// Service Worker for Local Coffee Shop
// Provides offline caching and improved performance

// Bump cache version when STATIC_ASSETS changes so existing clients
// re-precache the new dependency list on activate.
const STATIC_CACHE = 'coffee-shop-static-v8';
const API_CACHE = 'coffee-shop-api-v7';

// Static assets to cache on install.
// IMPORTANT: keep this in sync with the <link>/<script> tags in
// public/html/index.html and state.html — every asset those pages need before
// they become interactive must be listed here, or first-offline-visit will
// fail the hard-dep checks. Each /dist/*.bundle.min.js is a whole-page bundle
// (scripts/build-js.cjs).
const STATIC_ASSETS = [
    '/',
    '/html/index.html',
    '/html/state.html',
    '/dist/styles.min.css',
    '/dist/app.bundle.min.js',
    '/dist/state.bundle.min.js',
    '/geo-consent-default.js',
    '/consent-banner.js'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => {
                console.log('[SW] Caching static assets');
                // /dist/* is served immutable for a year without hashed
                // filenames, so bypass the HTTP cache or a new worker would
                // precache whatever stale copy the browser already holds.
                return cache.addAll(
                    STATIC_ASSETS.map((url) => new Request(url, { cache: 'reload' }))
                );
            })
            .then(() => {
                // Skip waiting to activate immediately
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('[SW] Failed to cache static assets:', error);
                // Rethrow so install fails and the previous worker (with its
                // complete cache) stays in control, instead of activating
                // with a partial cache and then deleting the old one.
                throw error;
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => {
                            // Delete old cache versions
                            return name.startsWith('coffee-shop-') &&
                                   name !== STATIC_CACHE &&
                                   name !== API_CACHE;
                        })
                        .map((name) => {
                            console.log('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                // Take control of all pages immediately
                return self.clients.claim();
            })
    );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Only handle same-origin requests.
    // NOTE: in production APP_CONFIG.API_BASE_URL points at
    // https://api.localcoffeeshop.co, so API traffic is cross-origin and the
    // network-first branch below only applies when the API is proxied under
    // this origin (e.g. local dev with API_BASE_URL unset).
    if (url.origin !== location.origin) {
        return;
    }

    // Handle API requests with network-first strategy
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirstStrategy(event));
        return;
    }

    // Handle static assets with cache-first strategy
    event.respondWith(cacheFirstStrategy(event));
});

// Network-first strategy for API requests
// Try network first, fall back to cache if offline
async function networkFirstStrategy(event) {
    const { request } = event;
    // Open the cache while the network request is in flight
    const cachePromise = caches.open(API_CACHE);

    try {
        const networkResponse = await fetch(request);
        const cache = await cachePromise;

        // Cache successful GET responses
        if (request.method === 'GET' && networkResponse.ok) {
            // Clone the response since it can only be consumed once.
            // waitUntil keeps the worker alive until the write finishes.
            event.waitUntil(cache.put(request, networkResponse.clone()));
        }

        return networkResponse;
    } catch (error) {
        console.log('[SW] Network failed, trying cache:', request.url);

        // Try to get from cache
        const cache = await cachePromise;
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
            // Add header to indicate cached response
            const headers = new Headers(cachedResponse.headers);
            headers.set('X-SW-Cache', 'true');
            return new Response(cachedResponse.body, {
                status: cachedResponse.status,
                statusText: cachedResponse.statusText,
                headers
            });
        }

        // Return offline response for API
        return new Response(JSON.stringify({
            success: false,
            error: {
                message: 'You appear to be offline. Please check your connection.',
                offline: true
            }
        }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Cache-first strategy for static assets
// Serve from cache if available, otherwise fetch from network
async function cacheFirstStrategy(event) {
    const { request } = event;

    // The Cache API only stores GET; let anything else go straight through
    if (request.method !== 'GET') {
        return fetch(request);
    }

    const cache = await caches.open(STATIC_CACHE);

    // Try cache first
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
        // Return cached version but also update cache in background.
        // Without waitUntil the browser may stop the worker once the
        // response is sent, killing the refresh partway.
        event.waitUntil(updateCache(request, cache));
        return cachedResponse;
    }

    // Not in cache, try network
    try {
        const networkResponse = await fetch(request);

        // Cache successful responses
        if (networkResponse.ok) {
            event.waitUntil(cache.put(request, networkResponse.clone()));
        }

        return networkResponse;
    } catch (error) {
        console.log('[SW] Both cache and network failed:', request.url);

        // Return offline page for navigation requests, if we have it
        if (request.mode === 'navigate') {
            const fallback = await caches.match('/');
            if (fallback) {
                return fallback;
            }
        }

        // Return empty response for other requests
        return new Response('Offline', { status: 503 });
    }
}

// Update cache in background (stale-while-revalidate pattern)
async function updateCache(request, cache) {
    try {
        // Revalidate with the server (conditional request) rather than the
        // browser's HTTP cache, which holds /dist/* immutable for a year
        const networkResponse = await fetch(request, { cache: 'no-cache' });
        if (networkResponse.ok) {
            await cache.put(request, networkResponse);
        }
    } catch (error) {
        // Silently fail - we already served from cache
    }
}

// Listen for skip waiting message from client
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
