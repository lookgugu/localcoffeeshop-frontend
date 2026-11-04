/**
 * Integration Tests — homepage when the initial API load fails (#25)
 *
 * Boots the real public/frontend.js against msw. When /states fails, the search box and both filters can't work, so they must be
 * disabled (and say why), the message must reflect the cause (rate limit vs
 * server error vs offline/network) without claiming an outage for every
 * failure, a "Try again" button must recover without duplicating listeners
 * or <option>s, and the static state directory (/pages/states/, no API
 * needed) must be offered.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../helpers/mockApi.js';
import { fixtureStates } from '../../helpers/fixtures.js';
import { click, input } from '../../helpers/dom.js';

import enums from '../../../public/enums.js';
import skeleton from '../../../public/skeleton.js';
import storeMod from '../../../public/store.js';
import api from '../../../public/api-client.js';
import shopActions from '../../../public/shop-actions.js';

function createTestDOM() {
  const container = document.createElement('main');
  container.className = 'container';
  container.innerHTML = `
    <div id="serverStatus" class="server-status" style="display: none;" role="alert" aria-live="polite">
      <p>⚠️ Unable to connect to the server. Please try again later or contact support if the problem persists.</p>
    </div>
    <div class="search-container" role="search">
      <input type="text" id="searchInput">
      <select id="stateFilter"><option value="">All States</option></select>
      <select id="priceFilter">
        <option value="">All Prices</option>
        <option value="PRICE_LEVEL_MODERATE">Moderate ($$)</option>
      </select>
    </div>
    <section id="searchResults" style="display: none;"></section>
    <section class="state-grid" id="stateGrid" role="grid"><div class="loading-indicator">Loading states from database...</div></section>
  `;
  document.body.appendChild(container);
}

async function waitFor(check, { timeout = 6000 } = {}) {
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

const $ = (id) => document.getElementById(id);
const controls = () => [$('searchInput'), $('stateFilter'), $('priceFilter')];
const status = () => $('serverStatus');
const retryButton = () => status().querySelector('button.retry-button');

const statesOk = () => http.get('*/api/v1/states', () => HttpResponse.json({ success: true, data: fixtureStates }));
const statesStatus = (code) => http.get('*/api/v1/states', () =>
  HttpResponse.json({ success: false, error: { message: 'nope' } }, { status: code }));

function expectUnavailable() {
  for (const el of controls()) {
    expect(el.disabled, el.id).toBe(true);
    expect(el.getAttribute('aria-disabled'), el.id).toBe('true');
    expect(el.getAttribute('aria-describedby'), el.id).toBe('serverStatusMessage');
  }
  expect(status().style.display).toBe('block');
  expect(status().getAttribute('role')).toBe('alert');
  expect($('serverStatusMessage')).not.toBeNull();
  const fallback = status().querySelector('a[href="/pages/states/"]');
  expect(fallback).not.toBeNull();
  expect(fallback.textContent).toMatch(/state directory/i);
  expect(retryButton().textContent).toBe('Try again');
  expect(retryButton().type).toBe('button');
}

