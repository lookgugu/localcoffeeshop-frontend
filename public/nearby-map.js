/**
 * Map for "Find Near Me" results (#30).
 *
 * MapLibre GL (self-hosted under /vendor, copied there by
 * scripts/copy-vendor.cjs) draws OpenFreeMap vector tiles, which are free and
 * need no API key. The library is ~1 MB, so it loads only the first time a
 * nearby search returns, never on a plain page view.
 *
 * Uses MapLibre's CSP build: its worker loads from /vendor instead of a
 * blob: URL, so the page CSP only needs worker-src 'self' and connect-src for
 * the tile host (scripts/csp.cjs).
 *
 * Publishes window.CoffeeShopNearbyMap = { createNearbyMap, toGeoJSON }.
 * frontend.js treats it as optional: without it, nearby results still list.
 */
(function (root) {
    'use strict';

    // Must match the installed maplibre-gl; scripts/copy-vendor.cjs fails the
    // build if it doesn't. A versioned path means a service worker never
    // serves a stale copy of the library after an upgrade.
    const MAPLIBRE_VERSION = '5.24.0';
    const VENDOR = `/vendor/maplibre-gl@${MAPLIBRE_VERSION}`;
    const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
    const BRAND = '#6f4e37';

    let libraryPromise = null;

    function loadLibrary(doc) {
        if (root.maplibregl) return Promise.resolve(root.maplibregl);
        if (libraryPromise) return libraryPromise;
        libraryPromise = new Promise((resolve, reject) => {
            const css = doc.createElement('link');
            css.rel = 'stylesheet';
            css.href = `${VENDOR}/maplibre-gl.css`;
            doc.head.appendChild(css);

            const script = doc.createElement('script');
            script.src = `${VENDOR}/maplibre-gl-csp.js`;
            script.onload = () => {
                root.maplibregl.setWorkerUrl(`${VENDOR}/maplibre-gl-csp-worker.js`);
                resolve(root.maplibregl);
            };
            script.onerror = () => {
                libraryPromise = null;
                reject(new Error('Could not load the map library'));
            };
            doc.head.appendChild(script);
        });
        return libraryPromise;
    }

    /** Shops as a GeoJSON FeatureCollection; shops without coordinates are skipped. */
    function toGeoJSON(shops) {
        return {
            type: 'FeatureCollection',
            features: shops
                .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
                .map((s) => ({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [s.longitude, s.latitude] },
                    properties: {
                        id: s.id,
                        name: s.displayName?.text || 'Coffee shop',
                        address: s.formattedAddress || '',
                    },
                })),
        };
    }

    function addLayers(map) {
        map.addSource('shops', {
            type: 'geojson',
            data: toGeoJSON([]),
            cluster: true,
            clusterRadius: 40,
            clusterMaxZoom: 14,
        });
        map.addLayer({
            id: 'clusters',
            type: 'circle',
            source: 'shops',
            filter: ['has', 'point_count'],
            paint: {
                'circle-color': BRAND,
                'circle-opacity': 0.85,
                'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 30, 24],
                'circle-stroke-width': 2,
                'circle-stroke-color': '#fff',
            },
        });
        map.addLayer({
            id: 'cluster-count',
            type: 'symbol',
            source: 'shops',
            filter: ['has', 'point_count'],
            layout: {
                'text-field': ['get', 'point_count_abbreviated'],
                'text-font': ['Noto Sans Bold'],
                'text-size': 12,
            },
            paint: { 'text-color': '#fff' },
        });
        map.addLayer({
            id: 'shop',
            type: 'circle',
            source: 'shops',
            filter: ['!', ['has', 'point_count']],
            paint: {
                'circle-color': BRAND,
                'circle-radius': 7,
                'circle-stroke-width': 2,
                'circle-stroke-color': '#fff',
            },
        });
    }

    function popupContent(doc, properties) {
        const box = doc.createElement('div');
        const name = doc.createElement('strong');
        name.textContent = properties.name;
        box.appendChild(name);
        if (properties.address) {
            const address = doc.createElement('div');
            address.textContent = properties.address;
            box.appendChild(address);
        }
        return box;
    }

    /**
     * @param {HTMLElement} container Element the map fills
     * @param {Object} [options]
     * @param {(center: {lat: number, lon: number}) => void} [options.onUserMove]
     *        Called when the visitor pans or zooms (not on programmatic moves).
     * @returns {{ show(view: {origin: {lat: number, lon: number}, shops: Object[]}): Promise<void> }}
     */
    function createNearbyMap(container, { onUserMove } = {}) {
        const doc = container.ownerDocument;
        let ready = null;
        let map = null;
        let originMarker = null;

        function init() {
            if (ready) return ready;
            ready = loadLibrary(doc).then((maplibregl) => new Promise((resolve) => {
                map = new maplibregl.Map({
                    container,
                    style: STYLE_URL,
                    center: [-98.5, 39.8],
                    zoom: 3,
                    cooperativeGestures: true,
                    attributionControl: { compact: true },
                });
                map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
                map.on('load', () => {
                    addLayers(map);
                    map.on('click', 'clusters', async (e) => {
                        const feature = e.features[0];
                        const zoom = await map.getSource('shops')
                            .getClusterExpansionZoom(feature.properties.cluster_id);
                        map.easeTo({ center: feature.geometry.coordinates, zoom });
                    });
                    map.on('click', 'shop', (e) => {
                        const feature = e.features[0];
                        new maplibregl.Popup({ offset: 10 })
                            .setLngLat(feature.geometry.coordinates)
                            .setDOMContent(popupContent(doc, feature.properties))
                            .addTo(map);
                    });
                    for (const layer of ['clusters', 'shop']) {
                        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
                        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
                    }
                    map.on('moveend', (e) => {
                        // originalEvent is only set for moves the visitor made.
                        if (!e.originalEvent || !onUserMove) return;
                        const { lat, lng } = map.getCenter();
                        onUserMove({ lat, lon: lng });
                    });
                    resolve();
                });
            }));
            return ready;
        }

        return {
            async show({ origin, shops }) {
                await init();
                const maplibregl = root.maplibregl;
                const data = toGeoJSON(shops);
                map.getSource('shops').setData(data);

                if (!originMarker) {
                    const dot = doc.createElement('div');
                    dot.className = 'nearby-map-origin';
                    dot.setAttribute('aria-label', 'Search location');
                    originMarker = new maplibregl.Marker({ element: dot });
                }
                originMarker.setLngLat([origin.lon, origin.lat]).addTo(map);

                const bounds = new maplibregl.LngLatBounds([origin.lon, origin.lat], [origin.lon, origin.lat]);
                for (const f of data.features) bounds.extend(f.geometry.coordinates);
                map.resize();
                map.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 0 });
            },
        };
    }

    root.CoffeeShopNearbyMap = { createNearbyMap, toGeoJSON, MAPLIBRE_VERSION };
})(typeof window !== 'undefined' ? window : globalThis);
