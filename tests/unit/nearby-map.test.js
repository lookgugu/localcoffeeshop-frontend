// @vitest-environment node
/**
 * public/nearby-map.js pure parts, and the build step that serves MapLibre
 * from /vendor (#30). The map rendering itself is checked in a real browser.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
await import('../../public/nearby-map.js');
const { toGeoJSON, createNearbyMap, MAPLIBRE_VERSION } = globalThis.CoffeeShopNearbyMap;
const { installedVersion, mapModuleVersion } = require('../../scripts/copy-vendor.cjs');

describe('nearby map', () => {
  it('turns shops into GeoJSON points (longitude first) and skips shops without coordinates', () => {
    const geo = toGeoJSON([
      { id: 1, displayName: { text: 'Corner Roasters' }, formattedAddress: '1 Tremont St', latitude: 42.35, longitude: -71.06 },
      { id: 2, displayName: { text: 'No Coords' } },
      { id: 3, latitude: 40.7, longitude: -74.0 },
    ]);
    expect(geo.type).toBe('FeatureCollection');
    expect(geo.features).toEqual([
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-71.06, 42.35] },
        properties: { id: 1, name: 'Corner Roasters', address: '1 Tremont St' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-74.0, 40.7] },
        properties: { id: 3, name: 'Coffee shop', address: '' } },
    ]);
  });

  it('rejects show() when the map style fails to load, and retries on the next show()', async () => {
    const maps = [];
    globalThis.maplibregl = {
      Map: class {
        constructor() { this.handlers = {}; this.removed = false; maps.push(this); }
        addControl() {}
        on(event, handler) { this.handlers[event] = handler; }
        remove() { this.removed = true; }
      },
      NavigationControl: class {},
    };
    try {
      const nearbyMap = createNearbyMap({ ownerDocument: {} });
      const first = nearbyMap.show({ origin: { lat: 0, lon: 0 }, shops: [] });
      await new Promise((r) => setTimeout(r, 0));
      maps[0].handlers.error({ error: new Error('style 503') });
      await expect(first).rejects.toThrow('style 503');
      expect(maps[0].removed).toBe(true);

      nearbyMap.show({ origin: { lat: 0, lon: 0 }, shops: [] }).catch(() => {});
      await new Promise((r) => setTimeout(r, 0));
      expect(maps).toHaveLength(2);
    } finally {
      delete globalThis.maplibregl;
    }
  });

  it('loads the same MapLibre version that is installed', () => {
    expect(mapModuleVersion()).toBe(MAPLIBRE_VERSION);
    expect(installedVersion()).toBe(MAPLIBRE_VERSION);
  });
});
