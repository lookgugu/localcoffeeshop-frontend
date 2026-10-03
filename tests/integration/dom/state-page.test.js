/**
 * Integration Tests — state page (`public/html/state.js`)
 *
 * Targeted at the data-validation guard that we just rewrote:
 *   - If the API returns a non-array body, the page must NOT try to render it.
 *
 * The page module is a side-effect script that pulls deps off `window`, so we
 * wire those up before importing it. We rely on `vi.isolateModulesAsync` to
 * re-execute the script per test (it caches module-level state otherwise).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../helpers/mockApi.js';

import enums from '../../../public/enums.js';
import skeleton from '../../../public/skeleton.js';
import storeMod from '../../../public/store.js';
import api from '../../../public/api-client.js';
import { createRequire } from 'node:module';

const { stateSlug } = createRequire(import.meta.url)('../../../scripts/prerender-states.cjs');

function mountDom() {
  // Build the minimal DOM scaffold the page expects.
  for (const [tag, id] of [
    ['h1', 'pageTitle'],
    ['span', 'totalShops'],
    ['span', 'avgPrice'],
    ['ul', 'coffeeList'],
    ['meta', 'metaDescription'],
    ['meta', 'metaOgTitle'],
    ['meta', 'metaOgDescription'],
    ['link', 'canonicalUrl'],
  ]) {
    const el = document.createElement(tag);
    el.id = id;
    document.body.appendChild(el);
  }
}

function stubWindowDeps() {
  window.CoffeeShopEnums = enums;
  window.CoffeeShopSkeleton = skeleton;
  window.CoffeeShopStore = storeMod;
  window.ApiClient = api;
}

describe('state.js — invalid API response shape', () => {
  beforeEach(() => {
    mountDom();
    stubWindowDeps();
    // Pretend we're on /html/state.html?code=CA so the page actually fetches.
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/html/state.html?code=CA'),
      writable: true,
    });
  });

  afterEach(() => {
    delete window.CoffeeShopEnums;
    delete window.CoffeeShopSkeleton;
    delete window.CoffeeShopStore;
    delete window.ApiClient;
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    vi.resetModules();
  });

  it('renders the error message when /states/:code returns a non-array body', async () => {
    // Wrap the non-array in the success envelope — ApiClient unwraps to `data`,
    // which is the (invalid) `{ unexpected: true }` payload state.js must reject.
    server.use(
      http.get('*/api/v1/config', () => HttpResponse.json({ success: true, data: { frontend_url: 'http://localhost' } })),
      http.get('*/api/v1/states/CA', () => {
        return HttpResponse.json({ success: true, data: { unexpected: true } });
      })
    );

    // Suppress the page's console.error noise — the validation throw is logged
    // by the catch block in loadStateShops.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.resetModules();
    await import('../../../public/html/state.js');

    // The page wires its DOMContentLoaded listener inside import; dispatch it.
    document.dispatchEvent(new Event('DOMContentLoaded'));

    // The page boots, fetches, fails the Array.isArray guard, and renders error.
    await new Promise((r) => setTimeout(r, 100));

    const coffeeList = document.getElementById('coffeeList');
    expect(coffeeList.textContent).toMatch(/error/i);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('boots immediately when the dynamic state bundle loads after DOMContentLoaded', async () => {
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'complete',
    });

    server.use(
      http.get('*/api/v1/config', () => HttpResponse.json({ success: true, data: { frontendUrl: 'http://localhost' } })),
      http.get('*/api/v1/states/CA', () => HttpResponse.json({
        success: true,
        data: [{
          id: 1,
          displayName: { text: 'Cafe Test', languageCode: 'en' },
          formattedAddress: '1 Test St, Los Angeles, CA',
          priceLevel: 'PRICE_LEVEL_MODERATE',
          state: 'CA',
        }],
      }))
    );

    vi.resetModules();
    await import('../../../public/html/state.js');

    await new Promise((r) => setTimeout(r, 100));

    expect(document.getElementById('pageTitle').textContent).toBe('Coffee Shops in California');
    expect(document.getElementById('totalShops').textContent).toBe('1');
    expect(document.querySelector('#coffeeList .coffee-item h3')?.textContent).toBe('Cafe Test');
  });

  // Same slug function the build uses to name the files; the two must agree
  it.each(['CA', 'NY', 'DC', 'PR', 'NC'])(
    'points canonical link and JSON-LD for %s at the prerendered static page',
    async (code) => {
      Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
      Object.defineProperty(window, 'location', {
        value: new URL(`http://localhost/html/state.html?code=${code}`),
        writable: true,
      });
      server.use(
        http.get('*/api/v1/config', () => HttpResponse.json({ success: true, data: { frontendUrl: 'http://localhost' } })),
        http.get(`*/api/v1/states/${code}`, () => HttpResponse.json({ success: true, data: [] }))
      );

      vi.resetModules();
      await import('../../../public/html/state.js');
      await new Promise((r) => setTimeout(r, 100));

      const staticPage = `http://localhost/pages/states/${stateSlug(enums, code)}.html`;
      expect(document.getElementById('canonicalUrl').getAttribute('href')).toBe(staticPage);
      const jsonLd = JSON.parse(document.getElementById('stateJsonLd').textContent);
      expect(jsonLd['@graph'][1]['@id']).toBe(staticPage);
    }
  );
});

