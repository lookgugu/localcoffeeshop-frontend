// @vitest-environment node
/**
 * Content Security Policy on every served page (#14)
 *
 * Production is a DigitalOcean App Platform static site, which can't set
 * response headers, so the CSP is a <meta http-equiv> tag in each page (see
 * scripts/csp.cjs). This test fails if a page the site serves is missing it,
 * has a stale copy, or has it too late in <head> to cover the page's scripts
 * and styles, and checks the policy allows the third-party assets the pages
 * actually load.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { CSP_DIRECTIVES, CSP_POLICY, CSP_META_TAG, REFERRER_META_TAG } = require('../../scripts/csp.cjs');
const prerender = require('../../scripts/prerender-states.cjs');
const enums = prerender.loadEnums();

const ROOT = resolve(__dirname, '../..');
const PUBLIC = join(ROOT, 'public');

/**
 * Every hand-written HTML page under public/ (all of it is served, as the
 * static site's output_dir). Skips build output: the root copies of
 * public/html/*.html made by `npm run build`, and the prerendered
 * public/pages/states/ (covered below through the template instead).
 */
function servedSourcePages() {
  const buildCopies = new Set(readdirSync(join(PUBLIC, 'html')).filter((f) => f.endsWith('.html')));
  const pages = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(PUBLIC, full);
      if (entry.isDirectory()) {
        if (rel === join('pages', 'states') || rel === 'dist') continue;
        walk(full);
      } else if (entry.name.endsWith('.html')) {
        if (dir === PUBLIC && buildCopies.has(entry.name)) continue;
        pages.push(rel);
      }
    }
  };
  walk(PUBLIC);
  return pages.sort();
}

function directive(name) {
  const d = CSP_DIRECTIVES.find((x) => x.split(' ')[0] === name);
  return d ? d.split(' ').slice(1) : null;
}

