/**
 * Homepage search: URL privacy + analytics (public/frontend.js)
 *
 * The raw search text is never written to the address bar (GA reads
 * page_location on history changes and its site-search detection reads ?q=),
 * a ?q= deep link arrives via LcsUrlPrivacy, and each settled search is
 * counted once as `directory_search` with categorical fields only.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../helpers/mockApi.js';
import { input, change } from '../../helpers/dom.js';

import enums from '../../../public/enums.js';
import skeleton from '../../../public/skeleton.js';
import storeMod from '../../../public/store.js';
import api from '../../../public/api-client.js';
import shopActions from '../../../public/shop-actions.js';

const SHOPS = [
  { id: 1, displayName: { text: 'Secret Latte Bar' }, formattedAddress: '1 Main St, Austin, TX', priceLevel: 'PRICE_LEVEL_MODERATE', state: 'TX' },
  { id: 2, displayName: { text: 'Other' }, formattedAddress: '2 Main St, Austin, TX', priceLevel: 'PRICE_LEVEL_MODERATE', state: 'TX' },
];

function dom() {
  document.body.innerHTML = `
    <div class="container">
      <div id="serverStatus"></div>
      <input id="searchInput">
      <select id="stateFilter"><option value="">All States</option><option value="TX">Texas</option></select>
      <select id="priceFilter"><option value=""></option><option value="PRICE_LEVEL_MODERATE">$$</option></select>
      <div id="searchResults"></div>
      <div id="stateGrid"></div>
    </div>`;
}

async function waitFor(check, timeout = 3000) {
  const start = Date.now();
  for (;;) {
    try {
      return check();
    } catch (err) {
      if (Date.now() - start > timeout) throw err;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

describe('frontend.js — search privacy and analytics', () => {
  let events;
  let replace;

  beforeEach(() => {
    dom();
    events = [];
    window.CoffeeShopEnums = enums;
    window.CoffeeShopSkeleton = skeleton;
    window.CoffeeShopStore = storeMod;
    window.CoffeeShopActions = shopActions;
    window.ApiClient = api;
    window.LcsAnalytics = { track: (name, params) => events.push([name, params]) };
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
    Object.defineProperty(window, 'location', { value: new URL('http://localhost/'), writable: true });
    replace = vi.fn();
    window.history.replaceState = replace;
    server.use(
      http.get('*/api/v1/health', () => HttpResponse.json({ success: true, data: { status: 'ok' } })),
      http.get('*/api/v1/states', () => HttpResponse.json({ success: true, data: [{ state_code: 'TX', shop_count: 2, avg_price_level: 2 }] })),
      http.get('*/api/v1/search', () => HttpResponse.json({
        success: true, data: SHOPS, metadata: { pagination: { page: 1, limit: 100, total: 2, hasNext: false } },
      })),
    );
  });

  afterEach(() => {
    for (const k of ['CoffeeShopEnums', 'CoffeeShopSkeleton', 'CoffeeShopStore', 'CoffeeShopActions', 'ApiClient', 'LcsAnalytics', 'LcsUrlPrivacy']) delete window[k];
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function boot() {
    vi.resetModules();
    await import('../../../public/frontend.js');
    await waitFor(() => expect(document.querySelector('#stateGrid').children.length).toBeGreaterThan(0));
  }

  const urlsWritten = () => replace.mock.calls.map((c) => String(c[2]));

  it('typed search text never reaches the URL; categorical filters do', async () => {
    await boot();
    change(document.getElementById('stateFilter'), 'TX');
    input(document.getElementById('searchInput'), 'Secret Latte');
    await waitFor(() => expect(document.querySelectorAll('#searchResults .coffee-item')).toHaveLength(2));
    expect(urlsWritten().length).toBeGreaterThan(0);
    for (const url of urlsWritten()) {
      expect(url).not.toMatch(/secret|latte|[?&]q=/i);
    }
    expect(urlsWritten().at(-1)).toContain('state=TX');
  });

  it('counts one directory_search per settled search, categorical only', async () => {
    await boot();
    input(document.getElementById('searchInput'), 'Sec');
    input(document.getElementById('searchInput'), 'Secret Latte');
    await waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual(['directory_search', { search_has_query: 'yes', search_state: 'all', search_price: 'any', result_count: 2 }]);
    expect(JSON.stringify(events)).not.toMatch(/secret|latte/i);

    // The same search again (e.g. a re-dispatched change) is not re-counted.
    change(document.getElementById('priceFilter'), '');
    await new Promise((r) => setTimeout(r, 600));
    expect(events).toHaveLength(1);

    change(document.getElementById('priceFilter'), 'PRICE_LEVEL_MODERATE');
    await waitFor(() => expect(events).toHaveLength(2));
    expect(events[1][1]).toMatchObject({ search_price: 'PRICE_LEVEL_MODERATE' });
  });

  it('a ?q= deep link arrives via LcsUrlPrivacy and is searched without re-entering the URL', async () => {
    window.LcsUrlPrivacy = { takeInitialQuery: vi.fn(() => 'Secret Latte') };
    await boot();
    await waitFor(() => expect(document.querySelectorAll('#searchResults .coffee-item')).toHaveLength(2));
    expect(document.getElementById('searchInput').value).toBe('Secret Latte');
    expect(window.LcsUrlPrivacy.takeInitialQuery).toHaveBeenCalledTimes(1);
    for (const url of urlsWritten()) expect(url).not.toMatch(/secret|latte/i);
    // A deep-linked initial render is not a person searching: no event.
    await new Promise((r) => setTimeout(r, 600));
    expect(events).toEqual([]);
  });

  it('after a deep link, a changed search is counted, but re-running the deep-linked one is not', async () => {
    window.LcsUrlPrivacy = { takeInitialQuery: () => 'Secret Latte' };
    await boot();
    await waitFor(() => expect(document.querySelectorAll('#searchResults .coffee-item')).toHaveLength(2));
    input(document.getElementById('searchInput'), 'Secret Latte');
    await new Promise((r) => setTimeout(r, 600));
    expect(events).toEqual([]);
    input(document.getElementById('searchInput'), 'Other');
    await waitFor(() => expect(events).toHaveLength(1));
    expect(events[0][0]).toBe('directory_search');
  });

  it('writing an unchanged URL is skipped (no synthetic history page_view)', async () => {
    Object.defineProperty(window, 'location', { value: new URL('http://localhost/?state=TX'), writable: true });
    await boot();
    await waitFor(() => expect(document.querySelectorAll('#searchResults .coffee-item')).toHaveLength(2));
    expect(urlsWritten()).toEqual([]);
  });

  it('works without the analytics helper', async () => {
    delete window.LcsAnalytics;
    await boot();
    input(document.getElementById('searchInput'), 'x');
    await waitFor(() => expect(document.querySelectorAll('#searchResults .coffee-item')).toHaveLength(2));
  });
});
