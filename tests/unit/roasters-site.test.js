// @vitest-environment node
/**
 * The curated roaster directory wired into the site (#50): the committed
 * data passes the checker, the generated page carries every row without JS,
 * loads analytics only through the consent-first external scripts (no inline
 * JS), and is reachable from the homepage, nav, sitemap and llms.txt.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const roasters = require('../../scripts/roasters.cjs');
const { sitemapUrls } = require('../../scripts/generate-sitemap.cjs');

const ROOT = resolve(__dirname, '../..');
const PUBLIC = join(ROOT, 'public');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const NEW_ENGLAND = ['CT', 'MA', 'ME', 'NH', 'RI', 'VT'];

const data = roasters.loadRoasters();
const page = roasters.renderRoastersPage(data);

describe('committed roaster data (data/roasters.json)', () => {
  it('passes the checker with no errors', () => {
    expect(roasters.validateRoasters(data).errors).toEqual([]);
  });

  it('is the initial New England collection: 15-25 unique roasters, mostly Massachusetts', () => {
    const rows = data.roasters;
    expect(rows.length).toBeGreaterThanOrEqual(15);
    expect(rows.length).toBeLessThanOrEqual(25);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const r of rows) expect(NEW_ENGLAND, r.id).toContain(r.state);
    const ma = rows.filter((r) => r.state === 'MA').length;
    expect(ma).toBe(Math.max(...NEW_ENGLAND.map((s) => rows.filter((r) => r.state === s).length)));
  });

  it('is stored sorted by id, so diffs stay reviewable', () => {
    const ids = data.roasters.map((r) => r.id);
    expect(ids).toEqual([...ids].sort());
  });
});

describe('generated /roasters/ page', () => {
  it('has every roaster, its shop link and official site in the HTML (no JS needed)', () => {
    const body = page.slice(page.indexOf('<body'));
    for (const r of data.roasters) {
      expect(body).toContain(`id="roaster-${r.id}"`);
      expect(body).toContain(`href="${r.shopUrl}"`);
      expect(body).toContain(`href="${r.website}"`);
    }
    expect((body.match(/class="roaster-card"/g) || []).length).toBe(data.roasters.length);
  });

  it('says which fulfillment is unconfirmed rather than guessing', () => {
    const unknown = data.roasters.filter((r) => r.shipping.status === 'unknown').length
      + data.roasters.filter((r) => r.pickup.status === 'unknown').length;
    expect((page.match(/class="fulfillment-unknown">Not confirmed</g) || []).length).toBe(unknown);
    expect(page).toMatch(/not exhaustive/i);
  });

  it('has its canonical URL, a title, and is indexable', () => {
    expect(page).toContain('<link rel="canonical" href="https://localcoffeeshop.co/roasters/">');
    expect(page).toContain('<meta name="robots" content="index, follow">');
    expect(page).toMatch(/<title>[^<]*Roasters[^<]*<\/title>/);
  });

  it('marks itself current in the main navigation', () => {
    expect(page).toMatch(/<nav class="site-nav" aria-label="Main">[\s\S]*<a href="\/roasters\/" aria-current="page">/);
  });

  it('has no inline executable scripts (only external files and JSON-LD)', () => {
    const scripts = [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    for (const [, attrs, body] of scripts) {
      if (/type="application\/ld\+json"/.test(attrs)) continue;
      expect(attrs, 'external script').toMatch(/\bsrc="/);
      expect(body.trim()).toBe('');
    }
    expect(page).not.toMatch(/\son[a-z]+="/i);
  });

  it('queues the consent default before gtag loads, then the banner and page script', () => {
    const order = [...page.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual([
      '/config.js',
      '/geo-consent-default.js',
      '/url-privacy.js',
      '/analytics-init.js',
      'https://www.googletagmanager.com/gtag/js?id=G-YVSXN7PM48',
      '/consent-banner.js',
      '/analytics-events.js',
      '/roasters.js',
      '/waitlist.js',
    ]);
  });

  it('only links out with plain https links (no target, no javascript:)', () => {
    for (const [, href] of page.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
      expect(href.startsWith('/') || href.startsWith('#') || href.startsWith('https://'), href).toBe(true);
    }
    expect(page).not.toMatch(/target="_blank"/);
  });
});

describe('analytics-init.js', () => {
  const FIELDS = { page_location: 'https://localcoffeeshop.co/', page_referrer: '' };
  const run = (initial, { privacy = { analyticsFields: () => FIELDS }, throwsConsent = false } = {}) => {
    const sandbox = { window: {}, Date };
    sandbox.window = sandbox;
    if (throwsConsent) sandbox.LocalCoffeeShopConsent = { getInitialConsentState: () => { throw new Error('boom'); } };
    else if (initial) sandbox.LocalCoffeeShopConsent = { getInitialConsentState: () => initial };
    if (privacy) sandbox.LcsUrlPrivacy = privacy;
    vm.runInNewContext(readFileSync(join(PUBLIC, 'analytics-init.js'), 'utf8'), sandbox);
    return { queue: sandbox.dataLayer.map((args) => Array.from(args)), sandbox };
  };

  it('queues consent default (from geo-consent-default.js) before js/config', () => {
    const initial = { analytics_storage: 'granted' };
    const { queue } = run(initial);
    expect(queue.map((a) => a[0])).toEqual(['consent', 'js', 'config']);
    expect(queue[0]).toEqual(['consent', 'default', initial]);
  });

  it('the first config carries explicit sanitised page_location and page_referrer', () => {
    const { queue } = run({ analytics_storage: 'denied' });
    expect(queue[2]).toEqual(['config', 'G-YVSXN7PM48', { page_location: FIELDS.page_location, page_referrer: '' }]);
  });

  it('defaults to denied analytics/ads if the geo default is unavailable or throws', () => {
    for (const { queue } of [run(null), run(null, { throwsConsent: true })]) {
      expect(queue[0][2]).toMatchObject({ analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    }
  });

  it.each([
    ['helper missing/blocked', { privacy: null }],
    ['helper without analyticsFields', { privacy: {} }],
    ['helper throws', { privacy: { analyticsFields: () => { throw new Error('boom'); } } }],
    ['helper returns null', { privacy: { analyticsFields: () => null } }],
    ['helper returns a raw/non-string referrer', { privacy: { analyticsFields: () => ({ page_location: 'https://x.test/', page_referrer: undefined }) } }],
  ])('FAILS CLOSED, no raw fallback, when the %s', (_label, opts) => {
    const { queue, sandbox } = run({ analytics_storage: 'granted' }, opts);
    expect(queue.map((a) => a[0])).toEqual(['consent']); // default only: no js, no config
    expect(sandbox['ga-disable-G-YVSXN7PM48']).toBe(true);
  });

  it('does not set the disable flag when everything works', () => {
    expect(run(null).sandbox['ga-disable-G-YVSXN7PM48']).toBeUndefined();
  });
});

describe('discoverability', () => {
  it('the homepage links to the roaster directory', () => {
    expect(read('public/html/index.html')).toContain('href="/roasters/"');
  });

  it.each(['public/html/about.html', 'public/pages/contact.html', 'public/pages/privacy.html'])('%s nav links to it', (p) => {
    const nav = read(p).match(/<div class="nav-links">([\s\S]*?)<\/div>/)[1];
    expect(nav).toContain('<a href="/roasters/">Roasters</a>');
  });

  it('is in the sitemap, dated by the most recent check', () => {
    const latest = data.roasters.map((r) => r.checkedAt).sort().pop();
    expect(sitemapUrls({ statesDir: '/nonexistent' })).toContainEqual(expect.objectContaining({ loc: '/roasters/', lastmod: latest }));
    expect(read('public/sitemap.xml')).toContain('<loc>https://localcoffeeshop.co/roasters/</loc>');
  });

  it('is described in llms.txt', () => {
    expect(read('public/llms.txt')).toContain('(https://localcoffeeshop.co/roasters/)');
  });
});

describe('build and CI wiring', () => {
  const pkg = JSON.parse(read('package.json'));

  it('the build validates the data and generates the page before the sitemap', () => {
    const steps = pkg.scripts.build.split('&&').map((s) => s.trim());
    expect(pkg.scripts['build:roasters']).toBe('node scripts/roasters.cjs');
    expect(pkg.scripts['check:roasters']).toBe('node scripts/roasters.cjs --check');
    expect(steps).toContain('npm run build:roasters');
    expect(steps.indexOf('npm run build:roasters')).toBeLessThan(steps.indexOf('npm run build:sitemap'));
  });

  it('CI runs the data checker', () => {
    expect(read('.github/workflows/ci.yml')).toContain('npm run check:roasters');
  });

  it('the generated page is not committed', () => {
    expect(read('.gitignore')).toMatch(/^public\/roasters\/$/m);
  });
});
