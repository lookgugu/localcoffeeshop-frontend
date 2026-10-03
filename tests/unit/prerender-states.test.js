// @vitest-environment node
/**
 * Unit Tests: scripts/prerender-states.cjs
 *
 * Covers fetching (pagination, envelope validation, retries), rendering
 * (escaping, pagination, JSON-LD positions, noindex for empty states) and the
 * build failure policy (skip in local dev, never write a partial set).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const prerender = require('../../scripts/prerender-states.cjs');
const { fetchStateShops, renderStatePages, renderIndexPage, pageFileName, isDeployBuild, resolveApiTarget, stateSlug, main } = prerender;

const enums = prerender.loadEnums();
const API = 'https://api.example.test/api/v1';
const SITE = 'https://localcoffeeshop.co';

const shop = (name, priceLevel = 'PRICE_LEVEL_MODERATE') => ({
  displayName: { text: name },
  formattedAddress: `1 ${name} St, Somewhere`,
  priceLevel,
});
const shops = (n, prefix = 'Shop') =>
  Array.from({ length: n }, (_, i) => shop(`${prefix} ${String(i + 1).padStart(4, '0')}`));

/** Fake fetch serving the API's paged envelope for every state. */
function pagedApi(byState, { pageLimitCap = 500 } = {}) {
  return vi.fn(async (url) => {
    const u = new URL(url);
    const code = u.pathname.split('/').pop();
    const page = Number(u.searchParams.get('page') || 1);
    const limit = Math.min(Number(u.searchParams.get('limit') || 100), pageLimitCap);
    const all = byState[code] || [];
    const data = all.slice((page - 1) * limit, page * limit);
    return Response.json({
      success: true,
      data,
      metadata: { pagination: { page, limit, total: all.length, hasNext: page * limit < all.length } },
    });
  });
}

const jsonLdOf = (html) =>
  JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

