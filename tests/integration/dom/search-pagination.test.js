/**
 * Integration Tests — search pagination in the real `public/frontend.js` (#16)
 *
 * The /search API pages its results (default 100 per page, metadata.pagination
 * with total/hasNext). The homepage must show the real total ("Showing X of
 * Y") and let users load past the first API page. "Load More" first reveals
 * already-fetched shops in client-side batches of 50, then fetches the next
 * API page when those run out.
 *
 * Unlike pagination.test.js (which exercises a test-local copy of the
 * batching logic), this file boots the actual frontend.js IIFE against msw.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../helpers/mockApi.js';
import { click, input } from '../../helpers/dom.js';

import enums from '../../../public/enums.js';
import skeleton from '../../../public/skeleton.js';
import storeMod from '../../../public/store.js';
import api from '../../../public/api-client.js';

const PRICES = ['PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE', 'PRICE_LEVEL_EXPENSIVE'];

function makeShops(n, prefix = 'Shop') {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    displayName: { text: `${prefix} ${i + 1}`, languageCode: 'en' },
    formattedAddress: `${i + 1} Congress Ave, Austin, TX`,
    priceLevel: PRICES[i % PRICES.length],
    state: 'TX',
  }));
}

/** msw /search handler that pages `all` like the real API and records requests. */
function pagedSearchHandler(all, requests, { failPages = new Set(), delayPages = new Map() } = {}) {
  return http.get('*/api/v1/search', async ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') || 1);
    const limit = Number(url.searchParams.get('limit') || 100);
    requests.push({
      page,
      limit,
      q: url.searchParams.get('q'),
      state: url.searchParams.get('state'),
      price: url.searchParams.get('price'),
    });
    if (delayPages.has(page)) await delay(delayPages.get(page));
    if (failPages.has(page)) {
      failPages.delete(page);
      return HttpResponse.json({ success: false, error: { message: 'boom' } }, { status: 400 });
    }
    const totalPages = Math.ceil(all.length / limit);
    return HttpResponse.json({
      success: true,
      data: all.slice((page - 1) * limit, page * limit),
      metadata: {
        pagination: { page, limit, total: all.length, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
        filters: { searchTerm: url.searchParams.get('q'), state: url.searchParams.get('state'), price: null },
      },
    });
  });
}

