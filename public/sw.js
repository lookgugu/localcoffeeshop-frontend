// Service Worker for Local Coffee Shop
// Provides offline caching and improved performance

const CACHE_NAME = 'coffee-shop-v3';
const STATIC_CACHE = 'coffee-shop-static-v3';
const API_CACHE = 'coffee-shop-api-v3';

// Static assets to cache on install
const STATIC_ASSETS = [
    '/',
    '/html/index.html',
    '/html/state.html',
    '/asset-loader.js',
    '/asset-loader-state.js',
    '/dist/styles.min.css',
    '/dist/app.min.js',
    '/dist/enums.min.js',
    '/dist/skeleton.min.js',
    '/dist/service-worker-registration.min.js',
    '/dist/connection-banner.min.js',
    '/dist/state.min.js',
    '/analytics.js',
    '/consent-banner.js'
];

// API routes to cache
const API_ROUTES = [
    '/api/v1/states',
    '/api/v1/health',
    '/api/v1/config'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                // Skip waiting to activate immediately
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('[SW] Failed to cache static assets:', error);
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

    // Only handle same-origin requests
    if (url.origin !== location.origin) {
        return;
    }

    // Handle API requests with network-first strategy
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirstStrategy(request));
        return;
    }

    // Handle static assets with cache-first strategy
    event.respondWith(cacheFirstStrategy(request));
});

// Network-first strategy for API requests
// Try network first, fall back to cache if offline
async function networkFirstStrategy(request) {
    const cache = await caches.open(API_CACHE);

    try {
        const networkResponse = await fetch(request);

        // Cache successful GET responses
        if (request.method === 'GET' && networkResponse.ok) {
            // Clone the response since it can only be consumed once
            cache.put(request, networkResponse.clone());
        }

        return networkResponse;
    } catch (error) {
        console.log('[SW] Network failed, trying cache:', request.url);

        // Try to get from cache
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
async function cacheFirstStrategy(request) {
    const cache = await caches.open(STATIC_CACHE);

    // Try cache first
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
        // Return cached version but also update cache in background
        updateCache(request, cache);
        return cachedResponse;
    }

    // Not in cache, try network
    try {
        const networkResponse = await fetch(request);

        // Cache successful responses
        if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }

        return networkResponse;
    } catch (error) {
        console.log('[SW] Both cache and network failed:', request.url);

        // Return offline page for navigation requests
        if (request.mode === 'navigate') {
            return caches.match('/');
        }

        // Return empty response for other requests
        return new Response('Offline', { status: 503 });
    }
}

// Update cache in background (stale-while-revalidate pattern)
async function updateCache(request, cache) {
    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            cache.put(request, networkResponse);
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