describe('stateSlug', () => {
  it('lowercases and hyphenates the state name', () => {
    expect(stateSlug(enums, 'CA')).toBe('california');
    expect(stateSlug(enums, 'NY')).toBe('new-york');
    expect(stateSlug(enums, 'nc')).toBe('north-carolina');
  });

  it('collapses punctuation in names like "Washington D.C."', () => {
    expect(stateSlug(enums, 'DC')).toBe('washington-d-c');
  });

  it('returns null for unknown or non-string codes', () => {
    expect(stateSlug(enums, 'XX')).toBe(null);
    expect(stateSlug(enums, null)).toBe(null);
  });

  it('gives every state a unique, URL-safe slug', () => {
    const slugs = enums.allStateCodes().map((c) => stateSlug(enums, c));
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe('resolveApiTarget', () => {
  it('uses an absolute API_BASE_URL as-is, minus trailing slashes', () => {
    expect(resolveApiTarget({ API_BASE_URL: 'https://api.example.test/api/v1/' }))
      .toEqual({ apiBase: 'https://api.example.test/api/v1' });
  });

  it('resolves a relative base against the site URL in a deploy build (same-origin API)', () => {
    expect(resolveApiTarget({ NODE_ENV: 'production', API_BASE_URL: '/api/v1' }))
      .toEqual({ apiBase: 'https://localcoffeeshop.co/api/v1' });
    expect(resolveApiTarget({ NODE_ENV: 'production', SITE_URL: 'https://staging.example.test/', API_BASE_URL: '/api/v1' }))
      .toEqual({ apiBase: 'https://staging.example.test/api/v1' });
  });

  it('defaults to /api/v1 like api-client.js when unset in a deploy build', () => {
    expect(resolveApiTarget({ NODE_ENV: 'production' }))
      .toEqual({ apiBase: 'https://localcoffeeshop.co/api/v1' });
  });

  it('skips local builds that only have a relative base', () => {
    expect(resolveApiTarget({ API_BASE_URL: '/api/v1' }).skip).toMatch(/relative/);
  });
});

describe('DigitalOcean App Platform spec', () => {
  // The safeguard only engages in deploy builds, detected via NODE_ENV. If the
  // spec stopped setting it (or the API URL) at build time, deploys would
  // silently skip the prerender and publish canonical links to missing pages.
  const spec = readFileSync(new URL('../../.do/app-spec.yaml', import.meta.url), 'utf8');
  const buildEnv = (key) => {
    const block = spec.match(new RegExp(`- key: ${key}\\n\\s+value: (\\S+)\\n\\s+scope: (\\S+)`));
    return block && { value: block[1], scope: block[2] };
  };

  it('marks builds as deploy builds (NODE_ENV=production at build time)', () => {
    const env = { NODE_ENV: buildEnv('NODE_ENV')?.value };
    expect(buildEnv('NODE_ENV')?.scope).toMatch(/BUILD_TIME|RUN_AND_BUILD_TIME/);
    expect(isDeployBuild(env)).toBe(true);
  });

  it('gives the build an absolute API_BASE_URL', () => {
    const api = buildEnv('API_BASE_URL');
    expect(api?.scope).toMatch(/BUILD_TIME|RUN_AND_BUILD_TIME/);
    expect(resolveApiTarget({ NODE_ENV: 'production', API_BASE_URL: api.value }))
      .toEqual({ apiBase: api.value.replace(/\/+$/, '') });
    expect(api.value).toMatch(/^https:\/\//);
  });
});

describe('fetchStateShops', () => {
  it('follows pagination until hasNext is false', async () => {
    const fetchImpl = pagedApi({ CA: shops(1240) });

    const result = await fetchStateShops(API, 'CA', { fetchImpl });

    expect(result).toHaveLength(1240);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.map(([url]) => new URL(url).search)).toEqual([
      '?page=1&limit=500', '?page=2&limit=500', '?page=3&limit=500',
    ]);
  });

  it('stops after one request when the API sends no pagination metadata', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ success: true, data: shops(3) }));

    await expect(fetchStateShops(API, 'CA', { fetchImpl })).resolves.toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects responses outside the { success, data: [] } envelope', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ success: true, data: { shops: [] } }));

    await expect(fetchStateShops(API, 'CA', { fetchImpl, retries: 0 }))
      .rejects.toThrow(/Unexpected response shape/);
  });

  it('retries transient failures before giving up', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ success: true, data: shops(2) }));

    await expect(fetchStateShops(API, 'CA', { fetchImpl, retries: 2 })).resolves.toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting retries', async () => {
    const fetchImpl = vi.fn(async () => new Response('down', { status: 500 }));

    await expect(fetchStateShops(API, 'CA', { fetchImpl, retries: 1 })).rejects.toThrow(/HTTP 500/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('renderStatePages', () => {
  it('renders a small state as one self-canonical page with no pagination', () => {
    const [page, ...rest] = renderStatePages(enums, { code: 'CA', shops: shops(3) });

    expect(rest).toEqual([]);
    expect(page.fileName).toBe('california.html');
    expect(page.html).toContain(`<link rel="canonical" href="${SITE}/pages/states/california.html">`);
    expect(page.html).toContain('<meta name="robots" content="index, follow">');
    expect(page.html).not.toContain('class="pagination"');
    expect(page.html).not.toMatch(/<link rel="(prev|next)"/);
  });

  it('splits large states into 250-shop pages with prev/next links', () => {
    const pages = renderStatePages(enums, { code: 'TX', shops: shops(2560) });

    expect(pages.map((p) => p.fileName)).toEqual(
      Array.from({ length: 11 }, (_, i) => pageFileName('texas', i + 1))
    );
    expect(pages[0].fileName).toBe('texas.html');
    expect(pages[10].fileName).toBe('texas-11.html');

    const second = pages[1].html;
    expect(second).toContain(`<link rel="canonical" href="${SITE}/pages/states/texas-2.html">`);
    expect(second).toContain(`<link rel="prev" href="${SITE}/pages/states/texas.html">`);
    expect(second).toContain(`<link rel="next" href="${SITE}/pages/states/texas-3.html">`);
    expect(second).toContain('Showing 251–500 of 2560');
    expect(second).toContain('<span aria-current="page">2</span>');

    expect(pages[0].html).not.toContain('<link rel="prev"');
    expect(pages[10].html).not.toContain('<link rel="next"');
    expect((pages[10].html.match(/<li class="coffee-item">/g) || []).length).toBe(60);
  });

  it('numbers JSON-LD positions continuously across pages', () => {
    const pages = renderStatePages(enums, { code: 'TX', shops: shops(600) });

    const positions = pages.flatMap((p) =>
      jsonLdOf(p.html)['@graph'][1].mainEntity.itemListElement.map((item) => item.position));
    expect(positions).toEqual(Array.from({ length: 600 }, (_, i) => i + 1));

    const secondGraph = jsonLdOf(pages[1].html)['@graph'];
    expect(secondGraph[1]['@id']).toBe(`${SITE}/pages/states/texas-2.html`);
    // Breadcrumb points at the state's first page, not the current one
    expect(secondGraph[0].itemListElement[2].item).toBe(`${SITE}/pages/states/texas.html`);
  });

  it('sorts shops by name, matching the dynamic page', () => {
    const [page] = renderStatePages(enums, { code: 'CA', shops: [shop('Zeta'), shop('Alpha'), shop('Mid')] });

    const names = [...page.html.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
    expect(names).toEqual(['Alpha', 'Mid', 'Zeta']);
  });

  it('escapes shop data in HTML and in JSON-LD', () => {
    const hostile = {
      displayName: { text: '</script><script>alert(1)</script>' },
      formattedAddress: '<img src=x onerror=alert(1)> & "quotes"',
      priceLevel: 'PRICE_LEVEL_MODERATE',
    };

    const [page] = renderStatePages(enums, { code: 'CA', shops: [hostile] });

    // Exactly one <script> tag: the JSON-LD block itself
    expect(page.html.match(/<script/g)).toHaveLength(1);
    expect(page.html).not.toContain('<img');
    expect(page.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot;');
    // JSON-LD still round-trips to the original text
    const item = jsonLdOf(page.html)['@graph'][1].mainEntity.itemListElement[0].item;
    expect(item.name).toBe(hostile.displayName.text);
    expect(item.address).toBe(hostile.formattedAddress);
  });

  it('maps price levels to schema.org priceRange and omits unknown ones', () => {
    const [page] = renderStatePages(enums, {
      code: 'CA',
      shops: [shop('A', 'PRICE_LEVEL_INEXPENSIVE'), shop('B', 'PRICE_LEVEL_EXPENSIVE'), shop('C', null)],
    });

    const items = jsonLdOf(page.html)['@graph'][1].mainEntity.itemListElement.map((i) => i.item);
    expect(items.map((i) => i.priceRange)).toEqual(['$', '$$$', undefined]);
  });

  it('renders one noindex page for a state with no shops', () => {
    const pages = renderStatePages(enums, { code: 'WY', shops: [] });

    expect(pages).toHaveLength(1);
    expect(pages[0].fileName).toBe('wyoming.html');
    expect(pages[0].html).toContain('<meta name="robots" content="noindex, follow">');
    expect(pages[0].html).toContain('No coffee shops listed in this state yet.');
  });
});

describe('renderIndexPage', () => {
  it('lists every state alphabetically with real counts, linking page 1', () => {
    const html = renderIndexPage(enums, [
      { code: 'TX', shops: shops(2) },
      { code: 'AL', shops: shops(1) },
    ]);

    const links = [...html.matchAll(/<a href="\/pages\/states\/([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
    expect(links).toEqual([['alabama.html', 'Alabama'], ['texas.html', 'Texas']]);
    expect(html).toContain('<p>1 coffee shop</p>');
    expect(html).toContain('<p>2 coffee shops</p>');
  });
});

describe('main (build step)', () => {
  let outDir;
  const log = { log: vi.fn(), warn: vi.fn() };

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'prerender-'));
    writeFileSync(join(outDir, 'previous.html'), 'last good build');
    log.log.mockClear();
    log.warn.mockClear();
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('skips with a warning when API_BASE_URL is not an absolute URL (local dev)', async () => {
    const fetchImpl = vi.fn();

    const result = await main({ env: { API_BASE_URL: '/api/v1' }, fetchImpl, outDir, log });

    expect(result.skipped).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Skipping state prerender'));
    expect(readdirSync(outDir)).toEqual(['previous.html']);
  });

  it('never skips a deploy build: a relative base is fetched from the site, and failures fail the build', async () => {
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 }));

    await expect(main({
      env: { NODE_ENV: 'production', API_BASE_URL: '/api/v1' },
      fetchImpl, outDir, log,
    })).rejects.toThrow(/HTTP 404/);

    expect(fetchImpl.mock.calls[0][0]).toMatch(/^https:\/\/localcoffeeshop\.co\/api\/v1\/states\//);
    expect(log.warn).not.toHaveBeenCalled();
    expect(readdirSync(outDir)).toEqual(['previous.html']);
  });

  it('writes every state page plus an index, replacing the previous output', async () => {
    const byState = Object.fromEntries(enums.allStateCodes().map((c) => [c, shops(2, c)]));
    byState.TX = shops(300, 'TX');

    await main({ env: { API_BASE_URL: API }, fetchImpl: pagedApi(byState), outDir, log });

    const files = readdirSync(outDir);
    expect(files).not.toContain('previous.html');
    expect(files).toContain('index.html');
    expect(files).toContain('texas-2.html');
    // 52 states, Texas has two pages, plus the index
    expect(files).toHaveLength(52 + 1 + 1);
    expect(readFileSync(join(outDir, 'texas.html'), 'utf8')).toContain('Total Coffee Shops: <span>300</span>');
  });

  it('leaves the previous output untouched when any state fails, so the build can fail safely', async () => {
    const ok = pagedApi(Object.fromEntries(enums.allStateCodes().map((c) => [c, shops(1, c)])));
    const fetchImpl = vi.fn(async (url, init) =>
      url.includes('/states/NV?') ? new Response('down', { status: 500 }) : ok(url, init));

    await expect(main({ env: { NODE_ENV: 'production', API_BASE_URL: API }, fetchImpl, outDir, log }))
      .rejects.toThrow(/HTTP 500/);

    expect(readdirSync(outDir)).toEqual(['previous.html']);
  });

  it('only warns in a local build when the API is unreachable, keeping existing pages', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed'); });

    const result = await main({ env: { API_BASE_URL: 'http://localhost:3000/api/v1' }, fetchImpl, outDir, log });

    expect(result.skipped).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("couldn't fetch from http://localhost:3000/api/v1"));
    expect(readdirSync(outDir)).toEqual(['previous.html']);
  });
});
