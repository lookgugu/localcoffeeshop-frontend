/**
 * Homepage build step (scripts/optimize-home.cjs): the state grid and filter
 * options are prerendered into public/index.html, and the stylesheet and
 * config.js are inlined, so a cold mobile visit paints real content without
 * waiting on the API or extra round trips.
 *
 * The prerendered grid must be the markup frontend.js renders itself (so the
 * live re-render on load changes nothing visible), and hydrating over it must
 * not duplicate the <option>s.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { http, HttpResponse } from 'msw';
import { server } from '../../helpers/mockApi.js';
import { fixtureStates } from '../../helpers/fixtures.js';

import enums from '../../../public/enums.js';
import skeleton from '../../../public/skeleton.js';
import storeMod from '../../../public/store.js';
import api from '../../../public/api-client.js';
import shopActions from '../../../public/shop-actions.js';

const require = createRequire(import.meta.url);
const home = require('../../../scripts/optimize-home.cjs');

const ROOT = resolve(__dirname, '../../..');
const SOURCE = readFileSync(join(ROOT, 'public/html/index.html'), 'utf8');
const API = 'https://api.example.test/api/v1';
const ENV = { API_BASE_URL: API, NODE_ENV: 'development' };
const silent = { log() {}, warn() {} };
const FAKE_FILES = {
  '/dist/styles.min.css': '.state-card{color:red}',
  '/config.js': "window.APP_CONFIG = { API_BASE_URL: 'x' };",
};

const okFetch = async (url) => {
  expect(url).toBe(`${API}/states`);
  return Response.json({ success: true, data: fixtureStates });
};

/** Run the build step over a copy of the source homepage. */
async function build(fetchImpl = okFetch) {
  const file = join(mkdtempSync(join(tmpdir(), 'home-')), 'index.html');
  writeFileSync(file, SOURCE);
  const { html } = await home.main({ env: ENV, fetchImpl, file, read: (url) => FAKE_FILES[url], log: silent });
  return html;
}

const sortedCodes = fixtureStates.map((s) => s.state_code).sort();

describe('scripts/optimize-home.cjs', () => {
  it('prerenders one card and one filter option per state, sorted by code', async () => {
    const doc = new DOMParser().parseFromString(await build(), 'text/html');
    const cards = [...doc.querySelectorAll('#stateGrid .state-card')];
    expect(cards.map((c) => c.id)).toEqual(sortedCodes.map((c) => `state-card-${c}`));
    expect(doc.querySelector('#stateGrid .loading-indicator')).toBeNull();
    expect(cards[0].querySelector('a').getAttribute('href')).toBe(`/html/state.html?code=${sortedCodes[0]}`);
    const options = [...doc.querySelectorAll('#stateFilter option')].map((o) => o.value);
    expect(options).toEqual(['', ...sortedCodes]);
  });

  it('inlines the stylesheet and config.js, and leaves the analytics scripts external and parser-blocking', async () => {
    const html = await build();
    expect(html).not.toContain('href="/dist/styles.min.css"');
    expect(html).toContain('<style>.state-card{color:red}</style>');
    expect(html).not.toContain('src="/config.js"');
    expect(html).toContain(`<script>${FAKE_FILES['/config.js']}</script>`);
    for (const src of ['/geo-consent-default.js', '/url-privacy.js', '/analytics-init.js']) {
      expect(html).toContain(`<script src="${src}"></script>`);
    }
  });

  it('when the API is unreachable, keeps the loading indicator but still inlines', async () => {
    const html = await build(async () => { throw new TypeError('fetch failed'); });
    expect(html).toContain('Loading states from database...');
    expect(html).not.toContain('class="state-card"');
    expect(html).toContain('<style>');
  });

  it('fails loudly if the page no longer has what it rewrites', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'home-')), 'index.html');
    writeFileSync(file, SOURCE.replace('<link rel="stylesheet" href="/dist/styles.min.css">', ''));
    await expect(home.main({ env: ENV, fetchImpl: okFetch, file, read: (url) => FAKE_FILES[url], log: silent }))
      .rejects.toThrow(/styles\.min\.css link/);
  });
});

describe('frontend.js over the prerendered homepage', () => {
  beforeEach(async () => {
    const doc = new DOMParser().parseFromString(await build(), 'text/html');
    document.body.innerHTML = doc.querySelector('main').outerHTML;
    window.CoffeeShopEnums = enums;
    window.CoffeeShopSkeleton = skeleton;
    window.CoffeeShopStore = storeMod;
    window.CoffeeShopActions = shopActions;
    window.ApiClient = api;
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
    Object.defineProperty(window, 'location', { value: new URL('http://localhost/'), writable: true });
    window.history.replaceState = vi.fn();
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

  it('re-renders the same grid markup it was prerendered with, without duplicating options', async () => {
    const grid = document.getElementById('stateGrid');
    const prerendered = grid.innerHTML;
    // Marks a prerendered node, so we can tell when frontend.js has replaced it.
    const marker = grid.querySelector('.state-card');
    let statesCalls = 0;
    server.use(http.get('*/api/v1/states', () => {
      statesCalls += 1;
      return HttpResponse.json({ success: true, data: fixtureStates });
    }));
    vi.resetModules();
    await import('../../../public/frontend.js');

    for (let i = 0; i < 300 && grid.contains(marker); i++) await new Promise((r) => setTimeout(r, 10));

    expect(grid.contains(marker)).toBe(false);
    expect(statesCalls).toBe(1);
    expect(grid.innerHTML).toBe(prerendered);
    expect(document.querySelectorAll('#stateFilter option')).toHaveLength(fixtureStates.length + 1);
  });
});
