// @vitest-environment node
/**
 * Page asset loading (#7)
 *
 * The homepage and state page declare their CSS and JS in markup (no
 * JS-injected assets), so the browser's preload scanner can fetch them in
 * parallel and the page JS stays off the critical rendering path (`defer`).
 * Each page's JS is one bundle built by scripts/build-js.cjs: its deps in
 * order, then the page code, which throws if a dep global is missing.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { BUNDLES, buildBundle } = require('../../scripts/build-js.cjs');

const PUBLIC = resolve(__dirname, '../../public');

const PAGES = {
  'html/index.html': { bundle: 'dist/app.bundle.min.js', pageCode: 'frontend.js' },
  'html/state.html': { bundle: 'dist/state.bundle.min.js', pageCode: 'html/state.js' },
};

// Parser-blocking on purpose: config + consent defaults must run before gtag.
const BLOCKING_SCRIPTS = ['/config.js', '/geo-consent-default.js'];

const DEP_GLOBALS = ['CoffeeShopEnums', 'CoffeeShopSkeleton', 'ApiClient', 'CoffeeShopStore'];

function head(page) {
  const html = readFileSync(join(PUBLIC, page), 'utf8');
  return html.slice(0, html.indexOf('</head>'));
}

/** <script> tags in document order as { src, defer, async, inline }. */
function scripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map(([, attrs, body]) => ({
    src: attrs.match(/\bsrc="([^"]+)"/)?.[1] ?? null,
    defer: /\bdefer\b/.test(attrs),
    async: /\basync\b/.test(attrs),
    type: attrs.match(/\btype="([^"]+)"/)?.[1] ?? null,
    body,
  }));
}

const stylesheets = (html) =>
  [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)].map(([tag]) => tag.match(/\bhref="([^"]+)"/)[1]);

/**
 * Run a bundle the way a browser runs a classic script, in a bare global with
 * a still-loading document, so page code registers its init instead of running.
 */
function runBundle(code, filename) {
  const listeners = [];
  const sandbox = {
    document: { readyState: 'loading', addEventListener: (type) => listeners.push(type) },
    navigator: {},
    location: { origin: 'https://localcoffeeshop.co', search: '' },
    addEventListener: () => {},
    console,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename });
  return { window: sandbox, listeners };
}

describe.each(Object.entries(PAGES))('%s', (page, { bundle, pageCode }) => {
  const html = head(page);
  const tags = scripts(html);
  const sameOrigin = tags.filter((t) => t.src && t.src.startsWith('/'));

  it('declares its stylesheet in markup', () => {
    expect(stylesheets(html)).toContain('/dist/styles.min.css');
  });

  it('declares its bundle in markup, deferred, instead of an asset loader', () => {
    expect(html).not.toMatch(/asset-loader/);
    expect(sameOrigin).toContainEqual(expect.objectContaining({ src: `/${bundle}`, defer: true }));
  });

  it('only blocks the parser for config and consent defaults', () => {
    const blocking = sameOrigin.filter((t) => !t.defer && !t.async).map((t) => t.src);
    expect(blocking).toEqual(BLOCKING_SCRIPTS);
  });

  it('queues consent defaults before the Google tag', () => {
    const idx = (pred) => tags.findIndex(pred);
    const geo = idx((t) => t.src === '/geo-consent-default.js');
    const consentDefault = idx((t) => /gtag\('consent',\s*'default'/.test(t.body));
    const gtagJs = idx((t) => t.src?.startsWith('https://www.googletagmanager.com/gtag/js?id=G-YVSXN7PM48'));
    const gtagConfig = idx((t) => /gtag\('config',\s*'G-YVSXN7PM48'\)/.test(t.body));

    expect(geo).toBeGreaterThan(-1);
    expect(geo).toBeLessThan(consentDefault);
    expect(consentDefault).toBeLessThan(gtagJs);
    expect(gtagJs).toBeLessThan(gtagConfig);
    expect(tags[gtagJs].async).toBe(true);
  });

  it('loads the consent banner', () => {
    expect(sameOrigin).toContainEqual(expect.objectContaining({ src: '/consent-banner.js', defer: true }));
  });

  it('bundles the page code last, after its dependencies in order', () => {
    const files = BUNDLES[bundle];
    expect(files.at(-1)).toBe(pageCode);
    const order = ['enums.js', 'skeleton.js', 'api-client.js', 'store.js', pageCode].map((f) => files.indexOf(f));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(files).toEqual(expect.arrayContaining(['connection-banner.js', 'service-worker-registration.js']));
  });

  it('bundle runs as one classic script: deps publish globals and page code finds them', async () => {
    const { window, listeners } = runBundle(await buildBundle(BUNDLES[bundle]), bundle);
    for (const name of DEP_GLOBALS) expect(window[name], name).toBeTruthy();
    // Page code got past its hard-dep checks and scheduled its init.
    expect(listeners).toContain('DOMContentLoaded');
  });

  it('precaches every same-origin asset it needs for offline use', () => {
    const swSource = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');
    const precached = new Function('self', `${swSource}\nreturn STATIC_ASSETS;`)({ addEventListener() {} });
    // config.js is regenerated per environment and isn't precached (pre-existing;
    // api-client falls back to a default base URL without it).
    const needed = [...stylesheets(html), ...sameOrigin.map((t) => t.src)].filter((u) => u !== '/config.js');
    expect(precached).toEqual(expect.arrayContaining(needed));
  });
});

// /dist URLs served before #7, when each held a single file. Returning
// visitors' old service workers still hold these in their precache and serve
// them cache-first, so pages and the precache list must never point at them.
const RETIRED_DIST_URLS = [
  'app.min.js',
  'state.min.js',
  'enums.min.js',
  'skeleton.min.js',
  'api-client.min.js',
  'store.min.js',
  'connection-banner.min.js',
  'service-worker-registration.min.js',
].map((f) => `/dist/${f}`);

describe('retired pre-#7 dist URLs', () => {
  const htmlDir = join(PUBLIC, 'html');
  const pages = readdirSync(htmlDir).filter((f) => f.endsWith('.html'));

  it.each(pages)('html/%s does not reference them', (page) => {
    const refs = [...readFileSync(join(htmlDir, page), 'utf8').matchAll(/\b(?:src|href)="([^"]+)"/g)]
      .map(([, url]) => new URL(url, `https://site.invalid/html/${page}`).pathname);
    expect(refs.filter((r) => RETIRED_DIST_URLS.includes(r))).toEqual([]);
  });

  it('are not bundle outputs or precached', () => {
    const swSource = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');
    const precached = new Function('self', `${swSource}\nreturn STATIC_ASSETS;`)({ addEventListener() {} });
    const outputs = Object.keys(BUNDLES).map((b) => `/${b}`);
    expect([...outputs, ...precached].filter((u) => RETIRED_DIST_URLS.includes(u))).toEqual([]);
  });
});

describe('bundles', () => {
  it('build one bundle per page and nothing else', () => {
    expect(Object.keys(BUNDLES).sort()).toEqual(Object.values(PAGES).map((p) => p.bundle).sort());
  });
});