describe('frontend.js — initial API failure (#25)', () => {
  let searchRequests;

  beforeEach(() => {
    createTestDOM();
    searchRequests = 0;
    window.CoffeeShopEnums = enums;
    window.CoffeeShopSkeleton = skeleton;
    window.CoffeeShopStore = storeMod;
    window.CoffeeShopActions = shopActions;
    window.ApiClient = api;
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
    Object.defineProperty(window, 'location', { value: new URL('http://localhost/'), writable: true });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.history.replaceState = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    delete window.CoffeeShopEnums;
    delete window.CoffeeShopSkeleton;
    delete window.CoffeeShopStore;
    delete window.CoffeeShopActions;
    delete window.ApiClient;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function boot(...handlers) {
    server.use(
      http.get('*/api/v1/search', () => {
        searchRequests += 1;
        return HttpResponse.json({ success: true, data: [] });
      }),
      ...handlers
    );
    vi.resetModules();
    await import('../../../public/frontend.js');
  }

  it('server error (5xx): disables search/filters, explains it as a server problem, offers retry + static directory', async () => {
    await boot(statesStatus(503));
    await waitFor(() => expect(retryButton()).not.toBeNull());

    expectUnavailable();
    const msg = $('serverStatusMessage').textContent;
    expect(msg).toMatch(/server/i);
    expect(msg).toMatch(/503/);
    expect(msg).not.toMatch(/offline|too many requests/i);
    // The grid points at the fallback too, instead of a dead "Loading..." or a bare error.
    expect($('stateGrid').querySelector('a[href="/pages/states/"]')).not.toBeNull();
    expect($('stateGrid').textContent).not.toMatch(/Loading states/);
  });

  it('rate limit (429): says so, and does not claim the server is down or unreachable', async () => {
    await boot(statesStatus(429));
    await waitFor(() => expect(retryButton()).not.toBeNull());

    expectUnavailable();
    const msg = $('serverStatusMessage').textContent;
    expect(msg).toMatch(/too many requests/i);
    expect(msg).toMatch(/wait/i);
    expect(msg).not.toMatch(/unable to connect|offline|down|problem/i);
  });

  it('offline (network error while navigator.onLine is false): says the device appears offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await boot(http.get('*/api/v1/states', () => HttpResponse.error()));
    await waitFor(() => expect(retryButton()).not.toBeNull());

    expectUnavailable();
    expect($('serverStatusMessage').textContent).toMatch(/offline/i);
  });

  it('network error while online: says the server could not be reached, without claiming the user is offline', async () => {
    await boot(http.get('*/api/v1/states', () => HttpResponse.error()));
    await waitFor(() => expect(retryButton()).not.toBeNull());

    expectUnavailable();
    const msg = $('serverStatusMessage').textContent;
    expect(msg).toMatch(/couldn.t reach/i);
    expect(msg).not.toMatch(/you appear to be offline|too many requests/i);
  });

  it('"Try again" recovers: re-enables controls, renders the grid, adds each state option once, keeps one listener', async () => {
    let statesCalls = 0;
    const flaky = http.get('*/api/v1/states', () => {
      statesCalls += 1;
      // The first two loads fail (ApiClient retries each 4x), then the API recovers.
      if (statesCalls <= 8) return HttpResponse.json({ success: false }, { status: 500 });
      return HttpResponse.json({ success: true, data: fixtureStates });
    });
    await boot(flaky);
    await waitFor(() => expect(retryButton()).not.toBeNull());

    // First retry fails again: still unavailable, button usable again.
    click(retryButton());
    expect(retryButton().disabled).toBe(true);
    await waitFor(() => expect(statesCalls).toBe(8));
    await waitFor(() => expect(retryButton().disabled).toBe(false));
    expectUnavailable();

    // Second retry succeeds.
    click(retryButton());
    await waitFor(() => expect(document.querySelectorAll('#stateGrid .state-card')).toHaveLength(fixtureStates.length));

    for (const el of controls()) {
      expect(el.disabled, el.id).toBe(false);
      expect(el.hasAttribute('aria-disabled'), el.id).toBe(false);
      expect(el.hasAttribute('aria-describedby'), el.id).toBe(false);
    }
    expect(status().style.display).toBe('none');
    expect($('stateFilter').querySelectorAll('option')).toHaveLength(fixtureStates.length + 1);

    // Exactly one input listener: one debounced search per edit.
    input($('searchInput'), 'latte');
    await waitFor(() => expect(searchRequests).toBe(1));
    await new Promise((r) => setTimeout(r, 400));
    expect(searchRequests).toBe(1);
  });

  it('a healthy load leaves the controls enabled and the status hidden', async () => {
    let healthCalls = 0;
    await boot(statesOk(), http.get('*/api/v1/health', () => {
      healthCalls += 1;
      return HttpResponse.json({ success: true, data: { status: 'ok' } });
    }));
    await waitFor(() => expect(document.querySelectorAll('#stateGrid .state-card')).toHaveLength(fixtureStates.length));

    for (const el of controls()) {
      expect(el.disabled, el.id).toBe(false);
      expect(el.hasAttribute('aria-disabled'), el.id).toBe(false);
    }
    expect(status().style.display).toBe('none');
    expect(retryButton()).toBeNull();
    // No serial /health round trip before /states: it delayed the grid by one mobile RTT.
    expect(healthCalls).toBe(0);
  });
});