function createTestDOM() {
  const container = document.createElement('div');
  container.className = 'container';

  const serverStatus = document.createElement('div');
  serverStatus.id = 'serverStatus';
  container.appendChild(serverStatus);

  const searchInput = document.createElement('input');
  searchInput.id = 'searchInput';
  container.appendChild(searchInput);

  const stateFilter = document.createElement('select');
  stateFilter.id = 'stateFilter';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All States';
  stateFilter.appendChild(all);
  container.appendChild(stateFilter);

  const priceFilter = document.createElement('select');
  priceFilter.id = 'priceFilter';
  const anyPrice = document.createElement('option');
  anyPrice.value = '';
  priceFilter.appendChild(anyPrice);
  container.appendChild(priceFilter);

  const searchResults = document.createElement('div');
  searchResults.id = 'searchResults';
  container.appendChild(searchResults);

  const stateGrid = document.createElement('div');
  stateGrid.id = 'stateGrid';
  container.appendChild(stateGrid);

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

const results = () => document.querySelectorAll('#searchResults .coffee-item');
const resultCount = () => document.querySelector('#searchResults .result-count');
const loadMore = () => document.querySelector('#searchResults .load-more');

describe('frontend.js — search pagination (#16)', () => {
  let requests;

  beforeEach(() => {
    createTestDOM();
    requests = [];
    window.CoffeeShopEnums = enums;
    window.CoffeeShopSkeleton = skeleton;
    window.CoffeeShopStore = storeMod;
    window.ApiClient = api;
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/?state=TX'),
      writable: true,
    });
    window.history.replaceState = vi.fn();
  });

  afterEach(() => {
    delete window.CoffeeShopEnums;
    delete window.CoffeeShopSkeleton;
    delete window.CoffeeShopStore;
    delete window.ApiClient;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function boot(searchHandler) {
    server.use(
      http.get('*/api/v1/health', () => HttpResponse.json({ success: true, data: { status: 'ok' } })),
      searchHandler
    );
    vi.resetModules();
    await import('../../../public/frontend.js');
  }

  it('requests the first API page and shows the real total from metadata', async () => {
    await boot(pagedSearchHandler(makeShops(2560), requests));

    await waitFor(() => expect(results()).toHaveLength(50));
    expect(requests[0]).toMatchObject({ page: 1, limit: 100, state: 'TX' });
    expect(resultCount().textContent).toBe('Showing 50 of 2,560');
    expect(resultCount().getAttribute('role')).toBe('status');
    expect(resultCount().getAttribute('aria-live')).toBe('polite');
    expect(loadMore().textContent).toBe('Load More (2,510 remaining)');
    expect(loadMore().getAttribute('aria-label')).toBe('Load 50 more results, 2,510 remaining');
  });

  it('reveals fetched shops first, then fetches the next API page with the same filters', async () => {
    await boot(pagedSearchHandler(makeShops(230), requests));
    await waitFor(() => expect(results()).toHaveLength(50));

    // Shops 51-100 are already in memory: no request.
    click(loadMore());
    await waitFor(() => expect(results()).toHaveLength(100));
    expect(requests).toHaveLength(1);
    expect(resultCount().textContent).toBe('Showing 100 of 230');
    expect(document.activeElement).toBe(results()[50]);

    // Out of fetched shops: fetch API page 2.
    click(loadMore());
    await waitFor(() => expect(results()).toHaveLength(150));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ page: 2, limit: 100, state: 'TX' });
    expect(results()[100].querySelector('h3').textContent).toBe('Shop 101');
    expect(document.activeElement).toBe(results()[100]);
    expect(resultCount().textContent).toBe('Showing 150 of 230');
    expect(loadMore().textContent).toBe('Load More (80 remaining)');

    click(loadMore());
    await waitFor(() => expect(results()).toHaveLength(200));
    click(loadMore());
    await waitFor(() => expect(results()).toHaveLength(230));
    expect(requests.map((r) => r.page)).toEqual([1, 2, 3]);
    expect(resultCount().textContent).toBe('230 found');
    expect(loadMore()).toBeNull();
  });

  it('disables "Load More" while the next page is in flight so a double click fetches once', async () => {
    await boot(pagedSearchHandler(makeShops(230), requests, { delayPages: new Map([[2, 50]]) }));
    await waitFor(() => expect(results()).toHaveLength(50));
    click(loadMore());
    await waitFor(() => expect(results()).toHaveLength(100));

    click(loadMore());
    await waitFor(() => expect(loadMore().disabled).toBe(true));
    expect(loadMore().textContent).toBe('Loading...');
    click(loadMore());
    await waitFor(() => expect(results()).toHaveLength(150));
    expect(requests.filter((r) => r.page === 2)).toHaveLength(1);
    expect(loadMore().disabled).toBe(false);
  });

  it('keeps shown results and re-enables "Load More" when the next page fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await boot(pagedSearchHandler(makeShops(230), requests, { failPages: new Set([2]) }));
    await waitFor(() => expect(results()).toHaveLength(50));
    click(loadMore());
    await waitFor(() => expect(results()).toHaveLength(100));

    click(loadMore());
    await waitFor(() => expect(document.querySelector('.error-message')).not.toBeNull());
    expect(document.querySelector('.error-message').textContent).toMatch(/failed to load more/i);
    expect(results()).toHaveLength(100);
    expect(loadMore().disabled).toBe(false);
    expect(resultCount().textContent).toBe('Showing 100 of 230');

    // Retry succeeds.
    click(loadMore());
    await waitFor(() => expect(results()).toHaveLength(150));
  });

  it('drops a next-page response that arrives after a newer search replaced the results', async () => {
    const tx = makeShops(230);
    const latte = makeShops(3, 'Latte');
    server.use(
      http.get('*/api/v1/health', () => HttpResponse.json({ success: true, data: { status: 'ok' } })),
      http.get('*/api/v1/search', async ({ request }) => {
        const url = new URL(request.url);
        const page = Number(url.searchParams.get('page') || 1);
        requests.push({ page, q: url.searchParams.get('q') });
        if (url.searchParams.get('q') === 'latte') {
          return HttpResponse.json({ success: true, data: latte, metadata: { pagination: { page: 1, limit: 100, total: 3, totalPages: 1, hasNext: false, hasPrev: false } } });
        }
        if (page === 2) await delay(400);
        return HttpResponse.json({
          success: true,
          data: tx.slice((page - 1) * 100, page * 100),
          metadata: { pagination: { page, limit: 100, total: 230, totalPages: 3, hasNext: page < 3, hasPrev: page > 1 } },
        });
      })
    );
    vi.resetModules();
    await import('../../../public/frontend.js');

    await waitFor(() => expect(results()).toHaveLength(50));
    click(loadMore());
    await waitFor(() => expect(results()).toHaveLength(100));
    click(loadMore()); // page 2 starts, slow

    input(document.getElementById('searchInput'), 'latte');
    await waitFor(() => expect(resultCount()?.textContent).toBe('3 found'));
    await new Promise((r) => setTimeout(r, 500)); // let the stale page 2 land
    expect(results()).toHaveLength(3);
    expect(resultCount().textContent).toBe('3 found');
    expect(loadMore()).toBeNull();
  });

  it('skips shops already fetched when the next page overlaps (data shifted between requests)', async () => {
    const all = makeShops(230);
    server.use(
      http.get('*/api/v1/health', () => HttpResponse.json({ success: true, data: { status: 'ok' } })),
      http.get('*/api/v1/search', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') || 1);
        requests.push({ page });
        // Page 2 starts 10 rows early, as if 10 rows were inserted before it.
        const data = page === 1 ? all.slice(0, 100) : all.slice(90, 190);
        return HttpResponse.json({
          success: true,
          data,
          metadata: { pagination: { page, limit: 100, total: 230, totalPages: 3, hasNext: page < 3, hasPrev: page > 1 } },
        });
      })
    );
    vi.resetModules();
    await import('../../../public/frontend.js');

    await waitFor(() => expect(results()).toHaveLength(50));
    click(loadMore());
    await waitFor(() => expect(results()).toHaveLength(100));
    click(loadMore()); // fetches page 2 (shops 91-190; 91-100 are duplicates)
    await waitFor(() => expect(results()).toHaveLength(150));

    const names = [...results()].map((li) => li.querySelector('h3').textContent);
    expect(names[100]).toBe('Shop 101');
    expect(new Set(names).size).toBe(names.length);
  });

  it('falls back to a single page when an older cached ApiClient ignores withMeta', async () => {
    // Old ApiClient: get() returns the bare data array whatever the options.
    window.ApiClient = { ...api, get: (path, opts) => api.get(path, { ...opts, withMeta: false }) };
    await boot(pagedSearchHandler(makeShops(2560), requests));

    await waitFor(() => expect(results()).toHaveLength(50));
    expect(resultCount().textContent).toBe('Showing 50 of 100');
    click(loadMore());
    await waitFor(() => expect(results()).toHaveLength(100));
    expect(resultCount().textContent).toBe('100 found');
    expect(loadMore()).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it('a response without pagination metadata is treated as the full result set', async () => {
    // Default mockApi handler: 7 shops, no metadata.
    server.use(http.get('*/api/v1/health', () => HttpResponse.json({ success: true, data: { status: 'ok' } })));
    vi.resetModules();
    await import('../../../public/frontend.js');

    await waitFor(() => expect(results()).toHaveLength(7));
    expect(resultCount().textContent).toBe('7 found');
    expect(loadMore()).toBeNull();
  });
});
