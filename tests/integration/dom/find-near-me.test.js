/**
 * Integration Tests — "Find Near Me" in the real `public/frontend.js`
 *
 * The button used to sort five hard-coded sample shops (San Francisco,
 * Mobile AL, Phoenix AZ) by distance, so every visitor saw the same fake
 * results. It now asks GET /nearby for the shops closest to the browser's
 * position and shows each one's distance.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../helpers/mockApi.js';
import { click } from '../../helpers/dom.js';

import enums from '../../../public/enums.js';
import skeleton from '../../../public/skeleton.js';
import storeMod from '../../../public/store.js';
import api from '../../../public/api-client.js';

const BOSTON = { latitude: 42.3601, longitude: -71.0589 };

function nearbyShop(id, name, distanceKm) {
  return {
    id,
    displayName: { text: name, languageCode: 'en' },
    formattedAddress: `${id} Tremont St, Boston, MA 02108, USA`,
    priceLevel: 'PRICE_LEVEL_MODERATE',
    state: 'MA',
    latitude: 42.35,
    longitude: -71.06,
    distanceKm,
  };
}

function createTestDOM() {
  const container = document.createElement('div');
  container.className = 'container';
  for (const [tag, id] of [
    ['div', 'serverStatus'], ['input', 'searchInput'], ['select', 'stateFilter'],
    ['select', 'priceFilter'], ['div', 'searchResults'], ['div', 'stateGrid'],
  ]) {
    const el = document.createElement(tag);
    el.id = id;
    container.appendChild(el);
  }
  const button = document.createElement('button');
  button.id = 'findNearMe';
  container.appendChild(button);
  document.body.appendChild(container);
}

async function waitFor(check, { timeout = 3000 } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      check();
      return;
    } catch (err) {
      if (Date.now() - start > timeout) throw err;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

const results = () => [...document.querySelectorAll('#searchResults .coffee-item')];

describe('frontend.js — Find Near Me', () => {
  let requests;

  beforeEach(() => {
    createTestDOM();
    requests = [];
    window.CoffeeShopEnums = enums;
    window.CoffeeShopSkeleton = skeleton;
    window.CoffeeShopStore = storeMod;
    window.ApiClient = api;
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
    Object.defineProperty(window, 'location', { value: new URL('http://localhost/'), writable: true });
    window.history.replaceState = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: vi.fn((ok) => ok({ coords: BOSTON })) },
    });
  });

  afterEach(() => {
    delete window.CoffeeShopEnums;
    delete window.CoffeeShopSkeleton;
    delete window.CoffeeShopStore;
    delete window.ApiClient;
    delete navigator.geolocation;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function boot(nearbyHandler) {
    server.use(
      http.get('*/api/v1/health', () => HttpResponse.json({ success: true, data: { status: 'ok' } })),
      http.get('*/api/v1/states', () => HttpResponse.json({ success: true, data: [] })),
      nearbyHandler
    );
    vi.resetModules();
    await import('../../../public/frontend.js');
  }

  it('asks /nearby for shops around the browser position and lists them closest first', async () => {
    await boot(http.get('*/api/v1/nearby', ({ request }) => {
      const url = new URL(request.url);
      requests.push(Object.fromEntries(url.searchParams));
      return HttpResponse.json({
        success: true,
        data: [nearbyShop(2, 'Farther Cafe', 16.1), nearbyShop(1, 'Corner Roasters', 0.4)],
        metadata: { count: 2, limit: 50, origin: { lat: BOSTON.latitude, lon: BOSTON.longitude } },
      });
    }));

    click(document.getElementById('findNearMe'));
    await waitFor(() => expect(results()).toHaveLength(2));

    expect(requests).toEqual([{ lat: '42.3601', lon: '-71.0589', limit: '50' }]);
    expect(results().map((li) => li.querySelector('h3').textContent))
      .toEqual(['Corner Roasters', 'Farther Cafe']);
    expect(results().map((li) => li.querySelector('.distance').textContent))
      .toEqual(['0.2 mi away', '10 mi away']);
    expect(document.body.textContent).not.toMatch(/Alabama Coffee|Arizona Brew|The Coffee House/);
  });

  it('says nothing was found when the API has no nearby shops', async () => {
    await boot(http.get('*/api/v1/nearby', () => HttpResponse.json({
      success: true, data: [], metadata: { count: 0, limit: 50 },
    })));

    click(document.getElementById('findNearMe'));
    await waitFor(() => expect(document.querySelector('#searchResults .no-results')).not.toBeNull());
    expect(results()).toHaveLength(0);
  });

  it('shows an error instead of results when /nearby fails', async () => {
    await boot(http.get('*/api/v1/nearby', () => HttpResponse.json(
      { success: false, error: { message: 'bad input' } }, { status: 400 }
    )));

    click(document.getElementById('findNearMe'));
    await waitFor(() => expect(document.body.textContent).toMatch('Could not fetch nearby coffee shops.'));
    expect(results()).toHaveLength(0);
  });
});
