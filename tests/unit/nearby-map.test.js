// @vitest-environment node
/**
 * public/nearby-map.js pure parts, and the build step that serves MapLibre
 * from /vendor (#30). The map rendering itself is checked in a real browser.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
await import('../../public/nearby-map.js');
const { toGeoJSON, MAPLIBRE_VERSION } = globalThis.CoffeeShopNearbyMap;
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

  it('loads the same MapLibre version that is installed', () => {
    expect(mapModuleVersion()).toBe(MAPLIBRE_VERSION);
    expect(installedVersion()).toBe(MAPLIBRE_VERSION);
  });
});
