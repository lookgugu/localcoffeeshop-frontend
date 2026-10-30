/**
 * Integration Tests — "Find Near Me" in the real `public/frontend.js`
 *
 * The button used to sort five hard-coded sample shops (San Francisco,
 * Mobile AL, Phoenix AZ) by distance, so every visitor saw the same fake
 * results. It now asks GET /nearby for the shops closest to the browser's
 * position and shows each one's distance, with a map and distance filter
 * (#30). The map itself (MapLibre) can't run in happy-dom, so a fake
 * window.CoffeeShopNearbyMap records what frontend.js asks it to draw.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../helpers/mockApi.js';
import { click, input } from '../../helpers/dom.js';

import enums from '../../../public/enums.js';
import skeleton from '../../../public/skeleton.js';
import storeMod from '../../../public/store.js';
import api from '../../../public/api-client.js';
import shopActions from '../../../public/shop-actions.js';

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
  const panel = document.createElement('section');
  panel.id = 'nearbyPanel';
  panel.hidden = true;
  panel.innerHTML = `
    <button type="button" class="radius-chip" data-radius="1" aria-pressed="false">1 mi</button>
    <button type="button" class="radius-chip" data-radius="5" aria-pressed="false">5 mi</button>
    <button type="button" class="radius-chip" data-radius="" aria-pressed="true">Any distance</button>
    <button type="button" id="searchThisArea" hidden>Search this area</button>
    <div id="nearbyMap"></div>`;
  container.appendChild(panel);
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
const names = () => results().map((li) => li.querySelector('h3').textContent);
const chip = (label) => [...document.querySelectorAll('.radius-chip')].find((b) => b.textContent === label);

function installFakeMap() {
  const fake = { shown: [], options: null };
  window.CoffeeShopNearbyMap = {
    createNearbyMap: vi.fn((el, options) => {
      fake.options = options;
      return { show: vi.fn(async (view) => { fake.shown.push(view); }) };
    }),
  };
  return fake;
}

describe('frontend.js — Find Near Me', () => {
  let requests;
  let statesLoaded;

  beforeEach(() => {
    createTestDOM();
    requests = [];
    statesLoaded = false;
    window.CoffeeShopEnums = enums;
    window.CoffeeShopSkeleton = skeleton;
    window.CoffeeShopStore = storeMod;
    window.CoffeeShopActions = shopActions;
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
    delete window.CoffeeShopActions;
    delete window.ApiClient;
    delete window.CoffeeShopNearbyMap;
    delete navigator.geolocation;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function boot(nearbyHandler) {
    server.use(
      http.get('*/api/v1/health', () => HttpResponse.json({ success: true, data: { status: 'ok' } })),
      http.get('*/api/v1/states', () => {
        statesLoaded = true;
        return HttpResponse.json({ success: true, data: [] });
      }),
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
    // Back to browsing by state, not an empty "Search Results" section.
    expect(document.getElementById('searchResults').style.display).toBe('none');
    expect(document.getElementById('stateGrid').style.display).toBe('grid');
  });

  it('restores the state grid when the browser refuses to share a location', async () => {
    navigator.geolocation.getCurrentPosition = vi.fn((ok, err) => err({ code: 1, message: 'denied' }));
    await boot(http.get('*/api/v1/nearby', () => HttpResponse.json({ success: true, data: [] })));

    click(document.getElementById('findNearMe'));
    await waitFor(() => expect(document.body.textContent).toMatch('Unable to retrieve your location.'));
    expect(document.getElementById('searchResults').style.display).toBe('none');
    expect(document.getElementById('stateGrid').style.display).toBe('grid');
  });

  it('a slow /nearby response does not overwrite a newer text search', async () => {
    await boot(http.get('*/api/v1/nearby', async () => {
      await delay(400);
      return HttpResponse.json({ success: true, data: [nearbyShop(1, 'Stale Nearby Cafe', 0.4)] });
    }));
    server.use(http.get('*/api/v1/search', () => HttpResponse.json({
      success: true,
      data: [{ id: 9, displayName: { text: 'Searched Roasters' }, formattedAddress: '1 Main St, Austin, TX', state: 'TX' }],
    })));
    // Startup restores the search box from the URL once /states loads;
    // type only after that, as a user would.
    await waitFor(() => expect(statesLoaded).toBe(true));
    await new Promise((r) => setTimeout(r, 20));

    click(document.getElementById('findNearMe'));
    input(document.getElementById('searchInput'), 'roasters');
    await waitFor(() => expect(results().map((li) => li.querySelector('h3').textContent)).toEqual(['Searched Roasters']));

    await new Promise((r) => setTimeout(r, 600)); // let the nearby response land
    expect(results().map((li) => li.querySelector('h3').textContent)).toEqual(['Searched Roasters']);
  });

  describe('map and distance filter', () => {
    const threeShops = [
      nearbyShop(1, 'Corner Roasters', 0.4),
      nearbyShop(2, 'Midtown Beans', 5.0),
      nearbyShop(3, 'Farther Cafe', 16.1),
    ];
    const nearbyOk = (shops = threeShops) => http.get('*/api/v1/nearby', ({ request }) => {
      requests.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json({ success: true, data: shops });
    });

    it('shows the panel and hands the map the shops and the search origin', async () => {
      const map = installFakeMap();
      await boot(nearbyOk());

      click(document.getElementById('findNearMe'));
      await waitFor(() => expect(results()).toHaveLength(3));

      expect(document.getElementById('nearbyPanel').hidden).toBe(false);
      expect(map.shown).toHaveLength(1);
      expect(map.shown[0].origin).toEqual({ lat: BOSTON.latitude, lon: BOSTON.longitude });
      expect(map.shown[0].shops.map((s) => s.id)).toEqual([1, 2, 3]);
    });

    it('filters the list and the map by distance, and "Any distance" brings everything back', async () => {
      const map = installFakeMap();
      await boot(nearbyOk());
      click(document.getElementById('findNearMe'));
      await waitFor(() => expect(results()).toHaveLength(3));

      click(chip('1 mi')); // 1.609 km: only the 0.4 km shop
      expect(names()).toEqual(['Corner Roasters']);
      expect(chip('1 mi').getAttribute('aria-pressed')).toBe('true');
      expect(chip('Any distance').getAttribute('aria-pressed')).toBe('false');
      expect(map.shown.at(-1).shops.map((s) => s.id)).toEqual([1]);

      click(chip('5 mi')); // 8.05 km
      expect(names()).toEqual(['Corner Roasters', 'Midtown Beans']);

      click(chip('Any distance'));
      expect(names()).toEqual(['Corner Roasters', 'Midtown Beans', 'Farther Cafe']);
      expect(requests).toHaveLength(1); // filtering never re-queries
    });

    it('says nothing is that close when a radius has no shops', async () => {
      installFakeMap();
      await boot(nearbyOk([nearbyShop(3, 'Farther Cafe', 16.1)]));
      click(document.getElementById('findNearMe'));
      await waitFor(() => expect(results()).toHaveLength(1));

      click(chip('1 mi'));
      expect(results()).toHaveLength(0);
      expect(document.querySelector('#searchResults .no-results')).not.toBeNull();
      // The chips stay, so the visitor can widen the radius again.
      expect(document.getElementById('nearbyPanel').hidden).toBe(false);
    });

    it('offers "Search this area" after the visitor moves the map, and searches its center', async () => {
      const map = installFakeMap();
      await boot(nearbyOk());
      click(document.getElementById('findNearMe'));
      await waitFor(() => expect(results()).toHaveLength(3));
      const searchArea = document.getElementById('searchThisArea');
      expect(searchArea.hidden).toBe(true);

      map.options.onUserMove({ lat: 42.4, lon: -71.1 });
      expect(searchArea.hidden).toBe(false);

      click(searchArea);
      await waitFor(() => expect(requests).toHaveLength(2));
      expect(requests[1]).toMatchObject({ lat: '42.4', lon: '-71.1' });
      await waitFor(() => expect(map.shown).toHaveLength(2));
      expect(map.shown[1].origin).toEqual({ lat: 42.4, lon: -71.1 });
      expect(searchArea.hidden).toBe(true);
    });

    it('hides the panel when a text search replaces the nearby results', async () => {
      installFakeMap();
      await boot(nearbyOk());
      server.use(http.get('*/api/v1/search', () => HttpResponse.json({
        success: true,
        data: [{ id: 9, displayName: { text: 'Searched Roasters' }, formattedAddress: '1 Main St, Austin, TX', state: 'TX' }],
      })));
      await waitFor(() => expect(statesLoaded).toBe(true));
      await new Promise((r) => setTimeout(r, 20));

      click(document.getElementById('findNearMe'));
      await waitFor(() => expect(results()).toHaveLength(3));
      input(document.getElementById('searchInput'), 'roasters');
      await waitFor(() => expect(names()).toEqual(['Searched Roasters']));

      expect(document.getElementById('nearbyPanel').hidden).toBe(true);
    });

    it('still lists nearby shops when the map module is missing', async () => {
      await boot(nearbyOk());
      click(document.getElementById('findNearMe'));
      await waitFor(() => expect(results()).toHaveLength(3));

      expect(document.getElementById('nearbyMap').hidden).toBe(true);
      click(chip('1 mi'));
      expect(names()).toEqual(['Corner Roasters']);
    });

    it('hides the panel again when the location is refused', async () => {
      installFakeMap();
      navigator.geolocation.getCurrentPosition = vi.fn((ok, err) => err({ code: 1, message: 'denied' }));
      await boot(nearbyOk());
      click(document.getElementById('findNearMe'));
      await waitFor(() => expect(document.body.textContent).toMatch('Unable to retrieve your location.'));
      expect(document.getElementById('nearbyPanel').hidden).toBe(true);
    });
  });
});
