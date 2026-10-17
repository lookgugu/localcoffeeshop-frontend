// @vitest-environment node
/**
 * scripts/smoke-check.cjs: GET-only smoke check of the public site and the
 * API's basic contract. Quiet on success (exit 0); on failure, one actionable
 * line per problem on stderr and exit 1. Never sends anything but GETs, and
 * never runs page JavaScript (so no analytics fire).
 */

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runSmokeCheck, main, DEFAULT_SITE_URL, DEFAULT_API_URL } = require('../../scripts/smoke-check.cjs');

const SITE = 'https://site.test';
const API = 'https://api.test/api/v1';

const HOME = '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"><script defer src="/dist/app.bundle.min.js"></script></head><body><section id="stateGrid"></section></body></html>';
const DIRECTORY = '<html><body><a href="/pages/states/california.html">California</a></body></html>';
const STATE_PAGE = '<html><body><ul id="coffeeList"></ul><script defer src="/dist/state.bundle.min.js"></script></body></html>';

const envelope = (data, metadata) => ({ success: true, data, ...(metadata ? { metadata } : {}) });

/** Healthy fake site + API; `overrides` maps a URL to a Response factory. */
function fakeFetch(overrides = {}) {
  const routes = {
    [`${SITE}/`]: () => new Response(HOME, { headers: { 'content-type': 'text/html' } }),
    [`${SITE}/pages/states/`]: () => new Response(DIRECTORY, { headers: { 'content-type': 'text/html' } }),
    [`${SITE}/html/state.html`]: () => new Response(STATE_PAGE, { headers: { 'content-type': 'text/html' } }),
    [`${SITE}/dist/app.bundle.min.js`]: () => new Response('(function(){})();', { headers: { 'content-type': 'application/javascript' } }),
    [`${API}/health`]: () => Response.json(envelope({ status: 'ok' })),
    [`${API}/states`]: () => Response.json(envelope([{ state_code: 'CA', shop_count: 10, avg_price_level: 2 }])),
    [`${API}/states/CA?page=1&limit=1`]: () => Response.json(envelope(
      [{ displayName: { text: 'A' }, formattedAddress: '1 A St', state: 'CA' }],
      { pagination: { page: 1, limit: 1, total: 10, hasNext: true } }
    )),
    ...overrides,
  };
  return vi.fn(async (url, init = {}) => {
    const route = routes[url];
    if (!route) return new Response('not found', { status: 404 });
    return route(init);
  });
}

const run = (fetchImpl) => runSmokeCheck({ siteUrl: SITE, apiUrl: API, fetchImpl, timeoutMs: 1000 });

describe('runSmokeCheck', () => {
  it('reports no problems for a healthy site and API', async () => {
    const fetchImpl = fakeFetch();
    expect(await run(fetchImpl)).toEqual([]);
  });

  it('only ever sends GET requests without a body, to the site and API only (no analytics)', async () => {
    const fetchImpl = fakeFetch();
    await run(fetchImpl);
    expect(fetchImpl).toHaveBeenCalled();
    for (const [url, init = {}] of fetchImpl.mock.calls) {
      expect(init.method ?? 'GET').toBe('GET');
      expect(init.body).toBeUndefined();
      expect(url.startsWith(SITE) || url.startsWith(API)).toBe(true);
      expect(url).not.toMatch(/google|analytics|gtag|doubleclick/);
    }
  });

  it('keeps API traffic small (the API allows 100 requests / 15 min per IP)', async () => {
    const fetchImpl = fakeFetch();
    await run(fetchImpl);
    expect(fetchImpl.mock.calls.filter(([u]) => u.startsWith(API)).length).toBeLessThanOrEqual(3);
  });

  it('names the URL and status when a page is down', async () => {
    const problems = await run(fakeFetch({ [`${SITE}/pages/states/`]: () => new Response('oops', { status: 503 }) }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${SITE}/pages/states/`);
    expect(problems[0]).toMatch(/HTTP 503/);
  });

  it('flags a homepage that lost its CSP, bundle or state grid', async () => {
    const problems = await run(fakeFetch({ [`${SITE}/`]: () => new Response('<html><body>hello</body></html>') }));
    expect(problems.join('\n')).toMatch(/Content-Security-Policy/);
    expect(problems.join('\n')).toMatch(/app\.bundle\.min\.js/);
    expect(problems.join('\n')).toMatch(/stateGrid/);
  });

  it('flags a broken /states contract with what was expected', async () => {
    const problems = await run(fakeFetch({ [`${API}/states`]: () => Response.json(envelope([{ code: 'CA' }])) }));
    expect(problems.join('\n')).toMatch(/\/states.*state_code.*shop_count/);
  });

  it('flags a per-state page without pagination metadata', async () => {
    const problems = await run(fakeFetch({ [`${API}/states/CA?page=1&limit=1`]: () => Response.json(envelope([])) }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/metadata\.pagination\.total/);
  });

  it('calls out a non-envelope or success:false API response', async () => {
    const problems = await run(fakeFetch({ [`${API}/health`]: () => Response.json({ ok: true }) }));
    expect(problems.join('\n')).toMatch(/\/health.*envelope/);
  });

  it('distinguishes rate limiting (429) from an outage', async () => {
    const problems = await run(fakeFetch({
      [`${API}/states`]: () => new Response('slow down', { status: 429, headers: { 'retry-after': '120' } }),
    }));
    expect(problems.join('\n')).toMatch(/rate.limited.*429.*retry after 120s/i);
  });

  it('reports network errors with the URL', async () => {
    const fetchImpl = fakeFetch({ [`${API}/health`]: () => { throw new TypeError('fetch failed'); } });
    const problems = await run(fetchImpl);
    expect(problems.join('\n')).toMatch(new RegExp(`${API}/health.*fetch failed`));
  });

  it('skips the per-state check when /states gave nothing usable', async () => {
    const fetchImpl = fakeFetch({ [`${API}/states`]: () => new Response('x', { status: 500 }) });
    await run(fetchImpl);
    expect(fetchImpl.mock.calls.some(([u]) => u.startsWith(`${API}/states/`))).toBe(false);
  });
});

describe('main (CLI)', () => {
  it('is silent and exits 0 on success', async () => {
    const log = { log: vi.fn(), error: vi.fn() };
    const code = await main({ env: { SMOKE_SITE_URL: SITE, SMOKE_API_URL: API }, fetchImpl: fakeFetch(), log });
    expect(code).toBe(0);
    expect(log.log).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('prints each problem to stderr and exits 1 on failure', async () => {
    const log = { log: vi.fn(), error: vi.fn() };
    const code = await main({
      env: { SMOKE_SITE_URL: SITE, SMOKE_API_URL: API },
      fetchImpl: fakeFetch({ [`${API}/health`]: () => new Response('down', { status: 502 }) }),
      log,
    });
    expect(code).toBe(1);
    const out = log.error.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toMatch(/smoke check failed/i);
    expect(out).toMatch(/HTTP 502/);
  });

  it('defaults to production URLs', () => {
    expect(DEFAULT_SITE_URL).toBe('https://localcoffeeshop.co');
    expect(DEFAULT_API_URL).toBe('https://api.localcoffeeshop.co/api/v1');
  });
});