// ---------------------------------------------------------------------------
// Pagination (#16): the API pages /states/:code; the page must show the real
// total and let users load the remaining pages.
// ---------------------------------------------------------------------------

const PRICES = ['PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE', 'PRICE_LEVEL_EXPENSIVE'];

function makeShops(n) {
  // Zero-padded names so API order == client-side name sort.
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    displayName: { text: `Shop ${String(i + 1).padStart(4, '0')}`, languageCode: 'en' },
    formattedAddress: `${i + 1} Main St, Los Angeles, CA`,
    priceLevel: PRICES[i % PRICES.length],
    state: 'CA',
  }));
}

/**
 * msw handler that pages `all` like the real API: honours `page` and `limit`
 * (default 100) and returns metadata.pagination. Records each request.
 */
function pagedStateHandler(all, requests, { failPages = new Set() } = {}) {
  return http.get('*/api/v1/states/CA', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') || 1);
    const limit = Number(url.searchParams.get('limit') || 100);
    requests.push({ page, limit });
    if (failPages.has(page)) {
      failPages.delete(page); // fail once, then succeed on retry
      return HttpResponse.json({ success: false, error: { message: 'boom' } }, { status: 400 });
    }
    const totalPages = Math.ceil(all.length / limit);
    return HttpResponse.json({
      success: true,
      data: all.slice((page - 1) * limit, page * limit),
      metadata: {
        pagination: { page, limit, total: all.length, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
        state: 'CA',
      },
    });
  });
}