/** Does a CSP source list allow this absolute URL (host + optional path)? */
function allows(sources, url) {
  const u = new URL(url);
  return sources.some((src) => {
    if (!/^https?:\/\//.test(src)) return false;
    const s = new URL(src.replace('*.', 'wildcard.'));
    if (s.protocol !== u.protocol) return false;
    const hostOk = src.includes('://*.')
      ? u.hostname.endsWith(s.hostname.replace(/^wildcard/, ''))
      : u.hostname === s.hostname;
    const pathOk = s.pathname === '/' || (s.pathname.endsWith('/') ? u.pathname.startsWith(s.pathname) : u.pathname === s.pathname);
    return hostOk && pathOk;
  });
}

/** Asserts the page has exactly the current CSP meta, early in <head>. */
function expectPolicy(html, label) {
  const metas = html.match(/<meta[^>]+http-equiv=["']?Content-Security-Policy[^>]*>/gi) || [];
  expect(metas, `${label}: expected exactly one CSP meta tag`).toHaveLength(1);
  expect(metas[0], `${label}: CSP meta is stale; copy CSP_META_TAG from scripts/csp.cjs`).toBe(CSP_META_TAG);

  const head = html.slice(0, html.search(/<\/head>/i));
  const at = head.indexOf(CSP_META_TAG);
  expect(at, `${label}: CSP meta must be inside <head>`).toBeGreaterThan(-1);
  // A meta CSP only applies to content after it.
  const firstResource = head.search(/<(script|link|style)\b/i);
  if (firstResource !== -1) {
    expect(at, `${label}: CSP meta must come before the first <script>/<link>/<style>`).toBeLessThan(firstResource);
  }

  expect(html, `${label}: missing referrer meta`).toContain(REFERRER_META_TAG);
}

describe('Content Security Policy (#14)', () => {
  const pages = servedSourcePages();

  it('finds the served pages', () => {
    for (const p of ['html/index.html', 'html/state.html', 'html/about.html', 'html/submit.html', 'html/404.html', 'pages/contact.html']) {
      expect(pages).toContain(p);
    }
  });

  describe.each(pages)('%s', (page) => {
    it('carries the current policy before any script or stylesheet', () => {
      expectPolicy(readFileSync(join(PUBLIC, page), 'utf8'), page);
    });
  });

  describe('prerendered state pages', () => {
    const shops = [{ displayName: { text: 'Bean There' }, formattedAddress: '1 Main St', priceLevel: 'PRICE_LEVEL_MODERATE' }];

    it('state pages carry the policy, on every page of a paginated state', () => {
      const many = Array.from({ length: 600 }, (_, i) => ({ ...shops[0], displayName: { text: `Shop ${i}` } }));
      const out = prerender.renderStatePages(enums, { code: 'TX', shops: many });
      expect(out.length).toBeGreaterThan(1);
      for (const { fileName, html } of out) expectPolicy(html, `states/${fileName}`);
    });

    it('the states index carries the policy', () => {
      expectPolicy(prerender.renderIndexPage(enums, [{ code: 'TX', shops }]), 'states/index.html');
    });
  });

  describe('the policy itself', () => {
    it('is the policy the meta tag carries', () => {
      expect(CSP_META_TAG).toContain(`content="${CSP_POLICY}"`);
      expect(CSP_POLICY).not.toContain('"');
    });

    it('locks down plugins, <base> and form targets', () => {
      expect(directive('default-src')).toEqual(["'self'"]);
      expect(directive('object-src')).toEqual(["'none'"]);
      expect(directive('base-uri')).toEqual(["'self'"]);
      expect(directive('form-action')).toEqual(["'self'"]);
    });

    it('has no directives browsers ignore in a meta tag', () => {
      for (const ignored of ['frame-ancestors', 'report-uri', 'report-to', 'sandbox']) {
        expect(directive(ignored), ignored).toBeNull();
      }
    });

    it('allows every third-party script and stylesheet the pages load', () => {
      const scriptSrc = directive('script-src');
      const styleSrc = directive('style-src');
      const sources = [
        ...pages.map((p) => readFileSync(join(PUBLIC, p), 'utf8')),
        ...readdirSync(PUBLIC).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(PUBLIC, f), 'utf8')),
      ].join('\n');

      const scripts = [...sources.matchAll(/<script[^>]+src=["'](https?:\/\/[^"']+)["']/g)].map((m) => m[1]);
      const dynamicScripts = [...sources.matchAll(/\.src\s*=\s*[`'"](https?:\/\/[^`'"$]+)/g)].map((m) => m[1]);
      const styles = [...sources.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/g)]
        .concat([...sources.matchAll(/<link[^>]+href=["']https?:[^>]+rel=["']stylesheet["'][^>]*>/g)])
        .map((m) => (m[0].match(/href=["'](https?:\/\/[^"']+)["']/) || [])[1])
        .filter(Boolean);

      expect(scripts.length).toBeGreaterThan(0);
      for (const url of [...scripts, ...dynamicScripts]) expect(allows(scriptSrc, url), `script-src must allow ${url}`).toBe(true);
      for (const url of styles) expect(allows(styleSrc, url), `style-src must allow ${url}`).toBe(true);
    });

    it('allows the production API and GA4 collection endpoints', () => {
      const spec = readFileSync(join(ROOT, '.do/app-spec.yaml'), 'utf8');
      const api = spec.match(/key: API_BASE_URL\s+value: (\S+)/)[1];
      const connect = directive('connect-src');
      for (const url of [api, 'https://region1.google-analytics.com/g/collect', 'https://www.google-analytics.com/g/collect']) {
        expect(allows(connect, url), `connect-src must allow ${url}`).toBe(true);
      }
      expect(allows(directive('font-src'), 'https://fonts.gstatic.com/s/x.woff2')).toBe(true);
    });

    // "Accept All" in consent-banner.js grants the ad_* consents, so with
    // Google signals on, gtag uses the advertising-features endpoints from
    // https://developers.google.com/tag-platform/security/guides/csp#google_analytics
    // (*.google.<TLD> aside: only .com, see scripts/csp.cjs).
    it('allows what Google lists for GA4 with advertising features', () => {
      const required = {
        'script-src': ['https://www.googletagmanager.com/gtag/js'],
        'img-src': [
          'https://www.googletagmanager.com/a', 'https://region1.google-analytics.com/g/collect',
          'https://www.google.com/ads/ga-audiences', 'https://stats.g.doubleclick.net/g/collect',
        ],
        'connect-src': [
          'https://www.googletagmanager.com/a', 'https://region1.google-analytics.com/g/collect',
          'https://www.google.com/ccm/collect', 'https://stats.g.doubleclick.net/g/collect',
          'https://pagead2.googlesyndication.com/ccm/collect',
        ],
        'frame-src': ['https://www.googletagmanager.com/static/service_worker/x/sw_iframe.html'],
      };
      for (const [name, urls] of Object.entries(required)) {
        const sources = directive(name);
        expect(sources, `${name} must be set (default-src 'self' would block these)`).not.toBeNull();
        for (const url of urls) expect(allows(sources, url), `${name} must allow ${url}`).toBe(true);
      }
    });
  });

  it('netlify.toml is gone, so nothing implies headers that are not served', () => {
    expect(existsSync(join(ROOT, 'netlify.toml'))).toBe(false);
  });
});