async function waitFor(check, { timeout = 2000 } = {}) {
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

const items = () => document.querySelectorAll('#coffeeList .coffee-item:not(.error)');
const loadMoreButton = () => document.getElementById('loadMoreShops');

describe('state.js — pagination (#16)', () => {
  let requests;

  beforeEach(() => {
    mountDom();
    stubWindowDeps();
    requests = [];
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/html/state.html?code=CA'),
      writable: true,
    });
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
  });

  afterEach(() => {
    delete window.CoffeeShopEnums;
    delete window.CoffeeShopSkeleton;
    delete window.CoffeeShopStore;
    delete window.ApiClient;
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    vi.resetModules();
  });

  async function boot(handler) {
    server.use(
      http.get('*/api/v1/config', () => HttpResponse.json({ success: true, data: { frontendUrl: 'http://localhost' } })),
      handler
    );
    vi.resetModules();
    await import('../../../public/html/state.js');
  }

  it('shows the real total from pagination metadata and labels the average as covering loaded shops only', async () => {
    await boot(pagedStateHandler(makeShops(250), requests));

    await waitFor(() => expect(items()).toHaveLength(100));
    expect(requests[0]).toEqual({ page: 1, limit: 100 });
    expect(document.getElementById('totalShops').textContent).toBe('250');
    expect(document.getElementById('avgPrice').textContent).toMatch(/based on the 100 shops loaded so far/);

    const status = document.getElementById('shopListStatus');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('Showing 100 of 250 coffee shops');

    const btn = loadMoreButton();
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toBe('Load more (150 remaining)');
    expect(btn.getAttribute('aria-label')).toBe('Load 100 more coffee shops, 150 remaining');
  });

  it('formats large totals with thousands separators', async () => {
    await boot(pagedStateHandler(makeShops(1240), requests));
    await waitFor(() => expect(items()).toHaveLength(100));
    expect(document.getElementById('totalShops').textContent).toBe('1,240');
    expect(document.getElementById('shopListStatus').textContent).toBe('Showing 100 of 1,240 coffee shops');
  });

  it('"Load more" fetches the next pages, appends them, and moves focus to the first new shop', async () => {
    await boot(pagedStateHandler(makeShops(250), requests));
    await waitFor(() => expect(items()).toHaveLength(100));

    loadMoreButton().click();
    await waitFor(() => expect(items()).toHaveLength(200));
    expect(requests[1]).toEqual({ page: 2, limit: 100 });
    expect(items()[0].querySelector('h3').textContent).toBe('Shop 0001');
    expect(items()[100].querySelector('h3').textContent).toBe('Shop 0101');
    expect(document.activeElement).toBe(items()[100]);
    expect(document.getElementById('shopListStatus').textContent).toBe('Showing 200 of 250 coffee shops');
    expect(loadMoreButton().textContent).toBe('Load more (50 remaining)');
    expect(document.getElementById('avgPrice').textContent).toMatch(/based on the 200 shops loaded so far/);

    loadMoreButton().click();
    await waitFor(() => expect(items()).toHaveLength(250));
    expect(requests[2]).toEqual({ page: 3, limit: 100 });
    expect(loadMoreButton().hidden).toBe(true);
    expect(document.getElementById('shopListStatus').textContent).toBe('Showing all 250 coffee shops');
    expect(document.getElementById('totalShops').textContent).toBe('250');
    // Everything is loaded, so the average covers the whole state — no qualifier.
    expect(document.getElementById('avgPrice').textContent).not.toMatch(/loaded/);
    expect(requests).toHaveLength(3);
  });

  it('disables the button while a page is loading so double clicks fetch once', async () => {
    await boot(pagedStateHandler(makeShops(250), requests));
    await waitFor(() => expect(items()).toHaveLength(100));

    loadMoreButton().click();
    expect(loadMoreButton().disabled).toBe(true);
    expect(document.getElementById('coffeeList').getAttribute('aria-busy')).toBe('true');
    loadMoreButton().click();
    await waitFor(() => expect(items()).toHaveLength(200));
    expect(requests.filter((r) => r.page === 2)).toHaveLength(1);
    expect(loadMoreButton().disabled).toBe(false);
    expect(document.getElementById('coffeeList').getAttribute('aria-busy')).toBe('false');
  });

  it('keeps loaded shops and offers a retry when "Load more" fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await boot(pagedStateHandler(makeShops(250), requests, { failPages: new Set([2]) }));
    await waitFor(() => expect(items()).toHaveLength(100));

    loadMoreButton().click();
    await waitFor(() => expect(document.getElementById('loadMoreError').hidden).toBe(false));
    expect(document.getElementById('loadMoreError').getAttribute('role')).toBe('alert');
    expect(document.getElementById('loadMoreError').textContent).toMatch(/could not load more/i);
    expect(items()).toHaveLength(100);
    expect(loadMoreButton().disabled).toBe(false);
    expect(document.getElementById('totalShops').textContent).toBe('250');

    loadMoreButton().click();
    await waitFor(() => expect(items()).toHaveLength(200));
    expect(document.getElementById('loadMoreError').hidden).toBe(true);
    errSpy.mockRestore();
  });

  it('shows no load-more controls when everything fits on one page', async () => {
    await boot(pagedStateHandler(makeShops(12), requests));
    await waitFor(() => expect(items()).toHaveLength(12));
    expect(document.getElementById('totalShops').textContent).toBe('12');
    expect(document.getElementById('avgPrice').textContent).not.toMatch(/loaded/);
    const controls = document.getElementById('loadMoreControls');
    expect(controls === null || controls.hidden).toBe(true);
  });

  it('shows the empty state when the state has no shops', async () => {
    await boot(pagedStateHandler([], requests));
    await waitFor(() => expect(document.getElementById('coffeeList').textContent)
      .toBe('No coffee shops found in this state.'));
    expect(document.getElementById('totalShops').textContent).toBe('0');
  });
});
